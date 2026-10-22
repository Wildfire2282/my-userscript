import type { UI } from '@ui';
import { INDICATOR } from '../config';
import type { AnchorBox } from '../features/geometry';
import indicatorCss from './indicator.css?inline';
import { indicatorPosition } from './indicator-position';

/**
 * 复制成功后的勾号圆点。
 *
 * 标记是文档级单例：每次展示自增序号，旧的隐藏 / 移除回调据此自我作废，
 * 保证任意时刻视口里最多只有一个提示。
 */

export interface IndicatorHandle {
  show: (rect: AnchorBox | null) => void;
  destroy: () => void;
}

export function createIndicator(ui: UI): IndicatorHandle {
  ui.useStyles(indicatorCss);

  const dot = document.createElement('div');
  dot.className = 'sel-copy-dot';
  dot.setAttribute('aria-hidden', 'true');
  dot.textContent = '\u2713';

  let holdTimer: number | undefined;
  let fadeTimer: number | undefined;
  let token = 0;

  const clearTimers = () => {
    if (holdTimer !== undefined) window.clearTimeout(holdTimer);
    if (fadeTimer !== undefined) window.clearTimeout(fadeTimer);
    holdTimer = undefined;
    fadeTimer = undefined;
  };

  const show = (rect: AnchorBox | null): void => {
    const point = indicatorPosition(rect, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    const current = ++token;
    clearTimers();

    if (!dot.isConnected) ui.layers.base.appendChild(dot);
    dot.style.left = `${point.left}px`;
    dot.style.top = `${point.top}px`;
    dot.dataset.visible = 'true';

    holdTimer = window.setTimeout(() => {
      if (current !== token) return;
      dot.dataset.visible = 'false';
      fadeTimer = window.setTimeout(() => {
        if (current !== token || !dot.isConnected) return;
        dot.remove();
      }, INDICATOR.fadeMs);
    }, INDICATOR.holdMs);
  };

  const destroy = (): void => {
    token += 1;
    clearTimers();
    dot.remove();
  };

  ui.onDestroy(destroy);

  return { show, destroy };
}
