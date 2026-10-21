import { describe, expect, it, vi } from 'vitest';
import type { GmApi } from '@shared';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  createSettingsStore,
  normalizeSettings,
} from '../src/settings';

function fakeGm(stored: unknown = null): GmApi & { written: unknown[] } {
  const written: unknown[] = [];
  return {
    written,
    getValue: vi.fn(() => stored),
    setValue: vi.fn((_key: string, value: unknown) => {
      written.push(value);
      return true;
    }),
    registerMenuCommand: vi.fn(() => true),
  };
}

describe('normalizeSettings', () => {
  it('没有存量时给出完整默认值', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('只覆盖存过的字段', () => {
    expect(normalizeSettings({ enabled: false }).enabled).toBe(false);
    expect(normalizeSettings({ enabled: false }).defaultEngine).toBe('google');
  });

  it('损坏的字段逐项回退，不影响其它字段', () => {
    const normalized = normalizeSettings({
      enabled: 'yes',
      linkOpenMode: 'sideways',
      defaultEngine: 42,
      customEngineUrl: 7,
      engines: { google: '', baidu: 3 },
    });
    expect(normalized.enabled).toBe(true);
    expect(normalized.linkOpenMode).toBe('background');
    expect(normalized.defaultEngine).toBe('google');
    expect(normalized.customEngineUrl).toBe('');
    // 空串和数字被丢弃，只留下默认值里仍然有效的引擎。
    expect(normalized.engines.google).toBeUndefined();
    expect(normalized.engines.baidu).toBeUndefined();
    expect(Object.keys(normalized.engines)).toEqual(['cn.bing', 'bing']);
  });

  it('引擎全坏时回退内置引擎', () => {
    expect(normalizeSettings({ engines: { broken: 1 } }).engines).toEqual(DEFAULT_SETTINGS.engines);
  });

  it('保留自定义引擎', () => {
    const engines = normalizeSettings({
      engines: { duckduckgo: 'https://duckduckgo.com/?q={keyword}' },
    }).engines;
    expect(engines.duckduckgo).toBe('https://duckduckgo.com/?q={keyword}');
    expect(engines.google).toContain('google.com');
  });
});

describe('createSettingsStore', () => {
  it('首次读取走 GM，之后走内存缓存', () => {
    const gm = fakeGm({ enabled: false });
    const store = createSettingsStore(gm);
    expect(store.get().enabled).toBe(false);
    expect(store.get().enabled).toBe(false);
    expect(gm.getValue).toHaveBeenCalledTimes(1);
    expect(gm.getValue).toHaveBeenCalledWith(SETTINGS_KEY, null);
  });

  it('更新时写回完整设置并立即生效', () => {
    const gm = fakeGm();
    const store = createSettingsStore(gm);
    const next = store.update({ defaultEngine: 'baidu', enabled: false });
    expect(next.defaultEngine).toBe('baidu');
    expect(store.get().enabled).toBe(false);
    expect(gm.setValue).toHaveBeenCalledWith(
      'settings',
      expect.objectContaining({ defaultEngine: 'baidu' }),
    );
    expect(gm.written).toHaveLength(1);
  });

  it('写入失败仍然保留内存中的新设置', () => {
    const gm = fakeGm();
    vi.mocked(gm.setValue).mockReturnValue(false);
    const store = createSettingsStore(gm);
    store.update({ linkOpenMode: 'foreground' });
    expect(store.get().linkOpenMode).toBe('foreground');
  });
});
