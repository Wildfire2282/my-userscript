import { append, type Content } from '../core/dom';
import { focusFirst, focusIfConnected } from '../core/focus';
import { uid } from '../core/id';
import { assertAlive, createScope } from '../core/lifecycle';
import type { UI } from '../core/mount';
import { createScrollHint, resolveScrollHint, type ScrollHintHandle } from '../core/scroll-hint';
import { lockPageScroll } from '../core/scroll-lock';
import { popTopLayer, pushTopLayer } from '../core/top-layer';
import { closeIcon } from '../icons';
import { createButton, type ButtonVariant } from './button';
import dialogCss from './dialog.css?inline';

export interface DialogAction {
  label: string;
  value: string;
  variant?: ButtonVariant;
  autofocus?: boolean;
}

export interface DialogOptions {
  title: string;
  description?: string;
  content?: Content | Content[];
  actions?: DialogAction[];
  dismissible?: boolean;
  closeLabel?: string;
  scrollHint?: boolean | { text?: string };
  onOpen?: () => void;
  onClose?: (value: string | null) => void;
}

export interface DialogHandle {
  el: HTMLDialogElement;
  open(): Promise<string | null>;
  close(value?: string | null): void;
  destroy(): void;
}

export interface ConfirmDialogOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  dismissible?: boolean;
}

