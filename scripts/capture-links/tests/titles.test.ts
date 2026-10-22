// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { bestTitle } from '../src/features/titles';

describe('bestTitle', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('优先用链接自身的 title 属性', () => {
    const link = document.createElement('a');
    link.setAttribute('title', '标题属性');
    link.textContent = '链接文字';
    document.body.appendChild(link);
    expect(bestTitle(link, 'https://example.com')).toBe('标题属性');
  });

  it('链接外层列表项的 title 优先于链接文字', () => {
    const item = document.createElement('li');
    item.setAttribute('title', '列表项标题');
    const link = document.createElement('a');
    link.textContent = '下载';
    item.appendChild(link);
    document.body.appendChild(item);
    expect(bestTitle(link, 'https://example.com')).toBe('列表项标题');
  });

  it('表格行标题也能代表链接', () => {
    const table = document.createElement('table');
    const row = document.createElement('tr');
    row.setAttribute('title', '表格行标题');
    const cell = document.createElement('td');
    const link = document.createElement('a');
    link.textContent = '下载';
    cell.appendChild(link);
    row.appendChild(cell);
    table.appendChild(row);
    document.body.appendChild(table);
    expect(bestTitle(link, 'https://example.com')).toBe('表格行标题');
  });

  it('没有外层标题时用链接文字', () => {
    const link = document.createElement('a');
    link.textContent = '  一段   链接文字  ';
    document.body.appendChild(link);
    expect(bestTitle(link, 'https://example.com')).toBe('一段 链接文字');
  });

  it('过长的文字与标题都退回地址', () => {
    const link = document.createElement('a');
    link.textContent = '字'.repeat(200);
    document.body.appendChild(link);
    expect(bestTitle(link, 'https://example.com')).toBe('https://example.com');
  });

  it('没有元素时直接用地址', () => {
    expect(bestTitle(null, 'https://example.com')).toBe('https://example.com');
  });
});
