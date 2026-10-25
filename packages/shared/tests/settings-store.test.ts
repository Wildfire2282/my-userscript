import { describe, expect, it } from 'vitest';
import type { GmApi } from '../src/host/gm';
import { createSettingsStore } from '../src/host/settings-store';

interface Settings {
  enabled: boolean;
  site: string;
}

const DEFAULTS: Settings = { enabled: true, site: '' };

function normalize(stored: unknown): Settings {
  const record = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<
    string,
    unknown
  >;
  return {
    enabled: record.enabled !== false,
    site: typeof record.site === 'string' ? record.site : '',
  };
}

function fakeGm(stored: unknown = null, writable = true): GmApi & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  if (stored !== null) values.set('k', stored);
  return {
    values,
    getValue: (key, fallback) => (values.has(key) ? values.get(key) : fallback),
    setValue: (key, value) => {
      if (!writable) return false;
      values.set(key, value);
      return true;
    },
    registerMenuCommand: () => true,
  };
}

describe('createSettingsStore', () => {
  it('每次都读存储：别的标签页改动立即生效', () => {
    const api = fakeGm({ enabled: true });
    const store = createSettingsStore({ api, key: 'k', normalize });

    expect(store.get().enabled).toBe(true);
    api.values.set('k', { enabled: false });
    expect(store.get().enabled).toBe(false);
  });

  it('没存过时用默认值', () => {
    const store = createSettingsStore({ api: fakeGm(), key: 'k', normalize });
    expect(store.get()).toEqual(DEFAULTS);
  });

  it('更新时写回完整设置并立即生效', () => {
    const api = fakeGm();
    const store = createSettingsStore({ api, key: 'k', normalize });

    store.update({ site: 'example.com' });
    expect(store.get()).toEqual({ enabled: true, site: 'example.com' });
    expect(api.values.get('k')).toEqual({ enabled: true, site: 'example.com' });
  });

  it('写失败时保留内存里的新值，不被存储中的旧值盖回去', () => {
    const api = fakeGm({ enabled: true, site: 'old' }, false);
    const store = createSettingsStore({ api, key: 'k', normalize });

    store.update({ site: 'new' });
    expect(store.get().site).toBe('new');
  });

  it('写失败后别处改了存储就跟存储走，不再顶住旧值', () => {
    const api = fakeGm({ enabled: true, site: 'old' }, false);
    const store = createSettingsStore({ api, key: 'k', normalize });

    store.update({ site: 'new' });
    expect(store.get().site).toBe('new');
    api.values.set('k', { enabled: true, site: 'other-tab' });
    expect(store.get().site).toBe('other-tab');
  });

  it('设置里带数组时，写失败后的新值仍然生效', () => {
    interface WithList {
      sites: string[];
    }
    const listNormalize = (stored: unknown): WithList => {
      const record = (typeof stored === 'object' && stored !== null ? stored : {}) as {
        sites?: unknown;
      };
      return { sites: Array.isArray(record.sites) ? (record.sites as string[]) : [] };
    };
    // GM 每次返回新的反序列化对象：不能靠引用判断“存储没变”。
    const values = new Map<string, unknown>();
    const api: GmApi = {
      getValue: (key, fallback) => (values.has(key) ? structuredClone(values.get(key)) : fallback),
      setValue: () => false,
      registerMenuCommand: () => true,
    };
    const store = createSettingsStore({ api, key: 'k', normalize: listNormalize });

    store.update({ sites: ['a.test'] });
    expect(store.get().sites).toEqual(['a.test']);
  });

  it('之后写成功时清掉内存副本', () => {
    const api = fakeGm({ site: 'old' }, false);
    const store = createSettingsStore({ api, key: 'k', normalize });
    store.update({ site: 'new' });

    api.setValue = (key, value) => {
      api.values.set(key, value);
      return true;
    };
    store.update({ site: 'newer' });
    expect(store.get().site).toBe('newer');
  });
});
