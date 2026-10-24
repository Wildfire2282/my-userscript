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

async function openClearDialog(): Promise<void> {
  const button = page.locator('userscript-ui-root').getByRole('button', { name: '清空本地设置' });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await page.locator('userscript-ui-root dialog').waitFor({ state: 'visible' });
}

describe('persistent alerts', () => {
  it('renders a warning with status semantics', async () => {
    const alert = page.locator('userscript-ui-root .ds-alert--warning');
    await alert.scrollIntoViewIfNeeded();

    expect(await alert.isVisible()).toBe(true);
    expect(await alert.getAttribute('role')).toBe('status');
    expect(await alert.textContent()).toContain('此操作不可撤销');
  });
});

describe('danger confirmation dialog', () => {
  it('opens as a native modal, focuses cancel, and locks page scroll', async () => {
    await openClearDialog();

    const state = await page.evaluate(() => {
      const root = (document.querySelector('userscript-ui-root') as HTMLElement)
        .shadowRoot as ShadowRoot;
      const dialog = root.querySelector('dialog') as HTMLDialogElement;
      const active = root.activeElement as HTMLElement | null;
      const rect = dialog.getBoundingClientRect();

      return {
        open: dialog.open,
        modal: dialog.matches(':modal'),
        overflow: document.documentElement.style.overflow,
        activeText: active?.textContent?.trim() ?? '',
        centeredX: Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2) < 2,
        title: dialog.querySelector('.ds-dialog-title')?.textContent,
      };
    });

    expect(state.open).toBe(true);
    expect(state.modal).toBe(true);
    expect(state.overflow).toBe('hidden');
    expect(state.activeText).toBe('取消');
    expect(state.centeredX).toBe(true);
    expect(state.title).toBe('清空本地设置？');
  });

  it('closes on Escape, restores scroll, and reports cancellation', async () => {
    await openClearDialog();
    await page.keyboard.press('Escape');
    await page.locator('userscript-ui-root dialog').waitFor({ state: 'detached' });

    const state = await page.evaluate(() => {
      const root = (document.querySelector('userscript-ui-root') as HTMLElement)
        .shadowRoot as ShadowRoot;
      return {
        overflow: document.documentElement.style.overflow,
        dialogs: root.querySelectorAll('dialog').length,
        status: root.querySelector('.demo-status')?.textContent,
      };
    });

    expect(state.overflow).toBe('');
    expect(state.dialogs).toBe(0);
    expect(state.status).toBe('已取消清空');
  });

  it('traps keyboard focus inside the modal', async () => {
    await openClearDialog();

    for (let index = 0; index < 4; index += 1) {
      await page.keyboard.press('Tab');
    }

    const inside = await page.evaluate(() => {
      const root = (document.querySelector('userscript-ui-root') as HTMLElement)
        .shadowRoot as ShadowRoot;
      const dialog = root.querySelector('dialog') as HTMLDialogElement;
      return dialog.contains(root.activeElement);
    });
    expect(inside).toBe(true);

    await page.keyboard.press('Escape');
    await page.locator('userscript-ui-root dialog').waitFor({ state: 'detached' });
  });

  it('closes when the backdrop is clicked', async () => {
    await openClearDialog();
    await page.mouse.click(10, 10);
    await page.locator('userscript-ui-root dialog').waitFor({ state: 'detached' });

    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
  });

  it('confirms the action and shows a success toast', async () => {
    await openClearDialog();
    await page
      .locator('userscript-ui-root')
      .getByRole('button', { name: '清空', exact: true })
      .click();
    await page.locator('userscript-ui-root dialog').waitFor({ state: 'detached' });

    const toast = page.locator('userscript-ui-root .ds-toast--success');
    await toast.waitFor({ state: 'visible' });

    expect(await toast.textContent()).toContain('本地设置已清空');
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
  });

  it('keeps toasts clickable while the modal is open', async () => {
    await openClearDialog();
    await page.evaluate(() => {
      const scope = window as Window & {
        __dsDemo?: {
          toast: {
            error(title: string, options?: { duration?: number }): unknown;
          };
        };
      };
      scope.__dsDemo?.toast.error('保存失败', { duration: 0 });
    });

    const toast = page.locator('userscript-ui-root .ds-toast--error').filter({
      hasText: '保存失败',
    });
    await toast.waitFor({ state: 'visible' });

    const close = toast.locator('.ds-toast-close');
    const box = await close.boundingBox();
    if (!box) throw new Error('Toast close button is not visible');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await toast.waitFor({ state: 'detached' });

    const dialogOpen = await page.evaluate(() => {
      const root = (document.querySelector('userscript-ui-root') as HTMLElement)
        .shadowRoot as ShadowRoot;
      return (root.querySelector('dialog') as HTMLDialogElement).open;
    });
    expect(dialogOpen).toBe(true);

    await page.keyboard.press('Escape');
    await page.locator('userscript-ui-root dialog').waitFor({ state: 'detached' });
    await page.mouse.move(10, 10);
  });
});

describe('toast lifecycle', () => {
  it('keeps a sticky toast after the pointer leaves', async () => {
    await page.evaluate(() => {
      const scope = window as Window & {
        __dsDemo?: {
          toast: {
            error(title: string, options?: { duration?: number }): unknown;
          };
        };
      };
      scope.__dsDemo?.toast.error('常驻错误', { duration: 0 });
    });

    const toast = page.locator('userscript-ui-root .ds-toast--error').filter({
      hasText: '常驻错误',
    });
    await toast.waitFor({ state: 'visible' });
    await toast.hover();
    await page.mouse.move(10, 10);

    expect(await toast.isVisible()).toBe(true);

    await toast.locator('.ds-toast-close').click();
    await toast.waitFor({ state: 'detached' });
    await page.mouse.move(10, 10);
  });

  it('auto-dismisses transient toasts', async () => {
    await page.evaluate(() => {
      const scope = window as Window & {
        __dsDemo?: {
          toast: {
            info(title: string, options?: { duration?: number }): unknown;
          };
        };
      };
      scope.__dsDemo?.toast.info('短通知', { duration: 300 });
    });

    const toast = page.locator('userscript-ui-root .ds-toast').filter({
      hasText: '短通知',
    });
    await toast.waitFor({ state: 'visible' });
    await toast.waitFor({ state: 'detached' });

    expect(await toast.count()).toBe(0);
  });

  it('announces errors assertively and allows manual dismissal', async () => {
    await page.evaluate(() => {
      const scope = window as Window & {
        __dsDemo?: {
          toast: {
            error(title: string, options?: { duration?: number }): unknown;
          };
        };
      };
      scope.__dsDemo?.toast.error('保存失败', { duration: 0 });
    });

    const toast = page.locator('userscript-ui-root .ds-toast--error').filter({
      hasText: '保存失败',
    });
    await toast.waitFor({ state: 'visible' });
    expect(await toast.getAttribute('role')).toBeNull();
    expect(
      await page
        .locator('userscript-ui-root .ds-toast-announcer[aria-live="assertive"]')
        .textContent(),
    ).toContain('保存失败');

    await toast.locator('.ds-toast-close').click();
    expect(await toast.count()).toBe(0);
  });
});
