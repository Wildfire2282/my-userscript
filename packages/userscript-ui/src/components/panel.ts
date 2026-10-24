import { append, type Content } from '../core/dom';
import { focusFirst, focusIfConnected } from '../core/focus';
import { uid } from '../core/id';
import { assertAlive, createScope } from '../core/lifecycle';
import type { UI } from '../core/mount';
import { createScrollHint, resolveScrollHint, type ScrollHintHandle } from '../core/scroll-hint';
import { closeIcon } from '../icons';
import { createButton } from './button';
import panelCss from './panel.css?inline';

export type PanelPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'center';

/**
 * Panel size presets. `settings` is the compact single-column surface for
 * script configuration; `operation` is wider and taller, for the script's
 * actual functionality. Both share the same padding, typography and footer.
 */
export type PanelSize = 'settings' | 'operation';

export interface PanelOptions {
  title?: string;
  description?: string;
  ariaLabel?: string;
  closeLabel?: string;
  /** Size preset. Defaults to `settings`. */
  size?: PanelSize;
  /**
   * Footer content. Nodes are adopted as-is: replacing them later detaches but
   * does not destroy component handles, so the caller owns their lifecycle.
   */
  footer?: Content | Content[];
  open?: boolean;
  position?: PanelPosition;
  scrollHint?: boolean | { text?: string };
  /** Move focus into the panel when it opens. Defaults to `true`. */
  autoFocus?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
}

export interface PanelHandle {
  el: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  setTitle(title?: string): void;
  setDescription(description?: string): void;
  /**
   * Replaces the footer content; an empty call hides the footer. Existing nodes
   * are detached but not destroyed: keep their handles and call `destroy()`
   * before dropping them, otherwise their listeners live until `ui.destroy()`.
   */
  setFooter(content?: Content | Content[]): void;
  setPosition(position: PanelPosition): void;
  /** Switches between the settings and operation presets without remounting. */
  setSize(size: PanelSize): void;
  onOpenChange(listener: (open: boolean) => void): () => void;
  destroy(): void;
}

