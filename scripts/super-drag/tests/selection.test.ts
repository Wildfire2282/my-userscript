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

describe('isPointInSelection · Shadow DOM 选区', () => {
  let root: ShadowRoot;

  beforeEach(() => {
    // 人手在 Shadow DOM 里拖选时，文档级选区被折叠到宿主上：这里把文档选区清掉正是这个状态。
    window.getSelection()?.removeAllRanges();
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = host.attachShadow({ mode: 'open' });
  });

  /** 作用域选区替身：只提供矩形，模拟 Chromium 的 `ShadowRoot.getSelection()`。 */
  function stubScopedSelection(rects: [number, number, number, number][] | null): void {
    Object.defineProperty(root, 'getSelection', {
      value: () => ({
        isCollapsed: rects === null,
        rangeCount: rects === null ? 0 : 1,
        getRangeAt: () => ({
          getClientRects: () =>
            (rects ?? []).map(([left, top, right, bottom]) => ({ left, top, right, bottom })),
        }),
      }),
    });
  }

  it('文档选区被折叠时，按作用域选区的矩形判断命中', () => {
    stubScopedSelection([[0, 0, 40, 20]]);
    expect(isPointInSelection(10, 10, [root])).toBe(true);
  });

  it('作用域选区之外的按下点不算命中', () => {
    stubScopedSelection([[0, 0, 40, 20]]);
    expect(isPointInSelection(100, 100, [root])).toBe(false);
  });

  it('作用域选区的容差与文档选区一致', () => {
    stubScopedSelection([[0, 0, 40, 20]]);
    expect(isPointInSelection(41, 10, [root])).toBe(true);
    expect(isPointInSelection(60, 10, [root])).toBe(false);
  });

  it('没有作用域选区 API（例如 Firefox）时不命中，也不抛错', () => {
    expect(isPointInSelection(10, 10, [root])).toBe(false);
  });

  it('事件路径里的普通节点被忽略', () => {
    stubScopedSelection([[0, 0, 40, 20]]);
    expect(isPointInSelection(10, 10, [document.body, document, window])).toBe(false);
  });

  it('没有传入事件路径时不命中', () => {
    stubScopedSelection([[0, 0, 40, 20]]);
    expect(isPointInSelection(10, 10)).toBe(false);
  });
});
