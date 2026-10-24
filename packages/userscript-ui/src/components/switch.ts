import type { FormControl } from '../core/form';
import { assertAlive, createScope } from '../core/lifecycle';
import type { UI } from '../core/mount';
import switchCss from './switch.css?inline';

export interface SwitchOptions {
  checked?: boolean;
  disabled?: boolean;
  name?: string;
  id?: string;
  ariaLabel?: string;
  onChange?: (checked: boolean, event: Event) => void;
}

export interface SwitchHandle extends FormControl<HTMLSpanElement, HTMLInputElement> {
  setChecked(checked: boolean): void;
  isChecked(): boolean;
  destroy(): void;
}

export function createSwitch(ui: UI, options: SwitchOptions = {}): SwitchHandle {
  assertAlive(ui, 'switch');
  ui.useStyles(switchCss);

  const scope = createScope(ui);
  const root = document.createElement('span');
  root.className = 'ds-switch';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'ds-switch-input';
  input.setAttribute('role', 'switch');
  input.checked = options.checked ?? false;
  input.setAttribute('aria-checked', String(input.checked));
  if (options.name) input.name = options.name;
  if (options.id) input.id = options.id;
  if (options.disabled) input.disabled = true;
  if (options.ariaLabel) input.setAttribute('aria-label', options.ariaLabel);

  const track = document.createElement('span');
  track.className = 'ds-switch-track';
  track.setAttribute('aria-hidden', 'true');

  const thumb = document.createElement('span');
  thumb.className = 'ds-switch-thumb';
  track.appendChild(thumb);

  root.append(input, track);

  input.addEventListener(
    'change',
    (event) => {
      input.setAttribute('aria-checked', String(input.checked));
      options.onChange?.(input.checked, event);
    },
    { signal: scope.signal },
  );

  return {
    el: root,
    input,
    setChecked(checked) {
      input.checked = checked;
      input.setAttribute('aria-checked', String(checked));
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
