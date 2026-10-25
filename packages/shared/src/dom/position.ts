/**
 * 视口夹紧原语：selection-copy 的提示标签定位与 youtube 的悬浮按钮定位
 * 各写了一份逐字相同的 `clamp`，收拢到一处。
 */

/**
 * 把值钳在 `[min, max]` 内。
 *
 * 视口比内容还窄时 `max < min`：贴住 `min`（左上角），不要算出负坐标。
 */
export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ClampBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 把矩形收回视口内，留 `margin` 边距。
 *
 * @param box 矩形左上与尺寸
 * @param viewport 视口尺寸
 * @param margin 四周边距；默认 0
 */
export function clampToViewport(
  box: ClampBox,
  viewport: ViewportSize,
  margin = 0,
): { left: number; top: number } {
  return {
    left: clamp(box.left, margin, viewport.width - box.width - margin),
    top: clamp(box.top, margin, viewport.height - box.height - margin),
  };
}
