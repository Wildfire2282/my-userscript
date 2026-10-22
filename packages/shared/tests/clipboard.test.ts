import { describe, expect, it, vi } from 'vitest';
import { createClipboard } from '../src/clipboard';

describe('createClipboard', () => {
  it('优先走 GM_setClipboard，拿到的是纯文本类型', async () => {
    const setClipboard = vi.fn();
    const copy = createClipboard({
      GM_setClipboard: setClipboard,
      clipboard: { writeText: vi.fn() },
    });
    await expect(copy.copy('一段文字')).resolves.toBe(true);
    expect(setClipboard).toHaveBeenCalledWith('一段文字', 'text');
  });

  it('没有 GM_setClipboard 时退回 GM 命名空间', async () => {
    const setClipboard = vi.fn();
    const copy = createClipboard({ GM: { setClipboard } });
    await expect(copy.copy('命令空间')).resolves.toBe(true);
    expect(setClipboard).toHaveBeenCalledWith('命令空间', 'text');
  });

  it('管理器抛错时继续用浏览器剪贴板', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const copy = createClipboard({
      GM_setClipboard: () => {
        throw new Error('denied');
      },
      clipboard: { writeText },
    });
    await expect(copy.copy('降级')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('降级');
  });

  it('两个通道都不可用时返回 false，不抛错', async () => {
    const copy = createClipboard({});
    await expect(copy.copy('没有通道')).resolves.toBe(false);
  });

  it('空文本不需要写剪贴板', async () => {
    const setClipboard = vi.fn();
    const copy = createClipboard({ GM_setClipboard: setClipboard });
    await expect(copy.copy('')).resolves.toBe(true);
    expect(setClipboard).not.toHaveBeenCalled();
  });
});
