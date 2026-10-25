import { chevronDownIcon } from '../icons';
import scrollHintCss from '../styles/scroll-hint.css?inline';
import { createScope } from './lifecycle';
import type { UI } from './mount';

export interface ScrollHintOptions {
  text?: string;
}

export interface ScrollHintHandle {
  el: HTMLElement;
  update(): void;
  destroy(): void;
}

const EDGE = 2;

export function resolveScrollHint(
  option: boolean | ScrollHintOptions | undefined,
): ScrollHintOptions | null {
  if (option === false) return null;
  if (option === true || option === undefined) return {};
  return option;
}

/**
 * Shows a hint above a scrollable area while more content is hidden below.
 * The hint is decorative; the scroll area itself stays keyboard scrollable.
 */
export function createScrollHint(
  ui: UI,
  container: HTMLElement,
  scroller: HTMLElement,
  options: ScrollHintOptions = {},
): ScrollHintHandle {
  ui.useStyles(scrollHintCss);

  const scope = createScope(ui);

  const el = document.createElement('div');
  el.className = 'ds-scroll-hint';
  el.setAttribute('data-ds-scroll-hint', '');
  el.setAttribute('aria-hidden', 'true');
  el.dataset.state = 'hidden';

  const label = document.createElement('span');
  label.className = 'ds-scroll-hint-label';
  label.appendChild(chevronDownIcon());

  const text = document.createElement('span');
  text.textContent = options.text ?? ui.labels.scrollHint;
  label.appendChild(text);

  el.appendChild(label);
  container.appendChild(el);

  const update = () => {
    const scrollable = scroller.scrollHeight > scroller.clientHeight + EDGE;
    const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - EDGE;
    const next = scrollable && !atEnd ? 'visible' : 'hidden';
    // 状态没变就不碰属性：面板内容每次变化都会走到这里。
    if (el.dataset.state !== next) el.dataset.state = next;
  };

  // 滚动、尺寸与内容变化可能在同一帧里触发多次，而 update 每次都要读布局；每帧只测一次。
  let frame = 0;
  const scheduleUpdate = (): void => {
    if (frame !== 0) return;
    if (typeof requestAnimationFrame !== 'function') {
      update();
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  };

  scroller.addEventListener('scroll', scheduleUpdate, { passive: true, signal: scope.signal });
  window.addEventListener('resize', scheduleUpdate, { passive: true, signal: scope.signal });

  const mutations = new MutationObserver(scheduleUpdate);
  mutations.observe(scroller, { childList: true, subtree: true, characterData: true });

  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleUpdate) : null;
  resize?.observe(scroller);

  update();

  return {
    el,
    update,
    destroy() {
      scope.destroy();
      mutations.disconnect();
      resize?.disconnect();
      if (frame !== 0 && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      el.remove();
    },
  };
}
