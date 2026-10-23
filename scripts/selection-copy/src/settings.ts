import {
  createGmApi,
  createSettingsStore as createSharedStore,
  mergeDefaults,
  type GmApi,
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

/** 站点标识需要的最小 Location 形状，方便测试传入假对象。 */
export interface SiteLocation {
  hostname: string;
  protocol: string;
}

/**
 * 站点标识：HTTP(S) 用主机名，`file:` 等没有主机名的页面用协议名。
 *
 * 不用完整 origin：同一站点在 http / https 下应共用“本站暂停”的选择。
 */
export function siteKey(location: SiteLocation): string {
  const host = location.hostname.trim().toLowerCase();
  if (host !== '') return host;
  const protocol = location.protocol.replace(/:$/, '').toLowerCase();
  return protocol === '' ? 'unknown' : protocol;
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

/** 计算站点时需要知道的 frame 关系；由 `topSiteKey` 从真实 window 提取。 */
export interface FrameSiteContext {
  self: SiteLocation;
  /** 同源时是顶层页面的位置；跨域读不到时为 null。 */
  top: SiteLocation | null;
  /** `location.ancestorOrigins`，顺序从最近的父级到顶层。 */
  ancestorOrigins: readonly string[];
}

/**
 * 顶层页面决定“当前网站”。
 *
 * 用户在面板里看到的是地址栏里的站点，不是某个广告 / 播放器等 iframe 的域名；
 * 暂停顶层站点后，同页 iframe 也应当停止复制。优先读同源 `top.location`，
 * 跨域时退到 Chromium / WebKit 的 `ancestorOrigins`，再退到本帧。
 */
export function frameSiteKey(context: FrameSiteContext): string {
  if (context.top) return siteKey(context.top);
  for (let index = context.ancestorOrigins.length - 1; index >= 0; index -= 1) {
    const origin = context.ancestorOrigins[index];
    if (!origin) continue;
    try {
      return siteKey(new URL(origin));
    } catch {
      // 不透明来源（sandbox / data:）解析不了，继续看下一个。
    }
  }
  return siteKey(context.self);
}

function readAncestorOrigins(location: Location): string[] {
  const origins = (location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  if (!origins) return [];
  const list: string[] = [];
  for (let index = 0; index < origins.length; index += 1) {
    const value = origins.item(index);
    if (value) list.push(value);
  }
  return list;
}

/** 当前 frame 所属的站点；顶层页面就是它自己。 */
export function topSiteKey(win: Window): string {
  if (win.top === win) return siteKey(win.location);

  let top: SiteLocation | null = null;
  try {
    const location = win.top?.location;
    if (location) top = { hostname: location.hostname, protocol: location.protocol };
  } catch {
    // 跨域：top.location 不可读，改用 ancestorOrigins。
  }

  return frameSiteKey({
    self: win.location,
    top,
    ancestorOrigins: readAncestorOrigins(win.location),
  });
}

/** 设置的读取与保存：每次读取都看存储，iframe 与其它标签页的改动立即生效。 */
export interface SettingsStore {
  get: () => Settings;
  update: (patch: Partial<Settings>) => Settings;
}

/**
 * 创建设置仓库；读取与写回的通用逻辑在 `@shared`。
 *
 * @param api GM 适配层；测试里可以传入假实现
 */
export function createSettingsStore(api: GmApi = createGmApi()): SettingsStore {
  return createSharedStore({ api, key: SETTINGS_KEY, normalize: normalizeSettings });
}
