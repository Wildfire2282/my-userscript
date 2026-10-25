/**
 * 统一日志：四个脚本的 `console.error('[slug] …', error)` 逐字同形。
 *
 * 前缀统一 `[slug]`；`warn` 用于“功能降级但主流程继续”（菜单不可用），
 * `error` 用于“某入口失败但脚本继续”（面板打不开、启动失败）。
 * 日志不含页面内容、剪贴板内容与个人信息。
 */

export interface Logger {
  /** 功能降级但主流程继续：菜单不可用之类。 */
  warn: (message: string) => void;
  /** 某入口失败但脚本继续：面板打不开、启动失败之类。 */
  error: (message: string, detail?: unknown) => void;
}

/**
 * 创建带 `[slug]` 前缀的日志器。
 *
 * @param slug 脚本标识，如 `super-drag`
 */
export function createLogger(slug: string): Logger {
  return {
    warn: (message) => console.warn(`[${slug}] ${message}`),
    error: (message, detail?: unknown) =>
      detail === undefined
        ? console.error(`[${slug}] ${message}`)
        : console.error(`[${slug}] ${message}`, detail),
  };
}

/**
 * 菜单 / 启动 / 面板打开三层错误边界的最小包装：失败只记日志，不抛给管理器与宿主页面。
 *
 * @param log 统一日志器
 * @param message 失败时的中文说明
 * @param run 实际回调
 */
export function guard(log: Logger, message: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    log.error(message, error);
  }
}
