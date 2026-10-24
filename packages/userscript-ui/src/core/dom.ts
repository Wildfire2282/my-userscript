export type Content = Node | string | null | undefined;

export function append(parent: Node, ...items: Content[]): void {
  for (const item of items) {
    if (item == null) continue;
    parent.appendChild(typeof item === 'string' ? document.createTextNode(item) : item);
  }
}

/**
 * 合并 `aria-describedby`：保留外部已有的 ID，只增删自己负责的那几个。
 * field、panel、tooltip 各写一份后改一处会漏两处，收到这里只留一份。
 */
export function syncDescribedBy(
  element: Element,
  owned: readonly string[],
  active: ReadonlySet<string> | readonly string[],
): void {
  const ids = new Set(
    (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean),
  );
  for (const id of owned) ids.delete(id);
  for (const id of active) ids.add(id);
  if (ids.size > 0) element.setAttribute('aria-describedby', [...ids].join(' '));
  else element.removeAttribute('aria-describedby');
}
