// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clipboard } from '@shared';
import type { CopyFeedback } from '../src/feedback';
import { createCopyAction } from '../src/features/copy-action';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings';

const SITE = 'example.com';

function behavior(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function makeAction(
  clipboard: Clipboard,
  showFeedback: (feedback: CopyFeedback) => void,
  overrides: Partial<Settings> = {},
) {
  return createCopyAction({
    clipboard,
    getSettings: () => behavior(overrides),
    site: SITE,
    showFeedback,
  });
}

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

function rect(left: number, top: number, width = 10, height = 20): DOMRect {
  return {
    left,
    right: left + width,
    top,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

describe('createCopyAction', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    window.getSelection()?.removeAllRanges();
  });

  it('复制去掉首尾空白后的选中文字，并显示成功反馈', async () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = '  要复制的文字  ';
    paragraph.getBoundingClientRect = () => rect(100, 200, 120, 20);
    document.body.appendChild(paragraph);
    select(paragraph);

    const clipboard = fakeClipboard();
    const showFeedback = vi.fn();
    const outcome = await makeAction(clipboard, showFeedback)(paragraph);

    expect(outcome).toBe('copied');
    expect(clipboard.copy).toHaveBeenCalledWith('要复制的文字');
    expect(showFeedback).toHaveBeenCalledTimes(1);
    expect(showFeedback).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }));
  });

  it('关闭“去掉首尾空白”后按原样复制', async () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = '  保留两端的空格  ';
    document.body.appendChild(paragraph);
    select(paragraph);

    const clipboard = fakeClipboard();
    await makeAction(clipboard, vi.fn(), { trimWhitespace: false })(paragraph);

    expect(clipboard.copy).toHaveBeenCalledWith('  保留两端的空格  ');
  });

  it('总开关或本站暂停时跳过，不读选区、不提示', async () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = '一段文字';
    document.body.appendChild(paragraph);
    select(paragraph);

    const clipboard = fakeClipboard();
    const showFeedback = vi.fn();

    expect(await makeAction(clipboard, showFeedback, { enabled: false })(paragraph)).toBe(
      'skipped',
    );
    expect(await makeAction(clipboard, showFeedback, { disabledSites: [SITE] })(paragraph)).toBe(
      'skipped',
    );
    expect(clipboard.copy).not.toHaveBeenCalled();
    expect(showFeedback).not.toHaveBeenCalled();
  });

  it('没有选区或选中空白时不复制、不提示', async () => {
    const clipboard = fakeClipboard();
    const showFeedback = vi.fn();
    const action = makeAction(clipboard, showFeedback);

    expect(await action(null)).toBe('skipped');
    expect(clipboard.copy).not.toHaveBeenCalled();

    const paragraph = document.createElement('p');
    paragraph.textContent = '   ';
    document.body.appendChild(paragraph);
    select(paragraph);
    expect(await action(paragraph)).toBe('skipped');
    expect(clipboard.copy).not.toHaveBeenCalled();
    expect(showFeedback).not.toHaveBeenCalled();
  });

  it('可编辑区域默认跳过，打开开关后复制', async () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.textContent = '可编辑文字';
    document.body.appendChild(editor);
    select(editor);

    const skipped = fakeClipboard();
    expect(await makeAction(skipped, vi.fn())(editor)).toBe('skipped');
    expect(skipped.copy).not.toHaveBeenCalled();

    const allowed = fakeClipboard();
    expect(await makeAction(allowed, vi.fn(), { copyInEditors: true })(editor)).toBe('copied');
    expect(allowed.copy).toHaveBeenCalledWith('可编辑文字');
  });

  it('文本框默认跳过，打开开关后从控件自身读取选区', async () => {
    const input = document.createElement('input');
    input.value = '  输入框里的文字  ';
    input.getBoundingClientRect = () => rect(100, 50, 300, 30);
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(0, 9);

    const skipped = fakeClipboard();
    expect(await makeAction(skipped, vi.fn())(input)).toBe('skipped');
    expect(skipped.copy).not.toHaveBeenCalled();

    const clipboard = fakeClipboard();
    const showFeedback = vi.fn();
    expect(await makeAction(clipboard, showFeedback, { copyInInputs: true })(input)).toBe('copied');
    expect(clipboard.copy).toHaveBeenCalledWith('输入框里的文字');
    expect(showFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'success',
        rect: expect.objectContaining({ top: 50, bottom: 80 }),
      }),
    );
  });

  it('写入失败时显示失败反馈', async () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = '一段文字';
    document.body.appendChild(paragraph);
    select(paragraph);

    const showFeedback = vi.fn();
    const outcome = await makeAction(fakeClipboard(false), showFeedback)(paragraph);

    expect(outcome).toBe('failed');
    expect(showFeedback).toHaveBeenCalledWith(expect.objectContaining({ variant: 'failure' }));
  });

  it('写入器抛错也按失败处理，不把异常抛给页面', async () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = '一段文字';
    document.body.appendChild(paragraph);
    select(paragraph);

    const clipboard: Clipboard = { copy: () => Promise.reject(new Error('denied')) };
    const showFeedback = vi.fn();
    const outcome = await makeAction(clipboard, showFeedback)(paragraph);

    expect(outcome).toBe('failed');
    expect(showFeedback).toHaveBeenCalledWith(expect.objectContaining({ variant: 'failure' }));
  });

  it('连续两次复制只让最新一次显示反馈', async () => {
    const first = document.createElement('p');
    first.textContent = '第一次';
    first.getBoundingClientRect = () => rect(10, 10);
    const second = document.createElement('p');
    second.textContent = '第二次';
    second.getBoundingClientRect = () => rect(100, 100);
    document.body.append(first, second);

    const resolvers: Array<(value: boolean) => void> = [];
    const clipboard: Clipboard = {
      copy: () => new Promise<boolean>((resolve) => resolvers.push(resolve)),
    };
    const showFeedback = vi.fn();
    const action = makeAction(clipboard, showFeedback);

    select(first);
    const older = action(first);
    select(second);
    const newer = action(second);

    resolvers[1]?.(true);
    await newer;
    resolvers[0]?.(true);
    await older;

    expect(showFeedback).toHaveBeenCalledTimes(1);
    expect(showFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        rect: expect.objectContaining({ left: 105, top: 100 }),
      }),
    );
  });

  it('旧写入后完成时按过期处理，不再上报成功', async () => {
    const first = document.createElement('p');
    first.textContent = '第一次';
    const second = document.createElement('p');
    second.textContent = '第二次';
    document.body.append(first, second);

    const resolvers: Array<(value: boolean) => void> = [];
    const clipboard: Clipboard = {
      copy: () => new Promise<boolean>((resolve) => resolvers.push(resolve)),
    };
    const showFeedback = vi.fn();
    const action = makeAction(clipboard, showFeedback);

    select(first);
    const older = action(first);
    select(second);
    const newer = action(second);

    resolvers[1]?.(true);
    await expect(newer).resolves.toBe('copied');
    resolvers[0]?.(true);
    await expect(older).resolves.toBe('skipped');
    expect(showFeedback).toHaveBeenCalledTimes(1);
  });
});
