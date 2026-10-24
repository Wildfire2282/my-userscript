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

describe('settings panel behavior', () => {
  it('renders accessible fields linked to native controls', async () => {
    const result = await page.evaluate(() => {
      const root = (document.querySelector('userscript-ui-root') as HTMLElement)
        .shadowRoot as ShadowRoot;
      const panel = root.querySelector('.ds-panel[data-size="settings"]') as HTMLElement;
      const labels = [...root.querySelectorAll<HTMLLabelElement>('.ds-field-label')].map(
        (label) => ({
          text: label.textContent,
          target: label.htmlFor,
          exists: Boolean(root.getElementById(label.htmlFor)),
        }),
      );

      return {
        visible: !panel.hidden,
        role: panel.getAttribute('role'),
        labelCount: labels.length,
        labels,
        switches: root.querySelectorAll('[role="switch"]').length,
        checkboxes: panel.querySelectorAll('input[type="checkbox"]:not([role="switch"])').length,
      };
    });

    expect(result.visible).toBe(true);
    expect(result.role).toBe('region');
    expect(result.labelCount).toBeGreaterThanOrEqual(6);
    expect(result.labels.every((label) => label.exists)).toBe(true);
    expect(result.switches).toBe(1);
    expect(result.checkboxes).toBe(1);
  });

  it('toggles the switch and updates its checked state', async () => {
    const switchInput = page.locator('userscript-ui-root .ds-switch-input');
    expect(await switchInput.getAttribute('aria-checked')).toBe('true');

    await switchInput.click();

    expect(await switchInput.getAttribute('aria-checked')).toBe('false');
  });

  it('shows a validation error for an invalid URL', async () => {
    const apiInput = page.locator('userscript-ui-root .ds-input[type="url"]');
    await apiInput.fill('not-a-url');
    await page.locator('userscript-ui-root').getByRole('button', { name: '保存设置' }).click();

    expect(await apiInput.getAttribute('aria-invalid')).toBe('true');
    expect(
      await page
        .locator('userscript-ui-root .ds-field-error')
        .filter({ hasText: 'http(s)' })
        .isVisible(),
    ).toBe(true);
  });

  it.each(['', '0', '201', '1.5'])('rejects an invalid maximum entry count: %s', async (value) => {
    const apiInput = page.locator('userscript-ui-root .ds-input[type="url"]');
    const maxInput = page.locator('userscript-ui-root .ds-input[type="number"]');
    await apiInput.fill('');
    await maxInput.fill(value);
    await page.locator('userscript-ui-root').getByRole('button', { name: '保存设置' }).click();

    expect(await maxInput.getAttribute('aria-invalid')).toBe('true');
    expect(
      await page
        .locator('userscript-ui-root .ds-field-error')
        .filter({ hasText: '1–200' })
        .isVisible(),
    ).toBe(true);
    expect(
      await page
        .locator('userscript-ui-root')
        .getByRole('button', { name: '保存设置' })
        .isEnabled(),
    ).toBe(true);
    await page
      .locator('userscript-ui-root')
      .getByRole('button', { name: '重置', exact: true })
      .click();
    expect(await maxInput.getAttribute('aria-invalid')).toBeNull();
    expect(await maxInput.inputValue()).toBe('50');
  });

  it('closes with Escape, restores focus, and reopens on the first control', async () => {
    await page.locator('userscript-ui-root .ds-input[type="url"]').focus();
    await page.keyboard.press('Escape');

    const panel = page.locator('userscript-ui-root .ds-panel[data-size="settings"]');
    expect(await panel.isHidden()).toBe(true);

    await page.evaluate(() => {
      const scope = window as Window & {
        __dsDemo?: { panel: { open(): void } };
      };
      scope.__dsDemo?.panel.open();
    });
    expect(await panel.isVisible()).toBe(true);

    const focused = await page.evaluate(() => {
      const root = (document.querySelector('userscript-ui-root') as HTMLElement)
        .shadowRoot as ShadowRoot;
      return {
        className: root.activeElement?.className ?? '',
        tagName: root.activeElement?.tagName ?? '',
      };
    });
    expect(focused.tagName).toBe('SELECT');
  });

  it('keeps the panel inside the viewport and scrolls its body', async () => {
    const geometry = await page.evaluate(() => {
      const root = (document.querySelector('userscript-ui-root') as HTMLElement)
        .shadowRoot as ShadowRoot;
      const panel = root.querySelector('.ds-panel[data-size="settings"]') as HTMLElement;
      const body = panel.querySelector('.ds-panel-body') as HTMLElement;
      const footer = panel.querySelector('.ds-panel-footer') as HTMLElement;
      const rect = panel.getBoundingClientRect();

      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        scrollable: body.scrollHeight > body.clientHeight,
        footerVisible: footer.getBoundingClientRect().height > 0,
      };
    });

    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(1000);
    expect(geometry.bottom).toBeLessThanOrEqual(800);
    expect(geometry.width).toBe(360);
    expect(geometry.scrollable).toBe(true);
    expect(geometry.footerVisible).toBe(true);
  });

  it('hints that more content is below and hides the hint at the bottom', async () => {
    const hint = page.locator('userscript-ui-root .ds-panel[data-size="settings"] .ds-scroll-hint');
    expect(await hint.isVisible()).toBe(true);
    expect(await hint.textContent()).toContain('向下滚动查看更多内容');

    const state = await page.evaluate(async () => {
      const root = (document.querySelector('userscript-ui-root') as HTMLElement)
        .shadowRoot as ShadowRoot;
      const panel = root.querySelector('.ds-panel[data-size="settings"]') as HTMLElement;
      const body = panel.querySelector('.ds-panel-body') as HTMLElement;
      const scrollHint = panel.querySelector('.ds-scroll-hint') as HTMLElement;
      const nextFrame = () =>
        new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

      body.scrollTop = body.scrollHeight;
      await nextFrame();
      await nextFrame();
      const atBottom = scrollHint.dataset.state;

      body.scrollTop = 0;
      await nextFrame();
      await nextFrame();
      const atTop = scrollHint.dataset.state;

      return { atBottom, atTop };
    });

    expect(state.atBottom).toBe('hidden');
    expect(state.atTop).toBe('visible');
  });
});

