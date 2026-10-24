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
    state = {
      count: 0,
      overflow: root.style.overflow,
      overflowPriority: root.style.getPropertyPriority('overflow'),
      padding: root.style.paddingRight,
      paddingPriority: root.style.getPropertyPriority('padding-right'),
    };
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
