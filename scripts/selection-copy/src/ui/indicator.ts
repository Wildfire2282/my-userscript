import type { UI } from '@ui';
import { INDICATOR, type CopyFeedbackVariant } from '../config';
import type { CopyFeedback } from '../feedback';
import indicatorCss from './indicator.css?inline';
import { indicatorPosition } from './indicator-position';

/**
 * 复制结果标签。
 *
 * 标记是文档级单例：每次展示自增序号，旧的隐藏 / 移除回调据此自我作废，
 * 保证任意时刻视口里最多只有一个提示。
 */

const LABELS: Record<CopyFeedbackVariant, string> = {
  success: '已复制',
  failure: '复制失败',
};

const ICONS: Record<CopyFeedbackVariant, string> = {
  success: '\u2713',
  failure: '!',
};

export interface IndicatorHandle {
  show: (feedback: CopyFeedback) => void;
  destroy: () => void;
}

export function createIndicator(ui: UI): IndicatorHandle {
  ui.useStyles(indicatorCss);

  const pill = document.createElement('div');
  pill.className = 'sel-copy-pill';
  // 每次选中都播报会打断读屏用户，反馈只给视觉确认。
  pill.setAttribute('aria-hidden', 'true');

  const icon = document.createElement('span');
  icon.className = 'sel-copy-pill-icon';
  const label = document.createElement('span');
  label.className = 'sel-copy-pill-label';
  pill.append(icon, label);

  let holdTimer: number | undefined;
  let fadeTimer: number | undefined;
  let token = 0;

  const clearTimers = () => {
    if (holdTimer !== undefined) window.clearTimeout(holdTimer);
    if (fadeTimer !== undefined) window.clearTimeout(fadeTimer);
    holdTimer = undefined;
    fadeTimer = undefined;
  };

  const show = ({ variant, rect, point: cursor }: CopyFeedback): void => {
    const at = indicatorPosition(
      cursor,
      rect,
      // 贴边判断用布局视口，避免标签压到经典滚动条下面。
      {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
      variant,
    );
    const current = ++token;
    clearTimers();

    icon.textContent = ICONS[variant];
    label.textContent = LABELS[variant];
    pill.dataset.variant = variant;
    pill.style.width = `${INDICATOR.widthPx[variant]}px`;

    if (!pill.isConnected) ui.layers.base.appendChild(pill);
    pill.style.left = `${at.left}px`;
    pill.style.top = `${at.top}px`;
    pill.dataset.visible = 'true';

    holdTimer = window.setTimeout(() => {
      if (current !== token) return;
      pill.dataset.visible = 'false';
      fadeTimer = window.setTimeout(() => {
        if (current !== token || !pill.isConnected) return;
        pill.remove();
      }, INDICATOR.fadeMs);
    }, INDICATOR.holdMs[variant]);
  };

  const destroy = (): void => {
    token += 1;
    clearTimers();
    pill.remove();
  };

  ui.onDestroy(destroy);

  return { show, destroy };
}
