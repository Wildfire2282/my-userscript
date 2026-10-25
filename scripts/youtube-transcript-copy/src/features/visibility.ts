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
    // 没有 Fullscreen API 的环境里该属性是 undefined：`!== null` 会把它当成“正在全屏”，
    // 按钮就永远不显示。只认真正存在的元素。
    fullscreen: fullscreenElement != null,
  };
}

export interface WatchVisibilityOptions {
  doc?: Document;
  /** 轮询间隔：播放器会随 SPA 导航整体替换，事件绑不到新节点上。 */
  intervalMs?: number;
}

/** 播放器当前承载的视频 ID；页面还没挂播放器或读不到时返回空串。 */
export function readPlayerVideoId(doc: Document = document): string {
  const player = doc.querySelector<
    HTMLElement & { getVideoData?: () => { video_id?: unknown } | null | undefined }
  >('#movie_player');
  try {
    const id = player?.getVideoData?.()?.video_id;
    if (typeof id === 'string') return id;
  } catch {
    // 播放器还没初始化：继续看 watch 页属性。
  }
  return doc.querySelector('ytd-watch-flexy')?.getAttribute('video-id')?.trim() ?? '';
}

/**
 * DOM 里的转写面板是否属于当前视频。
 *
 * 地址栏已经换台、面板节点却还是上一个视频的：同步读 DOM 会复制到别的内容。
 * 读不到播放器 ID 时按同一视频处理，保留没有播放器信息的页面上的旧行为。
 */
export function isPlayerOnVideo(videoId: string, doc: Document = document): boolean {
  const playerId = readPlayerVideoId(doc);
  return playerId === '' || playerId === videoId;
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
