import { describe, expect, it, vi } from 'vitest';
import type { GmApi } from '@shared';
import {
  CUSTOM_ENGINE_ID,
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
    expect(normalizeSettings({ linkOpenMode: 'foreground' }).linkOpenMode).toBe('foreground');
    expect(normalizeSettings({ linkOpenMode: 'foreground' }).defaultEngine).toBe('google');
  });

  it('损坏的字段逐项回退，不影响其它字段', () => {
    const normalized = normalizeSettings({
      linkOpenMode: 'sideways',
      defaultEngine: 42,
      customEngineUrl: 7,
      urlTextAction: 'sometimes',
      imageAction: 'thumbnail',
      dragKinds: 'all',
      engines: { google: '', baidu: 3 },
    });
    expect(normalized.linkOpenMode).toBe('background');
    expect(normalized.defaultEngine).toBe('google');
    expect(normalized.customEngineUrl).toBe('');
    expect(normalized.urlTextAction).toBe('open');
    expect(normalized.imageAction).toBe('viewer');
    expect(normalized.dragKinds).toEqual({ text: true, link: true, image: true });
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

  it('默认引擎指向已被丢弃的引擎时收敛到内置默认值', () => {
    const normalized = normalizeSettings({
      defaultEngine: 'duckduckgo',
      engines: { duckduckgo: '' },
    });
    expect(normalized.defaultEngine).toBe(DEFAULT_SETTINGS.defaultEngine);
    expect(normalized.engines.duckduckgo).toBeUndefined();
  });

  it('自定义与仍然存在的引擎都保留', () => {
    expect(normalizeSettings({ defaultEngine: CUSTOM_ENGINE_ID }).defaultEngine).toBe('custom');
    expect(
      normalizeSettings({
        defaultEngine: 'duckduckgo',
        engines: { duckduckgo: 'https://duckduckgo.com/?q={keyword}' },
      }).defaultEngine,
    ).toBe('duckduckgo');
  });

  it('拖动类型可以单独关闭，坏值按开启处理', () => {
    expect(normalizeSettings({ dragKinds: { image: false } }).dragKinds).toEqual({
      text: true,
      link: true,
      image: false,
    });
    expect(normalizeSettings({ dragKinds: { text: 'off', link: 0 } }).dragKinds).toEqual({
      text: true,
      link: true,
      image: true,
    });
  });

  it('旧版总开关不再读取，其它旧设置照常保留', () => {
    const normalized = normalizeSettings({
      enabled: false,
      linkOpenMode: 'foreground',
      defaultEngine: 'baidu',
      customEngineUrl: 'https://example.com/s?q={keyword}',
    });
    expect(normalized).not.toHaveProperty('enabled');
    expect(normalized.linkOpenMode).toBe('foreground');
    expect(normalized.defaultEngine).toBe('baidu');
    expect(normalized.customEngineUrl).toBe('https://example.com/s?q={keyword}');
  });

  it('保留新的网址文字处理与图片打开方式', () => {
    const normalized = normalizeSettings({ urlTextAction: 'search', imageAction: 'original' });
    expect(normalized.urlTextAction).toBe('search');
    expect(normalized.imageAction).toBe('original');
  });
});

describe('createSettingsStore', () => {
  it('首次读取走 GM，之后走内存缓存', () => {
    const gm = fakeGm({ linkOpenMode: 'foreground' });
    const store = createSettingsStore(gm);
    expect(store.get().linkOpenMode).toBe('foreground');
    expect(store.get().linkOpenMode).toBe('foreground');
    expect(gm.getValue).toHaveBeenCalledTimes(1);
    expect(gm.getValue).toHaveBeenCalledWith(SETTINGS_KEY, null);
  });

  it('更新时写回完整设置并立即生效', () => {
    const gm = fakeGm();
    const store = createSettingsStore(gm);
    const next = store.update({ defaultEngine: 'baidu', imageAction: 'original' });
    expect(next.defaultEngine).toBe('baidu');
    expect(store.get().imageAction).toBe('original');
    expect(gm.setValue).toHaveBeenCalledWith(
      'settings',
      expect.objectContaining({ defaultEngine: 'baidu', imageAction: 'original' }),
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
