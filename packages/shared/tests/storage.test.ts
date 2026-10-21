import { describe, expect, it, vi } from 'vitest';
import type { GmApi } from '../src/gm';
import { loadStoredSettings, mergeDefaults, saveStoredSettings } from '../src/storage';

const defaults = {
  enabled: true,
  linkOpenMode: 'background',
  engines: {
    google: 'https://www.google.com/search?q={keyword}',
    baidu: 'https://www.baidu.com/s?wd={keyword}',
  },
  tags: ['a', 'b'],
};

describe('mergeDefaults', () => {
  it('没有存量时返回默认值的深拷贝', () => {
    const merged = mergeDefaults(defaults, null);
    expect(merged).toEqual(defaults);
    expect(merged).not.toBe(defaults);
    expect(merged.engines).not.toBe(defaults.engines);
    merged.engines.google = 'changed';
    expect(defaults.engines.google).toBe('https://www.google.com/search?q={keyword}');
  });

  it('只覆盖存过的字段，其余保持默认', () => {
    expect(mergeDefaults(defaults, { enabled: false })).toEqual({ ...defaults, enabled: false });
  });

  it('嵌套对象逐键合并，新增的键保留', () => {
    const merged = mergeDefaults(defaults, {
      engines: {
        google: 'https://example.com/?q={keyword}',
        duckduckgo: 'https://duckduckgo.com/?q={keyword}',
      },
    });
    expect(merged.engines).toEqual({
      google: 'https://example.com/?q={keyword}',
      baidu: 'https://www.baidu.com/s?wd={keyword}',
      duckduckgo: 'https://duckduckgo.com/?q={keyword}',
    });
  });

  it('存储里多出来的顶层键保留，便于版本回退', () => {
    expect(mergeDefaults(defaults, { futureFlag: 1 })).toMatchObject({
      futureFlag: 1,
      enabled: true,
    });
  });

  it('存储内容不是对象时整体回到默认值', () => {
    for (const stored of ['oops', 42, ['array'], undefined, null]) {
      expect(mergeDefaults(defaults, stored)).toEqual(defaults);
    }
  });

  it('嵌套值被存成 null 时保留默认值，而不是清空', () => {
    const merged = mergeDefaults(defaults, { engines: null });
    expect(merged.engines).toEqual(defaults.engines);
  });

  it('数组整体覆盖而不是逐项合并', () => {
    expect(mergeDefaults(defaults, { tags: ['x'] }).tags).toEqual(['x']);
  });
});

describe('存储读写', () => {
  const api = (): GmApi => ({
    getValue: vi.fn((_key: string, fallback: unknown) => fallback),
    setValue: vi.fn(() => true),
    registerMenuCommand: vi.fn(() => true),
  });

  it('读取时走 GM 并按默认值补齐', () => {
    const gm = api();
    vi.mocked(gm.getValue).mockReturnValue({ enabled: false });
    expect(loadStoredSettings(gm, 'settings', defaults)).toEqual({ ...defaults, enabled: false });
    expect(gm.getValue).toHaveBeenCalledWith('settings', null);
  });

  it('写入失败时返回 false 而不是抛错', () => {
    const gm = api();
    vi.mocked(gm.setValue).mockReturnValue(false);
    expect(saveStoredSettings(gm, 'settings', defaults)).toBe(false);
  });
});
