import { append, type Content } from '../core/dom';
import { assertAlive, createScope } from '../core/lifecycle';
import type { UI } from '../core/mount';
import { closeIcon } from '../icons';
import { createButton } from './button';
import alertCss from './alert.css?inline';
import { feedbackIcon, feedbackRole, type FeedbackVariant } from './feedback';

export interface AlertOptions {
  variant?: FeedbackVariant;
  title?: string;
  description?: string;
  action?: Content | Content[];
  dismissible?: boolean;
  dismissLabel?: string;
  onDismiss?: () => void;
}

export interface AlertHandle {
  el: HTMLElement;
  /** User-initiated removal: runs `onDismiss`. */
  dismiss(): void;
  /** Teardown: removes the alert without running `onDismiss`. */
  destroy(): void;
}

export function createAlert(ui: UI, options: AlertOptions = {}): AlertHandle {
  assertAlive(ui, 'alert');
  ui.useStyles(alertCss);

  const scope = createScope(ui);

  const variant = options.variant ?? 'info';
  const el = document.createElement('div');
  el.className = `ds-alert ds-alert--${variant}`;
  el.setAttribute('data-ds-alert', '');
  scope.onDestroy(() => el.remove());

  const role = feedbackRole(variant);
  if (role) {
    el.setAttribute('role', role);
    el.setAttribute('aria-atomic', 'true');
  }

  const iconWrap = document.createElement('span');
  iconWrap.className = 'ds-alert-icon';
  iconWrap.setAttribute('aria-hidden', 'true');
  iconWrap.appendChild(feedbackIcon(variant));

  const content = document.createElement('div');
  content.className = 'ds-alert-content';

  if (options.title) {
    const title = document.createElement('p');
    title.className = 'ds-alert-title';
    title.textContent = options.title;
    content.appendChild(title);
  }

  if (options.description) {
    const description = document.createElement('p');
    description.className = 'ds-alert-description';
    description.textContent = options.description;
    content.appendChild(description);
  }

  if (options.action) {
    const action = document.createElement('div');
    action.className = 'ds-alert-action';
    const items = Array.isArray(options.action) ? options.action : [options.action];
    append(action, ...items);
    content.appendChild(action);
  }

  el.append(iconWrap, content);

  let settled = false;

  if (options.dismissible) {
    const close = createButton(ui, {
      size: 'sm',
      variant: 'ghost',
      iconOnly: true,
      ariaLabel: options.dismissLabel ?? ui.labels.close,
      icon: closeIcon(),
    });
    close.el.classList.add('ds-alert-close');
    close.el.addEventListener('click', () => dismiss(), { signal: scope.signal });
    scope.onDestroy(() => close.destroy());
    el.appendChild(close.el);
  }

  const dismiss = () => {
    if (settled || scope.destroyed) return;
    settled = true;
    scope.destroy();
    options.onDismiss?.();
  };

  return {
    el,
    dismiss,
    destroy() {
      if (settled) return;
      settled = true;
      scope.destroy();
    },
  };
}
