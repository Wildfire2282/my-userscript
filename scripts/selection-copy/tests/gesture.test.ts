import { describe, expect, it } from 'vitest';
import {
  isSameSelection,
  shouldCopyOnKeyUp,
  shouldCopyOnMouseUp,
  type Gesture,
  type SelectionSnapshot,
} from '../src/gesture';

const EMPTY: SelectionSnapshot = {
  anchorNode: null,
  anchorOffset: 0,
  focusNode: null,
  focusOffset: 0,
  rangeCount: 0,
};

function gesture(overrides: Partial<Gesture> = {}): Gesture {
  return { startX: 100, startY: 100, target: null, selection: EMPTY, ...overrides };
}

describe('isSameSelection', () => {
  it('逐项比较快照', () => {
    expect(isSameSelection(EMPTY, { ...EMPTY })).toBe(true);
    expect(isSameSelection(EMPTY, { ...EMPTY, rangeCount: 1 })).toBe(false);
    expect(isSameSelection(null, EMPTY)).toBe(false);
  });
});

describe('shouldCopyOnMouseUp', () => {
  it('拖动超过阈值就复制', () => {
    expect(shouldCopyOnMouseUp(gesture(), { clientX: 120, clientY: 100, detail: 1 }, EMPTY)).toBe(
      true,
    );
  });

  it('没有拖动、选区也没变的普通单击不复制', () => {
    expect(shouldCopyOnMouseUp(gesture(), { clientX: 101, clientY: 101, detail: 1 }, EMPTY)).toBe(
      false,
    );
  });

  it('位移很小但选区变了（键盘或页面脚本改动）时复制', () => {
    expect(
      shouldCopyOnMouseUp(
        gesture(),
        { clientX: 101, clientY: 101, detail: 1 },
        { ...EMPTY, rangeCount: 1 },
      ),
    ).toBe(true);
  });

  it('双击 / 三击即使没有位移也复制', () => {
    expect(shouldCopyOnMouseUp(gesture(), { clientX: 100, clientY: 100, detail: 2 }, EMPTY)).toBe(
      true,
    );
    expect(shouldCopyOnMouseUp(gesture(), { clientX: 100, clientY: 100, detail: 3 }, EMPTY)).toBe(
      true,
    );
  });

  it('阈值可以注入，边界值不触发', () => {
    expect(
      shouldCopyOnMouseUp(gesture(), { clientX: 103, clientY: 100, detail: 1 }, EMPTY, 3),
    ).toBe(false);
    expect(
      shouldCopyOnMouseUp(gesture(), { clientX: 104, clientY: 100, detail: 1 }, EMPTY, 3),
    ).toBe(true);
  });
});

describe('shouldCopyOnKeyUp', () => {
  const base = {
    isTrusted: true,
    altKey: false,
    shiftKey: false,
    ctrlKey: false,
    key: 'a',
  };

  it('Shift + 选区扩展键触发', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
      expect(shouldCopyOnKeyUp({ ...base, shiftKey: true, key })).toBe(true);
    }
    expect(shouldCopyOnKeyUp({ ...base, shiftKey: true, key: 'PageDown' })).toBe(true);
  });

  it('Ctrl+A 触发，Ctrl+Shift+A 不触发', () => {
    expect(shouldCopyOnKeyUp({ ...base, ctrlKey: true })).toBe(true);
    expect(shouldCopyOnKeyUp({ ...base, ctrlKey: true, shiftKey: true })).toBe(false);
  });

  it('Alt 组合、普通按键与不可信事件都不触发', () => {
    expect(shouldCopyOnKeyUp({ ...base, altKey: true })).toBe(false);
    expect(shouldCopyOnKeyUp(base)).toBe(false);
    expect(
      shouldCopyOnKeyUp({ ...base, isTrusted: false, shiftKey: true, key: 'ArrowRight' }),
    ).toBe(false);
  });

  it('Shift + 普通字母不触发', () => {
    expect(shouldCopyOnKeyUp({ ...base, shiftKey: true, key: 'A' })).toBe(false);
  });
});
