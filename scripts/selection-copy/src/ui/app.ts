import { mountUI, type UI } from '@ui';
import type { AnchorBox } from '../features/geometry';
import { createIndicator, type IndicatorHandle } from './indicator';

/**
 * 界面外壳：第一次真的复制成功时才创建 UI。
 *
 * 普通页面不产生任何节点与样式；用户从没复制过，就相当于脚本只多了几个事件监听。
 */

const LABELS = {
  close: '关闭',
  settings: '设置',
  notifications: '通知',
  dismissNotification: '关闭通知',
  closeSettings: '关闭设置',
  scrollHint: '向下滚动查看更多内容',
  cancel: '取消',
  confirm: '确定',
};

export interface IndicatorApp {
  show: (rect: AnchorBox | null) => void;
}

export function createIndicatorApp(): IndicatorApp {
  let ui: UI | null = null;
  let indicator: IndicatorHandle | null = null;

  return {
    show(rect) {
      if (!ui) {
        const mounted = mountUI({ theme: 'system', labels: LABELS });
        indicator = createIndicator(mounted);
        ui = mounted;
      }
      indicator?.show(rect);
    },
  };
}
