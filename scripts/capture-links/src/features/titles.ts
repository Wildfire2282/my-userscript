/**
 * 链接标题的取值策略，与线上旧版一致：先找能代表整行的 `title` 属性，
 * 再用链接自身的文字，最后退回地址本身。
 *
 * 列表里的链接常常只是“下载”两个字，光看链接文字没有信息量；外层行 / 列表项 /
 * 表格行上的 `title` 往往才是用户能认出的名字。
 */

const MAX_TITLE_LENGTH = 200;

function usableTitle(value: string | null | undefined): string | null {
  const text = value?.trim() ?? '';
  return text.length > 0 && text.length < MAX_TITLE_LENGTH ? text : null;
}

/**
 * 取一条链接的展示标题。
 *
 * @param node 链接元素；允许为空
 * @param fallback 都取不到时使用的文字（通常是地址）
 */
export function bestTitle(node: Element | null, fallback: string): string {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  if (!element) return fallback;

  const candidates = [
    element.closest('[title]'),
    element.closest('tr'),
    element.closest('li'),
    element.parentElement,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const title = usableTitle(candidate.getAttribute('title'));
    if (title !== null) return title;
  }

  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  return usableTitle(text) ?? fallback;
}
