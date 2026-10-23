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
  /** 回到页面右上角 30px，并删除位置记忆。 */
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
  // 没有存过位置时，按钮跟着播放器走：首屏布局会二次调整（播放器从初始位置
  // 移到最终位置），只在挂载时算一次会停在错误的地方。用户拖过之后就不再动它。
  let autoPosition = options.getSavedPosition() === null;
  let settleTimer: number | undefined;
  // 首屏布局稳定前分几次重算；只在这几个时间点校正，不做常驻轮询。
  const SETTLE_DELAYS_MS = [300, 1000, 2000, 4000];

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

  function sync(): void {
    const current = mount();
    if (!current) return;
    current.setVisible(visible);
    // 用户拖过：只把位置收回可视区域；没拖过：跟着播放器重新算默认位置。
    current.setPosition(
      autoPosition
        ? (options.getDefaultPosition() ?? current.getPosition())
        : current.getPosition(),
    );
  }

  function mount(): TranscriptButtonHandle | null {
    if (button) return button;
    const position = options.getSavedPosition() ?? options.getDefaultPosition();
    if (!position) return null;

    const mounted = mountUI({ theme: 'system' });
    const created = createTranscriptButton({
      ui: mounted,
      label: '复制当前转写文稿',
      onClick: () => void activate(created),
      onMoveEnd: (next) => {
        autoPosition = false;
        options.savePosition(next);
      },
    });
    created.setPosition(position);
    created.setVisible(visible);
    ui = mounted;
    button = created;
    scheduleSettle(0);
    return created;
  }

  /** 首屏布局稳定前按固定节奏再算几次默认位置；用户拖动后 autoPosition 关闭，不再校正。 */
  function scheduleSettle(index: number): void {
    const delay = SETTLE_DELAYS_MS[index];
    if (delay === undefined) {
      settleTimer = undefined;
      return;
    }
    settleTimer = window.setTimeout(() => {
      settleTimer = undefined;
      sync();
      scheduleSettle(index + 1);
    }, delay);
  }

  return {
    sync,
    setVisible(next) {
      visible = next;
      button?.setVisible(next);
    },
    resetPosition() {
      // 与线上旧版一致：回到视口右上角 30px，而不是播放器相对位置。
      autoPosition = false;
      button?.setPosition({ right: 30, top: 30 });
    },
    isMounted: () => button !== null,
    destroy() {
      if (settleTimer !== undefined) {
        window.clearTimeout(settleTimer);
        settleTimer = undefined;
      }
      button?.destroy();
      ui?.destroy();
      button = null;
      ui = null;
    },
  };
}
