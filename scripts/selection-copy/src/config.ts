/**
 * 行为常量。
 *
 * 线上旧版没有设置面板，所有行为写死在脚本里；迁移后继续保持“没有设置项”，
 * 这些值集中在这里，方便测试引用，也避免同一个数字散落在事件回调里。
 */

export const BEHAVIOR = {
  /** 在输入框里选中文字是否也自动复制。 */
  enableForTextBoxes: false,
  /** 在富文本编辑器里选中文字是否也自动复制。 */
  enableForContentEditable: false,
  /** 复制前是否去掉首尾空白。 */
  trimWhitespace: true,
  /** 鼠标位移超过该值即认定为拖动选区。 */
  dragThresholdPx: 3,
} as const;

export const INDICATOR = {
  sizePx: 14,
  gapPx: 8,
  marginPx: 8,
  holdMs: 1000,
  fadeMs: 300,
} as const;

/** 会改变选区的按键；`Ctrl+A` 在键盘处理里单独判断。 */
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
