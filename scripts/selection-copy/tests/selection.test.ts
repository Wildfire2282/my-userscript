// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  elementOf,
  getActiveElement,
  getActiveTextControl,
  isDisabledTarget,
  isTextControl,
  readSelectionText,
  readTextControlText,
  selectionForTarget,
  selectedTextControl,
  snapshotSelection,
} from '../src/selection';

describe('elementOf', () => {
  it('元素原样返回，文本节点返回父元素', () => {
    const paragraph = document.createElement('p');
    const text = document.createTextNode('文字');
    paragraph.appendChild(text);
    expect(elementOf(paragraph)).toBe(paragraph);
    expect(elementOf(text)).toBe(paragraph);
  });

  it('window 之类没有父元素的目标返回 null', () => {
    expect(elementOf(window)).toBeNull();
    expect(elementOf(null)).toBeNull();
  });
});

describe('isTextControl', () => {
  it('只认 input 与 textarea', () => {
    expect(isTextControl(document.createElement('input'))).toBe(true);
    expect(isTextControl(document.createElement('textarea'))).toBe(true);
    expect(isTextControl(document.createElement('div'))).toBe(false);
    expect(isTextControl(null)).toBe(false);
  });
});

describe('选区读取', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    window.getSelection()?.removeAllRanges();
  });

  function selectText(text: string): void {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    document.body.appendChild(paragraph);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  it('快照逐项相等', () => {
    selectText('一段文字');
    const first = snapshotSelection(window.getSelection());
    const second = snapshotSelection(window.getSelection());
    expect(first).toEqual(second);
    expect(first?.rangeCount).toBe(1);
  });

  it('读取时去掉首尾空白', () => {
    selectText('  前后都有空格  ');
    const selection = window.getSelection();
    expect(selection && readSelectionText(selection)).toBe('前后都有空格');
    expect(selection && readSelectionText(selection, false)).toBe('  前后都有空格  ');
  });

  it('文本控件按自身的 selectionStart / selectionEnd 读取', () => {
    const input = document.createElement('input');
    input.value = '  控件里的文字  ';
    document.body.appendChild(input);
    input.setSelectionRange(0, 8);
    expect(readTextControlText(input)).toBe('控件里的文字');
    expect(readTextControlText(input, false)).toBe('  控件里的文字');
  });
});

describe('手势来源', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    window.getSelection()?.removeAllRanges();
  });

  it('鼠标手势在正文里时，不把焦点输入框的旧选区当成本次来源', () => {
    const input = document.createElement('input');
    input.value = '输入框内容';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(0, 3);

    const paragraph = document.createElement('p');
    paragraph.textContent = '正文';
    document.body.appendChild(paragraph);

    expect(selectedTextControl(paragraph)).toBeNull();
    expect(selectedTextControl(null)).toBe(input);
  });

  it('Shadow Root 内优先使用作用域选区', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const paragraph = document.createElement('p');
    paragraph.textContent = '组件里的文字';
    shadow.appendChild(paragraph);
    const scoped = { rangeCount: 1 } as unknown as Selection;
    Object.defineProperty(shadow, 'getSelection', { value: () => scoped });

    expect(selectionForTarget(paragraph, document)).toBe(scoped);
  });
});

describe('门控', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    window.getSelection()?.removeAllRanges();
  });

  it('普通段落里选中文字允许复制', () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = '普通正文';
    document.body.appendChild(paragraph);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    window.getSelection()?.addRange(range);
    expect(isDisabledTarget(window.getSelection(), paragraph, null)).toBe(false);
  });

  it('输入框里的选区不复制', () => {
    const input = document.createElement('input');
    input.value = '输入框内容';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(0, 3);
    expect(isDisabledTarget(document.getSelection(), input, input)).toBe(true);
    expect(getActiveTextControl()).toBe(input);
  });

  it('焦点输入框的旧选区不拦截鼠标选中的正文', () => {
    const input = document.createElement('input');
    input.value = '旧的输入框选区';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(0, 3);
    const paragraph = document.createElement('p');
    paragraph.textContent = '新的正文选区';
    document.body.appendChild(paragraph);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    window.getSelection()?.addRange(range);

    expect(isDisabledTarget(window.getSelection(), paragraph, input)).toBe(false);
    expect(isDisabledTarget(null, null, input)).toBe(true);
  });

  it('富文本编辑器里的选区不复制', () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.textContent = '可编辑文字';
    document.body.appendChild(editor);
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    window.getSelection()?.addRange(range);
    expect(isDisabledTarget(window.getSelection(), editor, null)).toBe(true);
  });

  it('焦点在可编辑区域时也不复制', () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.textContent = '可编辑文字';
    document.body.appendChild(editor);
    editor.focus();
    expect(getActiveElement()).toBe(editor);
    expect(isDisabledTarget(null, null, null)).toBe(true);
  });

  it('焦点在编辑器但鼠标选的是正文时允许复制', () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.textContent = '评论框';
    document.body.appendChild(editor);
    editor.focus();
    const paragraph = document.createElement('p');
    paragraph.textContent = '普通正文';
    document.body.appendChild(paragraph);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    window.getSelection()?.addRange(range);
    expect(isDisabledTarget(window.getSelection(), paragraph, null)).toBe(false);
  });

  it('自己的界面里的文字永远不复制', () => {
    const host = document.createElement('div');
    host.setAttribute('data-ds-root', '');
    const paragraph = document.createElement('p');
    paragraph.textContent = '设置面板里的说明文字';
    host.appendChild(paragraph);
    document.body.appendChild(host);

    const range = document.createRange();
    range.selectNodeContents(paragraph);
    window.getSelection()?.addRange(range);

    expect(isDisabledTarget(window.getSelection(), paragraph, null)).toBe(true);
  });

  it('打开输入框开关后，输入框选区不再被门控', () => {
    const input = document.createElement('input');
    input.value = '输入框内容';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(0, 3);

    expect(isDisabledTarget(null, input, input)).toBe(true);
    expect(isDisabledTarget(null, input, input, { copyInInputs: true, copyInEditors: false })).toBe(
      false,
    );
  });

  it('没有 selectionStart 的数字输入框在键盘手势下也被输入框门控', () => {
    const input = document.createElement('input');
    input.type = 'number';
    input.value = '42';
    document.body.appendChild(input);
    input.focus();

    expect(getActiveTextControl()).toBeNull();
    expect(isDisabledTarget(null, null, null)).toBe(true);
    expect(isDisabledTarget(null, null, null, { copyInInputs: true, copyInEditors: false })).toBe(
      false,
    );
  });

  it('焦点在自己的面板里时，键盘手势不复制页面旧选区', () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = '页面旧选区';
    document.body.appendChild(paragraph);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    window.getSelection()?.addRange(range);

    const host = document.createElement('div');
    host.setAttribute('data-ds-root', '');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    shadow.appendChild(button);
    button.focus();

    expect(isDisabledTarget(window.getSelection(), null, null)).toBe(true);
  });
});
