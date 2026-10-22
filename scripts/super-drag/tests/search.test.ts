import { describe, expect, it } from 'vitest';
import {
  buildSearchUrl,
  defaultSettings,
  engineOptions,
  validateCustomEngineUrl,
} from '../src/search';
import { CUSTOM_ENGINE_ID, type Settings } from '../src/settings';

function settings(patch: Partial<Settings> = {}): Settings {
  return { ...defaultSettings(), ...patch };
}

describe('engineOptions', () => {
  it('列出存储里的引擎并追加自定义项', () => {
    const options = engineOptions(settings());
    expect(options.map((option) => option.value)).toEqual([
      'cn.bing',
      'bing',
      'google',
      'baidu',
      CUSTOM_ENGINE_ID,
    ]);
    expect(options[2]?.label).toBe('Google');
  });

  it('存储里新增的引擎用 ID 当显示名', () => {
    const options = engineOptions(settings({ engines: { duckduckgo: 'https://x/?q={keyword}' } }));
    expect(options[0]).toEqual({ value: 'duckduckgo', label: 'duckduckgo' });
  });
});

describe('buildSearchUrl', () => {
  it('按当前引擎拼接并编码关键词', () => {
    expect(buildSearchUrl(settings({ defaultEngine: 'baidu' }), '你好 世界')).toBe(
      'https://www.baidu.com/s?wd=%E4%BD%A0%E5%A5%BD%20%E4%B8%96%E7%95%8C',
    );
  });

  it('自定义引擎使用自定义地址', () => {
    const custom = settings({
      defaultEngine: CUSTOM_ENGINE_ID,
      customEngineUrl: 'https://example.com/s?q={keyword}',
    });
    expect(buildSearchUrl(custom, 'a b')).toBe('https://example.com/s?q=a%20b');
  });

  it('模板缺少占位符时回退 Google，不打开坏地址', () => {
    const broken = settings({
      defaultEngine: CUSTOM_ENGINE_ID,
      customEngineUrl: 'https://example.com/no-placeholder',
    });
    expect(buildSearchUrl(broken, 'x')).toBe('https://www.google.com/search?q=x');
  });

  it('引擎 ID 不存在时回退 Google', () => {
    expect(buildSearchUrl(settings({ defaultEngine: 'gone' }), 'x')).toBe(
      'https://www.google.com/search?q=x',
    );
  });
});

describe('validateCustomEngineUrl', () => {
  it('地址可用时返回 null', () => {
    expect(validateCustomEngineUrl('https://example.com/s?q={keyword}')).toBeNull();
  });

  it('缺少占位符或协议时报错', () => {
    expect(validateCustomEngineUrl('https://example.com/s?q=')).toContain('{keyword}');
    expect(validateCustomEngineUrl('example.com/?q={keyword}')).toContain('http://');
  });

  it('空地址提示填写', () => {
    expect(validateCustomEngineUrl('   ')).toContain('请填写');
  });
});
