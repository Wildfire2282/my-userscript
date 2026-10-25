import { describe, expect, it } from 'vitest';
import { compareVersions } from './versions.mjs';

describe('compareVersions', () => {
  it('逐段按数字比较，缺失段按 0', () => {
    expect(compareVersions('1.2.3', '1.2.4')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });

  it('非数字段退回自然排序', () => {
    expect(compareVersions('1.2.beta', '1.2.alpha')).toBeGreaterThan(0);
  });
});
