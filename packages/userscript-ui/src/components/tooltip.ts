import { syncDescribedBy } from '../core/dom';
import { uid } from '../core/id';
import { assertAlive, createScope } from '../core/lifecycle';
import type { UI } from '../core/mount';
import { anchorOverlayHost, onTopLayerChange } from '../core/top-layer';
import tooltipCss from './tooltip.css?inline';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipOptions {
  content: string;
  placement?: TooltipPlacement;
  delay?: number;
  hideDelay?: number;
}

export interface TooltipHandle {
  el: HTMLElement;
  show(): void;
  hide(): void;
  destroy(): void;
}

const GAP = 8;
const EDGE = 8;

export function createTooltip(ui: UI, target: HTMLElement, options: TooltipOptions): TooltipHandle {
  if (!options.content) throw new Error('Tooltips require content.');
  assertAlive(ui, 'tooltip');
  ui.useStyles(tooltipCss);

  const scope = createScope(ui);
  const id = uid('ds-tooltip');

  const el = document.createElement('div');
  el.className = 'ds-tooltip';
  el.id = id;
  el.setAttribute('role', 'tooltip');
  el.setAttribute('data-ds-tooltip', '');
  el.textContent = options.content;
  el.hidden = true;
  ui.layers.tooltip.appendChild(el);

  let open = false;
  let destroyed = false;
  let hovered = false;
  let focused = false;
  let showTimer: number | null = null;
  let hideTimer: number | null = null;
  let viewController: AbortController | null = null;
  let frame = 0;

  const clearTimers = () => {
    if (showTimer != null) window.clearTimeout(showTimer);
    if (hideTimer != null) window.clearTimeout(hideTimer);
    showTimer = null;
    hideTimer = null;
  };

  const applyDescribedBy = (): void => syncDescribedBy(target, [id], [id]);

  const restoreDescribedBy = (): void => syncDescribedBy(target, [id], []);

  const position = () => {
    const targetRect = target.getBoundingClientRect();
    if (targetRect.width === 0 && targetRect.height === 0) return;

    const tipRect = el.getBoundingClientRect();
    let placement = options.placement ?? 'top';

    if (placement === 'top' && targetRect.top - tipRect.height - GAP < EDGE) {
      placement = 'bottom';
    } else if (
      placement === 'bottom' &&
      targetRect.bottom + tipRect.height + GAP > window.innerHeight - EDGE
    ) {
      placement = 'top';
    } else if (placement === 'left' && targetRect.left - tipRect.width - GAP < EDGE) {
      placement = 'right';
    } else if (
      placement === 'right' &&
      targetRect.right + tipRect.width + GAP > window.innerWidth - EDGE
    ) {
      placement = 'left';
    }

    let left: number;
    let top: number;

    switch (placement) {
      case 'bottom':
        left = targetRect.left + targetRect.width / 2 - tipRect.width / 2;
        top = targetRect.bottom + GAP;
        break;
      case 'left':
        left = targetRect.left - tipRect.width - GAP;
        top = targetRect.top + targetRect.height / 2 - tipRect.height / 2;
        break;
      case 'right':
        left = targetRect.right + GAP;
        top = targetRect.top + targetRect.height / 2 - tipRect.height / 2;
        break;
      default:
        left = targetRect.left + targetRect.width / 2 - tipRect.width / 2;
        top = targetRect.top - tipRect.height - GAP;
        break;
    }

    el.dataset.placement = placement;
    el.style.left = `${Math.round(
      Math.min(Math.max(left, EDGE), Math.max(EDGE, window.innerWidth - tipRect.width - EDGE)),
    )}px`;
    el.style.top = `${Math.round(
      Math.min(Math.max(top, EDGE), Math.max(EDGE, window.innerHeight - tipRect.height - EDGE)),
    )}px`;
  };

  const showNow = () => {
    clearTimers();
    if (open || destroyed) return;
    const targetRect = target.getBoundingClientRect();
    if (!target.isConnected || (targetRect.width === 0 && targetRect.height === 0)) return;
    const host = anchorOverlayHost(ui, target, ui.layers.tooltip);
    if (!host) return;
    host.appendChild(el);
    open = true;
    el.hidden = false;
    position();
    applyDescribedBy();

    viewController = new AbortController();
    const reposition = () => {
      if (!open) return;
      const rect = target.getBoundingClientRect();
      if (
        rect.bottom < 0 ||
        rect.top > window.innerHeight ||
        rect.right < 0 ||
        rect.left > window.innerWidth
      ) {
        hideNow();
        return;
      }
      schedulePosition();
    };

    window.addEventListener('scroll', reposition, {
      capture: true,
      passive: true,
      signal: viewController.signal,
    });
    window.addEventListener('resize', reposition, {
      passive: true,
      signal: viewController.signal,
    });
  };

  /**
   * Scroll fires many times per frame; measuring on every event forces a
   * synchronous layout each time. Coalesce into one measurement per frame.
   */
  const schedulePosition = () => {
    if (frame) return;
    if (typeof requestAnimationFrame !== 'function') {
      position();
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (open) position();
    });
  };

  const hideNow = () => {
    clearTimers();
    if (!open) return;
    open = false;
    el.hidden = true;
    restoreDescribedBy();
    viewController?.abort();
    viewController = null;
    if (frame && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    ui.layers.tooltip.appendChild(el);
  };

  const detachTopLayer = onTopLayerChange(ui, () => {
    if (open) hideNow();
  });
  scope.onDestroy(detachTopLayer);

  const scheduleShow = (delay: number) => {
    if (hideTimer != null) window.clearTimeout(hideTimer);
    hideTimer = null;
    if (showTimer != null) window.clearTimeout(showTimer);

    if (delay <= 0) {
      showNow();
      return;
    }
    showTimer = window.setTimeout(showNow, delay);
  };

  const scheduleHide = (delay: number) => {
    if (showTimer != null) window.clearTimeout(showTimer);
    showTimer = null;
    if (hideTimer != null) window.clearTimeout(hideTimer);

    if (delay <= 0) {
      hideNow();
      return;
    }
    hideTimer = window.setTimeout(hideNow, delay);
  };

  target.addEventListener(
    'mouseenter',
    () => {
      hovered = true;
      scheduleShow(options.delay ?? 400);
    },
    { signal: scope.signal },
  );
  target.addEventListener(
    'mouseleave',
    () => {
      hovered = false;
      if (!focused) scheduleHide(options.hideDelay ?? 80);
    },
    { signal: scope.signal },
  );
  target.addEventListener(
    'focus',
    () => {
      focused = true;
      scheduleShow(0);
    },
    { signal: scope.signal },
  );
  target.addEventListener(
    'blur',
    () => {
      focused = false;
      if (!hovered) scheduleHide(0);
    },
    { signal: scope.signal },
  );
  target.addEventListener(
    'click',
    () => {
      // 点击后再移开鼠标要能收起：否则按钮仍保持焦点，mouseleave 会以为这是键盘聚焦而继续显示。
      focused = false;
      hideNow();
    },
    { signal: scope.signal },
  );
  target.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && !event.isComposing && open) {
        event.preventDefault();
        event.stopPropagation();
        hideNow();
      }
    },
    { signal: scope.signal },
  );

  const teardown = () => {
    if (destroyed) return;
    destroyed = true;
    hideNow();
    scope.destroy();
    el.remove();
  };
  scope.onDestroy(teardown);

  return {
    el,
    show() {
      if (!destroyed) scheduleShow(0);
    },
    hide() {
      hideNow();
    },
    destroy: teardown,
  };
}
