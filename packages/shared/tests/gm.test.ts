import { describe, expect, it, vi } from 'vitest';
import { createGmApi } from '../src/gm';

describe('createGmApi', () => {
  it('没有 GM 全局时全部降级，不抛错', () => {
    const api = createGmApi({});
    expect(api.getValue('settings', { enabled: true })).toEqual({ enabled: true });
    expect(api.setValue('settings', { enabled: false })).toBe(false);
    expect(api.registerMenuCommand('菜单', () => undefined)).toBe(false);
  });

  it('转发读写并回读真实值', () => {
    const store = new Map<string, unknown>();
    const api = createGmApi({
      GM_getValue: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
      GM_setValue: (key, value) => void store.set(key, value),
    });
    expect(api.setValue('settings', { enabled: false })).toBe(true);
    expect(api.getValue('settings', null)).toEqual({ enabled: false });
  });

  it('管理器返回 undefined 时回落到默认值', () => {
    const api = createGmApi({ GM_getValue: () => undefined });
    expect(api.getValue('missing', 'fallback')).toBe('fallback');
  });

  it('读写或注册抛错时不影响脚本继续运行', () => {
    const api = createGmApi({
      GM_getValue: () => {
        throw new Error('denied');
      },
      GM_setValue: () => {
        throw new Error('quota');
      },
      GM_registerMenuCommand: () => {
        throw new Error('denied');
      },
    });
    expect(api.getValue('settings', 'fallback')).toBe('fallback');
    expect(api.setValue('settings', {})).toBe(false);
    expect(api.registerMenuCommand('菜单', () => undefined)).toBe(false);
  });

  it('注册菜单项时把回调原样交给管理器', () => {
    const run = vi.fn();
    const register = vi.fn();
    createGmApi({ GM_registerMenuCommand: register }).registerMenuCommand('超级拖拽：设置', run);
    expect(register).toHaveBeenCalledWith('超级拖拽：设置', run);
  });
});
