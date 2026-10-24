import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountUI } from '../../src/index';

afterEach(() => {
  document.querySelectorAll('userscript-ui-root').forEach((host) => host.remove());
});

describe('mountUI', () => {
  it('creates an isolated open shadow root with layers', () => {
    const ui = mountUI({ theme: 'light' });

    expect(ui.host.tagName.toLowerCase()).toBe('userscript-ui-root');
    expect(ui.root.mode).toBe('open');
    expect(ui.container.className).toBe('ds-root');
    expect(ui.layers.base.parentElement).toBe(ui.container);
    expect(ui.layers.toast.parentElement).toBe(ui.container);
    expect(ui.layers.tooltip.parentElement).toBe(ui.container);
    expect(ui.theme).toBe('light');
    expect(ui.host.dataset.dsTheme).toBe('light');
    expect(ui.host.style.getPropertyValue('pointer-events')).toBe('none');
    expect(ui.host.style.getPropertyPriority('pointer-events')).toBe('important');

    const styleSources =
      ui.root.querySelectorAll('style[data-ds-style]').length + ui.root.adoptedStyleSheets.length;
    expect(styleSources).toBeGreaterThan(0);
  });

  it('switches explicit themes', () => {
    const ui = mountUI({ theme: 'light' });
    expect(ui.theme).toBe('light');

    ui.setTheme('dark');
    expect(ui.theme).toBe('dark');
    expect(ui.host.dataset.dsTheme).toBe('dark');
    expect(ui.host.style.getPropertyValue('color-scheme')).toBe('dark');

    ui.setTheme('light');
    expect(ui.theme).toBe('light');
  });

  it('applies custom tokens and rejects invalid names', () => {
    const ui = mountUI({ tokens: { '--ds-primary': '#123456' } });
    expect(ui.host.style.getPropertyValue('--ds-primary')).toBe('#123456');

    expect(() => mountUI({ tokens: { primary: '#000000' } })).toThrow(/--/);
  });

  it('validates token names before registering media listeners', () => {
    const matchMedia = vi.spyOn(window, 'matchMedia');

    expect(() => mountUI({ tokens: { primary: '#000000' } })).toThrow(/--/);
    expect(matchMedia).not.toHaveBeenCalled();
  });

  it('mounts nodes into the base layer', () => {
    const ui = mountUI();
    const node = document.createElement('div');
    ui.mount(node);

    expect(node.parentElement).toBe(ui.layers.base);
  });

  it('runs cleanup callbacks and destroys idempotently', () => {
    const ui = mountUI();
    let cleaned = 0;
    ui.onDestroy(() => {
      cleaned += 1;
    });

    ui.destroy();
    ui.destroy();

    expect(cleaned).toBe(1);
    expect(ui.signal.aborted).toBe(true);
    expect(document.querySelector('userscript-ui-root')).toBeNull();
  });

  it('runs cleanup registered after destruction immediately', () => {
    const ui = mountUI();
    ui.destroy();
    const cleanup = vi.fn();

    ui.onDestroy(cleanup);

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('rejects UI mutations after destruction', () => {
    const ui = mountUI();
    ui.destroy();

    expect(() => ui.setTheme('dark')).toThrow(/ui\.destroy/);
    expect(() => ui.useStyles('/* late */')).toThrow(/ui\.destroy/);
    expect(() => ui.mount(document.createElement('div'))).toThrow(/ui\.destroy/);
  });

  it('keeps multiple UI instances independent', () => {
    const first = mountUI({ theme: 'light' });
    const second = mountUI({ theme: 'dark' });

    expect(first.host).not.toBe(second.host);
    expect(first.theme).toBe('light');
    expect(second.theme).toBe('dark');

    first.destroy();
    expect(document.querySelectorAll('userscript-ui-root')).toHaveLength(1);
    expect(second.host.isConnected).toBe(true);
  });
});
