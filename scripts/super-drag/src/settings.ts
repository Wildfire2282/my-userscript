import { createGmApi, mergeDefaults, saveStoredSettings, type GmApi } from '@shared';

export type LinkOpenMode = 'background' | 'foreground';

/** 拖动文字是网址时的处理方式：直接打开，或当成搜索词。 */
export type UrlTextAction = 'open' | 'search';

/** 拖动图片时的处理方式：深色查看器，或直接打开原图。 */
export type ImageAction = 'viewer' | 'original';

/** 三类可独立停用的拖拽；关闭后这一类交还网页原生行为。 */
export interface DragKinds {
  text: boolean;
  link: boolean;
  image: boolean;
}

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
  /**
   * 打开新标签页时是否切过去。
   *
   * 键名沿用旧版（只影响链接的那一版），但语义已扩展到链接、图片和搜索；
   * 改名会让老用户设置丢失，见 AGENTS.md 6.4。
   */
  linkOpenMode: LinkOpenMode;
  /** 拖动文字本身是网址时，直接打开还是仍然搜索。 */
  urlTextAction: UrlTextAction;
  /** 拖动图片时打开查看器还是原图。 */
  imageAction: ImageAction;
  /** 三类拖拽各自的开关。 */
  dragKinds: DragKinds;
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
  linkOpenMode: 'background',
  urlTextAction: 'open',
  imageAction: 'viewer',
  dragKinds: { text: true, link: true, image: true },
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
 * 归一化三类拖拽开关。
 *
 * 只认显式的 `false`：存储里多出来的键、字符串、缺字段都按“开启”处理，
 * 避免坏值把用户唯一能用的拖拽也关掉。
 */
function sanitizeDragKinds(value: unknown): DragKinds {
  const stored =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    text: stored.text !== false,
    link: stored.link !== false,
    image: stored.image !== false,
  };
}

/**
 * 把存储里读到的任意值收敛成可用设置。
 *
 * 存储可能被旧版本、手改或别的脚本写坏；单个字段坏掉只回退该字段，不让整页拖拽失效。
 * 旧版的 `enabled` 总开关不再读取：整体停用交给脚本管理器的开关。
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
    linkOpenMode: merged.linkOpenMode === 'foreground' ? 'foreground' : 'background',
    urlTextAction: merged.urlTextAction === 'search' ? 'search' : 'open',
    imageAction: merged.imageAction === 'original' ? 'original' : 'viewer',
    dragKinds: sanitizeDragKinds(merged.dragKinds),
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
