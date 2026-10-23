/**
 * 链接的纯逻辑：解码、补全地址、去重、筛选。
 *
 * 不访问 DOM：页面扫描在 `features/scan-page.ts`，这里只处理已经取到的字符串，
 * 所以绝大多数边界都能用 Vitest 直接覆盖。
 */

/** 页面上的一条链接；`id` 与 `url` 相同，选中状态按它记录。 */
export interface LinkItem {
  id: string;
  url: string;
  title: string;
}

/** 从 `<a>` 上取到的原始字段；`absoluteHref` 是浏览器解析后的 `a.href`。 */
export interface LinkCandidate {
  rawHref: string;
  absoluteHref: string;
  title: string;
}

/** 线上旧版对地址做的实体解码；链接文字与地址都可能来自被转义的页面。
 *
 * 一次只解一层：`&amp;lt;` 还原成 `&lt;` 就停，不再往 `<` 解，
 * 否则页面原文里就写着 `&lt;` 的地方会被多解一层。 */
export function decodeText(text: string): string {
  return text.replace(
    /&(amp|lt|gt|quot|nbsp|#39|#\d+|#x[0-9a-f]+);/gi,
    (match, name: string) => {
      switch (name.toLowerCase()) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'nbsp':
          return ' ';
        case '#39':
          return "'";
        default: {
          // 数字实体：`&#58;` / `&#x3A;`；非法编码原样保留。
          const lower = name.toLowerCase();
          const code = lower.startsWith('#x')
            ? Number.parseInt(lower.slice(2), 16)
            : Number(lower.slice(1));
          return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
            ? String.fromCodePoint(code)
            : match;
        }
      }
    },
  );
}

export function normalizeUrl(url: string): string {
  return decodeText(url).trim();
}

/** 不执行的链接协议：不能打开、复制出来也是坏地址，列表里直接不要。 */
const BLOCKED_SCHEMES = /^(javascript|data|vbscript):/i;

/**
 * 把 `href` 补成绝对地址。
 *
 * @param rawHref 元素上的原始 `href`
 * @param baseHref 页面地址，用来解析相对地址
 * @param absoluteHref 浏览器已经解析好的 `a.href`，解析失败时用它兜底
 * @returns 归一化后的地址；空地址或不可执行的协议返回 `null`
 */
export function resolveUrl(rawHref: string, baseHref: string, absoluteHref = ''): string | null {
  const raw = rawHref.trim();
  if (raw === '' || BLOCKED_SCHEMES.test(raw)) return null;
  let resolved: string;
  try {
    resolved = new URL(raw, baseHref).toString();
  } catch {
    resolved = absoluteHref || raw;
  }
  const normalized = normalizeUrl(resolved);
  if (normalized === '' || BLOCKED_SCHEMES.test(normalized)) return null;
  return normalized;
}

/**
 * 汇总页面链接：忽略空地址，按绝对地址去重，第一条出现的标题优先。
 *
 * @param candidates 扫描到的候选链接
 * @param baseHref 页面地址，用来解析相对地址
 */
export function collectLinks(candidates: LinkCandidate[], baseHref: string): LinkItem[] {
  const seen = new Map<string, LinkItem>();
  for (const candidate of candidates) {
    const url = resolveUrl(candidate.rawHref, baseHref, candidate.absoluteHref);
    if (url === null || seen.has(url)) continue;
    seen.set(url, { id: url, url, title: candidate.title.trim() || url });
  }
  return [...seen.values()];
}

export function isMagnetLink(url: string): boolean {
  return url.toLowerCase().startsWith('magnet:');
}

/**
 * 按关键词与“仅磁链”筛选。
 *
 * 关键词同时匹配标题和地址，大小写不敏感；空关键词表示不过滤。
 */
export function filterLinks(items: LinkItem[], keyword: string, onlyMagnet: boolean): LinkItem[] {
  const needle = keyword.trim().toLowerCase();
  return items.filter((item) => {
    if (onlyMagnet && !isMagnetLink(item.url)) return false;
    if (needle === '') return true;
    return item.title.toLowerCase().includes(needle) || item.url.toLowerCase().includes(needle);
  });
}
