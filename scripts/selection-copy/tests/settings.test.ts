import { describe, expect, it } from 'vitest';
import type { GmApi } from '@shared';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  createSettingsStore,
  frameSiteKey,
  isEnabledOn,
  normalizeSettings,
  siteKey,
  siteLabel,
  withSiteEnabled,
} from '../src/settings';

function fakeGm(
  stored: unknown = null,
  writable = true,
): { api: GmApi; values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  if (stored !== null) values.set(SETTINGS_KEY, stored);
  const api: GmApi = {
    getValue: (key, fallback) => (values.has(key) ? values.get(key) : fallback),
    setValue: (key, value) => {
      if (!writable) return false;
      values.set(key, value);
      return true;
    },
    registerMenuCommand: () => true,
  };
  return { api, values };
}

describe('normalizeSettings', () => {
  it('没有存量设置时等于默认值', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('只认明确写出的值，坏类型回退默认行为', () => {
    expect(
      normalizeSettings({
        enabled: 'false',
        copyInInputs: 1,
        copyInEditors: 'yes',
        trimWhitespace: 'no',
        disabledSites: 'example.com',
      }),
    ).toEqual(DEFAULT_SETTINGS);
  });

  it('保留合法的关闭值与本站列表，并去重、规范大小写', () => {
    expect(
      normalizeSettings({
        enabled: false,
        copyInInputs: true,
        copyInEditors: true,
        trimWhitespace: false,
        disabledSites: [' Example.com ', 'example.com', '', 3],
      }),
    ).toEqual({
      enabled: false,
      copyInInputs: true,
      copyInEditors: true,
      trimWhitespace: false,
      disabledSites: ['example.com'],
    });
  });
});

describe('站点标识', () => {
  it('HTTP(S) 用主机名并转小写', () => {
    expect(siteKey({ hostname: 'Example.COM', protocol: 'https:' })).toBe('example.com');
  });

  it('没有主机名的本地页面用协议名', () => {
    expect(siteKey({ hostname: '', protocol: 'file:' })).toBe('file');
    expect(siteKey({ hostname: '', protocol: '' })).toBe('unknown');
  });

  it('面板里把 file 显示成可读名称', () => {
    expect(siteLabel('file')).toBe('本机文件');
    expect(siteLabel('example.com')).toBe('example.com');
  });
});

describe('顶层站点', () => {
  const self = { hostname: 'frame.example', protocol: 'https:' };

  it('同源 frame 直接用顶层页面的主机名', () => {
    expect(
      frameSiteKey({
        self,
        top: { hostname: 'www.example.com', protocol: 'https:' },
        ancestorOrigins: ['https://www.example.com'],
      }),
    ).toBe('www.example.com');
  });

  it('跨域时用 ancestorOrigins 里最顶层的那一项', () => {
    expect(
      frameSiteKey({
        self,
        top: null,
        ancestorOrigins: ['https://parent.example', 'https://www.example.com'],
      }),
    ).toBe('www.example.com');
  });

  it('来源不可解析时退回本帧主机名', () => {
    expect(frameSiteKey({ self, top: null, ancestorOrigins: ['null'] })).toBe('frame.example');
    expect(frameSiteKey({ self, top: null, ancestorOrigins: [] })).toBe('frame.example');
  });
});

describe('站点开关', () => {
  const settings = { ...DEFAULT_SETTINGS, disabledSites: ['example.com'] };

  it('总开关与本站开关同时生效', () => {
    expect(isEnabledOn(settings, 'other.com')).toBe(true);
    expect(isEnabledOn(settings, 'example.com')).toBe(false);
    expect(isEnabledOn({ ...settings, enabled: false }, 'other.com')).toBe(false);
  });

  it('切换本站只改列表，不动原对象', () => {
    const disabled = withSiteEnabled(settings, 'other.com', false);
    expect(disabled.disabledSites).toEqual(['example.com', 'other.com']);
    expect(settings.disabledSites).toEqual(['example.com']);

    const enabled = withSiteEnabled(disabled, 'example.com', true);
    expect(enabled.disabledSites).toEqual(['other.com']);
  });
});

describe('createSettingsStore', () => {
  it('读取一次后走内存缓存，更新写回同一个键', () => {
    const { api, values } = fakeGm();
    const store = createSettingsStore(api);

    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    store.update({ copyInInputs: true, disabledSites: ['example.com'] });

    expect(values.get(SETTINGS_KEY)).toMatchObject({
      copyInInputs: true,
      disabledSites: ['example.com'],
    });
    expect(store.get().copyInInputs).toBe(true);
  });

  it('复制前读到别的 frame 刚写入的设置', () => {
    const { api, values } = fakeGm();
    const store = createSettingsStore(api);

    expect(store.get().trimWhitespace).toBe(true);
    values.set(SETTINGS_KEY, { ...DEFAULT_SETTINGS, trimWhitespace: false });

    expect(store.get().trimWhitespace).toBe(true);
    expect(store.snapshot().trimWhitespace).toBe(false);
    expect(store.get().trimWhitespace).toBe(false);
  });

  it('写入失败时仍保留内存里的新设置，不被旧值覆盖', () => {
    const { api, values } = fakeGm(null, false);
    const store = createSettingsStore(api);

    store.update({ enabled: false });
    expect(store.get().enabled).toBe(false);
    expect(store.snapshot().enabled).toBe(false);
    expect(values.has(SETTINGS_KEY)).toBe(false);
  });

  it('存储里的坏值不会让脚本整体失效', () => {
    const { api } = fakeGm({ enabled: 'x', copyInInputs: 'x', disabledSites: {} });
    const store = createSettingsStore(api);
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
  });
});
