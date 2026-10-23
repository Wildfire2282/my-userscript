import { mountUI, type UI } from '@ui';
import type { CopyFeedback } from '../feedback';
import { createIndicator, type IndicatorHandle } from './indicator';

/**
 * 页面级界面宿主：复制反馈与设置面板共用一个 `@ui` Shadow Root。
 *
 * 第一次真的需要显示反馈或打开设置时才挂载；普通页面不产生任何节点与样式。
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

export interface UiHost {
  /** 取（必要时创建）共享的 UI；设置面板与反馈都挂在这里。 */
  ensure: () => UI;
  showFeedback: (feedback: CopyFeedback) => void;
}

export function createUiHost(): UiHost {
  let ui: UI | null = null;
  let indicator: IndicatorHandle | null = null;

  const ensure = (): UI => {
    if (!ui) ui = mountUI({ theme: 'system', labels: LABELS });
    return ui;
  };

  return {
    ensure,
    showFeedback(feedback) {
      try {
        const mounted = ensure();
        indicator ??= createIndicator(mounted);
        indicator.show(feedback);
      } catch (error) {
        // 界面挂不上只影响提示，复制本身已经完成，不能把异常抛回页面。
        console.error('[selection-copy] 复制提示显示失败', error);
      }
    },
  };
}
