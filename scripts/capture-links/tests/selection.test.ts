import { describe, expect, it } from 'vitest';
import type { LinkItem } from '../src/links';
import { invertSelection, pickedItems, selectAll, selectNone } from '../src/selection';

const A: LinkItem = { id: 'a', url: 'https://example.com/a', title: 'A' };
const B: LinkItem = { id: 'b', url: 'https://example.com/b', title: 'B' };

describe('批量勾选', () => {
  it('全选只加当前可见项，保留筛选之外的选中状态', () => {
    const selected = selectAll(new Set(['hidden']), [A, B]);
    expect([...selected].sort()).toEqual(['a', 'b', 'hidden']);
  });

  it('全不选只清当前可见项', () => {
    const selected = selectNone(new Set(['a', 'b', 'hidden']), [A]);
    expect([...selected].sort()).toEqual(['b', 'hidden']);
  });

  it('反选在可见项内互换', () => {
    const selected = invertSelection(new Set(['a', 'hidden']), [A, B]);
    expect([...selected].sort()).toEqual(['b', 'hidden']);
  });

  it('不修改传入的集合', () => {
    const original = new Set(['a']);
    selectAll(original, [A, B]);
    selectNone(original, [A]);
    invertSelection(original, [A, B]);
    expect([...original]).toEqual(['a']);
  });

  it('复制时只取当前筛选结果里被选中的条目，并保持列表顺序', () => {
    expect(pickedItems(new Set(['b', 'a', 'hidden']), [B, A])).toEqual([B, A]);
  });
});
