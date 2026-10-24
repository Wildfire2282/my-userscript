import { CUSTOM_ENGINE_ID, DEFAULT_SETTINGS, type Settings } from './settings';

/** 设置面板里“效果预览”使用的示例关键词。 */
export const PREVIEW_KEYWORD = 'hello';

/** 内置引擎的显示名；存储里新增的引擎直接用 ID 当名字。 */
const ENGINE_LABELS: Record<string, string> = {
  'cn.bing': 'Bing (CN)',
  bing: 'Bing',
  google: 'Google',
  baidu: 'Baidu',
};

const GOOGLE_FALLBACK = 'https://www.google.com/search?q={keyword}';

export interface EngineOption {
  value: string;
  label: string;
}

/** 未知引擎 ID 的显示名：把 `my-engine` 转成 `My Engine`，而不是直接甩出原始 ID。 */
function humanizeEngineId(id: string): string {
  return id
    .split(/[-_]/)
    .map((part) => (part === '' ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

/** 下拉选项：存储里的引擎 + 自定义。顺序沿用存储顺序，保证旧用户看到的顺序不变。 */
export function engineOptions(settings: Settings): EngineOption[] {
  const options = Object.keys(settings.engines).map((id) => ({
    value: id,
    label: Object.hasOwn(ENGINE_LABELS, id) ? ENGINE_LABELS[id]! : humanizeEngineId(id),
  }));
  options.push({ value: CUSTOM_ENGINE_ID, label: '自定义' });
  return options;
}

/** 解析当前引擎的地址模板；配置无效时回退 Google，而不是打开一个坏地址。 */
export function resolveSearchTemplate(settings: Settings): string {
  const template =
    settings.defaultEngine === CUSTOM_ENGINE_ID
      ? settings.customEngineUrl
      : settings.engines[settings.defaultEngine];
  if (typeof template !== 'string' || !template.includes('{keyword}')) return GOOGLE_FALLBACK;
  return template;
}

/** 把关键词编码后填进模板，得到最终搜索地址。 */
export function buildSearchUrl(settings: Settings, keyword: string): string {
  // 用户可以在自定义地址里写多个 {keyword}（例如同时带进 query 与 hash）。
  return resolveSearchTemplate(settings).replaceAll('{keyword}', encodeURIComponent(keyword));
}

/**
 * 校验自定义搜索地址。
 *
 * @returns 错误文案；`null` 表示可用
 */
export function validateCustomEngineUrl(url: string): string | null {
  const value = url.trim();
  if (value === '') return '请填写自定义搜索 URL';
  if (!value.includes('{keyword}')) return '自定义搜索 URL 必须包含 {keyword} 占位符';
  if (!/^https?:\/\//i.test(value)) return '自定义搜索 URL 必须以 http:// 或 https:// 开头';
  // 交给 URL 解析：前缀正则会放过 `https://?q=` 与带空格的地址，保存后打开是错误页。
  let parsed: URL;
  try {
    parsed = new URL(value.replaceAll('{keyword}', 'x'));
  } catch {
    return '自定义搜索 URL 不是有效地址';
  }
  if (parsed.hostname === '') return '自定义搜索 URL 缺少域名';
  if (/\s/.test(value)) return '自定义搜索 URL 不能包含空格';
  return null;
}

/** 默认设置的深拷贝，供“恢复默认”按钮使用。 */
export function defaultSettings(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    engines: { ...DEFAULT_SETTINGS.engines },
    dragKinds: { ...DEFAULT_SETTINGS.dragKinds },
  };
}
