// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { getSelectionText, isPointInSelection } from '../src/features/selection';

/**
 * happy-dom 不做排版，拿不到可信的矩形，所以这里只覆盖“按下的字符是否在选区里”
 * 这段判断：`caretRangeFromPoint` 用固定偏移的插入符替身，矩形判断天然落空。
 */

let paragraph: HTMLParagraphElement;
let text: Text;
let other: HTMLSpanElement;

beforeEach(() => {
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
  paragraph = document.createElement('p');
  text = document.createTextNode('前半句是选中的文字，后半句没有被选中');
  paragraph.appendChild(text);
  other = document.createElement('span');
  other.textContent = '另一段文字';
  paragraph.appendChild(other);
  document.body.appendChild(paragraph);

  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 8);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
});

/** 把按下点换算成给定文本节点里的插入符，再问脚本是否算“按在选区上”。 */
function pressAt(node: Node, offset: number): boolean {
  document.caretRangeFromPoint = () => {
    const caret = document.createRange();
    caret.setStart(node, offset);
    caret.collapse(true);
    return caret;
  };
  return isPointInSelection(10, 10);
}

describe('getSelectionText', () => {
  it('返回去掉首尾空白的选中文字', () => {
    expect(getSelectionText()).toBe('前半句是选中的文');
  });
});

describe('isPointInSelection', () => {
  it('按在选区内的字符上算命中', () => {
    expect(pressAt(text, 3)).toBe(true);
  });

  it('按在同一段文字、但选区之外的字符上不算命中', () => {
    // 这里正是 containsNode(node, true) 会误判的位置：节点与选区有交集，字符没有。
    expect(pressAt(text, 20)).toBe(false);
  });

  it('按在别的节点上不算命中', () => {
    expect(pressAt(other.firstChild as Text, 1)).toBe(false);
  });

  it('没有选区时永不命中', () => {
    window.getSelection()?.removeAllRanges();
    expect(isPointInSelection(10, 10)).toBe(false);
  });
});
