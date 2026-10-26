import { createUiHost as createSharedUiHost, type UI } from '@ui';
import type { CopyFeedback } from '../feedback';
import { createIndicator, type IndicatorHandle } from './indicator';

/**
 * 页面级界面宿主：复制反馈与设置面板共用一个 `@ui` Shadow Root。
 *
 * 第一次真的需要显示反馈或打开设置时才挂载；普通页面不产生任何节点与样式。
 */

export interface UiHost {
  /** 取（必要时创建）共享的 UI；设置面板与反馈都挂在这里。 */
  ensure: () => UI;
  showFeedback: (feedback: CopyFeedback) => void;
  destroy: () => void;
}

export function createUiHost(): UiHost {
  const host = createSharedUiHost();
  let indicator: IndicatorHandle | null = null;

  return {
    ensure: host.ensure,
    showFeedback(feedback) {
      try {
        const mounted = host.ensure();
        indicator ??= createIndicator(mounted);
        indicator.show(feedback);
      } catch (error) {
        // 界面挂不上只影响提示，复制本身已经完成，不能把异常抛回页面。
        console.error('[selection-copy] 复制提示显示失败', error);
      }
    },
    destroy() {
      indicator?.destroy();
      indicator = null;
      host.destroy();
    },
  };
}
