import type { FormControl } from '../core/form';
import { applyInvalid } from '../core/form';
import { assertAlive, createScope } from '../core/lifecycle';
import type { UI } from '../core/mount';
import inputCss from './input.css?inline';

export type InputType = 'text' | 'email' | 'password' | 'number' | 'search' | 'url' | 'tel';

export interface InputOptions {
  type?: InputType;
  value?: string;
  placeholder?: string;
  name?: string;
  id?: string;
  disabled?: boolean;
  readonly?: boolean;
  required?: boolean;
  invalid?: boolean;
  autocomplete?: HTMLInputElement['autocomplete'];
  inputMode?: 'text' | 'numeric' | 'decimal' | 'email' | 'url' | 'search' | 'tel';
  min?: number | string;
  max?: number | string;
  step?: number | string;
  ariaLabel?: string;
  onInput?: (value: string, event: Event) => void;
  onChange?: (value: string, event: Event) => void;
}

export interface InputHandle extends FormControl<HTMLInputElement, HTMLInputElement> {
  setValue(value: string): void;
  getValue(): string;
  setInvalid(invalid: boolean): void;
  destroy(): void;
}

export interface TextareaOptions {
  value?: string;
  placeholder?: string;
  name?: string;
  id?: string;
  rows?: number;
  disabled?: boolean;
  readonly?: boolean;
  required?: boolean;
  invalid?: boolean;
  ariaLabel?: string;
  onInput?: (value: string, event: Event) => void;
  onChange?: (value: string, event: Event) => void;
}

export interface TextareaHandle extends FormControl<HTMLTextAreaElement, HTMLTextAreaElement> {
  setValue(value: string): void;
  getValue(): string;
  setInvalid(invalid: boolean): void;
  destroy(): void;
}

/**
 * `data-ds-invalid` mirrors the control's own invalid state so a Field can add
 * a validation error without owning — or clearing — the control's state.
 */
export function createInput(ui: UI, options: InputOptions = {}): InputHandle {
  assertAlive(ui, 'input');
  ui.useStyles(inputCss);

  const scope = createScope(ui);
  const input = document.createElement('input');
  input.className = 'ds-input';
  input.type = options.type ?? 'text';
  if (options.value != null) input.value = options.value;
  if (options.placeholder) input.placeholder = options.placeholder;
  if (options.name) input.name = options.name;
  if (options.id) input.id = options.id;
  if (options.disabled) input.disabled = true;
  if (options.readonly) input.readOnly = true;
  if (options.required) input.required = true;
  if (options.autocomplete) input.autocomplete = options.autocomplete;
  if (options.inputMode) input.inputMode = options.inputMode;
  if (options.min != null) input.min = String(options.min);
  if (options.max != null) input.max = String(options.max);
  if (options.step != null) input.step = String(options.step);
  if (options.ariaLabel) input.setAttribute('aria-label', options.ariaLabel);

  const setInvalid = (invalid: boolean) => applyInvalid(input, invalid);
  if (options.invalid) setInvalid(true);

  if (options.onInput) {
    input.addEventListener('input', (event) => options.onInput?.(input.value, event), {
      signal: scope.signal,
    });
  }
  if (options.onChange) {
    input.addEventListener('change', (event) => options.onChange?.(input.value, event), {
      signal: scope.signal,
    });
  }

  return {
    el: input,
    input,
    setValue(value) {
      input.value = value;
    },
    getValue() {
      return input.value;
    },
    setInvalid,
    destroy() {
      scope.destroy();
      input.remove();
    },
  };
}

export function createTextarea(ui: UI, options: TextareaOptions = {}): TextareaHandle {
  assertAlive(ui, 'textarea');
  ui.useStyles(inputCss);

  const scope = createScope(ui);
  const textarea = document.createElement('textarea');
  textarea.className = 'ds-textarea';
  if (options.value != null) textarea.value = options.value;
  if (options.placeholder) textarea.placeholder = options.placeholder;
  if (options.name) textarea.name = options.name;
  if (options.id) textarea.id = options.id;
  if (options.rows != null) textarea.rows = options.rows;
  if (options.disabled) textarea.disabled = true;
  if (options.readonly) textarea.readOnly = true;
  if (options.required) textarea.required = true;
  if (options.ariaLabel) textarea.setAttribute('aria-label', options.ariaLabel);

  const setInvalid = (invalid: boolean) => applyInvalid(textarea, invalid);
  if (options.invalid) setInvalid(true);

  if (options.onInput) {
    textarea.addEventListener('input', (event) => options.onInput?.(textarea.value, event), {
      signal: scope.signal,
    });
  }
  if (options.onChange) {
    textarea.addEventListener('change', (event) => options.onChange?.(textarea.value, event), {
      signal: scope.signal,
    });
  }

  return {
    el: textarea,
    input: textarea,
    setValue(value) {
      textarea.value = value;
    },
    getValue() {
      return textarea.value;
    },
    setInvalid,
    destroy() {
      scope.destroy();
      textarea.remove();
    },
  };
}
