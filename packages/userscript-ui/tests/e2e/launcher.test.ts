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

function launcher() {
  return page.locator('userscript-ui-root .ds-launcher');
}

function panel() {
  return page.locator('userscript-ui-root .ds-panel[data-size="settings"]');
}

describe('floating launcher', () => {
  it('starts expanded with the panel and controls it', async () => {
    const button = launcher();
    const openPanel = panel();

    expect(await button.getAttribute('aria-expanded')).toBe('true');
    expect(await button.getAttribute('aria-label')).toBe('关闭设置');
    expect(await button.getAttribute('aria-controls')).toBe(await openPanel.getAttribute('id'));

    await button.click();
    expect(await openPanel.isHidden()).toBe(true);
    expect(await button.getAttribute('aria-expanded')).toBe('false');
    expect(await button.getAttribute('aria-label')).toBe('打开设置');
    expect(
      await page.evaluate(() => {
        const root = (document.querySelector('userscript-ui-root') as HTMLElement)
          .shadowRoot as ShadowRoot;
        return root.activeElement?.className;
      }),
    ).toContain('ds-launcher');

    await button.click();
    expect(await openPanel.isVisible()).toBe(true);
    expect(await button.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps the panel anchored above the launcher', async () => {
    const geometry = await page.evaluate(() => {
      const root = (document.querySelector('userscript-ui-root') as HTMLElement)
        .shadowRoot as ShadowRoot;
      const launcherEl = root.querySelector('.ds-launcher') as HTMLElement;
      const panelEl = root.querySelector('.ds-panel[data-size="settings"]') as HTMLElement;
      const lr = launcherEl.getBoundingClientRect();
      const pr = panelEl.getBoundingClientRect();

      return {
        launcherRight: lr.right,
        launcherBottom: lr.bottom,
        panelRight: pr.right,
        panelBottom: pr.bottom,
        gap: lr.top - pr.bottom,
      };
    });

    expect(geometry.launcherRight).toBe(980);
    expect(geometry.launcherBottom).toBe(780);
    expect(geometry.panelRight).toBe(980);
    expect(geometry.gap).toBe(8);
  });

  it('closes on Escape and returns focus to the launcher', async () => {
    const button = launcher();
    if ((await button.getAttribute('aria-expanded')) === 'true') await button.click();
    await button.click();

    await page.locator('userscript-ui-root .ds-select').first().focus();
    await page.keyboard.press('Escape');
    await panel().waitFor({ state: 'hidden' });

    expect(await launcher().getAttribute('aria-expanded')).toBe('false');
    expect(
      await page.evaluate(() => {
        const root = (document.querySelector('userscript-ui-root') as HTMLElement)
          .shadowRoot as ShadowRoot;
        return root.activeElement?.className;
      }),
    ).toContain('ds-launcher');
  });

  it('does not bubble launcher clicks to the host page', async () => {
    await page.evaluate(() => {
      const scope = window as Window & { __pageClicks?: number };
      scope.__pageClicks = 0;
      document.addEventListener('click', () => {
        scope.__pageClicks = (scope.__pageClicks ?? 0) + 1;
      });
    });

    await launcher().click();

    expect(
      await page.evaluate(() => (window as Window & { __pageClicks?: number }).__pageClicks),
    ).toBe(0);
  });
});

describe('tooltip', () => {
  it('appears on hover, positions itself, and hides on leave', async () => {
    const button = launcher();
    const tooltip = page.locator('userscript-ui-root .ds-tooltip');

    await page.click('#host-button');
    await page.mouse.move(500, 400);
    await button.hover();
    await tooltip.waitFor({ state: 'visible' });

    expect(await tooltip.isVisible()).toBe(true);
    expect(await tooltip.textContent()).toBe('打开或关闭设置面板');
    expect(await tooltip.getAttribute('data-placement')).toBe('left');

    const geometry = await page.evaluate(() => {
      const root = (document.querySelector('userscript-ui-root') as HTMLElement)
        .shadowRoot as ShadowRoot;
      const tip = root.querySelector('.ds-tooltip') as HTMLElement;
      const target = root.querySelector('.ds-launcher') as HTMLElement;
      const tr = tip.getBoundingClientRect();
      const lr = target.getBoundingClientRect();
      return {
        gap: lr.left - tr.right,
        inside:
          tr.left >= 0 &&
          tr.top >= 0 &&
          tr.right <= window.innerWidth &&
          tr.bottom <= window.innerHeight,
      };
    });

    expect(geometry.gap).toBe(8);
    expect(geometry.inside).toBe(true);

    await page.mouse.move(500, 400);
    await tooltip.waitFor({ state: 'hidden' });
    expect(await tooltip.isHidden()).toBe(true);
  });

  it('shows on keyboard focus and hides on Escape', async () => {
    const button = launcher();
    const tooltip = page.locator('userscript-ui-root .ds-tooltip');

    await button.focus();
    await tooltip.waitFor({ state: 'visible' });
    expect(await tooltip.isVisible()).toBe(true);

    await page.keyboard.press('Escape');
    expect(await tooltip.isHidden()).toBe(true);
    expect(
      await page.evaluate(() => {
        const root = (document.querySelector('userscript-ui-root') as HTMLElement)
          .shadowRoot as ShadowRoot;
        return root.activeElement?.className;
      }),
    ).toContain('ds-launcher');
  });
});
