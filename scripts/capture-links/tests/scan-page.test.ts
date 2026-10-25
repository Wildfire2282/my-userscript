// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { scanLinks } from '../src/features/scan-page';
import { formatLinks } from '../src/format';

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

  it('复制地址只经过 DOM 的一次实体解码，保留字面实体和标题', () => {
    const parsed = new DOMParser().parseFromString(
      `
      <a href="https://example.com/?a=1&amp;b=2">普通参数</a>
      <a href="https://example.com/?a=1&amp;amp;b=2">字面 &amp;amp;</a>
      <a href="magnet:?xt=urn:btih:abc&amp;dn=a&amp;amp;b">磁链</a>
    `,
      'text/html',
    );
    document.body.append(...parsed.body.childNodes);
    const items = scanLinks(document, BASE);
    const browserUrls = [...document.querySelectorAll('a')].map((anchor) => anchor.href);

    expect(items.map((item) => item.url)).toEqual(browserUrls);
    expect(formatLinks(items, 'url')).toBe(
      'https://example.com/?a=1&b=2\nhttps://example.com/?a=1&amp;b=2\nmagnet:?xt=urn:btih:abc&dn=a&amp;b',
    );
    expect(items[1]?.title).toBe('字面 &amp;');
    const copied = new DOMParser().parseFromString(formatLinks(items, 'html'), 'text/html');
    expect([...copied.querySelectorAll('a')].map((anchor) => anchor.href)).toEqual(browserUrls);
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

  it('SVG 里的链接也能扫到', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const link = document.createElementNS('http://www.w3.org/2000/svg', 'a');
    link.setAttribute('href', '/svg-link');
    link.textContent = 'SVG 链接';
    svg.appendChild(link);
    document.body.appendChild(svg);

    expect(scanLinks(document, BASE).map((item) => [item.url, item.title])).toEqual([
      ['https://example.com/svg-link', 'SVG 链接'],
    ]);
  });

  it('不扫描自己界面里的链接', () => {
    addLink('/page', '页面链接');
    const host = document.createElement('div');
    host.setAttribute('data-ds-root', '');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const own = document.createElement('a');
    own.setAttribute('href', '/own-ui');
    own.textContent = '面板里的按钮';
    shadow.appendChild(own);

    expect(scanLinks(document, BASE).map((item) => item.url)).toEqual(['https://example.com/page']);
  });

  it('没有链接时返回空数组', () => {
    expect(scanLinks(document, BASE)).toEqual([]);
  });
});
