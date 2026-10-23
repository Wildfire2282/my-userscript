/**
 * 悬浮按钮的显隐。
 *
 * 只要页面上有播放器就显示：暂停、播完、还没缓冲好都不影响，只有在浏览器全屏时
 * 藏起来，避免挡住播放器控件。判断本身是纯函数，事件绑定单独一层。
 */

export interface VideoSnapshot {
  exists: boolean;
  fullscreen: boolean;
}

export function shouldShowButton(snapshot: VideoSnapshot): boolean {
  return snapshot.exists && !snapshot.fullscreen;
}

export function findVideo(doc: Document = document): HTMLVideoElement | null {
  return doc.querySelector<HTMLVideoElement>('video.html5-main-video, #movie_player video');
}

export function readVideoState(
  doc: Document = document,
  fullscreen: Element | null | undefined = undefined,
): VideoSnapshot {
  const fullscreenElement = fullscreen === undefined ? doc.fullscreenElement : fullscreen;
  return {
    exists: findVideo(doc) !== null,
    fullscreen: fullscreenElement !== null,
  };
}

export interface WatchVisibilityOptions {
  doc?: Document;
  /** 轮询间隔：播放器会随 SPA 导航整体替换，事件绑不到新节点上。 */
  intervalMs?: number;
}

/**
 * 监听播放器出现 / 消失与全屏变化。
 *
 * 只在结果变化时回调，避免每 500ms 写一次 DOM。
 *
 * @returns 清理函数（定时器与全屏监听）
 */
export function watchVisibility(
  onChange: (visible: boolean) => void,
  options: WatchVisibilityOptions = {},
): () => void {
  const doc = options.doc ?? document;
  let last: boolean | null = null;

  const emit = (): void => {
    const next = shouldShowButton(readVideoState(doc));
    if (next === last) return;
    last = next;
    onChange(next);
  };

  doc.addEventListener('fullscreenchange', emit);
  const timer = window.setInterval(emit, options.intervalMs ?? 500);
  emit();

  return () => {
    window.clearInterval(timer);
    doc.removeEventListener('fullscreenchange', emit);
  };
}
