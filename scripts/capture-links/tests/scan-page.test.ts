// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { scanLinks } from '../src/features/scan-page';

const BASE = 'https://example.com/board/list';

describe('scanLinks', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  function addLink(href: string, text: string, title?: string): HTMLAnchorElement {
    const link = document.createElement('a');
    link.setAttribute('href', href);
    link.textContent = text;
    if (title !== undefined) link.setAttribute('title', title);
    document.body.appendChild(link);
    return link;
  }

  it('补全相对地址并忽略空地址', () => {
    addLink('/rel/path?x=1', '相对链接');
    addLink('', '空链接');
    addLink('https://other.test/a', '外部链接');
    const items = scanLinks(document, BASE);
    expect(items.map((item) => item.url)).toEqual([
      'https://example.com/rel/path?x=1',
      'https://other.test/a',
    ]);
  });

  it('重复地址只保留第一条', () => {
    addLink('/same', '第一条');
    addLink('/same', '第二条');
    const items = scanLinks(document, BASE);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('第一条');
  });

  it('标题优先取外层 title 属性', () => {
    const row = document.createElement('li');
    row.setAttribute('title', '行标题');
    const link = document.createElement('a');
    link.setAttribute('href', '/file');
    link.textContent = '下载';
    row.appendChild(link);
    document.body.appendChild(row);
    expect(scanLinks(document, BASE)[0]?.title).toBe('行标题');
  });

  it('影子节点里的链接也能扫到', () => {
    addLink('/light', '明处链接');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const link = document.createElement('a');
    link.setAttribute('href', '/shadow-link');
    link.textContent = '影子链接';
    shadow.appendChild(link);
    const items = scanLinks(document, BASE);
    expect(items.map((item) => item.url)).toEqual([
      'https://example.com/light',
      'https://example.com/shadow-link',
    ]);
  });

  it('没有链接时返回空数组', () => {
    expect(scanLinks(document, BASE)).toEqual([]);
  });
});
