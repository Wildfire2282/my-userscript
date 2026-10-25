/**
 * User-facing strings every component needs. Defaults are English; a script
 * passes one object to `mountUI({ labels })` instead of overriding the same
 * label on five different components.
 */
export interface UILabels {
  /** Close button of a panel or dialog. */
  close: string;
  /** Accessible name of a settings panel without a title. */
  settings: string;
  /** Accessible name of an operation panel without a title. */
  operation: string;
  /** Accessible name of the toast region. */
  notifications: string;
  /** Close button of a single toast. */
  dismissNotification: string;
  /** Launcher label while its panel is open. */
  closeSettings: string;
  /** Hint shown at the bottom of a scrollable panel or dialog body. */
  scrollHint: string;
  /** Cancel action of `confirmDialog`. */
  cancel: string;
  /** Confirm action of `confirmDialog`. */
  confirm: string;
}

export const DEFAULT_LABELS: UILabels = {
  close: 'Close',
  settings: 'Settings',
  operation: 'Operations',
  notifications: 'Notifications',
  dismissNotification: 'Dismiss notification',
  closeSettings: 'Close settings',
  scrollHint: 'Scroll for more',
  cancel: 'Cancel',
  confirm: 'Confirm',
};

/**
 * 中文文案预设：四个脚本的 `LABELS` 逐字相同且都缺 `operation`，
 * 无标题操作面板的 aria 名会回落到英文 `Operations`。
 * 脚本侧 `mountUI({ theme: 'system', labels: ZH_LABELS })` 即可，不再各写一份。
 */
export const ZH_LABELS: UILabels = {
  close: '关闭',
  settings: '设置',
  operation: '操作',
  notifications: '通知',
  dismissNotification: '关闭通知',
  closeSettings: '关闭设置',
  scrollHint: '向下滚动查看更多内容',
  cancel: '取消',
  confirm: '确定',
};

export function resolveLabels(overrides: Partial<UILabels> | undefined): UILabels {
  return { ...DEFAULT_LABELS, ...overrides };
}
