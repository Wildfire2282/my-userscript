import { createGmApi, mergeDefaults, saveStoredSettings, type GmApi } from '@shared';

export type LinkOpenMode = 'background' | 'foreground';

/** 「自定义」引擎在 `defaultEngine` 里的取值；`engines` 里不会有这个键。 */
export const CUSTOM_ENGINE_ID = 'custom';

/** 本脚本的全部设置；字段与线上旧版存储格式逐项对应。 */
export interface Settings {
  /** 当前搜索引擎 ID：内置引擎、存储里带进来的引擎，或 `'custom'`。 */
  defaultEngine: string;
  /** `defaultEngine === 'custom'` 时使用的地址模板，必须含 `{keyword}`。 */
  customEngineUrl: string;
  /** 引擎 ID → 带 `{keyword}` 的地址模板。 */
  engines: Record<string, string>;
  enabled: boolean;
  linkOpenMode: LinkOpenMode;
}

/** 线上旧键，按 AGENTS.md 6.4 不改名，否则老用户设置会丢。 */
export const SETTINGS_KEY = 'settings';

/** 没有存量设置时使用的值。 */
export const DEFAULT_SETTINGS: Settings = {
  defaultEngine: 'google',
  customEngineUrl: '',
  engines: {
    'cn.bing': 'https://cn.bing.com/search?q={keyword}',
    bing: 'https://www.bing.com/search?q={keyword}',
    google: 'https://www.google.com/search?q={keyword}',
    baidu: 'https://www.baidu.com/s?wd={keyword}',
  },
  enabled: true,
  linkOpenMode: 'background',
};

function sanitizeEngines(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_SETTINGS.engines };
  const engines: Record<string, string> = {};
  for (const [id, template] of Object.entries(value)) {
    if (typeof template === 'string' && template !== '') engines[id] = template;
  }
  // 全是坏值时回退内置引擎，避免“一个引擎都没有”的界面。
  return Object.keys(engines).length > 0 ? engines : { ...DEFAULT_SETTINGS.engines };
}

/**
 * 把存储里读到的任意值收敛成可用设置。
 *
 * 存储可能被旧版本、手改或别的脚本写坏；单个字段坏掉只回退该字段，不让整页拖拽失效。
 */
export function normalizeSettings(stored: unknown): Settings {
  const merged = mergeDefaults(DEFAULT_SETTINGS, stored);
  const engines = sanitizeEngines(merged.engines);
  const engine =
    typeof merged.defaultEngine === 'string' && merged.defaultEngine !== ''
      ? merged.defaultEngine
      : DEFAULT_SETTINGS.defaultEngine;
  return {
    // 引擎表里没有的 ID 会让面板显示第一个引擎、实际却按 Google 搜索，收敛成默认值。
    defaultEngine:
      engine === CUSTOM_ENGINE_ID || Object.hasOwn(engines, engine)
        ? engine
        : DEFAULT_SETTINGS.defaultEngine,
    customEngineUrl: typeof merged.customEngineUrl === 'string' ? merged.customEngineUrl : '',
    engines,
    enabled: merged.enabled !== false,
    linkOpenMode: merged.linkOpenMode === 'foreground' ? 'foreground' : 'background',
  };
}

/** 设置的读取与保存入口；读取结果缓存到内存，拖拽热路径不访问 GM。 */
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
