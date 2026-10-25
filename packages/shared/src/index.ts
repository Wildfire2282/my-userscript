/**
 * @shared 门面：只导出套件运行时需要的符号。
 *
 * 目录分组（见 docs/kit.md 第 2 节）：
 * - `host/`：GM 适配、存储、剪贴板、设置仓库
 * - `settings/`：设置定义（第 2 步）
 * - `runtime/`：启动、菜单、frame、日志（第 3 步）
 * - `dom/`：真实事件目标、可编辑判定、视口夹紧（第 6 步）
 * - `url/`：URL 黑名单与解析（第 6 步）
 *
 * 规则：子目录内部可以深导入（如 `@shared/host/gm`），跨脚本只从门面拿
 * 已确认多脚本共用的符号；未迁移的分组不建空模块。
 */
export { createGmApi } from './host/gm';
export type { GmApi } from './host/gm';
export { createClipboard } from './host/clipboard';
export type { Clipboard } from './host/clipboard';
export { mergeDefaults } from './host/storage';
export { createSettingsStore } from './host/settings-store';
export type { SettingsStore } from './host/settings-store';
export { createLogger, guard } from './runtime/logger';
export type { Logger } from './runtime/logger';
