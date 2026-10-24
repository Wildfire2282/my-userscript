import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  confirmDialog,
  createAlert,
  createButton,
  createDialog,
  createToast,
  createTooltip,
  mountUI,
  type UI,
} from '../../src/index';

let ui: UI;

beforeEach(() => {
  ui = mountUI();
});

afterEach(() => {
  ui.destroy();
  vi.useRealTimers();
});

describe('Alert', () => {
  it('renders a persistent warning with the right semantics', () => {
    const alert = createAlert(ui, {
      variant: 'warning',
      title: '不可撤销',
      description: '请确认后再继续。',
      dismissible: true,
    });

    expect(alert.el.className).toContain('ds-alert--warning');
    expect(alert.el.getAttribute('role')).toBe('status');
    expect(alert.el.textContent).toContain('不可撤销');
    expect(alert.el.querySelector('.ds-alert-icon svg')).not.toBeNull();

    alert.dismiss();
    expect(alert.el.isConnected).toBe(false);
  });

  it('does not use a live role for neutral information', () => {
    const alert = createAlert(ui, { variant: 'info', title: '提示' });
    expect(alert.el.hasAttribute('role')).toBe(false);
  });

  it('separates teardown from user dismissal', () => {
    const onDismiss = vi.fn();
    const alert = createAlert(ui, { title: '提示', dismissible: true, onDismiss });
    const close = alert.el.querySelector<HTMLButtonElement>('.ds-alert-close');

    alert.destroy();
    expect(alert.el.isConnected).toBe(false);
    expect(onDismiss).not.toHaveBeenCalled();

    close?.click();
    alert.dismiss();
    alert.destroy();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('runs onDismiss once and stops listening for close clicks', () => {
    const onDismiss = vi.fn();
    const alert = createAlert(ui, { title: '提示', dismissible: true, onDismiss });
    const close = alert.el.querySelector<HTMLButtonElement>('.ds-alert-close');

    alert.dismiss();
    expect(alert.el.isConnected).toBe(false);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    close?.click();
    alert.dismiss();
    alert.destroy();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('Toast', () => {
  it('auto-dismisses after the requested duration', () => {
    vi.useFakeTimers();
    const toast = createToast(ui);
    const handle = toast.success('已保存', { duration: 1000 });

    expect(handle.el.isConnected).toBe(true);
    expect(handle.el.hasAttribute('role')).toBe(false);

    vi.advanceTimersByTime(999);
    expect(handle.el.isConnected).toBe(true);

    vi.advanceTimersByTime(1);
    expect(handle.el.isConnected).toBe(false);
  });

  it('pauses while hovered or focused', () => {
    vi.useFakeTimers();
    const toast = createToast(ui);
    const handle = toast.info('处理中', { duration: 1000 });

    handle.el.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(2000);
    expect(handle.el.isConnected).toBe(true);

    handle.el.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(1000);
    expect(handle.el.isConnected).toBe(false);
  });

  it('keeps a sticky toast after the pointer and focus leave', () => {
    vi.useFakeTimers();
    const toast = createToast(ui);
    const handle = toast.info('常驻提示', { duration: 0 });

    handle.el.dispatchEvent(new Event('pointerenter'));
    handle.el.dispatchEvent(new Event('pointerleave'));
    handle.el.dispatchEvent(new FocusEvent('focusin'));
    handle.el.dispatchEvent(new FocusEvent('focusout'));

    expect(handle.el.isConnected).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('announces from persistent polite and assertive regions', () => {
    const toast = createToast(ui);
    const viewport = ui.layers.toast.querySelector('.ds-toast-viewport');
    const polite = viewport?.querySelector('[aria-live="polite"]');
    const assertive = viewport?.querySelector('[aria-live="assertive"]');

    toast.info('已保存', { description: '设置已写入', duration: 0 });
    expect(polite?.textContent).toBe('已保存 设置已写入');
    expect(assertive?.textContent).toBe('');

    toast.error('保存失败', { duration: 0 });
    expect(assertive?.textContent).toBe('保存失败');
  });

  it.each(['pointerleave', 'focusout'] as const)(
    'keeps the timer paused until both hover and focus end: %s first',
    (firstExit) => {
      vi.useFakeTimers();
      const toast = createToast(ui);
      const handle = toast.info('阅读中', { duration: 1000 });
      vi.advanceTimersByTime(300);
      handle.el.dispatchEvent(new Event('pointerenter'));
      handle.el.dispatchEvent(new FocusEvent('focusin'));

      handle.el.dispatchEvent(
        firstExit === 'focusout' ? new FocusEvent('focusout') : new Event('pointerleave'),
      );
      vi.advanceTimersByTime(2000);
      expect(handle.el.isConnected).toBe(true);

      handle.el.dispatchEvent(
        firstExit === 'pointerleave' ? new FocusEvent('focusout') : new Event('pointerleave'),
      );
      vi.advanceTimersByTime(699);
      expect(handle.el.isConnected).toBe(true);
      vi.advanceTimersByTime(1);
      expect(handle.el.isConnected).toBe(false);
    },
  );

  it('does not restart timers through a dismissed toast element', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const toast = createToast(ui);
    const handle = toast.info('提示', { duration: 1000, onDismiss });
    handle.el.dispatchEvent(new Event('pointerenter'));
    handle.dismiss();
    handle.el.dispatchEvent(new Event('pointerleave'));

    expect(vi.getTimerCount()).toBe(0);
    toast.destroy();
    ui.destroy();
    handle.dismiss();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('rejects new notifications after destruction without scheduling callbacks', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const toast = createToast(ui);
    toast.info('提示', { duration: 1000, onDismiss });
    toast.destroy();
    toast.destroy();

    expect(() => toast.info('迟到的提示', { onDismiss })).toThrow(/destroyed/);
    expect(vi.getTimerCount()).toBe(0);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('enforces the maximum number of visible toasts', () => {
    const toast = createToast(ui, { max: 2 });
    toast.info('第一条', { duration: 0 });
    toast.info('第二条', { duration: 0 });
    toast.info('第三条', { duration: 0 });

    const viewport = ui.layers.toast.querySelector('.ds-toast-viewport');
    expect(viewport?.querySelectorAll('.ds-toast')).toHaveLength(2);
    expect(viewport?.textContent).not.toContain('第一条');
    expect(viewport?.textContent).toContain('第三条');
  });

  it('replaces a toast with the same id', () => {
    const toast = createToast(ui);
    toast.info('旧消息', { id: 'status', duration: 0 });
    toast.success('新消息', { id: 'status', duration: 0 });

    const viewport = ui.layers.toast.querySelector('.ds-toast-viewport');
    expect(viewport?.querySelectorAll('.ds-toast')).toHaveLength(1);
    expect(viewport?.textContent).toContain('新消息');
    expect(viewport?.textContent).not.toContain('旧消息');
  });

  it('cleans up on destroy', () => {
    const toast = createToast(ui);
    toast.error('失败', { duration: 0 });

    toast.destroy();
    expect(ui.layers.toast.querySelector('.ds-toast-viewport')).toBeNull();
  });

  it('clears every toast even if an onDismiss callback throws', () => {
    const toast = createToast(ui);
    toast.info('第一条', {
      duration: 0,
      onDismiss: () => {
        throw new Error('boom');
      },
    });
    toast.info('第二条', { duration: 0 });

    expect(() => toast.clear()).toThrow('boom');
    expect(ui.layers.toast.querySelectorAll('.ds-toast')).toHaveLength(0);
  });

  it('supports localized region and close labels inside a persistent live region', () => {
    const toast = createToast(ui, { regionLabel: '通知', dismissLabel: '关闭通知' });
    const viewport = ui.layers.toast.querySelector('.ds-toast-viewport');
    expect(viewport?.getAttribute('role')).toBe('region');
    expect(viewport?.getAttribute('aria-label')).toBe('通知');
    expect(viewport?.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(viewport?.querySelector('[aria-live="assertive"]')).not.toBeNull();

    const handle = toast.info('提示', { duration: 0 });
    expect(handle.el.parentElement).toBe(viewport);
    expect(handle.el.hasAttribute('role')).toBe(false);
    expect(viewport?.querySelector('[aria-live="polite"]')?.textContent).toBe('提示');
    expect(handle.el.querySelector('.ds-toast-close')?.getAttribute('aria-label')).toBe('关闭通知');
  });
});

describe('Dialog', () => {
  it('renders a titled modal with actions and accessible labelling', () => {
    const dialog = createDialog(ui, {
      title: '删除项目？',
      description: '此操作不可撤销。',
      actions: [
        { label: '取消', value: 'cancel', variant: 'secondary', autofocus: true },
        { label: '删除', value: 'confirm', variant: 'destructive' },
      ],
    });

    expect(dialog.el.tagName).toBe('DIALOG');
    expect(dialog.el.getAttribute('aria-labelledby')).toBe(
      dialog.el.querySelector('.ds-dialog-title')?.id,
    );
    expect(dialog.el.querySelectorAll('.ds-dialog-footer button')).toHaveLength(2);
    expect(dialog.el.querySelector('.ds-dialog-footer button')?.textContent).toContain('取消');
    // The option must not add a live autofocus attribute: a non-modal dialog in
    // a gallery would steal focus and scroll the page as soon as it is visible.
    expect(dialog.el.querySelector('[autofocus]')).toBeNull();
    expect(ui.container.contains(dialog.el)).toBe(true);
  });

  it('locks page scroll while open and resolves the selected action', async () => {
    const dialog = createDialog(ui, {
      title: '确认',
      actions: [
        { label: '取消', value: 'cancel' },
        { label: '继续', value: 'confirm' },
      ],
    });

    const result = dialog.open();
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(dialog.el.hasAttribute('open')).toBe(true);

    dialog.close('confirm');
    await expect(result).resolves.toBe('confirm');
    expect(document.documentElement.style.overflow).toBe('');
    expect(dialog.el.hasAttribute('open')).toBe(false);
  });

  it('releases the scroll lock when the whole UI is destroyed', async () => {
    const dialog = createDialog(ui, {
      title: '确认',
      actions: [{ label: '关闭', value: 'close' }],
    });

    const result = dialog.open();
    expect(document.documentElement.style.overflow).toBe('hidden');

    ui.destroy();

    await expect(result).resolves.toBeNull();
    expect(document.documentElement.style.overflow).toBe('');
    expect(dialog.el.isConnected).toBe(false);
  });

  it('resolves confirmDialog to a boolean', async () => {
    const result = confirmDialog(ui, {
      title: '清空设置？',
      description: '不可撤销。',
      confirmLabel: '清空',
      cancelLabel: '取消',
      destructive: true,
    });

    const dialog = ui.container.querySelector('dialog');
    const confirm = [...(dialog?.querySelectorAll('button') ?? [])].find((button) =>
      button.textContent?.includes('清空'),
    );
    confirm?.click();

    await expect(result).resolves.toBe(true);
  });

  it('renders a scroll hint above the body and removes it on destroy', () => {
    const dialog = createDialog(ui, { title: '确认' });
    const hint = dialog.el.querySelector<HTMLElement>('.ds-scroll-hint');

    expect(hint?.textContent).toContain('Scroll for more');
    expect(hint?.parentElement?.className).toBe('ds-dialog-content');

    dialog.destroy();
    expect(hint?.isConnected).toBe(false);
  });

  it('can turn the scroll hint off', () => {
    const dialog = createDialog(ui, { title: '确认', scrollHint: false });
    expect(dialog.el.querySelector('.ds-scroll-hint')).toBeNull();
  });

  it('rejects an empty title', () => {
    expect(() => createDialog(ui, { title: '   ' })).toThrow(/title/);
  });
});

describe('Top layer overlays', () => {
  it('moves toasts into the topmost dialog and back', () => {
    const toast = createToast(ui);
    const handle = toast.info('提示', { duration: 0 });
    const viewport = handle.el.parentElement;
    expect(viewport?.parentElement).toBe(ui.layers.toast);

    const dialog = createDialog(ui, { title: '确认' });
    const result = dialog.open();
    expect(viewport?.parentElement).toBe(dialog.el);

    dialog.close();
    expect(viewport?.parentElement).toBe(ui.layers.toast);
    dialog.destroy();
    void result;
  });

  it('uses the most recently opened dialog and falls back to the previous one', () => {
    const toast = createToast(ui);
    const handle = toast.info('提示', { duration: 0 });
    const viewport = handle.el.parentElement;
    const first = createDialog(ui, { title: '第一个' });
    const second = createDialog(ui, { title: '第二个' });

    const firstResult = first.open();
    expect(viewport?.parentElement).toBe(first.el);

    const secondResult = second.open();
    expect(viewport?.parentElement).toBe(second.el);

    second.close();
    expect(viewport?.parentElement).toBe(first.el);

    first.close();
    expect(viewport?.parentElement).toBe(ui.layers.toast);

    first.destroy();
    second.destroy();
    void firstResult;
    void secondResult;
  });

  it('moves a tooltip into its dialog and hides it when the dialog closes', () => {
    const target = createButton(ui, { label: '目标' });
    vi.spyOn(target.el, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      top: 0,
      right: 100,
      bottom: 20,
      left: 0,
      toJSON: () => ({}),
    });
    const dialog = createDialog(ui, { title: '设置', content: target.el });
    const tooltip = createTooltip(ui, target.el, { content: '说明' });
    const result = dialog.open();

    tooltip.show();
    expect(tooltip.el.parentElement).toBe(dialog.el);
    expect(tooltip.el.hidden).toBe(false);

    dialog.close();
    expect(tooltip.el.hidden).toBe(true);
    expect(tooltip.el.parentElement).toBe(ui.layers.tooltip);
    dialog.destroy();
    void result;
  });
});
