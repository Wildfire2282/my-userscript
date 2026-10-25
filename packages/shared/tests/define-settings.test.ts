import { describe, expect, it, vi } from 'vitest';
import type { GmApi } from '../src/host/gm';
import { defineSettings } from '../src/settings/define-settings';

interface Settings {
  enabled: boolean;
  level: number;
}

const DEFAULTS: Settings = { enabled: true, level: 1 };

function normalize(stored: unknown): Settings {
  const record = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<
    string,
    unknown
  >;
  return {
    enabled: record.enabled !== false,
    level: typeof record.level === 'number' ? record.level : DEFAULTS.level,
  };
}

function fakeGm(stored: unknown = null): GmApi & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  if (stored !== null) values.set('k', stored);
  return {
    values,
    getValue: (key: string, fallback: unknown) => (values.has(key) ? values.get(key) : fallback),
    setValue: (key: string, value: unknown) => {
      values.set(key, value);
      return true;
    },
    registerMenuCommand: () => true,
  };
}

describe('defineSettings', () => {
  it('没有存量时给出默认值', () => {
    const store = defineSettings({ api: fakeGm(), key: 'k', defaults: DEFAULTS, normalize });
    expect(store.get()).toEqual(DEFAULTS);
  });

  it('update 写回存储并通知订阅者', () => {
    const api = fakeGm();
    const store = defineSettings({ api, key: 'k', defaults: DEFAULTS, normalize });
    const seen: Settings[] = [];
    const off = store.onChange((next) => void seen.push(next));
    store.update({ level: 3 });
    expect(api.values.get('k')).toEqual({ enabled: true, level: 3 });
    expect(seen).toEqual([{ enabled: true, level: 3 }]);
    off();
    store.update({ level: 4 });
    expect(seen).toHaveLength(1);
  });

  it('reset 回到默认值并写回', () => {
    const api = fakeGm({ level: 9, enabled: false });
    const store = defineSettings({ api, key: 'k', defaults: DEFAULTS, normalize });
    expect(store.reset()).toEqual(DEFAULTS);
    expect(store.get()).toEqual(DEFAULTS);
  });

  it('订阅者抛错不打断其它订阅者', () => {
    const store = defineSettings({ api: fakeGm(), key: 'k', defaults: DEFAULTS, normalize });
    const seen: Settings[] = [];
    store.onChange(() => {
      throw new Error('listener boom');
    });
    store.onChange((next) => void seen.push(next));
    expect(() => store.update({ level: 2 })).not.toThrow();
    expect(seen).toEqual([{ enabled: true, level: 2 }]);
  });

  it('写失败时 update 的内存兜底仍然生效', () => {
    const api = fakeGm();
    vi.spyOn(api, 'setValue').mockReturnValue(false);
    const store = defineSettings({ api, key: 'k', defaults: DEFAULTS, normalize });
    store.update({ level: 5 });
    expect(store.get().level).toBe(5);
  });
});
