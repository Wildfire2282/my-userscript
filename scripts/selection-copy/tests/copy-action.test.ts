// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clipboard } from '@shared';
import { createCopyAction } from '../src/features/copy-action';

function fakeClipboard(result: boolean | Promise<boolean> = true): Clipboard & {
  copy: ReturnType<typeof vi.fn>;
} {
  return { copy: vi.fn(() => Promise.resolve(result)) };
}

function select(element: Element): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe('createCopyAction', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    window.getSelection()?.removeAllRanges();
  });

  it('复制去掉首尾空白后的选中文字，并点亮标记', async () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = '  要复制的文字  ';
    document.body.appendChild(paragraph);
    select(paragraph);

    const clipboard = fakeClipboard();
    const showIndicator = vi.fn();
    await createCopyAction({ clipboard, showIndicator })(paragraph);

    expect(clipboard.copy).toHaveBeenCalledWith('要复制的文字');
    expect(showIndicator).toHaveBeenCalledTimes(1);
  });

  it('没有选区或选中空白时不复制、不提示', async () => {
    const clipboard = fakeClipboard();
    const showIndicator = vi.fn();
    const action = createCopyAction({ clipboard, showIndicator });

    await action(null);
    expect(clipboard.copy).not.toHaveBeenCalled();

    const paragraph = document.createElement('p');
    paragraph.textContent = '   ';
    document.body.appendChild(paragraph);
    select(paragraph);
    await action(paragraph);
    expect(clipboard.copy).not.toHaveBeenCalled();
    expect(showIndicator).not.toHaveBeenCalled();
  });

  it('可编辑区域里的选区被跳过', async () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.textContent = '可编辑文字';
    document.body.appendChild(editor);
    select(editor);

    const clipboard = fakeClipboard();
    const showIndicator = vi.fn();
    await createCopyAction({ clipboard, showIndicator })(editor);

    expect(clipboard.copy).not.toHaveBeenCalled();
    expect(showIndicator).not.toHaveBeenCalled();
  });

  it('写入失败时不点亮标记', async () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = '一段文字';
    document.body.appendChild(paragraph);
    select(paragraph);

    const showIndicator = vi.fn();
    await createCopyAction({ clipboard: fakeClipboard(false), showIndicator })(paragraph);
    expect(showIndicator).not.toHaveBeenCalled();
  });

  it('连续两次复制只让最新一次点亮标记', async () => {
    const first = document.createElement('p');
    first.textContent = '第一次';
    first.getBoundingClientRect = () =>
      ({ left: 10, right: 20, top: 10, bottom: 20, width: 10, height: 10 }) as DOMRect;
    const second = document.createElement('p');
    second.textContent = '第二次';
    second.getBoundingClientRect = () =>
      ({ left: 100, right: 110, top: 100, bottom: 110, width: 10, height: 10 }) as DOMRect;
    document.body.append(first, second);

    const resolvers: Array<(value: boolean) => void> = [];
    const clipboard: Clipboard = {
      copy: () => new Promise<boolean>((resolve) => resolvers.push(resolve)),
    };
    const showIndicator = vi.fn();
    const action = createCopyAction({ clipboard, showIndicator });

    select(first);
    const older = action(first);
    select(second);
    const newer = action(second);

    resolvers[1]?.(true);
    await newer;
    resolvers[0]?.(true);
    await older;

    expect(showIndicator).toHaveBeenCalledTimes(1);
    expect(showIndicator).toHaveBeenCalledWith(expect.objectContaining({ left: 100, top: 100 }));
  });
});
