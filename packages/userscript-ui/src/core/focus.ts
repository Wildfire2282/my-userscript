const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function focusFirst(container: HTMLElement): void {
  const root = container.getRootNode() as Document | ShadowRoot;
  for (const target of container.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    target.focus({ preventScroll: true });
    if (root.activeElement === target) return;
  }
  container.focus({ preventScroll: true });
}

export function focusIfConnected(target: HTMLElement | null): void {
  if (target?.isConnected) target.focus({ preventScroll: true });
}
