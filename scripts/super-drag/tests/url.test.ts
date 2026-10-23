import { describe, expect, it } from 'vitest';
import { asDirectUrl, looksLikeUrl } from '../src/features/url';

describe('looksLikeUrl', () => {
  it('识别带协议的地址', () => {
    expect(looksLikeUrl('https://example.com')).toBe(true);
    expect(looksLikeUrl('http://example.com/a?b=1')).toBe(true);
    expect(looksLikeUrl('ftp://example.com/file')).toBe(true);
    expect(looksLikeUrl('HTTPS://EXAMPLE.COM/Path')).toBe(true);
  });

  it('不把普通词句当网址', () => {
    expect(looksLikeUrl('example.com')).toBe(false);
    expect(looksLikeUrl('搜索 关键词')).toBe(false);
    expect(looksLikeUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('asDirectUrl', () => {
  it('裸网址直接返回，两端空白被忽略', () => {
    expect(asDirectUrl('  https://example.com/x  ')).toBe('https://example.com/x');
  });

  it('含空白的整段文字交给搜索', () => {
    expect(asDirectUrl('看这个 https://example.com')).toBe('');
    expect(asDirectUrl('两个词')).toBe('');
  });

  it('空值与超长词不当作网址', () => {
    expect(asDirectUrl('')).toBe('');
    expect(asDirectUrl(null)).toBe('');
    expect(asDirectUrl(undefined)).toBe('');
    const long = `https://example.com/${'a'.repeat(2048)}`;
    expect(asDirectUrl(long)).toBe('');
  });

  it('句尾标点被剥掉，括号结尾的合法地址保留', () => {
    expect(asDirectUrl('https://example.com。这是说明')).toBe('https://example.com');
    expect(asDirectUrl('https://example.com/a,')).toBe('https://example.com/a');
    expect(asDirectUrl('HTTPS://EXAMPLE.COM/Path')).toBe('HTTPS://EXAMPLE.COM/Path');
    expect(asDirectUrl('https://en.wikipedia.org/wiki/X_(film)')).toBe(
      'https://en.wikipedia.org/wiki/X_(film)',
    );
  });
});
