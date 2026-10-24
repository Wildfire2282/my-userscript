import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createButton,
  createLauncher,
  createPanel,
  createTooltip,
  mountUI,
  type UI,
} from '../../src/index';

let ui: UI;

beforeEach(() => {
  ui = mountUI();
  // happy-dom has no layout; give tooltip targets a usable rect.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
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
});

afterEach(() => {
  ui.destroy();
  vi.useRealTimers();
});

describe('Floating Launcher', () => {
  it('toggles the panel and keeps aria-expanded in sync', () => {
    const panel = createPanel(ui, { title: '设置', open: false });
    const launcher = createLauncher(ui, {
      panel,
      label: '打开设置',
      closeLabel: '关闭设置',
    });

    expect(launcher.el.parentElement).toBe(ui.layers.base);
    expect(launcher.el.getAttribute('aria-expanded')).toBe('false');
    expect(launcher.el.getAttribute('aria-label')).toBe('打开设置');
    expect(launcher.el.getAttribute('aria-controls')).toBe(panel.el.id);

    launcher.el.click();
    expect(panel.isOpen()).toBe(true);
    expect(launcher.el.getAttribute('aria-expanded')).toBe('true');
    expect(launcher.el.getAttribute('aria-label')).toBe('关闭设置');

    launcher.el.click();
    expect(panel.isOpen()).toBe(false);
    expect(launcher.el.getAttribute('aria-expanded')).toBe('false');
  });

  it('reacts when the panel is closed elsewhere', () => {
    const panel = createPanel(ui, { title: '设置' });
    const launcher = createLauncher(ui, { panel, label: '打开设置' });

    expect(launcher.el.getAttribute('aria-expanded')).toBe('true');

    panel.close();
    expect(launcher.el.getAttribute('aria-expanded')).toBe('false');

    panel.open();
    expect(launcher.el.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps expanded state synchronized when open callbacks immediately close the panel', () => {
    const panel = createPanel(ui, {
      title: '设置',
      open: false,
      onOpen: () => panel.close(),
    });
    const launcher = createLauncher(ui, { panel, label: '打开设置' });

    launcher.el.click();

    expect(panel.isOpen()).toBe(false);
    expect(launcher.el.getAttribute('aria-expanded')).toBe('false');
    expect(launcher.el.getAttribute('aria-label')).toBe('打开设置');
  });

  it('returns focus to the launcher when Escape closes its panel', () => {
    const panel = createPanel(ui, { title: '设置', open: false });
    const control = createButton(ui, { label: '编辑' });
    panel.body.append(control.el);
    const launcher = createLauncher(ui, { panel, label: '打开设置' });
    launcher.el.focus();
    launcher.el.click();
    expect(ui.root.activeElement).toBe(control.el);

    control.el.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(ui.root.activeElement).toBe(launcher.el);
    expect(launcher.el.getAttribute('aria-expanded')).toBe('false');
  });

  it('supports standalone click handlers and cleanup', () => {
    const onClick = vi.fn();
    const launcher = createLauncher(ui, { label: '执行', onClick });

    launcher.el.click();
    expect(onClick).toHaveBeenCalledTimes(1);

    launcher.destroy();
    expect(launcher.el.isConnected).toBe(false);
  });
});

describe('Tooltip', () => {
  it('shows on demand and manages aria-describedby', () => {
    const target = createButton(ui, { label: '目标' });
    ui.mount(target.el);
    const tooltip = createTooltip(ui, target.el, { content: '补充说明' });

    expect(tooltip.el.hidden).toBe(true);
    expect(tooltip.el.getAttribute('role')).toBe('tooltip');

    tooltip.show();

    expect(tooltip.el.hidden).toBe(false);
    expect(target.el.getAttribute('aria-describedby')).toContain(tooltip.el.id);

    tooltip.hide();

    expect(tooltip.el.hidden).toBe(true);
    expect(target.el.hasAttribute('aria-describedby')).toBe(false);
  });

  it('shows on focus and hides on Escape', () => {
    const target = createButton(ui, { label: '目标' });
    ui.mount(target.el);
    const tooltip = createTooltip(ui, target.el, { content: '说明' });

    target.el.dispatchEvent(new FocusEvent('focus'));
    expect(tooltip.el.hidden).toBe(false);

    target.el.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(tooltip.el.hidden).toBe(false);

    target.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(tooltip.el.hidden).toBe(true);
  });

  it('waits for the hover delay', () => {
    vi.useFakeTimers();
    const target = createButton(ui, { label: '目标' });
    ui.mount(target.el);
    const tooltip = createTooltip(ui, target.el, {
      content: '说明',
      delay: 400,
    });

    target.el.dispatchEvent(new MouseEvent('mouseenter'));
    expect(tooltip.el.hidden).toBe(true);

    vi.advanceTimersByTime(400);
    expect(tooltip.el.hidden).toBe(false);
  });

  it.each(['hide', 'destroy'] as const)('cancels a pending hover show on %s', (action) => {
    vi.useFakeTimers();
    const target = createButton(ui, { label: '目标' });
    ui.mount(target.el);
    const tooltip = createTooltip(ui, target.el, { content: '说明', delay: 400 });

    target.el.dispatchEvent(new MouseEvent('mouseenter'));
    tooltip[action]();
    vi.advanceTimersByTime(400);

    expect(tooltip.el.hidden).toBe(true);
    expect(target.el.hasAttribute('aria-describedby')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    if (action === 'destroy') expect(tooltip.el.isConnected).toBe(false);
  });

  it('preserves descriptions added or removed by consumers while shown', () => {
    const target = createButton(ui, { label: '目标' });
    ui.mount(target.el);
    target.el.setAttribute('aria-describedby', 'initial-description');
    const tooltip = createTooltip(ui, target.el, { content: '说明' });
    target.el.setAttribute('aria-describedby', 'current-description');
    tooltip.show();
    expect(target.el.getAttribute('aria-describedby')?.split(' ')).toEqual([
      'current-description',
      tooltip.el.id,
    ]);

    target.el.setAttribute('aria-describedby', `${tooltip.el.id} validation-error`);
    tooltip.hide();
    expect(target.el.getAttribute('aria-describedby')).toBe('validation-error');
    tooltip.show();
    tooltip.destroy();
    expect(target.el.getAttribute('aria-describedby')).toBe('validation-error');
  });

  it('closes only its own overlay on Escape before the containing panel', () => {
    const panel = createPanel(ui, { title: '设置', open: false });
    const target = createButton(ui, { label: '目标' });
    panel.body.append(target.el);
    const tooltip = createTooltip(ui, target.el, { content: '说明' });
    panel.open();
    tooltip.show();

    target.el.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(tooltip.el.hidden).toBe(true);
    expect(panel.isOpen()).toBe(true);

    target.el.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(panel.isOpen()).toBe(false);
  });

  it('does not show for a hidden, zero-size, or disconnected target', () => {
    const target = createButton(ui, { label: '目标' });
    const tooltip = createTooltip(ui, target.el, { content: '说明' });

    tooltip.show();

    expect(tooltip.el.hidden).toBe(true);
    expect(tooltip.el.parentElement).toBe(ui.layers.tooltip);

    const hidden = document.createElement('div');
    ui.mount(hidden);
    vi.spyOn(hidden, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      toJSON: () => ({}),
    });
    const hiddenTooltip = createTooltip(ui, hidden, { content: '隐藏目标' });

    hiddenTooltip.show();

    expect(hiddenTooltip.el.hidden).toBe(true);
    expect(hiddenTooltip.el.parentElement).toBe(ui.layers.tooltip);
  });

  it('removes the tooltip on destroy', () => {
    const target = createButton(ui, { label: '目标' });
    ui.mount(target.el);
    const tooltip = createTooltip(ui, target.el, { content: '说明' });

    tooltip.destroy();
    expect(tooltip.el.isConnected).toBe(false);
  });
});
