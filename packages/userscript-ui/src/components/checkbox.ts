import type { FormControl } from '../core/form';
import { assertAlive, createScope } from '../core/lifecycle';
import type { UI } from '../core/mount';
import checkboxCss from './checkbox.css?inline';

export interface CheckboxOptions {
  checked?: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  name?: string;
  value?: string;
  id?: string;
  ariaLabel?: string;
  onChange?: (checked: boolean, event: Event) => void;
}

export interface CheckboxHandle extends FormControl<HTMLSpanElement, HTMLInputElement> {
  setChecked(checked: boolean): void;
  setIndeterminate(indeterminate: boolean): void;
  isChecked(): boolean;
  destroy(): void;
}

export function createCheckbox(ui: UI, options: CheckboxOptions = {}): CheckboxHandle {
  assertAlive(ui, 'checkbox');
  ui.useStyles(checkboxCss);

  const scope = createScope(ui);
  const root = document.createElement('span');
  root.className = 'ds-checkbox';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'ds-checkbox-input';
  input.checked = options.checked ?? false;
  if (options.name) input.name = options.name;
  if (options.value != null) input.value = options.value;
  if (options.id) input.id = options.id;
  if (options.disabled) input.disabled = true;
  if (options.ariaLabel) input.setAttribute('aria-label', options.ariaLabel);

  const box = document.createElement('span');
  box.className = 'ds-checkbox-box';
  box.setAttribute('aria-hidden', 'true');

  root.append(input, box);

  const applyIndeterminate = (indeterminate: boolean) => {
    input.indeterminate = indeterminate;
    if (indeterminate) input.setAttribute('aria-checked', 'mixed');
    else input.removeAttribute('aria-checked');
  };
  applyIndeterminate(options.indeterminate ?? false);

  input.addEventListener(
    'change',
    (event) => {
      applyIndeterminate(false);
      options.onChange?.(input.checked, event);
    },
    { signal: scope.signal },
  );

  return {
    el: root,
    input,
    setChecked(checked) {
      applyIndeterminate(false);
      input.checked = checked;
    },
    setIndeterminate(indeterminate) {
      applyIndeterminate(indeterminate);
    },
    isChecked() {
      return input.checked;
    },
    destroy() {
      scope.destroy();
      root.remove();
    },
  };
}
