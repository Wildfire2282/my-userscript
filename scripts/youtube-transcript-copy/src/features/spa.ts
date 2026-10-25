/**
 * YouTube 是单页应用：换视频只改 URL 与 DOM，不会重新加载脚本。
 *
 * 这里把两种信号合成一个“该检查一次了”的回调：YouTube 自己的导航事件与兜底轮询。
 * 曾经还观察 body 的每次 DOM 变动来抢在轮询前发现地址变化，但全页的 MutationObserver
 * 会在 YouTube 每秒的 DOM 改动上反复回调，而地址变化本来就有导航事件和 1.5 秒轮询兜底。
 * 回调只做幂等的事（按钮已存在就跳过、位置不存在就补），所以多触发几次没有副作用。
 */

export interface WatchNavigationOptions {
  win?: Window;
  doc?: Document;
  intervalMs?: number;
}

export function watchNavigation(
  onTick: () => void,
  options: WatchNavigationOptions = {},
): () => void {
  const win = options.win ?? window;
  const doc = options.doc ?? document;
  let lastHref = doc.location.href;

  const notify = (): void => {
    lastHref = doc.location.href;
    onTick();
  };

  const onNavigate = (): void => notify();

  win.addEventListener('yt-navigate-finish', onNavigate);

  const timer = win.setInterval(() => {
    if (doc.location.href !== lastHref) {
      notify();
    } else if (doc.location.href.includes('/watch')) {
      // 视频节点可能被整体换掉而地址没变（例如播放器重载），仍需更新按钮。
      onTick();
    }
  }, options.intervalMs ?? 1500);

  return () => {
    win.removeEventListener('yt-navigate-finish', onNavigate);
    win.clearInterval(timer);
  };
}
