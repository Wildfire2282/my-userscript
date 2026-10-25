import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClipboard } from '../src/host/clipboard';

describe('createClipboard', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    window.getSelection()?.removeAllRanges();
  });

  it('优先走 GM_setClipboard，拿到的是纯文本类型', async () => {
    const setClipboard = vi.fn();
    const copy = createClipboard({
      GM_setClipboard: setClipboard,
      clipboard: { writeText: vi.fn() },
    });
    await expect(copy.copy('一段文字')).resolves.toBe(true);
    expect(setClipboard).toHaveBeenCalledWith('一段文字', 'text');
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

  it('textarea 兜底成功后恢复焦点与控件选区，网页选区恢复失败也不改报失败', async () => {
    const input = document.createElement('input');
    input.value = 'abcdef';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(1, 3);

    const paragraph = document.createElement('p');
    paragraph.textContent = '页面选区';
    document.body.appendChild(paragraph);
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const restoreSelection = vi
      .spyOn(Selection.prototype, 'setBaseAndExtent')
      .mockImplementation(() => {
        throw new Error('节点已被页面改掉');
      });

    const command = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: command, configurable: true });
    try {
      const copy = createClipboard({ document });
      await expect(copy.copy('新内容')).resolves.toBe(true);
      expect(command).toHaveBeenCalledWith('copy');
      expect(restoreSelection).toHaveBeenCalled();
      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(1);
      expect(input.selectionEnd).toBe(3);
    } finally {
      Reflect.deleteProperty(document, 'execCommand');
      restoreSelection.mockRestore();
    }
  });

  it('焦点在不支持选区的数字输入框时不抛错', async () => {
    const input = document.createElement('input');
    input.type = 'number';
    input.value = '42';
    document.body.appendChild(input);
    input.focus();
    Object.defineProperty(input, 'selectionStart', {
      get() {
        throw new Error('InvalidStateError');
      },
      configurable: true,
    });
    Object.defineProperty(input, 'selectionEnd', {
      get() {
        throw new Error('InvalidStateError');
      },
      configurable: true,
    });

    const command = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: command, configurable: true });
    try {
      const copy = createClipboard({ document });
      await expect(copy.copy('新内容')).resolves.toBe(true);
      expect(command).toHaveBeenCalledWith('copy');
      expect(document.activeElement).toBe(input);
    } finally {
      Reflect.deleteProperty(document, 'execCommand');
    }
  });
});
