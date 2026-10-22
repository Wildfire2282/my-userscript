import { INDICATOR } from '../config';
import type { AnchorBox } from '../features/geometry';

/**
 * 复制成功后的小圆点。
 *
 * 位置计算是纯函数，方便在 Vitest 里覆盖贴边、选区已滚出视口这些边界；
 * 实际的显示与淡出由 `createIndicator` 负责。
 */

export interface Viewport {
  width: number;
  height: number;
}

export interface IndicatorPoint {
  left: number;
  top: number;
}

function clamp(value: number, min: number, max: number): number {
  // 视口比“标记 + 两侧边距”还窄时 max < min：贴住左上角，不要算出负坐标。
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * 计算圆点左上角坐标。
 *
 * 选区贴边或已滚出视口时退回视口中央：标记不能跟着跑到视口外。
 *
 * @param rect 选区终点的行盒；没有可用矩形时传 null
 * @param viewport 视口尺寸
 */
export function indicatorPosition(rect: AnchorBox | null, viewport: Viewport): IndicatorPoint {
  const size = INDICATOR.sizePx;
  const anchored =
    rect !== null &&
    (rect.width > 0 || rect.height > 0) &&
    rect.bottom > 0 &&
    rect.top < viewport.height &&
    rect.right > 0 &&
    rect.left < viewport.width;

  return {
    left: clamp(
      anchored ? rect.right - size / 2 : viewport.width / 2 - size / 2,
      INDICATOR.marginPx,
      viewport.width - size - INDICATOR.marginPx,
    ),
    top: clamp(
      anchored ? rect.top - size - INDICATOR.gapPx : viewport.height / 2 - size / 2,
      INDICATOR.marginPx,
      viewport.height - size - INDICATOR.marginPx,
    ),
  };
}