async function openOperationPanel(): Promise<void> {
  await page
    .locator('userscript-ui-root')
    .getByRole('button', { name: '打开操作面板', exact: true })
    .click();
}

describe('operation panel', () => {
  it('switches from the settings panel to the wider operation panel', async () => {
    await openOperationPanel();

    const settings = page.locator('userscript-ui-root .ds-panel[data-size="settings"]');
    const operation = page.locator('userscript-ui-root .ds-panel[data-size="operation"]');
    expect(await settings.isHidden()).toBe(true);
    expect(await operation.isVisible()).toBe(true);

    const geometry = await page.evaluate(() => {
      const root = (document.querySelector('userscript-ui-root') as HTMLElement)
        .shadowRoot as ShadowRoot;
      const panel = root.querySelector('.ds-panel[data-size="operation"]') as HTMLElement;
      const footer = panel.querySelector('.ds-panel-footer') as HTMLElement;
      const grid = panel.querySelector('.demo-op-grid') as HTMLElement;
      const rect = panel.getBoundingClientRect();

      return {
        width: rect.width,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        maxHeight: Number.parseFloat(getComputedStyle(panel).maxHeight),
        footerVisible: footer.getBoundingClientRect().height > 0,
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      };
    });

    expect(geometry.width).toBe(560);
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(1000);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(800);
    expect(geometry.maxHeight).toBeLessThanOrEqual(640);
    expect(geometry.footerVisible).toBe(true);
    expect(geometry.columns).toBe(2);
  });

  it('returns to the settings panel from the operation footer', async () => {
    await openOperationPanel();
    await page
      .locator('userscript-ui-root')
      .getByRole('button', { name: '打开设置面板', exact: true })
      .click();

    expect(
      await page.locator('userscript-ui-root .ds-panel[data-size="settings"]').isVisible(),
    ).toBe(true);
    expect(
      await page.locator('userscript-ui-root .ds-panel[data-size="operation"]').isHidden(),
    ).toBe(true);
  });

  it('fits narrow viewports without overflowing horizontally', async () => {
    await page.evaluate(() => {
      const demo = (
        window as Window & {
          __dsDemo?: {
            panel: { close(): void };
            operationPanel: { open(): void };
          };
        }
      ).__dsDemo;
      demo?.panel.close();
      demo?.operationPanel.open();
    });
    await page.setViewportSize({ width: 420, height: 800 });

    const geometry = await page.evaluate(() => {
      const root = (document.querySelector('userscript-ui-root') as HTMLElement)
        .shadowRoot as ShadowRoot;
      const panel = root.querySelector('.ds-panel[data-size="operation"]') as HTMLElement;
      const rect = panel.getBoundingClientRect();
      return { width: rect.width, left: rect.left, right: rect.right };
    });

    expect(geometry.width).toBe(380);
    expect(geometry.left).toBe(20);
    expect(geometry.right).toBe(400);
  });
});
