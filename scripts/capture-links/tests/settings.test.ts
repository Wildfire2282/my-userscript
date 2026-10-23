import { describe, expect, it, vi } from 'vitest';
import type { GmApi } from '@shared';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  createSettingsStore,
  normalizeSettings,
  toCopyFormat,
} from '../src/settings';

function fakeGm(
  stored: unknown = null,
): GmApi & { written: unknown[]; values: Map<string, unknown> } {
  const written: unknown[] = [];
  const values = new Map<string, unknown>();
  if (stored !== null) values.set(SETTINGS_KEY, stored);
  return {
    written,
    values,
    getValue: vi.fn((key: string, fallback: unknown) =>
      values.has(key) ? values.get(key) : fallback,
    ),
    setValue: vi.fn((key: string, value: unknown) => {
      written.push(value);
      values.set(key, value);
      return true;
    }),
    registerMenuCommand: vi.fn(() => true),
  };
}

describe('toCopyFormat', () => {
  it('只接受三种已知格式，其余回退纯链接', () => {
    expect(toCopyFormat('markdown')).toBe('markdown');
    expect(toCopyFormat('html')).toBe('html');
    expect(toCopyFormat('url')).toBe('url');
    expect(toCopyFormat('pdf')).toBe('url');
    expect(toCopyFormat(null)).toBe('url');
  });
});

describe('normalizeSettings', () => {
  it('没有存量时给出完整默认值', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('只覆盖存过的字段', () => {
    expect(normalizeSettings({ copyFormat: 'markdown' })).toEqual({
      showFloatButton: true,
      copyFormat: 'markdown',
    });
  });

  it('损坏的字段逐项回退', () => {
    expect(normalizeSettings({ showFloatButton: 'no', copyFormat: 'rtf', unknown: 1 })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('只认显式的 false，缺字段按显示处理', () => {
    expect(normalizeSettings({ showFloatButton: false }).showFloatButton).toBe(false);
    expect(normalizeSettings({ showFloatButton: 0 }).showFloatButton).toBe(true);
  });
});

describe('createSettingsStore', () => {
  it('每次都读存储：别的标签页改了设置立即生效', () => {
    const gm = fakeGm({ copyFormat: 'html' });
    const store = createSettingsStore(gm);
    expect(store.get().copyFormat).toBe('html');
    expect(gm.getValue).toHaveBeenCalledWith(SETTINGS_KEY, null);

    gm.values.set(SETTINGS_KEY, { copyFormat: 'markdown' });
    expect(store.get().copyFormat).toBe('markdown');
  });

  it('更新时写回完整设置并立即生效', () => {
    const gm = fakeGm();
    const store = createSettingsStore(gm);
    store.update({ copyFormat: 'markdown', showFloatButton: false });
    expect(store.get()).toEqual({ showFloatButton: false, copyFormat: 'markdown' });
    expect(gm.setValue).toHaveBeenCalledWith(
      'settings',
      expect.objectContaining({ showFloatButton: false, copyFormat: 'markdown' }),
    );
  });

  it('写入失败仍然保留内存中的新设置', () => {
    const gm = fakeGm();
    vi.mocked(gm.setValue).mockReturnValue(false);
    const store = createSettingsStore(gm);
    store.update({ copyFormat: 'html' });
    expect(store.get().copyFormat).toBe('html');
  });
});
