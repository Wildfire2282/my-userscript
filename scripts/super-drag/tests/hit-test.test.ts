// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { hitTestFast, isIgnorableHref, resolveLinkHref } from '../src/features/hit-test';

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
});
