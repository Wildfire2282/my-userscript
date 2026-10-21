/**
 * 拖拽落点识别：从按下的位置往上找最近的链接 / 图片。
 *
 * 只在 dragstart 时调用一次。快路径用 `closest()` 覆盖普通页面；穿透 Shadow DOM
 * 时才走 `elementFromPoint` 逐层查找，避免给热路径加开销。
 */

export interface HitResult {
  /** 最近的链接地址；`''` 表示没有 */
  link: string;
  /** 最近的图片地址；`''` 表示没有 */
  image: string;
}

const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** 跨 Shadow 边界找父元素：先看 parentElement，再回到宿主。 */
export function parentAcrossShadow(node: Element): Element | null {
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

export function isIgnorableHref(href: string | null): boolean {
  return !href || href === '#' || href.toLowerCase().startsWith('javascript:');
}

/**
 * 解析链接地址。
 *
 * HTML 的 `a.href` 已是绝对地址，但 SVG 的 `<a>` 返回 SVGAnimatedString，
 * 所以统一读原始属性并用 `document.baseURI` 补全，顺带支持 `xlink:href`。
 */
export function resolveLinkHref(node: Element): string {
  const raw = node.getAttribute('href') ?? node.getAttributeNS(XLINK_NS, 'href') ?? '';
  if (raw === '') return '';
  try {
    return new URL(raw, document.baseURI).href;
  } catch {
    return '';
  }
}

/** 逐层穿透 open Shadow Root 取真实元素。 */
export function deepElementFromPoint(x: number, y: number): Element | null {
  let root: Document | ShadowRoot = document;
  let element: Element | null = null;
  for (;;) {
    let next: Element | null;
    try {
      next = root.elementFromPoint(x, y);
    } catch {
      next = null;
    }
    if (!next) break;
    element = next;
    if (next.shadowRoot && next.shadowRoot.mode === 'open') root = next.shadowRoot;
    else break;
  }
  return element;
}

/** 快路径：事件目标本身或其祖先就是链接 / 图片。 */
export function hitTestFast(target: Element | null): HitResult | null {
  if (!target || target.nodeType !== Node.ELEMENT_NODE || typeof target.closest !== 'function') {
    return null;
  }
  const tag = target.tagName.toUpperCase();

  let link = '';
  const linkEl = tag === 'A' ? target : target.closest('a');
  if (linkEl && !isIgnorableHref(linkEl.getAttribute('href'))) link = resolveLinkHref(linkEl);

  let image = '';
  if (tag === 'IMG') {
    const img = target as HTMLImageElement;
    image = img.currentSrc || img.src || '';
  }

  return link || image ? { link, image } : null;
}

/** 慢路径：一次命中测试后往上爬，收集最近的链接 / 图片。 */
export function hitTestSlow(x: number, y: number): HitResult {
  const found: HitResult = { link: '', image: '' };
  let node = deepElementFromPoint(x, y);
  while (node) {
    const tag = node.tagName.toUpperCase();
    if (found.link === '' && tag === 'A') {
      if (!isIgnorableHref(node.getAttribute('href'))) {
        found.link = resolveLinkHref(node);
        // 链接优先于图片，拿到就不再往上爬。
        if (found.link !== '') break;
      }
    } else if (found.image === '' && tag === 'IMG') {
      const img = node as HTMLImageElement;
      found.image = img.currentSrc || img.src || '';
    }
    node = parentAcrossShadow(node);
  }
  return found;
}

export function hitTest(x: number, y: number, target: Element | null): HitResult {
  return hitTestFast(target) ?? hitTestSlow(x, y);
}
