import type { CopyFeedbackVariant } from './config';
import type { AnchorBox } from './features/geometry';

/**
 * 一次复制的结果反馈。
 *
 * 复制动作只产生数据，界面负责显示：失败也要走同一条通道，避免“剪贴板没写进去
 * 但屏幕上什么都没说”。
 */
export interface CopyFeedback {
  variant: CopyFeedbackVariant;
  /** 选区终点的锚点；null 表示没有可用位置，由界面放到视口中央。 */
  rect: AnchorBox | null;
  /** 鼠标松开时的视口坐标；有它时提示贴住鼠标，没有（键盘选区）时贴住选区。 */
  point: { x: number; y: number } | null;
}
