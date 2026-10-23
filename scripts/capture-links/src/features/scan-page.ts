import { collectLinks, type LinkCandidate, type LinkItem } from '../links';
import { bestTitle } from './titles';

/** 递归收 `open` 影子节点里的链接：组件化页面常把弹窗、播放器里的 `<a>` 藏在这里。
 * `closed` 影子节点浏览器不让进，只能放弃。 */
function collectAnchors(root: ParentNode): HTMLAnchorElement[] {
  const scope = root as Document | DocumentFragment | Element;
  if (typeof scope.querySelectorAll !== 'function') return [];
  const found = [...scope.querySelectorAll<HTMLAnchorElement>('a[href]')];
  for (const element of scope.querySelectorAll('*')) {
    if (element.shadowRoot) found.push(...collectAnchors(element.shadowRoot));
  }
  return found;
}

/**
 * 扫描页面里的全部 `<a href>`。
 *
 * 只读 DOM：把元素上的字段交给 `collectLinks` 做补全与去重，方便单测直接覆盖
 * 地址规则；标题策略单独放在 `titles.ts`。
 *
 * @param doc 目标文档，默认当前页面
 * @param baseHref 解析相对地址用的页面地址；默认取文档自身的地址
 */
export function scanLinks(doc: Document = document, baseHref?: string): LinkItem[] {
  if (!doc.body) return [];
  const base = baseHref ?? doc.location?.href ?? '';
  const candidates: LinkCandidate[] = collectAnchors(doc).map((anchor) => ({
    rawHref: anchor.getAttribute('href') ?? '',
    absoluteHref: anchor.href,
    title: bestTitle(anchor, ''),
  }));
  return collectLinks(candidates, base);
}
