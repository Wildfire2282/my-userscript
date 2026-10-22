import { describe, expect, it } from 'vitest';
import { prioritize } from '../src/transcript/strategy';

describe('prioritize', () => {
  it('没有记忆时保持默认顺序', () => {
    expect(prioritize(3, undefined)).toEqual([0, 1, 2]);
  });

  it('上次成功的策略挪到最前面，其余顺序不变', () => {
    expect(prioritize(3, 2)).toEqual([2, 0, 1]);
    expect(prioritize(2, 1)).toEqual([1, 0]);
  });

  it('第 0 个不需要调整', () => {
    expect(prioritize(2, 0)).toEqual([0, 1]);
  });

  it('越界、非整数与负数都退回默认顺序', () => {
    expect(prioritize(2, 3)).toEqual([0, 1]);
    expect(prioritize(2, -1)).toEqual([0, 1]);
    expect(prioritize(2, 1.5)).toEqual([0, 1]);
  });

  it('没有策略时返回空数组', () => {
    expect(prioritize(0, 0)).toEqual([]);
  });
});
