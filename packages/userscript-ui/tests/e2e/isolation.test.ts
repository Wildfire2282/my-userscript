import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { launchBrowser, openShowcasePage } from './browser';
import { relativeLuminance } from './contrast';
import { waitForTheme } from './wait';

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

describe('shadow DOM isolation', () => {
  it('keeps component styles independent from aggressive host CSS', async () => {
    const result = await page.evaluate(() => {
      const host = document.querySelector('userscript-ui-root') as HTMLElement;
      const root = host.shadowRoot as ShadowRoot;
      const panel = root.querySelector('.ds-panel') as HTMLElement;
      const title = root.querySelector('.ds-panel-title') as HTMLElement;
      const button = root.querySelector('.ds-button--primary') as HTMLElement;
      const input = root.querySelector('.ds-input') as HTMLElement;
      const hostButton = document.querySelector('#host-button') as HTMLElement;

      return {
        hostCount: document.querySelectorAll('userscript-ui-root').length,
        hostPointer: getComputedStyle(host).pointerEvents,
        pageFont: getComputedStyle(document.body).fontFamily,
        panelFont: getComputedStyle(panel).fontFamily,
        panelFontSize: getComputedStyle(panel).fontSize,
        titleSize: getComputedStyle(title).fontSize,
        buttonBg: getComputedStyle(button).backgroundColor,
        inputFontSize: getComputedStyle(input).fontSize,
        hostButtonBg: getComputedStyle(hostButton).backgroundColor,
        hostButtonRadius: getComputedStyle(hostButton).borderRadius,
      };
    });

    expect(result.hostCount).toBe(1);
    expect(result.hostPointer).toBe('none');
    expect(result.pageFont).toContain('Comic Sans');
    expect(result.panelFont).not.toContain('Comic Sans');
    expect(result.panelFontSize).toBe('14px');
    expect(result.titleSize).toBe('16px');
    expect(result.buttonBg).toBe('rgb(24, 24, 27)');
    expect(result.inputFontSize).toBe('13px');
    expect(result.hostButtonBg).toBe('rgb(255, 105, 180)');
    expect(result.hostButtonRadius).toBe('0px');
  });

  it('does not block clicks on the host page', async () => {
    await page.evaluate(() => {
      const scope = window as Window & { __hostClicks?: number };
      scope.__hostClicks = 0;
      document.querySelector('#host-button')?.addEventListener('click', () => {
        scope.__hostClicks = (scope.__hostClicks ?? 0) + 1;
      });
    });

    await page.click('#host-button');

    const clicks = await page.evaluate(
      () => (window as Window & { __hostClicks?: number }).__hostClicks,
    );
    expect(clicks).toBe(1);
  });

  it('switches theme without leaking styles to the host', async () => {
    await page.locator('userscript-ui-root .ds-select').first().selectOption('dark');
    await waitForTheme(page, 'dark');

    const result = await page.evaluate(() => {
      const host = document.querySelector('userscript-ui-root') as HTMLElement;
      const root = host.shadowRoot as ShadowRoot;
      const panel = root.querySelector('.ds-panel') as HTMLElement;
      const button = root.querySelector('.ds-button--primary') as HTMLElement;
      const hostButton = document.querySelector('#host-button') as HTMLElement;

      return {
        theme: host.dataset.dsTheme,
        panelBg: getComputedStyle(panel).backgroundColor,
        panelColor: getComputedStyle(panel).color,
        buttonBg: getComputedStyle(button).backgroundColor,
        hostButtonBg: getComputedStyle(hostButton).backgroundColor,
      };
    });

    expect(result.theme).toBe('dark');
    expect(relativeLuminance(result.panelBg)).toBeLessThan(0.05);
    expect(result.panelColor).toBe('rgb(250, 250, 250)');
    expect(result.buttonBg).toBe('rgb(250, 250, 250)');
    expect(result.hostButtonBg).toBe('rgb(255, 105, 180)');
  });
});
