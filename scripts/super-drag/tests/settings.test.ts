import { describe, expect, it, vi } from 'vitest';
import type { GmApi } from '@shared';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  createSettingsStore,
  normalizeSettings,
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

describe('normalizeSettings', () => {
  it('没有存量时给出完整默认值', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('只覆盖存过的字段，其余保持默认', () => {
    const normalized = normalizeSettings({
      linkOpenMode: 'foreground',
      urlTextAction: 'search',
      imageAction: 'original',
    });
    expect(normalized.linkOpenMode).toBe('foreground');
    expect(normalized.urlTextAction).toBe('search');
    expect(normalized.imageAction).toBe('original');
    expect(normalized.defaultEngine).toBe('google');
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
    // google 已被丢弃，默认引擎只能落在表里真实存在的引擎上。
    expect(Object.hasOwn(normalized.engines, normalized.defaultEngine)).toBe(true);
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

  it('默认引擎指向已被丢弃的引擎时收敛到表里真实存在的引擎', () => {
    const normalized = normalizeSettings({
      defaultEngine: 'duckduckgo',
      engines: { duckduckgo: '' },
    });
    // 不能再写死 google：它可能也已被丢弃，那样面板显示的与真实搜索的又不一致。
    expect(Object.hasOwn(normalized.engines, normalized.defaultEngine)).toBe(true);
    expect(normalized.engines.duckduckgo).toBeUndefined();
  });

  it('模板里没有 {keyword} 的引擎整条丢弃', () => {
    const engines = normalizeSettings({
      engines: { duckduckgo: 'https://duckduckgo.com/' },
    }).engines;
    expect(engines.duckduckgo).toBeUndefined();
    expect(engines.google).toContain('{keyword}');
  });

  it('存储里叫 custom 的引擎被丢弃，避免与「自定义」选项撞 value', () => {
    const engines = normalizeSettings({
      engines: { custom: 'https://example.com/?q={keyword}' },
    }).engines;
    expect(engines.custom).toBeUndefined();
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
});

describe('createSettingsStore', () => {
  it('每次都读存储：别的标签页改了设置立即生效', () => {
    const gm = fakeGm({ linkOpenMode: 'foreground' });
    const store = createSettingsStore(gm);
    expect(store.get().linkOpenMode).toBe('foreground');
    expect(gm.getValue).toHaveBeenCalledWith(SETTINGS_KEY, null);

    gm.values.set(SETTINGS_KEY, { linkOpenMode: 'background' });
    expect(store.get().linkOpenMode).toBe('background');
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
