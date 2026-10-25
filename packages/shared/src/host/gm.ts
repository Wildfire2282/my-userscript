/**
 * GM_* 适配层。
 *
 * 只封装线上脚本真正用到的三个同步 API；没有升级成 Promise 抽象的打算——现有 4 个脚本
 * 都只在少数几处同步读写，包一层 Promise 只会让调用点变成 async 而没有实际收益。
 *
 * 没有脚本管理器时（本地打开页面、单元测试、浏览器检查）统一降级：读不到就返回默认值，
 * 写不进去就返回 false，不抛错，调用方不需要 try/catch。
 */

/** 脚本可用的 GM 能力子集；缺失时调用返回降级值。 */
export interface GmApi {
  /** 读取存储值；缺失、出错或没有 GM 时返回 `fallback`。 */
  getValue(key: string, fallback: unknown): unknown;
  /** 写入存储值；成功返回 true。 */
  setValue(key: string, value: unknown): boolean;
  /** 注册脚本管理器菜单项；成功返回 true。 */
  registerMenuCommand(label: string, run: () => void): boolean;
}

/** 由脚本管理器注入到页面的全局函数。用可选属性表达“可能没有”。 */
interface GmGlobals {
  GM_getValue?: (key: string, fallback?: unknown) => unknown;
  GM_setValue?: (key: string, value: unknown) => void;
  GM_registerMenuCommand?: (label: string, run: () => void) => void;
}

/**
 * 把全局 GM 函数包成可注入的接口。
 *
 * @param scope 通常是 `globalThis`；测试里传假对象即可验证降级分支。
 */
export function createGmApi(scope: GmGlobals = globalThis as GmGlobals): GmApi {
  return {
    getValue(key, fallback) {
      if (typeof scope.GM_getValue !== 'function') return fallback;
      try {
        const stored = scope.GM_getValue(key, fallback);
        // 部分管理器在键不存在时返回 undefined 而不是 fallback。
        return stored === undefined ? fallback : stored;
      } catch {
        return fallback;
      }
    },
    setValue(key, value) {
      if (typeof scope.GM_setValue !== 'function') return false;
      try {
        scope.GM_setValue(key, value);
        return true;
      } catch {
        // 配额或权限问题：保留内存里的设置，不让一次写入失败中断拖拽。
        return false;
      }
    },
    registerMenuCommand(label, run) {
      if (typeof scope.GM_registerMenuCommand !== 'function') return false;
      try {
        scope.GM_registerMenuCommand(label, run);
        return true;
      } catch {
        return false;
      }
    },
  };
}
