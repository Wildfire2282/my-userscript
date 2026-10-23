import { elementOf, getActiveElement } from '../selection';

/**
 * 反馈标记的锚点几何。
 *
 * 优先取焦点处的插入点（caret）：它同时处理了正向 / 反向选区、RTL 文本和行内换行，
 * 也比“最后一行的行盒右边缘”更接近用户眼睛停留的位置。拿不到插入点时依次退回
 * 选区行盒、整体包围盒与容器元素矩形。
 */

export interface AnchorBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** 在给定水平位置构造零宽锚点；`x` 是提示标签的中心。 */
function pointAt(rect: DOMRect, x: number): AnchorBox {
  return {
    left: x,
    right: x,
    top: rect.top,
    bottom: rect.bottom,
    width: 0,
    height: rect.height,
  };
}

function centerX(rect: DOMRect): number {
  return rect.left + rect.width / 2;
}

/** 焦点处的零宽插入点；浏览器还没算出布局时返回 null。 */
function getCaretRect(selection: Selection): AnchorBox | null {
  const node = selection.focusNode;
  if (!node) return null;
  const range = document.createRange();
  try {
    range.setStart(node, selection.focusOffset);
    range.collapse(true);
    const [first] = range.getClientRects();
    const rect = first ?? range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return pointAt(rect, rect.left);
  } catch {
    // 焦点节点已脱离文档或 offset 越界。
    return null;
  }
}

function isForwardSelection(selection: Selection, range: Range): boolean {
  return (
    selection.anchorNode === range.startContainer && selection.anchorOffset === range.startOffset
  );
}

/** 选区终点所在行的行盒；拿不到插入点时的退路。 */
function getSelectionEndRect(selection: Selection, range: Range): AnchorBox | null {
  try {
    const lineRects = range.getClientRects();
    const forward = isForwardSelection(selection, range);
    const lineRect = lineRects[forward ? lineRects.length - 1 : 0];
    if (!lineRect) return null;
    // RTL 行的视觉终点与逻辑终点相反，行盒的两侧边缘正好对应两种选择方向。
    return pointAt(lineRect, forward ? lineRect.right : lineRect.left);
  } catch {
    // 选区节点已脱离文档等情况
    return null;
  }
}

function getFallbackRect(selection: Selection, range: Range | null): AnchorBox | null {
  const anchorElement = elementOf(selection.anchorNode);
  const documentBox =
    !anchorElement || anchorElement === document.body || anchorElement === document.documentElement;

  const activeElement = documentBox ? getActiveElement() : null;
  if (
    activeElement &&
    activeElement !== document.body &&
    activeElement !== document.documentElement
  ) {
    const activeRect = activeElement.getBoundingClientRect();
    if (activeRect.width > 0 || activeRect.height > 0) {
      return pointAt(activeRect, centerX(activeRect));
    }
  }

  if (range) {
    try {
      const boxRect = range.getBoundingClientRect();
      if (boxRect.width > 0 || boxRect.height > 0) return pointAt(boxRect, centerX(boxRect));
    } catch {
      // 继续用容器元素兜底
    }
  }

  const box = anchorElement?.getBoundingClientRect();
  if (box && (box.width > 0 || box.height > 0)) return pointAt(box, centerX(box));
  return null;
}

/**
 * 取标记要贴住的位置。
 *
 * @param selection 当前文档选区
 * @returns 焦点处的插入点或兜底矩形；都没有时返回 null（标记会落在视口中央）
 */
export function getAnchorRect(selection: Selection): AnchorBox | null {
  const caret = getCaretRect(selection);
  if (caret) return caret;
  const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (!range) return getFallbackRect(selection, null);
  return getSelectionEndRect(selection, range) ?? getFallbackRect(selection, range);
}

/**
 * 文本框没有可读的插入点矩形，只能贴住控件本身。
 *
 * 水平方向取控件中线，让提示落在输入框上方居中，而不是跑到宽输入框的右端。
 */
export function getControlAnchorRect(element: Element): AnchorBox | null {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return pointAt(rect, centerX(rect));
}
