import { describe, expect, it } from 'vitest';
import { mergeDefaults } from '../src/storage';

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

  it('存储里多出来的键是深拷贝，改合并结果不污染入参', () => {
    const stored = { extra: { nested: 1 } };
    const merged = mergeDefaults(defaults, stored) as typeof defaults & {
      extra: { nested: number };
    };
    merged.extra.nested = 2;
    expect(stored.extra.nested).toBe(1);
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
