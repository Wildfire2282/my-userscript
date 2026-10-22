/**
 * YouTube 是单页应用：换视频只改 URL 与 DOM，不会重新加载脚本。
 *
 * 这里把三种信号合成一个“该检查一次了”的回调：YouTube 自己的导航事件、
 * 地址变化、以及兜底轮询。回调只做幂等的事（按钮已存在就跳过、位置不存在就补），
 * 所以多触发几次没有副作用。
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

  const onDomChange = (): void => {
    if (doc.location.href !== lastHref) notify();
  };

  win.addEventListener('yt-navigate-finish', onNavigate);

  const observer = new MutationObserver(onDomChange);
  let observing = false;
  const observeBody = (): void => {
    if (observing || !doc.body) return;
    observer.observe(doc.body, { childList: true, subtree: true });
    observing = true;
  };
  observeBody();
  if (!observing) doc.addEventListener('DOMContentLoaded', observeBody, { once: true });

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
    doc.removeEventListener('DOMContentLoaded', observeBody);
    observer.disconnect();
    win.clearInterval(timer);
  };
}
