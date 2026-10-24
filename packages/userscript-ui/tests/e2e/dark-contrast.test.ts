import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { launchBrowser, openShowcasePage } from './browser';
import { readColors } from './colors';
import { contrastRatio } from './contrast';
import { waitForTheme, waitForUiTransitions } from './wait';

let browser: Browser;
let page: Page;

const TEXT_MIN = 4.5;
const CONTROL_MIN = 3;
const FIELD_BORDER_MIN = 3;

beforeAll(async () => {
  browser = await launchBrowser();
  page = await openShowcasePage(browser, 'clean.html');
  await page.locator('userscript-ui-root .ds-select').first().selectOption('dark');
  await waitForTheme(page, 'dark');
});

afterAll(async () => {
  await browser?.close();
});

describe('dark theme contrast', () => {
  it('keeps native controls in the dark color scheme', async () => {
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

    expect(schemes).toEqual({ container: 'dark', select: 'dark' });
  });

  it('keeps panel text readable on the dark surface', async () => {
    const title = await readColors(page, '.ds-panel-title');
    const description = await readColors(page, '.ds-panel-description');
    const fieldDescription = await readColors(page, '.ds-field-description');

    expect(contrastRatio(title.fg, title.bg)).toBeGreaterThanOrEqual(TEXT_MIN);
    expect(contrastRatio(description.fg, description.bg)).toBeGreaterThanOrEqual(TEXT_MIN);
    expect(contrastRatio(fieldDescription.fg, fieldDescription.bg)).toBeGreaterThanOrEqual(
      TEXT_MIN,
    );
  });

  it('keeps button labels readable on their own background', async () => {
    const primary = await readColors(page, '.ds-button--primary');
    const secondary = await readColors(page, '.ds-button--secondary');
    const destructive = await readColors(page, '.ds-button--destructive');

    expect(contrastRatio(primary.fg, primary.bg)).toBeGreaterThanOrEqual(TEXT_MIN);
    expect(contrastRatio(secondary.fg, secondary.bg)).toBeGreaterThanOrEqual(TEXT_MIN);
    expect(contrastRatio(destructive.fg, destructive.bg)).toBeGreaterThanOrEqual(TEXT_MIN);
  });

  it('keeps the validation error readable', async () => {
    const input = page.locator('userscript-ui-root .ds-input[type="url"]');
    await input.fill('not-a-url');
    await page.locator('userscript-ui-root').getByRole('button', { name: '保存设置' }).click();

    const error = page.locator('userscript-ui-root .ds-field-error:not([hidden])');
    await error.waitFor({ state: 'visible' });

    const colors = await readColors(page, '.ds-field-error:not([hidden])');
    expect(contrastRatio(colors.fg, colors.bg)).toBeGreaterThanOrEqual(TEXT_MIN);
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

  it('keeps switch and field boundaries distinguishable', async () => {
    const switchInput = page.locator('userscript-ui-root .ds-switch-input');
    await switchInput.click();
    await page.mouse.move(10, 10);
    await waitForUiTransitions(page, '.ds-switch-track');

    const thumb = await readColors(page, '.ds-switch-thumb');
    const track = await readColors(page, '.ds-switch-track');
    const input = await readColors(page, '.ds-input');
    const panel = await readColors(page, '.ds-panel');

    expect(contrastRatio(thumb.ownBg, track.ownBg)).toBeGreaterThanOrEqual(CONTROL_MIN);
    expect(contrastRatio(track.ownBg, panel.ownBg)).toBeGreaterThanOrEqual(CONTROL_MIN);
    expect(contrastRatio(input.border, panel.ownBg)).toBeGreaterThanOrEqual(FIELD_BORDER_MIN);
  });
});
