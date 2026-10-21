/**
 * 选区命中判断：按下的位置是否落在已有选区上。
 *
 * 评论类页面常把文字包在带内边距的容器里，或盖一层手势层，按下的点可能偏离字形几个像素，
 * 所以先看矩形（留 `SELECTION_HIT_SLOP_PX` 容差），再用插入符的位置做最可靠的确认。
 */

export const SELECTION_HIT_SLOP_PX = 4;

/** 当前选中文本；没有选区时返回空字符串。 */
export function getSelectionText(): string {
  const selection = window.getSelection();
  return selection ? selection.toString().trim() : '';
}

function pointInRect(x: number, y: number, rect: DOMRect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function pointNearRect(x: number, y: number, rect: DOMRect, slop: number): boolean {
  return (
    x >= rect.left - slop &&
    x <= rect.right + slop &&
    y >= rect.top - slop &&
    y <= rect.bottom + slop
  );
}

function caretRangeFromPoint(x: number, y: number): Range | null {
  try {
    if (typeof document.caretRangeFromPoint === 'function') {
      return document.caretRangeFromPoint(x, y);
    }
  } catch {
    // 继续尝试标准方法
  }
  try {
    if (typeof document.caretPositionFromPoint === 'function') {
      const position = document.caretPositionFromPoint(x, y);
      if (position) {
        const range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
        return range;
      }
    }
  } catch {
    // 浏览器不支持：调用方回落到矩形判断
  }
  return null;
}

/**
 * 判断按下点上的字符是否在选区内部。
 *
 * 不用 `selection.containsNode(node, true)`：它只要求节点与选区有交集，同一段文字里
 * 选区之外的按下点也算命中；`comparePoint` 比的是具体偏移，才对得上“按下的字符”。
 */
function isCaretInsideRange(range: Range, container: Node, offset: number): boolean {
  if (typeof range.comparePoint === 'function') {
    try {
      return range.comparePoint(container, offset) === 0;
    } catch {
      // 节点已脱离文档时 comparePoint 会抛错，退回粗糙的节点级判断。
    }
  }
  const selection = window.getSelection();
  if (selection && typeof selection.containsNode === 'function') {
    try {
      return selection.containsNode(container, true);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * 判断坐标是否落在当前选区上。
 *
 * @param x 客户端坐标 X
 * @param y 客户端坐标 Y
 */
export function isPointInSelection(x: number, y: number): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;

  const range = selection.getRangeAt(0);
  let rects: DOMRect[];
  try {
    rects = Array.from(range.getClientRects());
  } catch {
    rects = [];
  }
  for (const rect of rects) {
    // 容差已经包含“正好落在字形上”，不必再单独判断一次矩形内部。
    if (pointNearRect(x, y, rect, SELECTION_HIT_SLOP_PX)) return true;
  }

  // 最强信号：按下的字符本身就在选区里。
  const caret = caretRangeFromPoint(x, y);
  if (caret && isCaretInsideRange(range, caret.startContainer, caret.startOffset)) return true;

  if (rects.length > 0) return false;

  const anchor = range.commonAncestorContainer;
  const host = anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement;
  if (host && typeof host.getBoundingClientRect === 'function') {
    return pointInRect(x, y, host.getBoundingClientRect());
  }
  return false;
}
