import { createClipboard, createGmApi, createUserscript, type UserscriptKit } from '@shared';
import { defaultButtonPosition, readPlayerRect } from './features/position';
import { isWatchPage, watchNavigation, watchWatchPage } from './features/spa';
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
 * 入口：只在播放页生效。
 *
 * 播放页直接装网络钩子（越早越好），DOM 就绪后建悬浮按钮、挂 SPA 与播放状态监听；
 * 首页、搜索页只留一个地址观察，切进播放页才启动，切出去收掉。
 *
 * 只在顶层 frame 运行：转写面板与播放器都在主文档里，iframe 里跑一份只会重复请求。
 */
createUserscript(createGmApi(), {
  slug: 'youtube-transcript-copy',
  // 无 `@noframes`，同域 iframe 也会被 `@match` 注入：顶层判断不能省。
  topFrameOnly: true,
  installLock: false,
  onStart: () => {
    // 非播放页不装网络钩子：首页、搜索页这些地方没有任何属于脚本的东西在运行。
    // 单页从这些地方点进视频时，由下面的播放页开关补装（见 onReady）。
    if (!isWatchPage()) return undefined;
    const currentVideoId = (): string => readVideoId(location.search, location.pathname);
    // `document-start` 同步执行，抢在页面 JS 之前；清理只在卸载时 restore。
    const network = installNetworkCapture(window, { currentVideoId });
    return () => network.restore();
  },
  onReady: (kit) => {
    // 只在播放页生效：直接打开首页、搜索页时仅留一个地址观察；
    // 单页切进播放页时补启动，切出去时收掉（菜单项一旦注册无法撤回，随页面卸载消失）。
    let stopWatch: (() => void) | null = null;
    return watchWatchPage({
      isWatchPage: () => isWatchPage(document),
      onEnterWatch: () => {
        stopWatch = startOnWatchPage(kit);
      },
      onLeaveWatch: () => {
        stopWatch?.();
        stopWatch = null;
      },
    });
  },
});

/**
 * 播放页内的全部功能：网络缓存、服务、悬浮按钮、菜单、SPA 与显隐监听。
 *
 * 调用方保证只在播放页调用、离开时调用返回的清理函数；重复进入会重新调用。
 */
function startOnWatchPage(kit: UserscriptKit): () => void {
  // `document-start` 时播放器响应还没有挂到 window 上，等 DOM 就绪后再读一次。
  // 记下它属于哪个视频：SPA 换视频后不能再拿旧视频的字幕轨。
  const store = createStore(kit.gm);
  const clipboard = createClipboard();
  const currentVideoId = (): string => readVideoId(location.search, location.pathname);
  // 直接打开播放页时钩子在 onStart 里已装好，这里复用同一份；单页从首页点进来时
  // onStart 跳过了安装，这里补装（会晚于首屏请求，首条字幕轨不受影响）。
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

  // 面板兜底打开时记下复原动作；取完（无论成败）立刻执行，页面尽量回到原样。
  let restorePage: (() => void) | null = null;

  const service = createTranscriptService({
    videoId: currentVideoId,
    fromInitialTrack: () =>
      initialTrack && initialTrack.videoId === currentVideoId()
        ? fetchInitialTrack(initialTrack)
        : Promise.resolve(null),
    fromNetworkCache: () => network.get(),
    // 静默层全失败才会走到这里：打开面板会动页面，复制完由 copyTranscript 复原。
    ensurePanelOpen: async () => {
      const result = await openTranscriptPanel();
      restorePage = result.restore;
      return result.opened;
    },
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
    const segments = await service.fetchTranscript().finally(() => {
      // 取完就不再需要面板里的内容：先把页面恢复原状，再写剪贴板。
      restorePage?.();
      restorePage = null;
    });
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
      // 新视频的响应可能已经先到：只清旧视频的捕获。
      network.clear(videoId);
      // 新视频有自己的首条字幕轨，重读一次；否则旧轨的失败记忆会拖慢每次复制。
      captureInitialTrack();
    }
    app.sync();
  });
  // 拖动窗口时 resize 每帧触发多次，而每次同步都要读播放器布局；同一帧只测一次。
  // 监听挂在本次启动自己的 signal 上：切出播放页时一起收掉，进出多次不累积。
  const scope = new AbortController();
  let resizeFrame = 0;
  const onResize = (): void => {
    if (resizeFrame !== 0) return;
    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = 0;
      app.sync();
    });
  };
  window.addEventListener('resize', onResize, { signal: scope.signal });

  return () => {
    scope.abort();
    stopVisibility();
    stopNavigation();
    window.cancelAnimationFrame(resizeFrame);
    app.destroy();
    // 切出播放页后不留请求包装：下次进来重新装，不影响页面自己的请求。
    network.restore();
  };
}

interface YtWindow extends Window {
  ytInitialPlayerResponse?: unknown;
}

interface YtWindow extends Window {
  ytInitialPlayerResponse?: unknown;
}
