import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createButton, createPanel, createSection, mountUI, type UI } from '../../src/index';

let ui: UI;

beforeEach(() => {
  ui = mountUI();
});

afterEach(() => {
  ui.destroy();
});

describe('Section', () => {
  it('renders an optional header and a body', () => {
    const section = createSection(ui, {
      title: '常规',
      description: '控制脚本行为。',
    });

    expect(section.el.tagName).toBe('SECTION');
    expect(section.el.querySelector('.ds-section-title')?.textContent).toBe('常规');
    expect(section.el.querySelector('.ds-section-description')?.textContent).toBe('控制脚本行为。');
    expect(section.body.className).toBe('ds-section-body');
  });

  it('omits the header when no text is provided', () => {
    const section = createSection(ui);
    expect(section.el.querySelector('.ds-section-header')).toBeNull();
  });
});

describe('Panel', () => {
  it('mounts into the base layer and opens by default', () => {
    const panel = createPanel(ui, {
      title: '设置',
      description: '脚本参数',
    });

    expect(panel.el.parentElement).toBe(ui.layers.base);
    expect(panel.isOpen()).toBe(true);
    expect(panel.el.hidden).toBe(false);
    expect(panel.el.getAttribute('role')).toBe('region');
    expect(panel.el.getAttribute('aria-labelledby')).toBe(
      panel.el.querySelector('.ds-panel-title')?.id,
    );
  });

  it('supports centered placement and updates it later', () => {
    const panel = createPanel(ui, { title: '设置', position: 'center' });
    expect(panel.el.dataset.position).toBe('center');

    panel.setPosition('top-left');
    expect(panel.el.dataset.position).toBe('top-left');
  });

  it('uses the settings preset by default', () => {
    const panel = createPanel(ui, {});

    expect(panel.el.dataset.size).toBe('settings');
    expect(panel.el.getAttribute('aria-label')).toBe('Settings');
  });

  it('uses the operation preset and switches presets at runtime', () => {
    const panel = createPanel(ui, { size: 'operation' });

    expect(panel.el.dataset.size).toBe('operation');
    expect(panel.el.getAttribute('aria-label')).toBe('Operations');

    panel.setSize('settings');
    expect(panel.el.dataset.size).toBe('settings');
    expect(panel.el.getAttribute('aria-label')).toBe('Settings');

    panel.setSize('operation');
    expect(panel.el.dataset.size).toBe('operation');
    expect(panel.el.getAttribute('aria-label')).toBe('Operations');
  });

  it('keeps a titled operation panel labelled by its heading', () => {
    const panel = createPanel(ui, { size: 'operation', title: '批量操作' });

    expect(panel.el.getAttribute('aria-label')).toBeNull();
    expect(panel.el.getAttribute('aria-labelledby')).toBe(
      panel.el.querySelector('.ds-panel-title')?.id,
    );
  });

  it('prefers an explicit ariaLabel across preset and title changes', () => {
    const panel = createPanel(ui, { size: 'operation', ariaLabel: '页面工具' });

    expect(panel.el.getAttribute('aria-label')).toBe('页面工具');

    panel.setSize('settings');
    expect(panel.el.getAttribute('aria-label')).toBe('页面工具');

    panel.setTitle('工具');
    panel.setTitle();
    expect(panel.el.getAttribute('aria-label')).toBe('页面工具');
  });

  it('closes on Escape and on the close button', () => {
    const onClose = vi.fn();
    const panel = createPanel(ui, { title: '设置', onClose });

    panel.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(panel.isOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);

    panel.open();
    const closeButton = panel.el.querySelector<HTMLButtonElement>('.ds-panel-close');
    closeButton?.click();

    expect(panel.isOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('ignores Escape while an IME is composing', () => {
    const panel = createPanel(ui, { title: '设置' });

    panel.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(panel.isOpen()).toBe(true);

    panel.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(panel.isOpen()).toBe(false);
  });

  it('does not duplicate close callbacks across repeated toggles', () => {
    const onClose = vi.fn();
    const panel = createPanel(ui, { title: '设置', onClose });

    for (let index = 0; index < 3; index += 1) {
      panel.close();
      panel.open();
    }
    panel.close();

    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('starts hidden when requested and toggles', () => {
    const panel = createPanel(ui, { title: '设置', open: false });
    expect(panel.isOpen()).toBe(false);
    expect(panel.el.hidden).toBe(true);

    panel.open();
    expect(panel.isOpen()).toBe(true);
    expect(panel.el.hidden).toBe(false);

    panel.toggle();
    expect(panel.isOpen()).toBe(false);
  });

  it('renders footer content and updates its title', () => {
    const save = createButton(ui, { label: '保存' });
    const panel = createPanel(ui, {
      title: '设置',
      footer: save.el,
    });

    expect(panel.footer.hidden).toBe(false);
    expect(panel.footer.contains(save.el)).toBe(true);

    panel.setTitle('新的标题');
    expect(panel.el.querySelector('.ds-panel-title')?.textContent).toBe('新的标题');
    expect(panel.el.getAttribute('aria-labelledby')).toBe(
      panel.el.querySelector('.ds-panel-title')?.id,
    );
  });

  it('keeps its accessible description in sync without removing external descriptions', () => {
    const panel = createPanel(ui, { title: '设置', description: '操作说明' });
    const description = panel.el.querySelector('.ds-panel-description');
    expect(panel.el.getAttribute('aria-describedby')).toBe(description?.id);

    panel.el.setAttribute('aria-describedby', `${description?.id} external-help`);
    panel.setDescription();
    expect(description?.hasAttribute('hidden')).toBe(true);
    expect(panel.el.getAttribute('aria-describedby')).toBe('external-help');

    panel.setDescription('新的说明');
    expect(description?.textContent).toBe('新的说明');
    expect(panel.el.getAttribute('aria-describedby')?.split(' ')).toEqual([
      'external-help',
      description?.id,
    ]);
  });

  it('does not send stale open state after a listener closes the panel', () => {
    const panel = createPanel(ui, { title: '设置', open: false });
    const observed: boolean[] = [];
    panel.onOpenChange((open) => {
      if (open) panel.close();
    });
    panel.onOpenChange((open) => observed.push(open));

    panel.open();

    expect(panel.isOpen()).toBe(false);
    expect(observed).toEqual([false]);
  });

  it('keeps open-change listeners in sync when onClose throws', () => {
    const panel = createPanel(ui, {
      title: '设置',
      open: false,
      onClose: () => {
        throw new Error('boom');
      },
    });
    const observed: boolean[] = [];
    panel.onOpenChange((open) => observed.push(open));

    panel.open();
    expect(() => panel.close()).toThrow('boom');

    expect(panel.isOpen()).toBe(false);
    expect(observed).toEqual([true, false]);
  });

  it('keeps open-change listeners in sync when onOpen throws', () => {
    const panel = createPanel(ui, {
      title: '设置',
      open: false,
      onOpen: () => {
        throw new Error('boom');
      },
    });
    const observed: boolean[] = [];
    panel.onOpenChange((open) => observed.push(open));

    expect(() => panel.open()).toThrow('boom');

    expect(panel.isOpen()).toBe(true);
    expect(observed).toEqual([true]);
  });

  it('notifies close before propagating an onClose error during teardown', () => {
    const panel = createPanel(ui, {
      title: '设置',
      open: false,
      onClose: () => {
        throw new Error('boom');
      },
    });
    const observed: boolean[] = [];
    panel.onOpenChange((open) => observed.push(open));
    panel.open();

    expect(() => panel.destroy()).toThrow('boom');

    expect(panel.isOpen()).toBe(false);
    expect(observed).toEqual([true, false]);
  });

  it('runs onClose and restores focus when destroyed while open', () => {
    const onClose = vi.fn();
    const panel = createPanel(ui, { title: '设置', open: false, onClose });
    const outside = createButton(ui, { label: '入口' });
    const inside = createButton(ui, { label: '控件' });
    panel.body.append(inside.el);
    ui.mount(outside.el);
    outside.el.focus();
    panel.open();
    inside.el.focus();

    panel.destroy();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(ui.root.activeElement).toBe(outside.el);
  });

  it('keeps focus outside the panel when it is closed programmatically', () => {
    const panel = createPanel(ui, { title: '设置', open: false });
    const control = createButton(ui, { label: '编辑' });
    const outside = createButton(ui, { label: '其他操作' });
    panel.body.append(control.el);
    ui.mount(outside.el);
    panel.open();
    outside.el.focus();

    panel.close();

    expect(ui.root.activeElement).toBe(outside.el);
  });

  it('renders a scroll hint above the body by default', () => {
    const panel = createPanel(ui, { title: '设置' });
    const hint = panel.el.querySelector<HTMLElement>('.ds-scroll-hint');

    expect(hint).not.toBeNull();
    expect(hint?.getAttribute('aria-hidden')).toBe('true');
    expect(hint?.textContent).toContain('Scroll for more');
    expect(hint?.parentElement?.className).toBe('ds-panel-content');
  });

  it('supports custom hint text and can be turned off', () => {
    const custom = createPanel(ui, { title: '设置', scrollHint: { text: '继续下滑' } });
    expect(custom.el.querySelector('.ds-scroll-hint')?.textContent).toContain('继续下滑');

    const disabled = createPanel(ui, { title: '设置', scrollHint: false });
    expect(disabled.el.querySelector('.ds-scroll-hint')).toBeNull();
  });

  it('removes the scroll hint when the panel is destroyed', () => {
    const panel = createPanel(ui, { title: '设置' });
    const hint = panel.el.querySelector('.ds-scroll-hint');

    panel.destroy();

    expect(hint?.isConnected).toBe(false);
  });
});
