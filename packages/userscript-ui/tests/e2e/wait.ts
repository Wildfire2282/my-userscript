import type { Page } from 'playwright-core';

/** Waits until CSS transitions on a shadow UI element have settled. */
export async function waitForUiTransitions(page: Page, selector: string): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await page.waitForFunction((sel) => {
    const root = document.querySelector<HTMLElement>('userscript-ui-root')?.shadowRoot;
    const element = root?.querySelector(sel);
    return !element || element.getAnimations().length === 0;
  }, selector);
}

/** Waits until `mountUI()` has applied the requested theme. */
export async function waitForTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.waitForFunction(
    (next) => document.querySelector<HTMLElement>('userscript-ui-root')?.dataset.dsTheme === next,
    theme,
  );
}
