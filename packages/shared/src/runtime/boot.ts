import type { GmApi } from '../host/gm';
import { createLogger, guard, type Logger } from './logger';

/**
 * 安装锁：同一文档只装一份。
 *
 * 不同管理器的沙箱之间 window 不一定共享，DOM 一定共享，所以用元素属性而不用
 * window 标记。selection-copy 的 `data-selection-auto-copy-installed` 沿用此实现。
 */
export function installOnce(attribute: string): boolean {
  const root = document.documentElement;
  if (!root || root.hasAttribute(attribute)) return false;
  root.setAttribute(attribute, '');
  return true;
}

/**
 * 站点标识：HTTP(S) 用顶层主机名，`file:` 等无主机名页面用协议名。
 *
 * 同域 iframe 里 `window.top.location` 可读；跨域读顶层会抛错，回退读
 * `location.ancestorOrigins`（顶层在最后），再回退本帧。无主机名用 protocol。
 * selection-copy 的 `topSiteKey` 语义与此一致，第 6 步搬纯函数时可合。
 *
 * @param win 当前 frame 的 window；测试里传假对象
 */
export function siteKey(win: Window): string {
  const hostOf = (hostname: string, protocol: string): string | null => {
    const host = hostname.trim().toLowerCase();
    if (host !== '') return host;
    const scheme = protocol.replace(/:$/, '').trim().toLowerCase();
    return scheme !== '' ? scheme : null;
  };
  try {
    const top = win.top?.location;
    const hit = top && hostOf(top.hostname, top.protocol);
    if (hit) return hit;
  } catch {
    // 跨域：读顶层抛错，走下面的 ancestorOrigins 回退。
  }
  try {
    const origins = (win.location as Location & { ancestorOrigins?: unknown }).ancestorOrigins as
      { length: number; [index: number]: unknown } | undefined;
    if (origins && typeof origins.length === 'number') {
      for (let index = origins.length - 1; index >= 0; index--) {
        try {
          const url = new URL(String(origins[index]));
          const hit = hostOf(url.hostname, url.protocol);
          if (hit) return hit;
        } catch {
          // 单个 origin 解析失败就跳过，看下一个。
        }
      }
    }
  } catch {
    // ancestorOrigins 不可用就回退本帧。
  }
  return hostOf(win.location.hostname, win.location.protocol) ?? 'unknown';
}

/** 菜单项：label 为中文动作名；`topFrameOnly` 为真时只在顶层注册。 */
export interface MenuItem {
  label: string;
  run: () => void;
  topFrameOnly?: boolean;
}

/** `createUserscript` 的启动参数。 */
export interface UserscriptOptions {
  /** 日志与错误文案共用的标识，如 `super-drag`。 */
  slug: string;
  /** 安装锁属性名；`false` 关闭（已有 `@noframes` 且无重复注入风险的脚本）。 */
  installLock?: string | false;
  /** 为真时只在顶层 frame 启动；默认 false（selection-copy 需要每个 iframe 都跑）。 */
  topFrameOnly?: boolean;
  /** 菜单项；注册失败只告警。 */
  menus?: MenuItem[];
  /**
   * 脚本执行时同步运行；需要抢在页面 JS 之前的行为放这里
   * （youtube 的转写网络钩子）。可返回清理函数。
   */
  onStart?: () => void | (() => void);
  /**
   * DOM 就绪后运行。用 `document.readyState` 判断：已就绪同步跑，
   * 否则等 `DOMContentLoaded`（once）。可返回清理函数。
   */
  onReady?: (kit: UserscriptKit) => void | (() => void);
}

/** 传给 `onReady` 的套件工具。 */
export interface UserscriptKit {
  /** 脚本的 GM 能力。 */
  gm: GmApi;
  /** 统一日志器。 */
  log: Logger;
  /** 页面级 signal：监听挂这里，`destroy()` 时统一清理。 */
  signal: AbortSignal;
  /** 注册菜单项；`topFrameOnly` 的项只在顶层注册。 */
  menu: (item: MenuItem) => void;
}

/**
 * 脚本启动器：安装锁、frame 判断、菜单注册、DOM 就绪、pagehide 清理。
 *
 * - 顶层 `guard` 兜住同步启动异常（与各脚本原有顶层 try/catch 同语义）。
 * - `onStart` 同步执行，不等 DOM；`onReady` 等 DOM 就绪。
 * - 清理函数幂等；`pagehide` 且 `persisted === false` 时自动调用。
 * - 菜单回调统一 `guard` 包裹；注册失败只告警，不阻断脚本主功能。
 *
 * @param gmApi GM 适配层；测试里传假实现
 * @param options 启动参数
 * @returns `destroy` 供页面卸载与测试调用
 */
export function createUserscript(
  gmApi: GmApi,
  options: UserscriptOptions,
): { destroy: () => void } {
  const { slug, installLock = true, topFrameOnly = false, menus = [] } = options;
  const log = createLogger(slug);
  const cleanups: Array<() => void> = [];
  let destroyed = false;

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    for (const cleanup of [...cleanups].reverse()) {
      try {
        cleanup();
      } catch {
        // 清理失败不能打断后面的清理。
      }
    }
    cleanups.length = 0;
  };

  const controller = new AbortController();
  cleanups.push(() => controller.abort());
  const onPageHide = (event: PageTransitionEvent): void => {
    // bfcache 恢复时还要继续用；只有真正离开才清理。
    if (!event.persisted) destroy();
  };
  window.addEventListener('pagehide', onPageHide);
  cleanups.push(() => window.removeEventListener('pagehide', onPageHide));

  const menu = (item: MenuItem): void => {
    if ((item.topFrameOnly ?? false) && window.top !== window.self) return;
    // 管理器调用的就是带错误边界的版本，异常不冒给管理器。
    const wrapped = (): void => guard(log, `打开${item.label}失败`, item.run);
    if (!gmApi.registerMenuCommand(item.label, wrapped)) {
      log.warn(`菜单命令不可用：${item.label}`);
    }
  };

  guard(log, '启动失败', () => {
    if (typeof installLock === 'string' && !installOnce(installLock)) return;
    if (topFrameOnly && window.top !== window.self) return;

    const startCleanup = options.onStart?.();
    if (typeof startCleanup === 'function') cleanups.push(startCleanup);

    for (const item of menus) menu(item);

    const runReady = (): void => {
      if (destroyed) return;
      const readyCleanup = options.onReady?.({ gm: gmApi, log, signal: controller.signal, menu });
      if (typeof readyCleanup === 'function') cleanups.push(readyCleanup);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', runReady, {
        once: true,
        signal: controller.signal,
      });
    } else {
      runReady();
    }
  });

  return { destroy };
}
