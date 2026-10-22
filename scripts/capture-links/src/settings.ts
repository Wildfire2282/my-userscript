import { createGmApi, mergeDefaults, saveStoredSettings, type GmApi } from '@shared';

/** 复制到剪贴板的格式；线上旧键 `copyFormat` 的取值。 */
export type CopyFormat = 'url' | 'markdown' | 'html';

/** 本脚本的全部设置；字段与线上旧版存储格式逐项对应。 */
export interface Settings {
  /** 是否显示右下角悬浮按钮；关掉后只能从油猴菜单打开面板。 */
  showFloatButton: boolean;
  /** 复制选中链接时使用的格式。 */
  copyFormat: CopyFormat;
}

/** 线上旧键，按 AGENTS.md 6.4 不改名，否则老用户设置会丢。 */
export const SETTINGS_KEY = 'settings';

/** 没有存量设置时使用的值。 */
export const DEFAULT_SETTINGS: Settings = {
  showFloatButton: true,
  copyFormat: 'url',
};

/** 把任意存储值或控件值收敛成合法的复制格式。 */
export function toCopyFormat(value: unknown): CopyFormat {
  return value === 'markdown' || value === 'html' ? value : 'url';
}

/**
 * 把存储里读到的任意值收敛成可用设置。
 *
 * 单个字段坏掉只回退该字段：存储可能被旧版本、手改或别的脚本写坏，
 * 不能让一个坏值把悬浮按钮或复制格式一起弄丢。
 */
export function normalizeSettings(stored: unknown): Settings {
  const merged = mergeDefaults(DEFAULT_SETTINGS, stored);
  return {
    // 只认显式的 false：缺字段、字符串、多余键都按“显示”处理。
    showFloatButton: merged.showFloatButton !== false,
    copyFormat: toCopyFormat(merged.copyFormat),
  };
}

/** 设置的读取与保存入口；读取结果缓存到内存，打开面板时不重复访问 GM。 */
export interface SettingsStore {
  get: () => Settings;
  update: (patch: Partial<Settings>) => Settings;
}

/**
 * 创建设置仓库。
 *
 * @param api GM 适配层；测试里可以传入假实现
 */
export function createSettingsStore(api: GmApi = createGmApi()): SettingsStore {
  let cache: Settings | null = null;

  const get = (): Settings => {
    if (!cache) cache = normalizeSettings(api.getValue(SETTINGS_KEY, null));
    return cache;
  };

  return {
    get,
    update(patch) {
      const next: Settings = { ...get(), ...patch };
      cache = next;
      // 写失败时保留内存副本：本次浏览仍然按新设置工作，不打断用户。
      saveStoredSettings(api, SETTINGS_KEY, next);
      return next;
    },
  };
}
