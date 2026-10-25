import { isOwnUiNode } from '@ui';
import { collectLinks, type LinkCandidate, type LinkItem } from '../links';
import { bestTitle } from './titles';

/**
 * 递归收 `open` 影子节点里的链接：组件化页面常把弹窗、播放器里的 `<a>` 藏在这里。
 * `closed` 影子节点浏览器不让进，只能放弃。
 *
 * 一遍遍历：先取本层全部元素，再对带 shadowRoot 的下钻；不对每个元素重复查子树，
 * 否则大页面是 O(n²)。
 */
function collectAnchors(root: ParentNode, found: HTMLAnchorElement[] = []): HTMLAnchorElement[] {
  const scope = root as Document | DocumentFragment | Element;
  if (typeof scope.querySelectorAll !== 'function') return found;
  for (const element of scope.querySelectorAll('*')) {
    // 自己的界面：扫进去只会把面板里的按钮和目标当链接。
    if (isOwnUiNode(element)) continue;
    if (element.tagName === 'A' && element.hasAttribute('href')) {
      found.push(element as HTMLAnchorElement);
    }
    if (element.shadowRoot) collectAnchors(element.shadowRoot, found);
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
 * @param baseHref 解析相对地址用的基准地址；默认取文档 baseURI（含 `<base href>`）
 */
export function scanLinks(doc: Document = document, baseHref?: string): LinkItem[] {
  if (!doc.body) return [];
  const base = baseHref ?? doc.baseURI;
  const candidates: LinkCandidate[] = collectAnchors(doc).map((anchor) => {
    // SVG `<a>` 的 href 是 SVGAnimatedString，不是字符串；只有 HTML 锚点才读它。
    const resolved = anchor.href;
    return {
      rawHref: anchor.getAttribute('href') ?? '',
      absoluteHref: typeof resolved === 'string' ? resolved : '',
      title: bestTitle(anchor, ''),
    };
  });
  return collectLinks(candidates, base);
}
