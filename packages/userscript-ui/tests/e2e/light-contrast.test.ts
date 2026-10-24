import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { launchBrowser, openShowcasePage } from './browser';
import { readColors } from './colors';
import { contrastRatio } from './contrast';
import { waitForUiTransitions } from './wait';

let browser: Browser;
let page: Page;

const TEXT_MIN = 4.5;
const CONTROL_MIN = 3;

beforeAll(async () => {
  browser = await launchBrowser();
  page = await openShowcasePage(browser, 'clean.html');
});

afterAll(async () => {
  await browser?.close();
});

describe('light theme contrast', () => {
  it('keeps native controls in the light color scheme', async () => {
    const schemes = await page.evaluate(() => {
      const root = (document.querySelector('userscript-ui-root') as HTMLElement)
        .shadowRoot as ShadowRoot;
      const container = root.querySelector('.ds-root') as HTMLElement;
      const select = root.querySelector('.ds-select') as HTMLElement;
      return {
        container: getComputedStyle(container).colorScheme,
        select: getComputedStyle(select).colorScheme,
      };
    });

    expect(schemes).toEqual({ container: 'light', select: 'light' });
  });

  it('keeps control boundaries at least 3:1', async () => {
    const input = await readColors(page, '.ds-input');
    const checkbox = await readColors(page, '.ds-checkbox-box');
    const panel = await readColors(page, '.ds-panel');

    expect(contrastRatio(input.border, panel.ownBg)).toBeGreaterThanOrEqual(CONTROL_MIN);
    expect(contrastRatio(checkbox.border, panel.ownBg)).toBeGreaterThanOrEqual(CONTROL_MIN);

    const switchInput = page.locator('userscript-ui-root .ds-switch-input');
    await switchInput.click();
    await page.mouse.move(10, 10);
    await waitForUiTransitions(page, '.ds-switch-track');

    const track = await readColors(page, '.ds-switch-track');
    const thumb = await readColors(page, '.ds-switch-thumb');

    expect(contrastRatio(track.ownBg, panel.ownBg)).toBeGreaterThanOrEqual(CONTROL_MIN);
    expect(contrastRatio(thumb.ownBg, track.ownBg)).toBeGreaterThanOrEqual(CONTROL_MIN);

    await switchInput.click();
  });

  it('keeps the destructive hover label readable', async () => {
    const button = page.locator('userscript-ui-root .ds-button--destructive');
    await button.scrollIntoViewIfNeeded();
    await button.hover();
    await waitForUiTransitions(page, '.ds-button--destructive');

    const colors = await readColors(page, '.ds-button--destructive');
    expect(contrastRatio(colors.fg, colors.bg)).toBeGreaterThanOrEqual(TEXT_MIN);

    await page.mouse.move(10, 10);
  });

  it('keeps muted text readable on tinted surfaces', async () => {
    const alert = await readColors(page, '.ds-alert--warning .ds-alert-description');
    const hint = await readColors(page, '.ds-scroll-hint-label');

    expect(contrastRatio(alert.fg, alert.bg)).toBeGreaterThanOrEqual(TEXT_MIN);
    expect(contrastRatio(hint.fg, hint.bg)).toBeGreaterThanOrEqual(TEXT_MIN);
  });
});