export function createDialog(ui: UI, options: DialogOptions): DialogHandle {
  if (options.title.trim() === '') throw new Error('Dialogs require a title.');
  assertAlive(ui, 'dialog');
  ui.useStyles(dialogCss);

  const scope = createScope(ui);
  const titleId = uid('ds-dialog-title');
  const descriptionId = uid('ds-dialog-description');

  const el = document.createElement('dialog');
  el.className = 'ds-dialog';
  el.setAttribute('data-ds-dialog', '');
  el.setAttribute('aria-labelledby', titleId);
  if (options.description) el.setAttribute('aria-describedby', descriptionId);

  const header = document.createElement('header');
  header.className = 'ds-dialog-header';

  const heading = document.createElement('div');
  heading.className = 'ds-dialog-heading';

  const title = document.createElement('h2');
  title.className = 'ds-dialog-title';
  title.id = titleId;
  title.textContent = options.title;
  heading.appendChild(title);

  if (options.description) {
    const description = document.createElement('p');
    description.className = 'ds-dialog-description';
    description.id = descriptionId;
    description.textContent = options.description;
    heading.appendChild(description);
  }

  header.appendChild(heading);

  const body = document.createElement('div');
  body.className = 'ds-dialog-body';
  if (options.content) {
    const items = Array.isArray(options.content) ? options.content : [options.content];
    append(body, ...items);
  }

  const content = document.createElement('div');
  content.className = 'ds-dialog-content';
  content.appendChild(body);

  const footer = document.createElement('div');
  footer.className = 'ds-dialog-footer';
  footer.hidden = !options.actions?.length;

  let resolveCurrent: ((value: string | null) => void) | null = null;
  let currentPromise: Promise<string | null> | null = null;
  let releaseScroll: (() => void) | null = null;
  let returnFocus: HTMLElement | null = null;
  let autofocusTarget: HTMLElement | null = null;
  let destroyed = false;
  const buttons: Array<{ destroy(): void }> = [];

  const finish = (value: string | null) => {
    if (!resolveCurrent) return;

    const resolve = resolveCurrent;
    resolveCurrent = null;
    currentPromise = null;
    const focusTarget = returnFocus;
    returnFocus = null;
    popTopLayer(ui, el);
    releaseScroll?.();
    releaseScroll = null;

    el.returnValue = '';
    resolve?.(value);
    focusIfConnected(focusTarget);
    options.onClose?.(value);
  };

  const close = (value: string | null = null) => {
    if (!resolveCurrent) return;
    if (el.open && typeof el.close === 'function') {
      el.close(value ?? '');
    } else {
      el.removeAttribute('open');
    }
    finish(value);
  };

  const dismiss = () => {
    if (options.dismissible === false) return;
    close(null);
  };

  if (options.dismissible !== false) {
    const closeButton = createButton(ui, {
      size: 'sm',
      variant: 'ghost',
      iconOnly: true,
      ariaLabel: options.closeLabel ?? ui.labels.close,
      icon: closeIcon(),
    });
    buttons.push(closeButton);
    closeButton.el.classList.add('ds-dialog-close');
    closeButton.el.addEventListener('click', dismiss, { signal: scope.signal });
    header.appendChild(closeButton.el);
  }

  for (const action of options.actions ?? []) {
    const button = createButton(ui, {
      label: action.label,
      variant: action.variant ?? 'secondary',
    });
    buttons.push(button);
    button.el.addEventListener('click', () => close(action.value), { signal: scope.signal });
    // Stored instead of applied as an `autofocus` attribute: a dialog rendered
    // outside a modal (for example in a component gallery) would otherwise grab
    // focus, and scroll the page, as soon as it became visible.
    if (action.autofocus) autofocusTarget = button.el;
    footer.appendChild(button.el);
  }

  el.append(header, content, footer);

  const hintOptions = resolveScrollHint(options.scrollHint);
  const hint: ScrollHintHandle | null = hintOptions
    ? createScrollHint(ui, content, body, hintOptions)
    : null;

  el.addEventListener(
    'cancel',
    (event) => {
      event.preventDefault();
      dismiss();
    },
    { signal: scope.signal },
  );

  el.addEventListener(
    'close',
    () => {
      // Only a dialog that actually closed settles the result. A stale event
      // left behind by reopening from `onClose` finds `el.open === true`, and
      // `finish` is idempotent for the case where `close()` already settled.
      if (!el.open) finish(el.returnValue || null);
    },
    { signal: scope.signal },
  );

  el.addEventListener(
    'click',
    (event) => {
      if (event.target !== el) return;
      const rect = el.getBoundingClientRect();
      if (
        event.clientX < Math.floor(rect.left) ||
        event.clientX > Math.ceil(rect.right) ||
        event.clientY < Math.floor(rect.top) ||
        event.clientY > Math.ceil(rect.bottom)
      )
        dismiss();
    },
    { signal: scope.signal },
  );

  el.addEventListener(
    'wheel',
    (event) => {
      if (event.target === el) event.preventDefault();
    },
    { passive: false, signal: scope.signal },
  );

  ui.container.appendChild(el);

  const open = (): Promise<string | null> => {
    if (destroyed) return Promise.resolve(null);
    if (currentPromise) return currentPromise;

    returnFocus =
      (ui.root.activeElement as HTMLElement | null) ??
      (document.activeElement as HTMLElement | null);

    el.returnValue = '';
    releaseScroll = lockPageScroll();
    // Promise.withResolvers is unavailable in the supported Chrome 111 baseline.
    const promise = new Promise<string | null>((resolve) => {
      resolveCurrent = resolve;
    });
    currentPromise = promise;

    if (typeof el.showModal === 'function') {
      try {
        el.showModal();
      } catch (error) {
        resolveCurrent = null;
        currentPromise = null;
        releaseScroll?.();
        releaseScroll = null;
        returnFocus = null;
        throw error;
      }
      pushTopLayer(ui, el);
    } else {
      el.setAttribute('open', '');
    }

    if (autofocusTarget?.isConnected) autofocusTarget.focus({ preventScroll: true });
    else focusFirst(body);

    hint?.update();
    options.onOpen?.();
    return promise;
  };

  const teardown = () => {
    if (destroyed) return;
    destroyed = true;
    try {
      close();
    } finally {
      scope.destroy();
      hint?.destroy();
      for (const button of buttons) button.destroy();
      el.remove();
    }
  };
  scope.onDestroy(teardown);

  return { el, open, close, destroy: teardown };
}

export async function confirmDialog(ui: UI, options: ConfirmDialogOptions): Promise<boolean> {
  const dialog = createDialog(ui, {
    title: options.title,
    description: options.description,
    dismissible: options.dismissible ?? true,
    actions: [
      {
        label: options.cancelLabel ?? ui.labels.cancel,
        value: 'cancel',
        variant: 'secondary',
        autofocus: true,
      },
      {
        label: options.confirmLabel ?? ui.labels.confirm,
        value: 'confirm',
        variant: options.destructive ? 'destructive' : 'primary',
      },
    ],
  });

  const result = await dialog.open();
  dialog.destroy();
  return result === 'confirm';
}
