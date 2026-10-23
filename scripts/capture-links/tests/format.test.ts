import { describe, expect, it } from 'vitest';
import { formatLinks } from '../src/format';
import type { LinkItem } from '../src/links';

const ITEMS: LinkItem[] = [
  { id: '1', url: 'https://example.com/a', title: 'A 页面' },
  { id: '2', url: 'https://example.com/b', title: 'B 页面' },
];

describe('formatLinks', () => {
  it('纯链接每行一个地址', () => {
    expect(formatLinks(ITEMS, 'url')).toBe('https://example.com/a\nhttps://example.com/b');
  });

  it('Markdown 用 [标题](地址)', () => {
    expect(formatLinks(ITEMS, 'markdown')).toBe(
      '[A 页面](https://example.com/a)\n[B 页面](https://example.com/b)',
    );
  });

  it('HTML 用 <a href> 包住标题', () => {
    expect(formatLinks(ITEMS, 'html')).toBe(
      '<a href="https://example.com/a">A 页面</a>\n<a href="https://example.com/b">B 页面</a>',
    );
  });

  it('没有选中项时是空字符串', () => {
    expect(formatLinks([], 'url')).toBe('');
  });

  it('标题里的特殊字符会转义，不拼出坏格式', () => {
    const items: LinkItem[] = [{ id: '1', url: 'https://example.com/a', title: 'a]b"c<d' }];
    expect(formatLinks(items, 'markdown')).toBe('[a\\]b"c<d](https://example.com/a)');
    expect(formatLinks(items, 'html')).toBe('<a href="https://example.com/a">a]b&quot;c&lt;d</a>');
  });

  it('地址里有括号时 Markdown 用 <> 包裹', () => {
    const items: LinkItem[] = [{ id: '1', url: 'https://example.com/a(1)', title: 'A' }];
    expect(formatLinks(items, 'markdown')).toBe('[A](<https://example.com/a(1)>)');
  });
});