export function createPanel(ui: UI, options: PanelOptions = {}): PanelHandle {
  assertAlive(ui, 'panel');
  ui.useStyles(panelCss);

  const scope = createScope(ui);
  const titleId = uid('ds-panel-title');
  const descriptionId = uid('ds-panel-description');

  const el = document.createElement('section');
  el.className = 'ds-panel';
  el.setAttribute('data-ds-panel', '');
  el.dataset.position = options.position ?? 'bottom-right';
  el.setAttribute('role', 'region');
  el.tabIndex = -1;

  let panelSize: PanelSize = options.size ?? 'settings';
  el.dataset.size = panelSize;

  const header = document.createElement('header');
  header.className = 'ds-panel-header';

  const heading = document.createElement('div');
  heading.className = 'ds-panel-heading';

  const title = document.createElement('h2');
  title.className = 'ds-panel-title';
  title.id = titleId;
  title.textContent = options.title ?? '';
  title.hidden = !options.title;

  const description = document.createElement('p');
  description.className = 'ds-panel-description';
  description.id = descriptionId;
  description.textContent = options.description ?? '';
  description.hidden = !options.description;

  heading.append(title, description);
  heading.hidden = !options.title && !options.description;
  header.appendChild(heading);

  const body = document.createElement('div');
  body.className = 'ds-panel-body';

  const content = document.createElement('div');
  content.className = 'ds-panel-content';
  content.appendChild(body);

  const footer = document.createElement('div');
  footer.className = 'ds-panel-footer';
  footer.hidden = true;

  let isOpen = false;
  let destroyed = false;
  let returnFocus: HTMLElement | null = null;
  const openListeners = new Set<(open: boolean) => void>();

  /**
   * Listeners observe the current state, not a queue of transitions: when a
   * listener changes the state mid-broadcast, the remaining listeners are
   * skipped so nobody is told about a state that is already stale. The new
   * state is broadcast by the nested `open()` / `close()` call.
   */
  const notify = (open: boolean) => {
    for (const listener of [...openListeners]) {
      if (isOpen !== open) break;
      if (!openListeners.has(listener)) continue;
      listener(open);
    }
  };

  const fallbackLabel = () =>
    options.ariaLabel ?? (panelSize === 'operation' ? ui.labels.operation : ui.labels.settings);

  const setTitle = (next?: string) => {
    title.textContent = next ?? '';
    title.hidden = !next;
    heading.hidden = title.hidden && description.hidden;

    if (next) {
      el.setAttribute('aria-labelledby', titleId);
      el.removeAttribute('aria-label');
    } else {
      el.removeAttribute('aria-labelledby');
      el.setAttribute('aria-label', fallbackLabel());
    }
  };

  const setSize = (next: PanelSize) => {
    panelSize = next;
    el.dataset.size = next;
    if (title.hidden) el.setAttribute('aria-label', fallbackLabel());
  };

  const setDescription = (next?: string) => {
    description.textContent = next ?? '';
    description.hidden = !next;
    heading.hidden = title.hidden && description.hidden;
    const ids = new Set((el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean));
    if (next) ids.add(descriptionId);
    else ids.delete(descriptionId);
    if (ids.size) el.setAttribute('aria-describedby', [...ids].join(' '));
    else el.removeAttribute('aria-describedby');
  };

  const setFooter = (next?: Content | Content[]) => {
    footer.replaceChildren();
    if (next == null) {
      footer.hidden = true;
      return;
    }
    const items = Array.isArray(next) ? next : [next];
    append(footer, ...items);
    footer.hidden = items.length === 0;
  };

  const close = () => {
    if (!isOpen || destroyed) return;
    const active = ui.root.activeElement;
    const shouldRestoreFocus = active != null && el.contains(active);

    isOpen = false;
    el.hidden = true;
    el.dataset.open = 'false';

    try {
      if (shouldRestoreFocus) focusIfConnected(returnFocus);
      options.onClose?.();
    } finally {
      // A consumer hook must not desynchronize the open state from its
      // listeners, even when the hook itself throws.
      if (!isOpen) notify(false);
    }
  };

  const open = () => {
    if (isOpen || destroyed) return;
    isOpen = true;
    returnFocus =
      (ui.root.activeElement as HTMLElement | null) ??
      (document.activeElement as HTMLElement | null);
    el.hidden = false;
    el.dataset.open = 'true';
    if (options.autoFocus !== false) {
      focusFirst(body);
      const active = ui.root.activeElement;
      if (!active || !body.contains(active)) el.focus({ preventScroll: true });
    }
    hint?.update();
    try {
      options.onOpen?.();
    } finally {
      if (isOpen && !destroyed) notify(true);
    }
  };

  const closeButton = createButton(ui, {
    size: 'sm',
    variant: 'ghost',
    iconOnly: true,
    ariaLabel: options.closeLabel ?? ui.labels.close,
    icon: closeIcon(),
  });
  closeButton.el.classList.add('ds-panel-close');
  closeButton.el.addEventListener('click', close, { signal: scope.signal });
  header.appendChild(closeButton.el);
  el.append(header, content, footer);

  const hintOptions = resolveScrollHint(options.scrollHint);
  const hint: ScrollHintHandle | null = hintOptions
    ? createScrollHint(ui, content, body, hintOptions)
    : null;

  el.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && !event.isComposing && isOpen) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    },
    { signal: scope.signal },
  );

  if (options.title) {
    el.setAttribute('aria-labelledby', titleId);
  } else {
    el.setAttribute('aria-label', fallbackLabel());
  }

  setDescription(options.description);
  if (options.footer) setFooter(options.footer);

  el.hidden = options.open === false;
  el.dataset.open = options.open === false ? 'false' : 'true';
  isOpen = options.open !== false;

  ui.layers.base.appendChild(el);

  /**
   * Runs for an explicit `destroy()` and for `ui.destroy()`: the scope callback
   * invokes it, so a panel is always torn down exactly once.
   */
  const teardown = () => {
    if (destroyed) return;
    const wasOpen = isOpen;
    const active = ui.root.activeElement;
    const shouldRestoreFocus = wasOpen && active != null && el.contains(active);

    destroyed = true;
    isOpen = false;
    scope.destroy();
    hint?.destroy();
    closeButton.destroy();
    el.remove();

    if (wasOpen) {
      try {
        if (shouldRestoreFocus) focusIfConnected(returnFocus);
        options.onClose?.();
      } finally {
        try {
          notify(false);
        } finally {
          openListeners.clear();
        }
      }
    } else {
      openListeners.clear();
    }
  };
  scope.onDestroy(teardown);

  const handle: PanelHandle = {
    el,
    body,
    footer,
    open,
    close,
    toggle() {
      if (isOpen) close();
      else open();
    },
    isOpen() {
      return isOpen;
    },
    setTitle,
    setDescription,
    setFooter,
    setPosition(position) {
      el.dataset.position = position;
    },
    setSize,
    onOpenChange(listener) {
      openListeners.add(listener);
      return () => openListeners.delete(listener);
    },
    destroy: teardown,
  };

  return handle;
}
