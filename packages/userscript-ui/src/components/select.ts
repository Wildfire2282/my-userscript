import { applyInvalid, type FormControl } from '../core/form';
import { chevronDownIcon } from '../icons';
import { assertAlive, createScope } from '../core/lifecycle';
import type { UI } from '../core/mount';
import selectCss from './select.css?inline';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectOptions {
  options: SelectOption[];
  value?: string;
  placeholder?: string;
  name?: string;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  ariaLabel?: string;
  onChange?: (value: string, event: Event) => void;
}

export interface SelectHandle extends FormControl<HTMLElement, HTMLSelectElement> {
  setValue(value: string): void;
  getValue(): string;
  setOptions(options: SelectOption[]): void;
  setInvalid(invalid: boolean): void;
  destroy(): void;
}

export function createSelect(ui: UI, options: SelectOptions): SelectHandle {
  assertAlive(ui, 'select');
  ui.useStyles(selectCss);

  const scope = createScope(ui);
  const wrap = document.createElement('span');
  wrap.className = 'ds-select-wrap';

  const select = document.createElement('select');
  select.className = 'ds-select';
  if (options.name) select.name = options.name;
  if (options.id) select.id = options.id;
  if (options.disabled) select.disabled = true;
  if (options.required) select.required = true;
  if (options.ariaLabel) select.setAttribute('aria-label', options.ariaLabel);

  const chevron = chevronDownIcon();
  chevron.classList.add('ds-select-chevron');
  let placeholderOption: HTMLOptionElement | null = null;

  const renderOptions = (next: SelectOption[]) => {
    select.replaceChildren();
    placeholderOption = null;

    // 占位项占着 `value=''`：选项里已有真实的空值项时再加占位项，
    // 那个真实选项就永远选不到了。
    if (options.placeholder && !next.some((item) => item.value === '')) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = options.placeholder;
      placeholder.disabled = true;
      select.appendChild(placeholder);
      placeholderOption = placeholder;
    }

    for (const item of next) {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      if (item.disabled) option.disabled = true;
      select.appendChild(option);
    }
  };

  renderOptions(options.options);

  const selectFirstEnabled = (items: SelectOption[]) => {
    const first = items.find((item) => !item.disabled);
    if (first) select.value = first.value;
    else select.selectedIndex = -1;
  };

  const requested = options.value;
  if (
    requested != null &&
    options.options.some((item) => item.value === requested && !item.disabled)
  ) {
    select.value = requested;
  } else if (placeholderOption) {
    select.value = '';
  } else {
    selectFirstEnabled(options.options);
  }

  wrap.append(select, chevron);

  const setInvalid = (invalid: boolean) => applyInvalid(select, invalid);
  if (options.invalid) setInvalid(true);

  if (options.onChange) {
    select.addEventListener('change', (event) => options.onChange?.(select.value, event), {
      signal: scope.signal,
    });
  }

  return {
    el: wrap,
    input: select,
    setValue(value) {
      if (
        (value === '' && placeholderOption) ||
        [...select.options].some((option) => option.value === value && !option.disabled)
      ) {
        select.value = value;
      }
    },
    getValue() {
      return select.value;
    },
    setOptions(next) {
      const current = select.value;
      renderOptions(next);
      if ([...select.options].some((option) => option.value === current && !option.disabled)) {
        select.value = current;
      } else if (placeholderOption) {
        select.value = '';
      } else {
        selectFirstEnabled(next);
      }
    },
    setInvalid,
    destroy() {
      scope.destroy();
      wrap.remove();
    },
  };
}
