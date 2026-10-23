import { createButton, type UI } from '@ui';
import { clampPosition, type ButtonPosition } from '../features/position';
import buttonCss from './transcript-button.css?inline';

/**
 * 可拖动悬浮按钮。
 *
 * 外观（尺寸、颜色、悬停、焦点环、加载态）全部来自 `@ui` 的按钮组件；
 * 本文件只补两件框架不提供的事：自由拖动定位（框架的 Launcher 只支持四角），
 * 以及 T / 加载中 / ✓ / ✕ 的复制结果状态。
 */

export type ButtonState = 'normal' | 'loading' | 'success' | 'error';

const DRAG_THRESHOLD_PX = 3;
const RESET_DELAY_MS = 1500;
const CLICK_SUPPRESS_MS = 50;
// 加载态用组件的转圈动画，标签留空，避免文字和转圈挤在一起。
const LABELS: Record<ButtonState, string> = {
  normal: 'T',
  loading: '',
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
  const { ui } = options;
  if (ui.destroyed) throw new Error('Cannot create a transcript button after ui.destroy().');
  ui.useStyles(buttonCss);

  const wrap = document.createElement('div');
  wrap.className = 'yt-transcript-wrap';
  wrap.dataset.dragging = 'false';
  wrap.dataset.state = 'normal';

  const stateLabel = document.createElement('span');
  stateLabel.textContent = LABELS.normal;

  let state: ButtonState = 'normal';
  let position: ButtonPosition = { right: 30, top: 30 };
  let suppressClick = false;
  let resetTimer: number | undefined;
  // 拖动中的 pointermove / pointerup 挂在 document 上，必须能随 UI 销毁一起收掉。
  let dragScope: AbortController | null = null;

  const button = createButton(ui, {
    label: stateLabel,
    variant: 'destructive',
    size: 'lg',
    iconOnly: true,
    ariaLabel: options.label,
    title: options.label,
    onClick: (event) => {
      event.stopPropagation();
      // 拖动结束后浏览器仍会补一次 click；用短暂抑制避免“拖一下就复制”。
      if (suppressClick || state === 'loading') return;
      options.onClick();
    },
  });
  wrap.appendChild(button.el);
  ui.mount(wrap);

  const applyPosition = (): void => {
    wrap.style.right = `${position.right}px`;
    wrap.style.top = `${position.top}px`;
  };

  const applyState = (next: ButtonState): void => {
    state = next;
    wrap.dataset.state = next;
    stateLabel.textContent = LABELS[next];
    button.setLoading(next === 'loading');
    if (resetTimer !== undefined) {
      window.clearTimeout(resetTimer);
      resetTimer = undefined;
    }
    if (next === 'success' || next === 'error') {
      resetTimer = window.setTimeout(() => applyState('normal'), RESET_DELAY_MS);
    }
  };

  wrap.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    if (event.button !== 0 || state === 'loading') return;

    const rect = wrap.getBoundingClientRect();
    const startRight = window.innerWidth - rect.right;
    const startTop = rect.top;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;

    dragScope?.abort();
    const scope = new AbortController();
    dragScope = scope;
    const { signal } = scope;

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
      scope.abort();
      dragScope = null;
      wrap.dataset.dragging = 'false';
      // 没移动就是一次普通单击：不改位置，否则会停用“跟着播放器走”。
      if (!moved) return;
      options.onMoveEnd(position);
      suppressClick = true;
      window.setTimeout(() => {
        suppressClick = false;
      }, CLICK_SUPPRESS_MS);
    };

    wrap.dataset.dragging = 'true';
    document.addEventListener('pointermove', onMove, { signal });
    document.addEventListener('pointerup', onUp, { signal });
  });

  const cleanup = (): void => {
    if (resetTimer !== undefined) window.clearTimeout(resetTimer);
    resetTimer = undefined;
    dragScope?.abort();
    dragScope = null;
  };

  // UI 被销毁时也必须收掉拖动监听（`destroy()` 可能没被调用）。
  ui.onDestroy(cleanup);

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
      cleanup();
      // 组件有自己的 scope，先销毁再删节点，监听与按钮上的点击回调一起释放。
      button.destroy();
      wrap.remove();
    },
  };
}
