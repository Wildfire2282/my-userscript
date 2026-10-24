export type Content = Node | string | null | undefined;

export function append(parent: Node, ...items: Content[]): void {
  for (const item of items) {
    if (item == null) continue;
    parent.appendChild(typeof item === 'string' ? document.createTextNode(item) : item);
  }
}
