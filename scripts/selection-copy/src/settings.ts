import {
  createGmApi,
  defineSettings,
  mergeDefaults,
  type GmApi,
  type DefinedSettings,
} from '@shared';

/**
 * 本脚本的设置。
 *
 * 默认值与 1.2.0 的行为逐项一致：升级后不重新配置也感觉不到变化。
 * 存储里只认明确写出的值，坏数据回退默认，避免一次误写让脚本整体失效。
 */

export interface Settings {
  /** 总开关。关闭后不复制、不提示，但保留菜单入口以便重新打开。 */
  enabled: boolean;
  /** 在 input / textarea 里选中时也复制。默认关闭：编辑文字时会不停覆盖剪贴板。 */
  copyInInputs: boolean;
  /** 在 contenteditable 区域里选中时也复制。默认关闭，理由同上。 */
  copyInEditors: boolean;
  /** 复制前去掉首尾空白；关闭后按原样复制。 */
  trimWhitespace: boolean;
  /** 不自动复制的站点，值为 `siteKey()` 的结果。 */
  disabledSites: string[];
}

/** 新键按 AGENTS.md 6.4 的 `<slug>:<area>.<key>` 命名。 */
export const SETTINGS_KEY = 'selection-copy:config.settings';

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  copyInInputs: false,
  copyInEditors: false,
  trimWhitespace: true,
  disabledSites: [],
};

function normalizeSites(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const sites = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const site = item.trim().toLowerCase();
    if (site !== '') sites.add(site);
  }
  return [...sites];
}

/**
 * 把存储里读到的任意值收敛成可用设置。
 *
 * 布尔字段只在“明确写了”时改变默认值：旧版没有这些字段，缺字段必须保持旧行为。
 */
export function normalizeSettings(stored: unknown): Settings {
  const merged = mergeDefaults(DEFAULT_SETTINGS, stored);
  return {
    enabled: merged.enabled !== false,
    copyInInputs: merged.copyInInputs === true,
    copyInEditors: merged.copyInEditors === true,
    trimWhitespace: merged.trimWhitespace !== false,
    disabledSites: normalizeSites(merged.disabledSites),
  };
}

/** 面板里展示的站点名；`file` 不是真实主机名，换成中文说明。 */
export function siteLabel(site: string): string {
  return site === 'file' ? '本机文件' : site;
}

/** 当前站点是否允许自动复制。 */
export function isEnabledOn(settings: Settings, site: string): boolean {
  return settings.enabled && !settings.disabledSites.includes(site);
}

/** 生成“在 / 不在本站复制”的新设置，不改原对象。 */
export function withSiteEnabled(settings: Settings, site: string, enabled: boolean): Settings {
  const others = settings.disabledSites.filter((item) => item !== site);
  return { ...settings, disabledSites: enabled ? others : [...others, site] };
}

/** 设置的读取与保存：每次读取都看存储，iframe 与其它标签页的改动立即生效。 */
export type SettingsStore = DefinedSettings<Settings>;

/**
 * 创建设置仓库；读取与写回的通用逻辑在 `@shared`。
 *
 * @param api GM 适配层；测试里可以传入假实现
 */
export function createSettingsStore(api: GmApi = createGmApi()): SettingsStore {
  return defineSettings({
    api,
    key: SETTINGS_KEY,
    defaults: DEFAULT_SETTINGS,
    normalize: normalizeSettings,
  });
}
