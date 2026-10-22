/**
 * 悬浮按钮的显隐。
 *
 * 只在视频真的在播放时出现：暂停、播完、还没缓冲好、或者页面进了浏览器全屏时
 * 都藏起来，避免挡住播放器控件。判断本身是纯函数，事件绑定单独一层。
 */

export interface VideoSnapshot {
  exists: boolean;
  paused: boolean;
  ended: boolean;
  readyState: number;
  fullscreen: boolean;
}

export function shouldShowButton(snapshot: VideoSnapshot): boolean {
  return (
    snapshot.exists &&
    !snapshot.paused &&
    !snapshot.ended &&
    snapshot.readyState > 2 &&
    !snapshot.fullscreen
  );
}

export function findVideo(doc: Document = document): HTMLVideoElement | null {
  return doc.querySelector<HTMLVideoElement>('video.html5-main-video, #movie_player video');
}

interface WebkitDocument extends Document {
  webkitFullscreenElement?: Element | null;
}

export function readVideoState(
  doc: Document = document,
  fullscreen: Element | null | undefined = undefined,
): VideoSnapshot {
  const video = findVideo(doc);
  const fullscreenElement =
    fullscreen === undefined
      ? (doc.fullscreenElement ?? (doc as WebkitDocument).webkitFullscreenElement ?? null)
      : fullscreen;
  return {
    exists: video !== null,
    paused: video?.paused ?? true,
    ended: video?.ended ?? false,
    readyState: video?.readyState ?? 0,
    fullscreen: fullscreenElement !== null,
  };
}

export interface WatchVisibilityOptions {
  doc?: Document;
  /** 轮询间隔：播放器会随 SPA 导航整体替换，事件绑不到新节点上。 */
  intervalMs?: number;
}

/**
 * 监听播放状态与全屏变化。
 *
 * 只在结果变化时回调，避免每 500ms 写一次 DOM；视频节点被替换后自动重新绑定。
 *
 * @returns 清理函数（定时器与所有监听）
 */
export function watchVisibility(
  onChange: (visible: boolean) => void,
  options: WatchVisibilityOptions = {},
): () => void {
  const doc = options.doc ?? document;
  let video: HTMLVideoElement | null = null;
  let last: boolean | null = null;

  const emit = (): void => {
    const next = shouldShowButton(readVideoState(doc));
    if (next === last) return;
    last = next;
    onChange(next);
  };

  const detach = (): void => {
    if (!video) return;
    for (const type of ['play', 'pause', 'ended', 'loadeddata'] as const) {
      video.removeEventListener(type, emit);
    }
    video = null;
  };

  const bind = (): void => {
    const found = findVideo(doc);
    if (found === video) return;
    detach();
    video = found;
    if (!video) return;
    for (const type of ['play', 'pause', 'ended', 'loadeddata'] as const) {
      video.addEventListener(type, emit);
    }
  };

  const onFullscreen = (): void => emit();

  doc.addEventListener('fullscreenchange', onFullscreen);
  doc.addEventListener('webkitfullscreenchange', onFullscreen);
  const timer = window.setInterval(() => {
    bind();
    emit();
  }, options.intervalMs ?? 500);

  bind();
  emit();

  return () => {
    window.clearInterval(timer);
    doc.removeEventListener('fullscreenchange', onFullscreen);
    doc.removeEventListener('webkitfullscreenchange', onFullscreen);
    detach();
  };
}
