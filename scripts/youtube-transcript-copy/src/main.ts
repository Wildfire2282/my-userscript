import { createClipboard, createGmApi } from '@shared';
import { defaultButtonPosition, readPlayerRect } from './features/position';
import { watchNavigation } from './features/spa';
import { readVideoState, shouldShowButton, watchVisibility } from './features/visibility';
import { createStore } from './store';
import { requestPanel } from './transcript/api';
import { extractFromPanelDump, extractFromViewModel } from './transcript/extract';
import { fetchInitialTrack, readInitialTrack, type CaptionTrack } from './transcript/initial-track';
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

const MENU_ACTIONS = '操作面板';
const MENU_SETTINGS = '功能设置';

interface YtWindow extends Window {
  ytInitialPlayerResponse?: unknown;
}

function start(): void {
  if (window.top !== window.self) return;

  const gm = createGmApi();
  const store = createStore(gm);
  const clipboard = createClipboard();
  const currentVideoId = (): string => readVideoId(location.search, location.pathname);
  // 把当前视频交给网络钩子：页面还会为别的视频和翻译字幕发同样的请求，那些不能留。
  const network = installNetworkCapture(window, { currentVideoId });

  // `document-start` 时播放器响应还没有挂到 window 上，等 DOMContentLoaded 再读一次。
  // 记下它属于哪个视频：SPA 换视频后不能再拿旧视频的字幕轨。
  let initialTrack: { videoId: string; track: CaptionTrack } | null = null;
  const captureInitialTrack = (): void => {
    const track = readInitialTrack((window as YtWindow).ytInitialPlayerResponse);
    // 新视频没有字幕时也要清空，否则策略记忆会让旧视频的轨一直占着第一位。
    initialTrack = track ? { videoId: currentVideoId(), track } : null;
  };

  const service = createTranscriptService({
    videoId: currentVideoId,
    fromInitialTrack: () =>
      initialTrack && initialTrack.videoId === currentVideoId()
        ? fetchInitialTrack(initialTrack.track)
        : Promise.resolve(null),
    fromNetworkCache: () => network.get(),
    ensurePanelOpen: () => openTranscriptPanel(),
    fromViewModel: () => extractFromViewModel(document.body),
    fromPanelDump: () => extractFromPanelDump(document.body),
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

  const register = (label: string, run: () => void): void => {
    if (!gm.registerMenuCommand(label, run)) {
      console.warn(`[youtube-transcript-copy] 菜单命令不可用：${label}`);
    }
  };

  register(MENU_ACTIONS, () => app.openActions());
  register(MENU_SETTINGS, () => app.openSettings());

  const boot = (): void => {
    app.sync();
    watchVisibility((visible) => app.setVisible(visible));
    let lastVideoId = currentVideoId();
    watchNavigation(() => {
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
    window.addEventListener('resize', () => app.sync());
  };

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        captureInitialTrack();
        boot();
      },
      { once: true },
    );
  } else {
    captureInitialTrack();
    boot();
  }
}

try {
  start();
} catch (error) {
  console.error('[youtube-transcript-copy] 启动失败', error);
}
