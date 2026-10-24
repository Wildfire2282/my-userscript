import {
  createButton,
  createPanel,
  createSection,
  createToast,
  mountUI,
  type PanelHandle,
  type ToastController,
  type UI,
} from '@ui';
import type { ButtonPosition } from '../features/position';
import { createTranscriptButton, type TranscriptButtonHandle } from './button';

/**
 * 悬浮按钮与油猴菜单面板的应用外壳。
 *
 * UI 只创建一次：要么是第一次拿到按钮位置（观看页有播放器），要么是第一次从菜单
 * 打开面板。之后复用同一个实例，SPA 换视频只更新位置与显隐，不重复 `mountUI()`。
 *
 * 菜单只有两项：操作面板（复制、重置按钮位置）与功能设置（清空记忆）。
 */

/** `skipped`：上一次复制还没结束，这次什么都没做。 */
export type CopyOutcome = 'success' | 'empty' | 'error' | 'skipped';

// 面板与提示都只出现在中文界面里；不传就是 @ui 的英文默认文案。
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
  clearSavedPosition: () => void;
  clearStrategy: () => void;
}

export interface TranscriptButtonApp {
  /** 确保按钮已创建、位置在视口内，并按最近一次可见性状态显示。 */
  sync: () => void;
  setVisible: (visible: boolean) => void;
  /** 油猴菜单「操作面板」。 */
  openActions: () => void;
  /** 油猴菜单「功能设置」。 */
  openSettings: () => void;
  destroy: () => void;
}

export function createTranscriptButtonApp(
  options: TranscriptButtonAppOptions,
): TranscriptButtonApp {
  let ui: UI | null = null;
  let button: TranscriptButtonHandle | null = null;
  let toast: ToastController | null = null;
  let panels: { actions: PanelHandle; settings: PanelHandle } | null = null;
  let visible = options.isVisible();
  let busy = false;
  // 没有存过位置时，按钮跟着播放器走：首屏布局会二次调整（播放器从初始位置
  // 移到最终位置），只在挂载时算一次会停在错误的地方。用户拖过之后就不再动它。
  let autoPosition = options.getSavedPosition() === null;
  let settleTimer: number | undefined;
  // 首屏布局稳定前分几次重算；只在这几个时间点校正，不做常驻轮询。
  const SETTLE_DELAYS_MS = [300, 1000, 2000, 4000];

  const ensureUI = (): UI => {
    if (!ui) ui = mountUI({ theme: 'system', labels: LABELS });
    return ui;
  };

  /** 抓取并复制；按钮和面板共用，同一时刻只跑一个。 */
  const copy = async (): Promise<CopyOutcome> => {
    // 已经在抓的时候不能谎报失败：调用方对“跳过”不出任何提示。
    if (busy) return 'skipped';
    busy = true;
    try {
      return await options.activate();
    } catch {
      return 'error';
    } finally {
      busy = false;
    }
  };

  const activateFromButton = async (target: TranscriptButtonHandle): Promise<void> => {
    // 抓取期间忽略重复点击：面板与网络请求都不便宜，重复发起只会互相打断。
    if (busy) return;
    target.setState('loading');
    const outcome = await copy();
    // 没有文稿与写入失败都显示 ✕：用户能看到“这次没复制成功”。
    target.setState(outcome === 'success' ? 'success' : 'error');
  };

  /** 回到播放器右上角并清掉位置记忆：之后重新跟着播放器走。 */
  const resetPosition = (): void => {
    // 只清存储、停用自动跟随的写法会让按钮钉死在视口角落，与提示文案相反。
    autoPosition = true;
    options.clearSavedPosition();
    const next = options.getDefaultPosition();
    if (next) button?.setPosition(next);
  };

  const ensurePanels = (): { actions: PanelHandle; settings: PanelHandle } => {
    if (panels) return panels;

    const current = ensureUI();
    const notify = createToast(current);
    toast = notify;

    const actions = createPanel(current, {
      title: '操作面板',
      description: '复制本页的转写文稿，或把悬浮按钮放回右上角。',
      open: false,
      closeLabel: '关闭操作面板',
    });
    const copyButton = createButton(current, {
      label: '复制当前转写文稿',
      onClick: () => {
        copyButton.setLoading(true);
        void copy().then((outcome) => {
          copyButton.setLoading(false);
          if (outcome === 'skipped') return;
          if (outcome === 'success') {
            notify.success('已复制转写文稿');
            actions.close();
          } else if (outcome === 'empty') {
            notify.warning('没有找到转写文稿');
          } else {
            notify.error('复制失败，请稍后重试');
          }
        });
      },
    });
    const resetButton = createButton(current, {
      label: '重置按钮位置',
      variant: 'secondary',
      onClick: () => {
        resetPosition();
        notify.success('按钮已回到播放器右上角');
        actions.close();
      },
    });
    const actionSection = createSection(current, { title: '操作' });
    actionSection.body.append(copyButton.el, resetButton.el);
    actions.body.append(actionSection.el);

    const settings = createPanel(current, {
      title: '功能设置',
      description: '这里只放会影响脚本行为的开关；改动立即生效。',
      open: false,
      closeLabel: '关闭功能设置',
    });
    const memorySection = createSection(current, {
      title: '记忆',
      description: '脚本会记住上次能用的转写抓取方式，下次优先用它；清空后重新按默认顺序尝试。',
    });
    const clearStrategy = createButton(current, {
      label: '清空策略记忆',
      variant: 'destructive',
      onClick: () => {
        options.clearStrategy();
        notify.success('已清空策略记忆');
      },
    });
    memorySection.body.append(clearStrategy.el);
    settings.body.append(memorySection.el);

    panels = { actions, settings };
    return panels;
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

    const mounted = ensureUI();
    const created = createTranscriptButton({
      ui: mounted,
      label: '复制当前转写文稿',
      onClick: () => void activateFromButton(created),
      onMoveEnd: (next) => {
        autoPosition = false;
        options.savePosition(next);
      },
    });
    created.setPosition(position);
    created.setVisible(visible);
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
      // 首次在无播放器页面加载时按钮没建出来；之后播放器出现（如迷你播放器）要补建。
      if (next && !button) sync();
      button?.setVisible(next);
    },
    openActions() {
      ensurePanels().actions.open();
    },
    openSettings() {
      ensurePanels().settings.open();
    },
    destroy() {
      if (settleTimer !== undefined) {
        window.clearTimeout(settleTimer);
        settleTimer = undefined;
      }
      button?.destroy();
      toast?.destroy();
      button = null;
      toast = null;
      panels = null;
      ui?.destroy();
      ui = null;
    },
  };
}
