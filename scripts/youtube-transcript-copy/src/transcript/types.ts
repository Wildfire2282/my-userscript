/** 一条转写片段；`start` 是毫秒偏移，未知时为 null。 */
export interface Segment {
  start: number | null;
  text: string;
}

/** 提取策略分两类：网络层（不需要打开面板）与 DOM 层（必须先打开面板）。 */
export type StrategyKind = 'net' | 'dom';

/** 记住某类策略里上一次成功的下标，下次优先尝试。 */
export interface StrategyChoice {
  idx: number;
  at: number;
}

/** 键是策略类别，值是上次成功的下标；对应线上旧键 `strategy`。 */
export type StrategyMemory = Record<string, StrategyChoice>;
