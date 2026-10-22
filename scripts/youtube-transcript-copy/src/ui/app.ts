import { mountUI, type UI } from '@ui';
import type { ButtonPosition } from '../features/position';
import { createTranscriptButton, type TranscriptButtonHandle } from './button';

/**
 * 悬浮按钮的应用外壳。
 *
 * UI 与按钮只在第一次拿到位置时创建（观看页有播放器）；之后复用同一个实例，
 * SPA 换视频只更新位置与显隐，不重复 `mountUI()`。
 */

export type CopyOutcome = 'success' | 'empty' | 'error';

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

export interface TranscriptButtonAppOptions {
  getSavedPosition: () => ButtonPosition | null;
  savePosition: (position: ButtonPosition) => void;
  getDefaultPosition: () => ButtonPosition | null;
  isVisible: () => boolean;
  activate: () => Promise<CopyOutcome>;
}

export interface TranscriptButtonApp {
  /** 确保按钮已创建、位置在视口内，并按最近一次可见性状态显示。 */
  sync: () => void;
  setVisible: (visible: boolean) => void;
  /** 回到默认位置；没有播放器时用旧版的 30px 右上角。 */
  resetPosition: () => void;
  isMounted: () => boolean;
  destroy: () => void;
}

export function createTranscriptButtonApp(
  options: TranscriptButtonAppOptions,
): TranscriptButtonApp {
  let ui: UI | null = null;
  let button: TranscriptButtonHandle | null = null;
  let visible = options.isVisible();
  let busy = false;

  const activate = async (target: TranscriptButtonHandle): Promise<void> => {
    // 抓取期间忽略重复点击：面板与网络请求都不便宜，重复发起只会互相打断。
    if (busy) return;
    busy = true;
    target.setState('loading');
    try {
      const outcome = await options.activate();
      // 没有文稿与写入失败都显示 ✕：用户能看到“这次没复制成功”。
      target.setState(outcome === 'success' ? 'success' : 'error');
    } catch {
      target.setState('error');
    } finally {
      busy = false;
    }
  };

  const mount = (): TranscriptButtonHandle | null => {
    if (button) return button;
    const position = options.getSavedPosition() ?? options.getDefaultPosition();
    if (!position) return null;

    const mounted = mountUI({ theme: 'system', labels: LABELS });
    const created = createTranscriptButton({
      ui: mounted,
      label: '复制当前转写文稿',
      onClick: () => void activate(created),
      onMoveEnd: options.savePosition,
    });
    created.setPosition(position);
    created.setVisible(visible);
    ui = mounted;
    button = created;
    return created;
  };

  return {
    sync() {
      const current = mount();
      if (!current) return;
      current.setVisible(visible);
      // 视口变化后把位置收回可视区域；不写回存储，等用户下次拖动再存。
      current.setPosition(current.getPosition());
    },
    setVisible(next) {
      visible = next;
      button?.setVisible(next);
    },
    resetPosition() {
      button?.setPosition(options.getDefaultPosition() ?? { right: 30, top: 30 });
    },
    isMounted: () => button !== null,
    destroy() {
      ui?.destroy();
      ui = null;
      button = null;
    },
  };
}
