/**
 * 拖拽反馈图标的位置。
 *
 * 纯函数：拖拽时每帧都会调用，单独测边界比在浏览器里拖动稳定得多。
 */

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** 图标尺寸与指针留白；与 `drag-cursor.css` 的宽高保持一致。 */
export const DRAG_MARK = {
  sizePx: 26,
  offsetPx: 4,
  marginPx: 8,
} as const;

function clamp(value: number, min: number, max: number): number {
  // 视口比“图标 + 两侧边距”还小时 max < min：贴住左上角，不要算出负坐标。
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * 计算图标左上角坐标。
 *
 * 默认整体贴在指针左上方，右下角与指针隔一点距离；指针靠近视口左上角时
 * 收进视口，避免图标被裁掉一半。
 *
 * @param point 指针的视口坐标
 * @param viewport 视口尺寸
 */
export function cursorMarkPosition(point: Point, viewport: Viewport): Point {
  const maxX = viewport.width - DRAG_MARK.sizePx - DRAG_MARK.marginPx;
  const maxY = viewport.height - DRAG_MARK.sizePx - DRAG_MARK.marginPx;
  return {
    x: clamp(point.x - DRAG_MARK.sizePx - DRAG_MARK.offsetPx, DRAG_MARK.marginPx, maxX),
    y: clamp(point.y - DRAG_MARK.sizePx - DRAG_MARK.offsetPx, DRAG_MARK.marginPx, maxY),
  };
}
