import { createClipboard, createGmApi, createUserscript } from '@shared';
import { defaultButtonPosition, readPlayerRect } from './features/position';
import { watchNavigation } from './features/spa';
import {
  isPlayerOnVideo,
  readVideoState,
  shouldShowButton,
  watchVisibility,
} from './features/visibility';
import { createStore } from './store';
import { requestPanel } from './transcript/api';
import { extractFromPanelDump, extractFromViewModel } from './transcript/extract';
import {
  fetchInitialTrack,
  readInitialTrack,
  readPlayerResponse,
  type CaptionTrack,
} from './transcript/initial-track';
import { formatLines } from './transcript/format';
import { installNetworkCapture } from './transcript/network';
import { openTranscriptPanel } from './transcript/open-panel';
import { createTranscriptService } from './transcript/service';
import { createTranscriptButtonApp, type CopyOutcome } from './ui/app';
import { readVideoId } from './transcript/network';

/**
 * 入口：先装网络钩子（越早越好），DOM 就绪后再建悬浮按钮、挂 SPA 与播放状态监听。
 *
 * 只在顶层 frame 运行：转写面板与播放器都在主文档里，iframe 里跑一份只会重复请求。
 */
createUserscript(createGmApi(), {
  slug: 'youtube-transcript-copy',
  // 无 `@noframes`，同域 iframe 也会被 `@match` 注入：顶层判断不能省。
  topFrameOnly: true,
  installLock: false,
  onStart: () => {
    const currentVideoId = (): string => readVideoId(location.search, location.pathname);
    // 把当前视频交给网络钩子：页面还会为别的视频和翻译字幕发同样的请求，那些不能留。
    // `document-start` 同步执行，抢在页面 JS 之前；清理只在卸载时 restore。
    const network = installNetworkCapture(window, { currentVideoId });
    return () => network.restore();
  },
  onReady: (kit) => {
    // `document-start` 时播放器响应还没有挂到 window 上，等 DOM 就绪后再读一次。
    // 记下它属于哪个视频：SPA 换视频后不能再拿旧视频的字幕轨。
    const store = createStore(kit.gm);
    const clipboard = createClipboard();
    const currentVideoId = (): string => readVideoId(location.search, location.pathname);
    // onStart 与 onReady 各自独立：网络钩子在 onStart 里已装，这里只拿缓存读口。
    // 重复注入（多管理器）时复用同一份捕获，不重复包装 fetch。
    const network = installNetworkCapture(window, { currentVideoId });

    let initialTrack: CaptionTrack | null = null;
    const captureInitialTrack = (): void => {
      const videoId = currentVideoId();
      // 首屏之后 ytInitialPlayerResponse 可能还停在旧视频；播放器自己的响应更新。
      // 新视频没有字幕时也要清空，否则策略记忆会让旧视频的轨一直占着第一位。
      initialTrack =
        [readPlayerResponse(), (window as YtWindow).ytInitialPlayerResponse]
          .map(readInitialTrack)
          .find((track) => track !== null && track.videoId === videoId) ?? null;
    };
    captureInitialTrack();

    const service = createTranscriptService({
      videoId: currentVideoId,
      fromInitialTrack: () =>
        initialTrack && initialTrack.videoId === currentVideoId()
          ? fetchInitialTrack(initialTrack)
          : Promise.resolve(null),
      fromNetworkCache: () => network.get(),
      ensurePanelOpen: () => openTranscriptPanel(),
      // 地址栏已经换台时，DOM 可能还是上一个视频的面板；同步读取没有 await 守卫。
      fromViewModel: () =>
        isPlayerOnVideo(currentVideoId()) ? extractFromViewModel(document.body) : null,
      fromPanelDump: () =>
        isPlayerOnVideo(currentVideoId()) ? extractFromPanelDump(document.body) : null,
      fromApi: (videoId) => requestPanel(videoId),
      memory: {
        get: store.getStrategy,
        remember: (kind, index) => store.rememberStrategy(kind, index),
      },
    });

    const copyTranscript = async (): Promise<CopyOutcome> => {
      const segments = await service.fetchTranscript();
      if (segments.length === 0) return 'empty';
      const written = await clipboard.copy(formatLines(segments));
      return written ? 'success' : 'error';
    };

    const app = createTranscriptButtonApp({
      getSavedPosition: store.getPosition,
      savePosition: store.savePosition,
      getDefaultPosition: () =>
        defaultButtonPosition(readPlayerRect(), {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      isVisible: () => shouldShowButton(readVideoState()),
      activate: copyTranscript,
      clearSavedPosition: store.clearPosition,
      clearStrategy: store.clearStrategy,
    });

    kit.menu({ label: '操作面板', run: () => app.openActions() });
    kit.menu({ label: '功能设置', run: () => app.openSettings() });

    app.sync();
    const stopVisibility = watchVisibility((visible) => app.setVisible(visible));
    let lastVideoId = currentVideoId();
    const stopNavigation = watchNavigation(() => {
      // SPA 换视频：网络缓存的旧转写不能留给新视频，服务层按 videoId 也不会复用缓存。
      const videoId = currentVideoId();
      if (videoId !== lastVideoId) {
        lastVideoId = videoId;
        network.clear();
        // 新视频有自己的首条字幕轨，重读一次；否则旧轨的失败记忆会拖慢每次复制。
        captureInitialTrack();
      }
      app.sync();
    });
    // 拖动窗口时 resize 每帧触发多次，而每次同步都要读播放器布局；同一帧只测一次。
    let resizeFrame = 0;
    const onResize = (): void => {
      if (resizeFrame !== 0) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0;
        app.sync();
      });
    };
    window.addEventListener('resize', onResize, { signal: kit.signal });

    return () => {
      stopVisibility();
      stopNavigation();
      window.cancelAnimationFrame(resizeFrame);
      app.destroy();
    };
  },
});

interface YtWindow extends Window {
  ytInitialPlayerResponse?: unknown;
}
