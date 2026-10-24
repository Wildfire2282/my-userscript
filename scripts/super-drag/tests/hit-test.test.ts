// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  hasNativeDragContent,
  hitTestFast,
  isIgnorableHref,
  resolveLinkHref,
} from '../src/features/hit-test';

beforeEach(() => {
  document.body.replaceChildren();
});

describe('isIgnorableHref', () => {
  it('空值、井号与 javascript: 都不当链接', () => {
    expect(isIgnorableHref(null)).toBe(true);
    expect(isIgnorableHref('')).toBe(true);
    expect(isIgnorableHref('#')).toBe(true);
    expect(isIgnorableHref('javascript:void(0)')).toBe(true);
    expect(isIgnorableHref('JavaScript:alert(1)')).toBe(true);
  });

  it('真实地址可用', () => {
    expect(isIgnorableHref('/path')).toBe(false);
    expect(isIgnorableHref('https://example.com')).toBe(false);
  });
});

describe('resolveLinkHref', () => {
  it('绝对地址保持原样', () => {
    const link = document.createElement('a');
    link.setAttribute('href', 'https://example.com/x?y=1#z');
    expect(resolveLinkHref(link)).toBe('https://example.com/x?y=1#z');
  });

  it('相对地址按 document.baseURI 补全', () => {
    const link = document.createElement('a');
    link.setAttribute('href', '/relative/path');
    expect(resolveLinkHref(link)).toBe(new URL('/relative/path', document.baseURI).href);
  });

  it('支持 xlink:href（SVG 链接）', () => {
    const link = document.createElementNS('http://www.w3.org/2000/svg', 'a');
    link.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', 'https://example.com/svg');
    expect(resolveLinkHref(link)).toBe('https://example.com/svg');
  });

  it('没有 href 时返回空字符串', () => {
    expect(resolveLinkHref(document.createElement('a'))).toBe('');
  });
});

describe('hitTestFast', () => {
  it('链接内的子元素识别为链接', () => {
    const link = document.createElement('a');
    link.setAttribute('href', 'https://example.com/a');
    const span = document.createElement('span');
    link.appendChild(span);
    document.body.appendChild(link);
    expect(hitTestFast(span)).toEqual({ link: 'https://example.com/a', image: '' });
  });

  it('图片识别为图片', () => {
    const img = document.createElement('img');
    img.setAttribute('src', 'https://example.com/i.png');
    document.body.appendChild(img);
    expect(hitTestFast(img)).toMatchObject({ image: 'https://example.com/i.png' });
  });

  it('普通文字不认领', () => {
    const p = document.createElement('p');
    p.textContent = '普通段落';
    document.body.appendChild(p);
    expect(hitTestFast(p)).toBeNull();
  });

  it('# 与 javascript: 链接按普通内容处理', () => {
    const link = document.createElement('a');
    link.setAttribute('href', '#');
    const span = document.createElement('span');
    link.appendChild(span);
    document.body.appendChild(link);
    expect(hitTestFast(span)).toBeNull();
  });

  it('事件目标缺失时返回 null', () => {
    expect(hitTestFast(null)).toBeNull();
  });

  it('SVG 链接的 xlink:href 也能识别', () => {
    const link = document.createElementNS('http://www.w3.org/2000/svg', 'a');
    link.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', 'https://example.com/svg');
    document.body.appendChild(link);
    expect(hitTestFast(link)).toEqual({ link: 'https://example.com/svg', image: '' });
  });

  it('src 为空的图片不打开当前页面地址', () => {
    const img = document.createElement('img');
    img.setAttribute('src', '');
    // 浏览器里 `img.src` 对空属性会解析成当前页面地址，且此时没有选中的资源。
    Object.defineProperty(img, 'src', { value: document.baseURI });
    Object.defineProperty(img, 'currentSrc', { value: '' });
    document.body.appendChild(img);
    expect(hitTestFast(img)).toBeNull();
  });
});

describe('hasNativeDragContent', () => {
  it('带可用地址的链接与图片算脚本内容', () => {
    const link = document.createElement('a');
    link.setAttribute('href', '/target');
    const img = document.createElement('img');
    img.setAttribute('src', 'https://example.com/i.png');
    document.body.append(link, img);

    expect(hasNativeDragContent(link)).toBe(true);
    expect(hasNativeDragContent(img)).toBe(true);
  });

  it('没有地址、只有 # 或 javascript: 的链接仍归页面', () => {
    const empty = document.createElement('a');
    const hash = document.createElement('a');
    hash.setAttribute('href', '#');
    const script = document.createElement('a');
    script.setAttribute('href', 'javascript:void(0)');
    document.body.append(empty, hash, script);

    expect(hasNativeDragContent(empty)).toBe(false);
    expect(hasNativeDragContent(hash)).toBe(false);
    expect(hasNativeDragContent(script)).toBe(false);
  });

  it('没有地址的图片与普通可拖拽容器都交还页面', () => {
    const img = document.createElement('img');
    img.setAttribute('src', '');
    const card = document.createElement('div');
    document.body.append(img, card);

    expect(hasNativeDragContent(img)).toBe(false);
    expect(hasNativeDragContent(card)).toBe(false);
  });
});
