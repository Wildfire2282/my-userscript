/**
 * 行为常量。
 *
 * 用户能改的项（输入框 / 富文本 / 首尾空白 / 站点开关）在 `settings.ts`；
 * 这里只放不随设置变化的几何与手势阈值，方便测试引用。
 */

export const BEHAVIOR = {
  /** 鼠标位移超过该值即认定为拖动选区。 */
  dragThresholdPx: 3,
} as const;

export type CopyFeedbackVariant = 'success' | 'failure';

/**
 * 复制反馈标签。
 *
 * 宽高必须与 `indicator.css` 的宽度、`--ds-control-h-sm` 高度保持一致：
 * 位置是纯函数算出来的，尺寸对不上会贴边时露出一截或压住选区。
 */
export const INDICATOR = {
  widthPx: {
    success: 68,
    failure: 80,
  } satisfies Record<CopyFeedbackVariant, number>,
  heightPx: 28,
  gapPx: 6,
  marginPx: 8,
  holdMs: {
    success: 1200,
    // 失败要让人看清“为什么没复制”，比成功多停留一会儿。
    failure: 1800,
  } satisfies Record<CopyFeedbackVariant, number>,
  fadeMs: 180,
} as const;

/** 会改变选区的按键；`Ctrl+A` / `Cmd+A` 在键盘处理里单独判断。 */
export const SELECTION_EXTEND_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);
