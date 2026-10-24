import type { UI } from '../core/mount';
import type { Content } from '../core/dom';
import { assertAlive, createScope } from '../core/lifecycle';
import buttonCss from './button.css?inline';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonOptions {
  label?: string | Node;
  variant?: ButtonVariant;
  size?: ButtonSize;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  loading?: boolean;
  icon?: Element;
  iconOnly?: boolean;
  ariaLabel?: string;
  title?: string;
  onClick?: (event: MouseEvent) => void;
}

export interface ButtonHandle {
  el: HTMLButtonElement;
  setLoading(loading: boolean): void;
  setDisabled(disabled: boolean): void;
  destroy(): void;
}

export function createButton(ui: UI, options: ButtonOptions = {}): ButtonHandle {
  assertAlive(ui, 'button');
  const iconOnly = options.size === 'icon' || options.iconOnly === true;
  const variant = options.variant ?? 'primary';
  const size = options.size ?? 'md';

  if (iconOnly && !options.ariaLabel) {
    throw new Error('Icon-only buttons require an ariaLabel.');
  }
  if (
    !iconOnly &&
    (options.label == null || (typeof options.label === 'string' && options.label.trim() === ''))
  ) {
    throw new Error('Buttons require a label.');
  }

  // 校验放在注册 scope 与挂样式之前：非法调用不该留下一个永不使用的清理回调。
  const scope = createScope(ui);
  ui.useStyles(buttonCss);

  const el = document.createElement('button');
  el.type = options.type ?? 'button';
  el.className = `ds-button ds-button--${variant} ds-button--${size}`;
  if (iconOnly) el.classList.add('ds-button--icon');
  el.setAttribute('data-ds-button', '');
  if (options.ariaLabel) el.setAttribute('aria-label', options.ariaLabel);
  if (options.title) el.title = options.title;

  const spinner = document.createElement('span');
  spinner.className = 'ds-button-spinner';
  spinner.setAttribute('aria-hidden', 'true');

  if (options.icon) {
    options.icon.classList.add('ds-button-icon');
    el.appendChild(options.icon);
  }

  if (options.label != null) {
    const label = document.createElement('span');
    label.className = 'ds-button-label';
    appendContent(label, options.label);
    el.appendChild(label);
  }

  let disabled = options.disabled ?? false;
  let loading = options.loading ?? false;

  const sync = () => {
    el.disabled = disabled || loading;
    el.dataset.loading = loading ? 'true' : 'false';

    if (loading) {
      el.setAttribute('aria-busy', 'true');
      el.setAttribute('aria-disabled', 'true');
      if (!spinner.isConnected) el.prepend(spinner);
    } else {
      el.removeAttribute('aria-busy');
      el.removeAttribute('aria-disabled');
      spinner.remove();
    }
  };

  if (options.onClick) {
    el.addEventListener('click', options.onClick, { signal: scope.signal });
  }

  sync();

  return {
    el,
    setLoading(next) {
      loading = next;
      sync();
    },
    setDisabled(next) {
      disabled = next;
      sync();
    },
    destroy() {
      scope.destroy();
      el.remove();
    },
  };
}

function appendContent(parent: Node, content: Content): void {
  if (typeof content === 'string') {
    parent.textContent = content;
  } else if (content) {
    parent.appendChild(content);
  }
}
