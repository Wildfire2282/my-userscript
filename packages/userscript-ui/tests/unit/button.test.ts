import { afterEach, describe, expect, it, vi } from 'vitest';
import { createButton, mountUI, type UI } from '../../src/index';

let ui: UI | undefined;

afterEach(() => {
  ui?.destroy();
  ui = undefined;
});

function setup(): UI {
  ui = mountUI();
  return ui;
}

describe('createButton', () => {
  it('renders the requested variant and size', () => {
    const app = setup();
    const button = createButton(app, {
      label: '保存',
      variant: 'destructive',
      size: 'sm',
    });

    expect(button.el.tagName).toBe('BUTTON');
    expect(button.el.type).toBe('button');
    expect(button.el.className).toContain('ds-button--destructive');
    expect(button.el.className).toContain('ds-button--sm');
    expect(button.el.textContent).toBe('保存');
  });

  it('invokes the click handler', () => {
    const app = setup();
    const onClick = vi.fn();
    const button = createButton(app, { label: '执行', onClick });

    button.el.click();

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('exposes a loading state that disables the button', () => {
    const app = setup();
    const button = createButton(app, { label: '加载' });

    button.setLoading(true);

    expect(button.el.disabled).toBe(true);
    expect(button.el.dataset.loading).toBe('true');
    expect(button.el.getAttribute('aria-busy')).toBe('true');
    expect(button.el.getAttribute('aria-disabled')).toBe('true');
    expect(button.el.querySelector('.ds-button-spinner')).not.toBeNull();

    button.setLoading(false);

    expect(button.el.disabled).toBe(false);
    expect(button.el.dataset.loading).toBe('false');
    expect(button.el.hasAttribute('aria-busy')).toBe(false);
    expect(button.el.querySelector('.ds-button-spinner')).toBeNull();
  });

  it('restores the disabled option when loading ends', () => {
    const app = setup();
    const button = createButton(app, { label: '禁用', disabled: true });

    button.setLoading(true);
    button.setLoading(false);

    expect(button.el.disabled).toBe(true);
  });

  it('keeps loading and disabled transitions independent and cleans up clicks', () => {
    const app = setup();
    const onClick = vi.fn();
    const button = createButton(app, { label: '执行', onClick });
    app.layers.base.appendChild(button.el);

    button.setLoading(true);
    button.setLoading(true);
    button.setDisabled(true);
    button.setDisabled(false);
    button.el.click();

    expect(button.el.disabled).toBe(true);
    expect(button.el.querySelectorAll('.ds-button-spinner')).toHaveLength(1);
    expect(onClick).not.toHaveBeenCalled();

    button.setLoading(false);
    button.el.click();
    expect(onClick).toHaveBeenCalledTimes(1);

    app.destroy();
    button.el.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('rejects empty labels', () => {
    const app = setup();
    expect(() => createButton(app, { label: '' })).toThrow(/label/);
    expect(() => createButton(app, { label: '   ' })).toThrow(/label/);
  });

  it('requires an accessible label for icon-only buttons', () => {
    const app = setup();
    expect(() => createButton(app, { size: 'icon' })).toThrow(/ariaLabel/);

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const button = createButton(app, {
      size: 'icon',
      icon,
      ariaLabel: '更多操作',
    });

    expect(button.el.getAttribute('aria-label')).toBe('更多操作');
    expect(button.el.querySelector('svg')).not.toBeNull();
  });
});
