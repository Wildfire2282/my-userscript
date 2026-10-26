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

export interface WatchGateOptions {
  /** 当前是否在播放页；生产里读地址栏，测试里传假函数。 */
  isWatchPage: () => boolean;
  /** 进入播放页时启动全部功能；只调用一次，重复进入前必有离开。 */
  onEnterWatch: () => void;
  /** 离开播放页时收掉全部功能；销毁时如果在页内也会调用一次。 */
  onLeaveWatch: () => void;
  /** 导航信号；默认用本模块的 `watchNavigation`。 */
  watchNavigate?: (onTick: () => void) => () => void;
}

/**
 * 只在播放页生效的开关。
 *
 * 直接打开非播放页时什么都不做，只留一个地址观察；单页从首页点进视频
 * （脚本不会重新注入）时靠导航信号补启动，切出播放页时收掉，避免按钮、
 * 菜单和定时器留在首页、搜索页这些地方。
 */
export function watchWatchPage(options: WatchGateOptions): () => void {
  const watchNavigate = options.watchNavigate ?? watchNavigation;
  let inside = false;

  const sync = (): void => {
    if (options.isWatchPage()) {
      if (inside) return;
      inside = true;
      options.onEnterWatch();
    } else if (inside) {
      inside = false;
      options.onLeaveWatch();
    }
  };

  sync();
  const stopNavigate = watchNavigate(sync);

  return () => {
    stopNavigate();
    if (inside) {
      inside = false;
      options.onLeaveWatch();
    }
  };
}

/**
 * 是否普通观看页。
 *
 * 离线夹具 `watch.html` 同样视为播放页，否则真实浏览器场景（file:// 协议）
 * 永远进不了播放分支；线上不存在该路径，没有误判。
 */
export function isWatchPage(doc: Document = document): boolean {
  const path = doc.location.pathname;
  return path === '/watch' || path.endsWith('/watch.html');
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
    // 后台标签页不需要同步按钮位置：切回来时导航事件或下一次轮询会补上。
    if (doc.hidden) return;
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
