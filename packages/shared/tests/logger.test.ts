import { describe, expect, it, vi } from 'vitest';
import { createLogger, guard } from '../src/runtime/logger';

describe('createLogger', () => {
  it('输出带 [slug] 前缀，不含多余信息', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const log = createLogger('super-drag');
      log.warn('菜单命令不可用');
      log.error('启动失败', new Error('boom'));
      expect(warn).toHaveBeenCalledWith('[super-drag] 菜单命令不可用');
      expect(error).toHaveBeenCalledWith('[super-drag] 启动失败', expect.any(Error));
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});

describe('guard', () => {
  it('正常执行不记日志', () => {
    const log = createLogger('capture-links');
    const run = vi.fn();
    guard(log, '打开面板失败', run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('抛错只记日志，不抛给调用方', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const log = createLogger('capture-links');
      expect(() =>
        guard(log, '打开面板失败', () => {
          throw new Error('mount failed');
        }),
      ).not.toThrow();
      expect(error).toHaveBeenCalledWith('[capture-links] 打开面板失败', expect.any(Error));
    } finally {
      error.mockRestore();
    }
  });
});
