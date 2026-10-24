import { uid } from '../core/id';
import { assertAlive, createScope } from '../core/lifecycle';
import type { UI } from '../core/mount';
import { onTopLayerChange, overlayHost } from '../core/top-layer';
import { closeIcon } from '../icons';
import { createButton } from './button';
import { feedbackIcon, type FeedbackVariant } from './feedback';
import toastCss from './toast.css?inline';

export interface ToastOptions {
  title?: string;
  description?: string;
  variant?: FeedbackVariant;
  duration?: number;
  id?: string;
  onDismiss?: () => void;
}

export interface ToastHandle {
  id: string;
  el: HTMLElement;
  dismiss(): void;
}

export interface ToastController {
  show(options: ToastOptions): ToastHandle;
  success(title: string, options?: Omit<ToastOptions, 'title' | 'variant'>): ToastHandle;
  info(title: string, options?: Omit<ToastOptions, 'title' | 'variant'>): ToastHandle;
  warning(title: string, options?: Omit<ToastOptions, 'title' | 'variant'>): ToastHandle;
  error(title: string, options?: Omit<ToastOptions, 'title' | 'variant'>): ToastHandle;
  dismiss(id: string): void;
  clear(): void;
  destroy(): void;
}

export interface ToastControllerOptions {
  max?: number;
  regionLabel?: string;
  dismissLabel?: string;
}

interface ToastRecord extends ToastHandle {
  variant: FeedbackVariant;
  remove(): void;
}

const DEFAULT_DURATION: Record<FeedbackVariant, number> = {
  success: 4000,
  info: 4000,
  warning: 6000,
  error: 8000,
};

