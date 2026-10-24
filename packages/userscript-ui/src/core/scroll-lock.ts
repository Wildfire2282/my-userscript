const LOCK_KEY = Symbol.for('userscript-ui.scroll-lock');

interface LockState {
  count: number;
  overflow: string;
  overflowPriority: string;
  padding: string;
  paddingPriority: string;
}

const scope = globalThis as unknown as {
  [LOCK_KEY]?: LockState;
};

/**
 * Locks page scrolling while a modal dialog is open. The state is shared
 * through a global symbol so two userscripts do not unlock each other.
 *
 * The scrollbar width is compensated with padding, otherwise the page content
 * shifts horizontally the moment a dialog opens.
 */
export function lockPageScroll(): () => void {
  const root = document.documentElement;
  let state = scope[LOCK_KEY];
  if (!state) {
    // 快照在真正加锁时（count 从 0 起）才写；这里只需要一个共享的计数槽。
    state = { count: 0, overflow: '', overflowPriority: '', padding: '', paddingPriority: '' };
    scope[LOCK_KEY] = state;
  }

  const holder = state;
  if (holder.count === 0) {
    holder.overflow = root.style.overflow;
    holder.overflowPriority = root.style.getPropertyPriority('overflow');
    holder.padding = root.style.paddingRight;
    holder.paddingPriority = root.style.getPropertyPriority('padding-right');

    const scrollbar = Math.max(0, window.innerWidth - root.clientWidth);
    if (scrollbar > 0) {
      root.style.setProperty(
        'padding-right',
        `calc(${holder.padding || '0px'} + ${scrollbar}px)`,
        'important',
      );
    }
    root.style.setProperty('overflow', 'hidden', 'important');
  }
  holder.count += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    holder.count -= 1;

    if (holder.count > 0) return;

    if (holder.padding) {
      root.style.setProperty('padding-right', holder.padding, holder.paddingPriority);
    } else {
      root.style.removeProperty('padding-right');
    }
    if (holder.overflow) {
      root.style.setProperty('overflow', holder.overflow, holder.overflowPriority);
    } else {
      root.style.removeProperty('overflow');
    }
    delete scope[LOCK_KEY];
  };
}
