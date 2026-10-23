import { INDICATOR, type CopyFeedbackVariant } from '../config';
import type { AnchorBox } from '../features/geometry';

/**
 * 复制反馈标签的位置。
 *
 * 位置计算是纯函数，方便在 Vitest 里覆盖贴边、贴顶翻转、选区已滚出视口这些边界；
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
  // 视口比“标签 + 两侧边距”还窄时 max < min：贴住左上角，不要算出负坐标。
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * 计算标签左上角坐标。
 *
 * 默认贴在焦点正上方并水平居中；上方放不下时翻到下一行，避免挡住刚选中的文字。
 * 选区贴边或已滚出视口时退回视口中央：标签不能跟着跑到视口外。
 *
 * @param rect 选区焦点或控件锚点；没有可用位置时传 null
 * @param viewport 视口尺寸
 * @param variant 成功 / 失败两种标签宽度不同，贴边时要分别计算
 */
export function indicatorPosition(
  rect: AnchorBox | null,
  viewport: Viewport,
  variant: CopyFeedbackVariant = 'success',
): IndicatorPoint {
  const width = INDICATOR.widthPx[variant];
  const height = INDICATOR.heightPx;
  const margin = INDICATOR.marginPx;
  const maxLeft = viewport.width - width - margin;
  const maxTop = viewport.height - height - margin;

  const centered = (): IndicatorPoint => ({
    left: clamp((viewport.width - width) / 2, margin, maxLeft),
    top: clamp((viewport.height - height) / 2, margin, maxTop),
  });

  if (rect === null) return centered();

  const anchored =
    (rect.width > 0 || rect.height > 0) &&
    rect.bottom > 0 &&
    rect.top < viewport.height &&
    rect.left < viewport.width &&
    // 插入点宽度为 0，x=0 时 right 也是 0，不能当成“已滚出左边”。
    rect.right >= 0;

  if (!anchored) return centered();

  const left = clamp(rect.right - width / 2, margin, maxLeft);
  const above = rect.top - height - INDICATOR.gapPx;
  if (above >= margin) return { left, top: clamp(above, margin, maxTop) };

  const below = rect.bottom + INDICATOR.gapPx;
  if (below + height <= viewport.height - margin) return { left, top: below };
  return { left, top: clamp(above, margin, maxTop) };
}
