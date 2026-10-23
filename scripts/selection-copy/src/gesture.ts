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
  /** macOS 的 Cmd 键；全选在 Mac 上是 Cmd+A，不认它就会漏掉一半用户。 */
  metaKey: boolean;
  key: string;
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
 * 普通单击（没有拖动、选区也没变）只是移动光标或取消选区，不复制；拖动、双击 /
 * 三击、以及选区确实变了的操作都算一次新选择。
 */
export function shouldCopyOnMouseUp(
  gesture: Gesture,
  end: MouseUpEnd,
  current: SelectionSnapshot | null,
  threshold: number = BEHAVIOR.dragThresholdPx,
): boolean {
  const moved =
    Math.abs(end.clientX - gesture.startX) > threshold ||
    Math.abs(end.clientY - gesture.startY) > threshold;
  if (!moved && end.detail === 1 && isSameSelection(gesture.selection, current)) return false;
  return true;
}

/**
 * 松开按键后是否去复制：Shift + 选区扩展键，或 Ctrl+A / Cmd+A（不带 Shift）。
 *
 * Alt 组合交给系统；页面合成的键盘事件一律忽略，避免被脚本反复触发。
 */
export function shouldCopyOnKeyUp(event: KeyUpLike): boolean {
  if (!event.isTrusted || event.altKey) return false;
  const extendsSelection = event.shiftKey && SELECTION_EXTEND_KEYS.has(event.key);
  const selectsAll =
    (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'a';
  return extendsSelection || selectsAll;
}
