import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { launchBrowser, openShowcasePage } from './browser';

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await launchBrowser();
});

beforeEach(async () => {
  await page?.close();
  page = await openShowcasePage(browser);
});

afterAll(async () => {
  await page?.close();
  await browser?.close();
});

describe('panel position', () => {
  it('centers the panel in the viewport when position is center', async () => {
    const geometry = await page.evaluate(() => {
      const demo = (
        window as Window & {
          __dsDemo?: { panel: { setPosition(position: 'center'): void } };
        }
      ).__dsDemo;
      demo?.panel.setPosition('center');

      const root = (document.querySelector('userscript-ui-root') as HTMLElement)
        .shadowRoot as ShadowRoot;
      const panel = root.querySelector('.ds-panel') as HTMLElement;
      const rect = panel.getBoundingClientRect();

      return {
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        width: rect.width,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });

    expect(geometry.width).toBe(440);
    expect(Math.abs(geometry.centerX - geometry.viewportWidth / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.centerY - geometry.viewportHeight / 2)).toBeLessThanOrEqual(1);
  });
});
