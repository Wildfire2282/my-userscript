import type { UI } from '@ui';
import { clampPosition, type ButtonPosition } from '../features/position';
import buttonCss from './transcript-button.css?inline';

/**
 * 可拖动悬浮按钮。
 *
 * 只负责显示与手势：位置换算交给 `clampPosition`，复制与状态时长由调用方决定。
 * 状态与线上旧版一致：T（就绪）→ 跳动的点（抓取中）→ ✓ / ✕（1.5 秒后回到 T）。
 */

export type ButtonState = 'normal' | 'loading' | 'success' | 'error';

const DRAG_THRESHOLD_PX = 3;
const RESET_DELAY_MS = 1500;
const DOT_INTERVAL_MS = 300;
const CLICK_SUPPRESS_MS = 50;
const LABELS: Record<ButtonState, string> = {
  normal: 'T',
  loading: '.',
  success: '\u2713',
  error: '\u2715',
};

export interface TranscriptButtonOptions {
  ui: UI;
  label: string;
  onClick: () => void;
  onMoveEnd: (position: ButtonPosition) => void;
}

export interface TranscriptButtonHandle {
  el: HTMLElement;
  setState: (state: ButtonState) => void;
  setVisible: (visible: boolean) => void;
  setPosition: (position: ButtonPosition) => void;
  getPosition: () => ButtonPosition;
  destroy: () => void;
}

export function createTranscriptButton(options: TranscriptButtonOptions): TranscriptButtonHandle {
  options.ui.useStyles(buttonCss);

  const wrap = document.createElement('div');
  wrap.className = 'yt-transcript-wrap';
  wrap.dataset.dragging = 'false';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'yt-transcript-button';
  button.dataset.state = 'normal';
  button.setAttribute('aria-label', options.label);
  button.title = options.label;

  const label = document.createElement('span');
  label.className = 'yt-transcript-label';
  label.textContent = LABELS.normal;
  button.appendChild(label);
  wrap.appendChild(button);
  // 必须挂进 @ui 的 Shadow Root：`position: fixed` 才能相对视口，也能用上 Token。
  options.ui.layers.base.appendChild(wrap);

  let state: ButtonState = 'normal';
  let position: ButtonPosition = { right: 30, top: 30 };
  let dotsTimer: number | undefined;
  let resetTimer: number | undefined;
  let suppressClick = false;

  const clearTimers = (): void => {
    if (dotsTimer !== undefined) window.clearInterval(dotsTimer);
    if (resetTimer !== undefined) window.clearTimeout(resetTimer);
    dotsTimer = undefined;
    resetTimer = undefined;
  };

  const applyPosition = (): void => {
    wrap.style.right = `${position.right}px`;
    wrap.style.top = `${position.top}px`;
  };

  const applyState = (next: ButtonState): void => {
    state = next;
    button.dataset.state = next;
    button.disabled = next === 'loading';
    clearTimers();

    if (next === 'loading') {
      let count = 1;
      label.textContent = LABELS.loading;
      dotsTimer = window.setInterval(() => {
        count = (count % 3) + 1;
        label.textContent = '.'.repeat(count);
      }, DOT_INTERVAL_MS);
      return;
    }

    label.textContent = LABELS[next];
    if (next === 'success' || next === 'error') {
      resetTimer = window.setTimeout(() => applyState('normal'), RESET_DELAY_MS);
    }
  };

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    // 拖动结束后浏览器仍会补一次 click；用短暂抑制避免“拖一下就复制”。
    if (suppressClick || state === 'loading') return;
    options.onClick();
  });

  wrap.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const rect = wrap.getBoundingClientRect();
    const startRight = window.innerWidth - rect.right;
    const startTop = rect.top;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;

    const onMove = (moveEvent: PointerEvent): void => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) moved = true;
      position = clampPosition(
        { right: startRight - dx, top: startTop + dy },
        { width: window.innerWidth, height: window.innerHeight },
      );
      applyPosition();
    };

    const onUp = (): void => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      // 触屏拖动被系统手势抢占时会发 cancel 而不是 up：不摘监听就越积越多。
      document.removeEventListener('pointercancel', onUp);
      wrap.dataset.dragging = 'false';
      options.onMoveEnd(position);
      if (moved) {
        suppressClick = true;
        window.setTimeout(() => {
          suppressClick = false;
        }, CLICK_SUPPRESS_MS);
      }
    };

    wrap.dataset.dragging = 'true';
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });

  applyPosition();

  return {
    el: wrap,
    setState: applyState,
    setVisible(visible) {
      wrap.hidden = !visible;
    },
    setPosition(next) {
      position = clampPosition(next, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      applyPosition();
    },
    getPosition: () => position,
    destroy() {
      clearTimers();
      wrap.remove();
    },
  };
}
