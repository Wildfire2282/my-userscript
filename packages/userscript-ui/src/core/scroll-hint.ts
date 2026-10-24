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
    el.dataset.state = scrollable && !atEnd ? 'visible' : 'hidden';
  };

  scroller.addEventListener('scroll', update, { passive: true, signal: scope.signal });
  window.addEventListener('resize', update, { passive: true, signal: scope.signal });

  const mutations = new MutationObserver(update);
  mutations.observe(scroller, { childList: true, subtree: true, characterData: true });

  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
  resize?.observe(scroller);

  update();

  return {
    el,
    update,
    destroy() {
      scope.destroy();
      mutations.disconnect();
      resize?.disconnect();
      el.remove();
      mutations.disconnect();
      resize?.disconnect();
      el.remove();
    },
  };
}
