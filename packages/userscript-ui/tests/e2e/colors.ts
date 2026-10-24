import type { Page } from 'playwright-core';

export interface ElementColors {
  fg: string;
  bg: string;
  ownBg: string;
  border: string;
}

/**
 * Reads colors as plain sRGB. Canvas normalizes color-mix() and oklab()
 * values that getComputedStyle can return for mixed colors.
 */
export function readColors(page: Page, selector: string): Promise<ElementColors> {
  return page.evaluate((sel) => {
    const root = document.querySelector('userscript-ui-root')?.shadowRoot;
    const el = root?.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`element not found: ${sel}`);

    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const toRgb = (value: string): string => {
      if (!ctx) return value;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return `rgb(${r} ${g} ${b})`;
    };

    let node: HTMLElement | null = el;
    let bg = 'rgb(0 0 0)';
    while (node) {
      const value = getComputedStyle(node).backgroundColor;
      if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') {
        bg = toRgb(value);
        break;
      }
      node = node.parentElement;
    }

    return {
      fg: toRgb(getComputedStyle(el).color),
      bg,
      ownBg: toRgb(getComputedStyle(el).backgroundColor),
      border: toRgb(getComputedStyle(el).borderTopColor),
    };
  }, selector);
}
