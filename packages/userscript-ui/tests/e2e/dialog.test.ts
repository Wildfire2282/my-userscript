import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Browser, Page } from 'playwright-core';
import type * as Library from '../../src/index';
import { launchBrowser, uiRoot } from './browser';

declare global {
  interface Window {
    UserscriptUI: typeof Library;
  }
}

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await launchBrowser();
});

beforeEach(async () => {
  await page?.close();
  page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.goto(pathToFileURL(resolve(uiRoot, 'tests/e2e/fixtures/stress.html')).href);
  await page.addScriptTag({ path: resolve(uiRoot, 'dist/lib/userscript-ui.iife.js') });
});

afterAll(async () => {
  await browser?.close();
});

describe('native dialog lifecycle', () => {
  it('settles an open dialog and restores scroll on UI destruction', async () => {
    const state = await page.evaluate(async () => {
      const { mountUI, createDialog } = window.UserscriptUI;
      const ui = mountUI();
      const dialog = createDialog(ui, { title: '确认' });
      const result = dialog.open();
      ui.destroy();
      return {
        value: await result,
        overflow: document.documentElement.style.overflow,
        connected: dialog.el.isConnected,
      };
    });
    expect(state).toEqual({ value: null, overflow: '', connected: false });
  });

  it('allows immediate reopening without a stale close event settling the next result', async () => {
    const state = await page.evaluate(async () => {
      const { mountUI, createDialog } = window.UserscriptUI;
      const ui = mountUI();
      const values: (string | null)[] = [];
      const dialog = createDialog(ui, { title: '确认', onClose: (value) => values.push(value) });
      const first = dialog.open();
      // Chrome 111 has no Promise.withResolvers; await the native close signal.
      const closed = new Promise<Event>((resolve) =>
        dialog.el.addEventListener('close', resolve, { once: true }),
      );
      dialog.close('first');
      const second = dialog.open();
      await closed;
      const reopened = dialog.el.matches(':modal');
      dialog.close('second');
      const results = await Promise.all([first, second]);
      dialog.close('unused');
      dialog.destroy();
      ui.destroy();
      return { reopened, results, values };
    });
    expect(state).toEqual({
      reopened: true,
      results: ['first', 'second'],
      values: ['first', 'second'],
    });
  });

  it('supports reopening from onClose without losing the new result', async () => {
    const state = await page.evaluate(async () => {
      const { mountUI, createDialog } = window.UserscriptUI;
      const ui = mountUI();
      let next: Promise<string | null> | undefined;
      const dialog = createDialog(ui, {
        title: '确认',
        onClose: (value) => {
          if (value === 'first') next = dialog.open();
        },
      });
      const first = dialog.open();
      // Await the queued native event, not a guessed wall-clock delay.
      const closed = new Promise<Event>((resolve) =>
        dialog.el.addEventListener('close', resolve, { once: true }),
      );
      dialog.close('first');
      await closed;
      const reopened = dialog.el.matches(':modal');
      dialog.close('second');
      const results = await Promise.all([first, next]);
      ui.destroy();
      return { reopened, results };
    });
    expect(state).toEqual({ reopened: true, results: ['first', 'second'] });
  });

  it('only dismisses on clicks outside the dialog bounds', async () => {
    await page.evaluate(() => {
      const { mountUI, createDialog } = window.UserscriptUI;
      const ui = mountUI();
      void createDialog(ui, { title: '确认' }).open();
    });
    const dialog = page.locator('userscript-ui-root dialog');
    const box = await dialog.boundingBox();
    if (!box) throw new Error('Dialog is not visible');
    await page.mouse.click(box.x, box.y + box.height / 2);
    expect(await dialog.evaluate((el) => (el as HTMLDialogElement).open)).toBe(true);
    await page.mouse.click(10, 10);
    expect(await dialog.evaluate((el) => (el as HTMLDialogElement).open)).toBe(false);
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
  });

  it('keeps the shared lock until the last dialog closes and restores important overflow', async () => {
    const state = await page.evaluate(async () => {
      const { mountUI, createDialog } = window.UserscriptUI;
      document.documentElement.style.setProperty('overflow', 'scroll', 'important');
      const firstUI = mountUI();
      const secondUI = mountUI();
      const first = createDialog(firstUI, { title: '第一个' });
      const second = createDialog(secondUI, { title: '第二个' });
      const results = [first.open(), second.open()];
      firstUI.destroy();
      const stillLocked = getComputedStyle(document.documentElement).overflow;
      secondUI.destroy();
      await Promise.all(results);
      return {
        stillLocked,
        overflow: document.documentElement.style.overflow,
        priority: document.documentElement.style.getPropertyPriority('overflow'),
      };
    });
    expect(state).toEqual({ stillLocked: 'hidden', overflow: 'scroll', priority: 'important' });
  });

  it('rolls back scroll locking when showModal fails instead of opening a nonmodal fallback', async () => {
    const state = await page.evaluate(() => {
      const { mountUI, createDialog } = window.UserscriptUI;
      const ui = mountUI();
      const dialog = createDialog(ui, { title: '确认' });
      dialog.el.remove();
      let error = '';
      try {
        void dialog.open();
      } catch (value) {
        error = (value as Error).name;
      }
      const state = {
        error,
        overflow: document.documentElement.style.overflow,
        open: dialog.el.open,
      };
      ui.destroy();
      return state;
    });
    expect(state).toEqual({ error: 'InvalidStateError', overflow: '', open: false });
  });

  it('focuses the first usable panel control past hidden, inert and disabled candidates', async () => {
    const focused = await page.evaluate(() => {
      const { mountUI, createPanel } = window.UserscriptUI;
      const ui = mountUI();
      const panel = createPanel(ui, { title: '设置', open: false });
      const hidden = document.createElement('button');
      hidden.hidden = true;
      const fieldset = document.createElement('fieldset');
      fieldset.disabled = true;
      fieldset.append(document.createElement('button'));
      const inert = document.createElement('div');
      inert.inert = true;
      inert.append(document.createElement('button'));
      const visible = document.createElement('button');
      visible.textContent = '可用操作';
      panel.body.append(hidden, fieldset, inert, visible);
      panel.open();
      const focused = ui.root.activeElement === visible;
      ui.destroy();
      return focused;
    });
    expect(focused).toBe(true);
  });

  it('hints that more content is below inside a long dialog', async () => {
    const state = await page.evaluate(async () => {
      const { mountUI, createDialog } = window.UserscriptUI;
      const ui = mountUI();
      const content = Array.from({ length: 40 }, (_, index) => {
        const line = document.createElement('p');
        line.textContent = `第 ${index + 1} 行`;
        return line;
      });
      const dialog = createDialog(ui, { title: '长内容', content });
      void dialog.open();
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

      const body = ui.root.querySelector('.ds-dialog-body') as HTMLElement;
      const hint = ui.root.querySelector('.ds-scroll-hint') as HTMLElement;
      const visible = hint.dataset.state;

      body.scrollTop = body.scrollHeight;
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

      const atBottom = hint.dataset.state;
      dialog.close();
      ui.destroy();
      return { visible, atBottom, label: hint.textContent };
    });
    expect(state.visible).toBe('visible');
    expect(state.atBottom).toBe('hidden');
    expect(state.label).toContain('Scroll for more');
  });

  it('renders tooltips above an open modal', async () => {
    const state = await page.evaluate(() => {
      const { mountUI, createButton, createDialog, createTooltip } = window.UserscriptUI;
      const ui = mountUI();
      const target = createButton(ui, { label: '目标' });
      const dialog = createDialog(ui, { title: '说明', content: target.el });
      const tooltip = createTooltip(ui, target.el, { content: '补充说明' });
      void dialog.open();
      tooltip.show();

      // The tooltip is pointer-events:none in production. Enable hit testing
      // for this assertion so elementFromPoint reports the paint order.
      tooltip.el.style.pointerEvents = 'auto';
      const rect = tooltip.el.getBoundingClientRect();
      const hit = ui.root.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const above = hit === tooltip.el || tooltip.el.contains(hit);
      const insideDialog = tooltip.el.parentElement === dialog.el;

      tooltip.hide();
      dialog.close();
      ui.destroy();
      return { above, insideDialog };
    });

    expect(state.insideDialog).toBe(true);
    expect(state.above).toBe(true);
  });
});