export function createToast(ui: UI, options: ToastControllerOptions = {}): ToastController {
  assertAlive(ui, 'toast');
  ui.useStyles(toastCss);

  const scope = createScope(ui);
  let destroyed = false;
  const max = Math.max(1, options.max ?? 4);
  const records: ToastRecord[] = [];

  const viewport = document.createElement('div');
  viewport.className = 'ds-toast-viewport';
  viewport.setAttribute('data-ds-toast-viewport', '');
  viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-label', options.regionLabel ?? ui.labels.notifications);

  // The visible toast is created after its content exists, which makes it an
  // unreliable live region. Announcements go through two persistent regions
  // instead: polite for status updates, assertive for errors.
  const announcers = {
    polite: createAnnouncer('polite'),
    assertive: createAnnouncer('assertive'),
  };
  viewport.append(announcers.polite, announcers.assertive);
  const announcementVersions = { polite: 0, assertive: 0 };

  const announce = (variant: FeedbackVariant, title?: string, description?: string) => {
    const politeness = variant === 'error' ? 'assertive' : 'polite';
    const target = announcers[politeness];
    const version = ++announcementVersions[politeness];
    const message = [title, description].filter(Boolean).join(' ');
    // 同一句话写回同样的内容不会触发 live region，再报一次就静默了；
    // 先清空、下一轮再写入，屏幕阅读器才会重新播报。
    if (target.textContent === message) {
      target.textContent = '';
      queueMicrotask(() => {
        if (!destroyed && announcementVersions[politeness] === version) {
          target.textContent = message;
        }
      });
      return;
    }
    target.textContent = message;
  };

  // A toast must stay visible above a modal, and only elements inside a
  // top-layer dialog paint above `::backdrop`. The viewport therefore moves to
  // the topmost dialog of this UI and returns to its own layer afterwards.
  const attachViewport = () => {
    if (destroyed) return;
    const host = overlayHost(ui, ui.layers.toast);
    if (viewport.parentElement !== host) host.appendChild(viewport);
  };

  attachViewport();
  const detachTopLayer = onTopLayerChange(ui, attachViewport);
  scope.onDestroy(() => {
    detachTopLayer();
    viewport.remove();
  });

  const dismiss = (id: string) => {
    const record = records.find((item) => item.id === id);
    record?.remove();
  };

  const clear = () => {
    // Keep clearing after a throwing onDismiss callback; surface the first
    // failure only after every toast has been removed.
    let failed = false;
    let failure: unknown;
    for (const record of [...records]) {
      try {
        record.remove();
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
    if (failed) throw failure;
  };

  const show = (toastOptions: ToastOptions): ToastHandle => {
    if (destroyed) throw new Error('Cannot show a toast after its controller is destroyed.');
    if (!toastOptions.title && !toastOptions.description) {
      throw new Error('Toasts require a title or description.');
    }

    const id = toastOptions.id ?? uid('ds-toast');
    dismiss(id);
    if (destroyed) throw new Error('Cannot show a toast after its controller is destroyed.');

    const variant = toastOptions.variant ?? 'info';
    const duration = toastOptions.duration ?? DEFAULT_DURATION[variant];
    // duration <= 0 means "stay until dismissed", not "zero time remaining".
    const autoDismiss = duration > 0;
    const local = new AbortController();

    const el = document.createElement('div');
    el.className = `ds-toast ds-toast--${variant}`;
    el.setAttribute('data-ds-toast', '');

    const icon = document.createElement('span');
    icon.className = 'ds-toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.appendChild(feedbackIcon(variant));

    const content = document.createElement('div');
    content.className = 'ds-toast-content';

    if (toastOptions.title) {
      const title = document.createElement('p');
      title.className = 'ds-toast-title';
      title.textContent = toastOptions.title;
      content.appendChild(title);
    }

    if (toastOptions.description) {
      const description = document.createElement('p');
      description.className = 'ds-toast-description';
      description.textContent = toastOptions.description;
      content.appendChild(description);
    }

    let timer: number | null = null;
    let remaining = duration;
    let startedAt = 0;
    let removed = false;
    let hovered = false;
    let focused = false;

    const startTimer = () => {
      if (!autoDismiss || removed || destroyed || remaining <= 0) return;
      startedAt = Date.now();
      timer = window.setTimeout(() => remove(), remaining);
    };

    const pause = () => {
      if (timer == null) return;
      window.clearTimeout(timer);
      timer = null;
      remaining -= Date.now() - startedAt;
    };

    const resume = () => {
      if (!autoDismiss || hovered || focused || timer != null || removed) return;
      // The remaining time ran out while paused: dismiss instead of leaving a
      // toast that can never time out again.
      if (remaining <= 0) {
        remove();
        return;
      }
      startTimer();
    };

    const remove = () => {
      if (removed) return;
      removed = true;
      if (timer != null) window.clearTimeout(timer);
      local.abort();
      close.destroy();
      el.remove();
      const index = records.indexOf(record);
      if (index >= 0) records.splice(index, 1);
      toastOptions.onDismiss?.();
    };

    const close = createButton(ui, {
      size: 'sm',
      variant: 'ghost',
      iconOnly: true,
      ariaLabel: options.dismissLabel ?? ui.labels.dismissNotification,
      icon: closeIcon(),
    });
    close.el.classList.add('ds-toast-close');
    close.el.addEventListener('click', remove, { signal: local.signal });

    el.append(icon, content, close.el);
    el.addEventListener(
      'pointerenter',
      () => {
        hovered = true;
        pause();
      },
      { signal: local.signal },
    );
    el.addEventListener(
      'pointerleave',
      () => {
        hovered = false;
        resume();
      },
      { signal: local.signal },
    );
    el.addEventListener(
      'focusin',
      () => {
        focused = true;
        pause();
      },
      { signal: local.signal },
    );
    el.addEventListener(
      'focusout',
      (event) => {
        if (!el.contains(event.relatedTarget as Node | null)) {
          focused = false;
          resume();
        }
      },
      { signal: local.signal },
    );

    const record: ToastRecord = {
      id,
      el,
      variant,
      dismiss: remove,
      remove,
    };

    records.unshift(record);
    viewport.prepend(el);
    announce(variant, toastOptions.title, toastOptions.description);
    startTimer();

    while (records.length > max) {
      records[records.length - 1]?.remove();
    }

    return record;
  };

  const teardown = () => {
    if (destroyed) return;
    destroyed = true;
    try {
      clear();
    } finally {
      scope.destroy();
    }
  };
  scope.onDestroy(teardown);

  return {
    show,
    success: (title, extra) => show({ ...extra, title, variant: 'success' }),
    info: (title, extra) => show({ ...extra, title, variant: 'info' }),
    warning: (title, extra) => show({ ...extra, title, variant: 'warning' }),
    error: (title, extra) => show({ ...extra, title, variant: 'error' }),
    dismiss,
    clear,
    destroy: teardown,
  };
}

function createAnnouncer(politeness: 'polite' | 'assertive'): HTMLElement {
  const announcer = document.createElement('div');
  announcer.className = 'ds-toast-announcer';
  announcer.setAttribute('aria-live', politeness);
  announcer.setAttribute('aria-atomic', 'true');
  return announcer;
}
