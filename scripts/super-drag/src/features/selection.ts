/**
 * 选区读取与命中判断：矩形（含容差）+ 插入符。
 *
 * 人手在 Shadow DOM 里拖选时，Chromium 把文档级选区折叠到宿主上（isCollapsed 为 true、
 * 无矩形），只有 toString() 还有文字；作用域选区用 `ShadowRoot.getSelection()` 取。
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
 * @param path 按下点途经的事件路径（内 → 外）；文档级选区被折叠时依次问带 `getSelection` 的节点
 */
export function isPointInSelection(
  x: number,
  y: number,
  path: readonly EventTarget[] = [],
): boolean {
  const selection = window.getSelection();
  const active =
    selection && !selection.isCollapsed
      ? selection
      : (path
          .map(
            (node) =>
              (node as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.() ??
              null,
          )
          .find((s) => s && !s.isCollapsed) ?? null);
  if (!active) return false;

  const range = active.getRangeAt(0);
  let rects: DOMRect[] = [];
  try {
    rects = Array.from(range.getClientRects());
  } catch {
    // 脱离文档时会抛错
  }
  for (const rect of rects) {
    // 容差已包含“落在字形上”的情况。
    if (pointNearRect(x, y, rect, SELECTION_HIT_SLOP_PX)) return true;
  }

  // 按下的字符本身就在选区里（阴影树拿不到插入符）。
  const caret = caretRangeFromPoint(x, y);
  if (caret && isCaretInsideRange(range, caret.startContainer, caret.startOffset)) return true;

  if (rects.length > 0) return false;

  const anchor = range.commonAncestorContainer;
  const host = anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement;
  return !!host && pointInRect(x, y, host.getBoundingClientRect());
}
