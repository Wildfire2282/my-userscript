import { BEHAVIOR, SELECTION_EXTEND_KEYS } from './config';

/**
 * 手势判断：哪些鼠标 / 键盘操作算“用户刚刚选了一段文字”。
 *
 * 纯函数，不读 DOM：事件回调只负责收集快照，归这里判断，所以两条最容易回归的规则
 * （普通单击不复制、拖动才复制）都能在 Vitest 里直接覆盖。
 */

/** 选区快照；节点引用用来判断“选区有没有变”，不读内容。 */
export interface SelectionSnapshot {
  anchorNode: Node | null;
  anchorOffset: number;
  focusNode: Node | null;
  focusOffset: number;
  rangeCount: number;
}

/** 按下鼠标时记录的手势起点。 */
export interface Gesture {
  startX: number;
  startY: number;
  target: EventTarget | null;
  selection: SelectionSnapshot | null;
}

/** 松开鼠标时能拿到的事件字段。 */
export interface MouseUpEnd {
  clientX: number;
  clientY: number;
  detail: number;
}

/** 键盘事件里与选区相关的字段。 */
export interface KeyUpLike {
  isTrusted: boolean;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  key: string;
  /** 物理按键；非拉丁键盘布局下 `key` 不是 'a'，只有它可靠。 */
  code?: string;
}

export function isSameSelection(
  first: SelectionSnapshot | null,
  second: SelectionSnapshot | null,
): boolean {
  return (
    first !== null &&
    second !== null &&
    first.anchorNode === second.anchorNode &&
    first.anchorOffset === second.anchorOffset &&
    first.focusNode === second.focusNode &&
    first.focusOffset === second.focusOffset &&
    first.rangeCount === second.rangeCount
  );
}

/**
 * 松开鼠标后是否去复制。
 *
 * 双击 / 三击与选区变化都算新选择；选区没变时只有文本控件里的拖动才算，
 * 避免拖滑块、拖卡片等操作把上一次的选区又写一遍剪贴板。
 */
export function shouldCopyOnMouseUp(
  gesture: Gesture,
  end: MouseUpEnd,
  current: SelectionSnapshot | null,
  textSelected = false,
  threshold: number = BEHAVIOR.dragThresholdPx,
): boolean {
  if (end.detail > 1) return true;
  if (!isSameSelection(gesture.selection, current)) return true;
  const moved =
    Math.abs(end.clientX - gesture.startX) > threshold ||
    Math.abs(end.clientY - gesture.startY) > threshold;
  return textSelected && moved;
}

/**
 * 松开按键后是否去复制：Shift + 选区扩展键，或 Ctrl+A（不带 Shift）。
 *
 * Alt 组合交给系统；页面合成的键盘事件一律忽略，避免被脚本反复触发。
 */
export function shouldCopyOnKeyUp(event: KeyUpLike): boolean {
  if (!event.isTrusted || event.altKey) return false;
  const extendsSelection = event.shiftKey && SELECTION_EXTEND_KEYS.has(event.key);
  // 认物理键位：俄语等布局下按 Ctrl+A 得到的 key 是 'ф'，只看 key 会漏掉全选。
  const isA = event.code === 'KeyA' || event.key.toLowerCase() === 'a';
  const selectsAll = event.ctrlKey && !event.shiftKey && isA;
  return extendsSelection || selectsAll;
}
