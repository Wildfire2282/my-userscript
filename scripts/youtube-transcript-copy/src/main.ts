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

/**
 * 入口：先装网络钩子（越早越好），DOM 就绪后再建悬浮按钮、挂 SPA 与播放状态监听。
 *
 * 只在顶层 frame 运行：转写面板与播放器都在主文档里，iframe 里跑一份只会重复请求。
 */

const MENU_COPY = '复制当前转写文稿';
const MENU_RESET_POSITION = '重置按钮位置';
const MENU_CLEAR_STRATEGY = '清空策略记忆';

interface YtWindow extends Window {
  ytInitialPlayerResponse?: unknown;
}

function start(): void {
  if (window.top !== window.self) return;

  const gm = createGmApi();
  const store = createStore(gm);
  const clipboard = createClipboard();
  const network = installNetworkCapture(window);
  const currentVideoId = (): string => new URLSearchParams(location.search).get('v') ?? '';

  // `document-start` 时播放器响应还没挂到 window 上，等 DOMContentLoaded 再读一次。
  // 记下它属于哪个视频：SPA 换视频后不能再拿旧视频的字幕轨。
  let initialTrack: { videoId: string; track: CaptionTrack } | null = null;
  const captureInitialTrack = (): void => {
    const track = readInitialTrack((window as YtWindow).ytInitialPlayerResponse);
    if (track) initialTrack = { videoId: currentVideoId(), track };
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
  });

  const register = (label: string, run: () => void): void => {
    if (!gm.registerMenuCommand(label, run)) {
      console.warn(`[youtube-transcript-copy] 菜单命令不可用：${label}`);
    }
  };

  register(MENU_COPY, () => {
    void (async () => {
      const outcome = await copyTranscript();
      if (outcome !== 'success') {
        // 菜单没有按钮状态可看，只把结果写进控制台；不输出任何文稿内容。
        console.warn(`[youtube-transcript-copy] 复制未成功：${outcome}`);
      }
    })();
  });
  register(MENU_RESET_POSITION, () => {
    store.clearPosition();
    app.resetPosition();
  });
  register(MENU_CLEAR_STRATEGY, () => store.clearStrategy());

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
