import { getActiveElement, elementOf } from '../selection';

/**
 * 反馈标记的锚点几何。
 *
 * 跨行 / 跨块的选区不能直接用整体包围盒：那会把标记甩到另一行甚至选区起点。
 * 所以优先取“选区终点所在行的行盒”，退化成零宽锚点；文本框与 Shadow DOM 里的
 * 选区没有行盒，只能退回控件矩形，再退回整体包围盒或容器元素矩形。
 */

export interface AnchorBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

function isForwardSelection(selection: Selection, range: Range): boolean {
  return (
    selection.anchorNode === range.startContainer && selection.anchorOffset === range.startOffset
  );
}

/** 选区终点所在行的行盒；失败时返回 null。 */
function getSelectionEndRect(selection: Selection, range: Range): AnchorBox | null {
  try {
    const lineRects = range.getClientRects();
    const forward = isForwardSelection(selection, range);
    const lineRect = lineRects[forward ? lineRects.length - 1 : 0];
    if (!lineRect) return null;
    const edge = forward ? lineRect.right : lineRect.left;
    return {
      left: edge,
      right: edge,
      top: lineRect.top,
      bottom: lineRect.bottom,
      width: 0,
      height: lineRect.height,
    };
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
    if (activeRect.width > 0 || activeRect.height > 0) return activeRect;
  }

  if (range) {
    try {
      const boxRect = range.getBoundingClientRect();
      if (boxRect.width > 0 || boxRect.height > 0) return boxRect;
    } catch {
      // 继续用容器元素兜底
    }
  }

  return anchorElement?.getBoundingClientRect() ?? null;
}

/**
 * 取标记要贴住的位置。
 *
 * @param selection 当前文档选区
 * @returns 选区终点的行盒或兜底矩形；都没有时返回 null（标记会落在视口中央）
 */
export function getAnchorRect(selection: Selection): AnchorBox | null {
  const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (!range) return getFallbackRect(selection, null);
  return getSelectionEndRect(selection, range) ?? getFallbackRect(selection, range);
}
