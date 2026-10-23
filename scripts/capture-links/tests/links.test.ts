import { describe, expect, it } from 'vitest';
import {
  collectLinks,
  decodeText,
  filterLinks,
  isMagnetLink,
  normalizeUrl,
  resolveUrl,
  type LinkItem,
} from '../src/links';

const BASE = 'https://example.com/page';

describe('decodeText', () => {
  it('还原常见实体', () => {
    expect(decodeText('a&amp;b&lt;c&gt;d&quot;e&#39;f')).toBe('a&b<c>d"e\'f');
  });

  it('还原空格与数字实体，只解一层', () => {
    expect(decodeText('第&nbsp;一节')).toBe('第 一节');
    expect(decodeText('a&#58;b&#x3A;c')).toBe('a:b:c');
    expect(decodeText('&amp;lt;')).toBe('&lt;');
    expect(decodeText('&#xZZ;')).toBe('&#xZZ;');
  });
});

describe('normalizeUrl', () => {
  it('去掉首尾空白并解码实体', () => {
    expect(normalizeUrl('  https://example.com/a&amp;b  ')).toBe('https://example.com/a&b');
  });
});

describe('resolveUrl', () => {
  it('相对地址按页面地址补全', () => {
    expect(resolveUrl('/rel/path?x=1', BASE)).toBe('https://example.com/rel/path?x=1');
  });

  it('完整地址保持原样', () => {
    expect(resolveUrl('https://other.test/a?b=1', BASE)).toBe('https://other.test/a?b=1');
  });

  it('空地址被忽略', () => {
    expect(resolveUrl('', BASE)).toBeNull();
    expect(resolveUrl('   ', BASE)).toBeNull();
  });

  it('磁力链接不被当成相对路径', () => {
    expect(resolveUrl('magnet:?xt=urn:btih:abc&dn=file', BASE)).toBe(
      'magnet:?xt=urn:btih:abc&dn=file',
    );
  });

  it('页面地址不可用时退回浏览器解析好的地址', () => {
    expect(resolveUrl('/rel', 'not a url', 'https://example.com/rel')).toBe(
      'https://example.com/rel',
    );
  });

  it('javascript:/data: 链接直接丢掉', () => {
    expect(resolveUrl('javascript:void(0)', BASE)).toBeNull();
    expect(resolveUrl('JAVASCRIPT:alert(1)', BASE)).toBeNull();
    expect(resolveUrl('data:text/html,hi', BASE)).toBeNull();
    expect(
      collectLinks(
        [{ rawHref: 'javascript:void(0)', absoluteHref: 'javascript:void(0)', title: '按钮' }],
        BASE,
      ),
    ).toEqual([]);
  });
});

describe('collectLinks', () => {
  it('按绝对地址去重，第一条的标题优先', () => {
    const items = collectLinks(
      [
        { rawHref: 'https://example.com/a', absoluteHref: 'https://example.com/a', title: 'A' },
        { rawHref: '/a', absoluteHref: 'https://example.com/a', title: '重复的 A' },
        { rawHref: 'https://example.com/b', absoluteHref: 'https://example.com/b', title: '' },
      ],
      BASE,
    );
    expect(items.map((item) => [item.url, item.title])).toEqual([
      ['https://example.com/a', 'A'],
      ['https://example.com/b', 'https://example.com/b'],
    ]);
  });

  it('忽略空地址与重复项', () => {
    const items = collectLinks(
      [
        { rawHref: '', absoluteHref: '', title: '空' },
        { rawHref: '#', absoluteHref: `${BASE}#`, title: '锚点' },
      ],
      BASE,
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.url).toBe(`${BASE}#`);
  });
});

describe('filterLinks', () => {
  const items: LinkItem[] = [
    { id: '1', url: 'https://example.com/alpha', title: 'Alpha 页面' },
    { id: '2', url: 'magnet:?xt=urn:btih:abc', title: '磁力资源' },
    { id: '3', url: 'https://example.com/file.torrent', title: '种子' },
  ];

  it('关键词同时匹配标题与地址，大小写不敏感', () => {
    expect(filterLinks(items, 'ALPHA', false).map((item) => item.id)).toEqual(['1']);
    expect(filterLinks(items, 'file.torrent', false).map((item) => item.id)).toEqual(['3']);
  });

  it('空关键词返回全部', () => {
    expect(filterLinks(items, '   ', false)).toHaveLength(3);
  });

  it('仅磁链只保留 magnet: 地址', () => {
    expect(filterLinks(items, '', true).map((item) => item.id)).toEqual(['2']);
  });

  it('关键词与仅磁链同时生效', () => {
    expect(filterLinks(items, '磁力', true).map((item) => item.id)).toEqual(['2']);
    expect(filterLinks(items, '种子', true)).toEqual([]);
  });

  it('识别磁力地址不区分大小写', () => {
    expect(isMagnetLink('MAGNET:?xt=1')).toBe(true);
    expect(isMagnetLink('https://example.com/magnet:')).toBe(false);
  });
});
