import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCheckbox,
  createField,
  createInput,
  createSelect,
  createSwitch,
  createTextarea,
  mountUI,
  type UI,
} from '../../src/index';

let ui: UI;

beforeEach(() => {
  ui = mountUI();
});

afterEach(() => {
  ui.destroy();
});

describe('Input', () => {
  it('forwards native attributes and value changes', () => {
    const onInput = vi.fn();
    const input = createInput(ui, {
      type: 'email',
      value: 'a@example.com',
      placeholder: 'you@example.com',
      name: 'email',
      onInput,
    });

    expect(input.el.type).toBe('email');
    expect(input.el.name).toBe('email');
    expect(input.el.placeholder).toBe('you@example.com');
    expect(input.getValue()).toBe('a@example.com');

    input.el.value = 'b@example.com';
    input.el.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onInput).toHaveBeenCalledWith('b@example.com', expect.any(Event));
  });

  it('toggles the invalid state', () => {
    const input = createInput(ui, {});

    input.setInvalid(true);
    expect(input.input.getAttribute('aria-invalid')).toBe('true');

    input.setInvalid(false);
    expect(input.input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('creates a styled native textarea', () => {
    const textarea = createTextarea(ui, { value: 'hello', rows: 4 });

    expect(textarea.el.tagName).toBe('TEXTAREA');
    expect(textarea.el.className).toBe('ds-textarea');
    expect(Number(textarea.el.rows)).toBe(4);
    expect(textarea.getValue()).toBe('hello');
  });
});

describe('Select', () => {
  it('renders options and emits changes', () => {
    const onChange = vi.fn();
    const select = createSelect(ui, {
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ],
      value: 'b',
      onChange,
    });

    expect(select.input.value).toBe('b');
    expect(select.input.options).toHaveLength(2);

    select.input.value = 'a';
    select.input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange).toHaveBeenCalledWith('a', expect.any(Event));
  });

  it('supports a placeholder and replacing options', () => {
    const select = createSelect(ui, {
      placeholder: 'Choose one',
      options: [{ value: 'a', label: 'Alpha' }],
    });

    expect(select.input.value).toBe('');
    expect(select.input.options[0]?.disabled).toBe(true);

    select.setOptions([
      { value: 'b', label: 'Beta' },
      { value: 'c', label: 'Gamma' },
    ]);
    select.setValue('c');

    expect(select.getValue()).toBe('c');
    expect(select.input.options).toHaveLength(3);
  });

  it('accepts and preserves an explicit empty-string option value', () => {
    const onChange = vi.fn();
    const select = createSelect(ui, {
      options: [
        { value: 'a', label: 'Alpha' },
        { value: '', label: 'None' },
      ],
      value: '',
      onChange,
    });

    expect(select.getValue()).toBe('');
    expect(select.input.selectedIndex).toBe(1);

    select.setOptions([
      { value: 'b', label: 'Beta' },
      { value: '', label: 'None' },
    ]);

    expect(select.getValue()).toBe('');
    expect(select.input.selectedIndex).toBe(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('占位项与真实空值项并存时，真实空值项仍然可选', () => {
    const select = createSelect(ui, {
      placeholder: 'Choose one',
      options: [
        { value: 'a', label: 'Alpha' },
        { value: '', label: 'None' },
      ],
    });

    // 不加占位项：它的 value 会占住 ''，真实选项就永远选不到。
    expect(select.input.options).toHaveLength(2);
    select.setValue('');
    expect(select.input.selectedIndex).toBe(1);
    expect(select.input.options[1]?.textContent).toBe('None');
  });

  it('never selects a disabled initial value', () => {
    const select = createSelect(ui, {
      options: [
        { value: 'a', label: 'Alpha', disabled: true },
        { value: 'b', label: 'Beta' },
      ],
      value: 'a',
    });

    expect(select.getValue()).toBe('b');

    select.setOptions([
      { value: 'x', label: 'X', disabled: true },
      { value: 'y', label: 'Y' },
    ]);
    expect(select.getValue()).toBe('y');

    const none = createSelect(ui, {
      options: [{ value: 'a', label: 'Alpha', disabled: true }],
    });
    expect(none.getValue()).toBe('');
  });

  it('does not treat a disabled empty option as the omitted placeholder', () => {
    const select = createSelect(ui, {
      placeholder: 'Choose one',
      value: '',
      options: [
        { value: '', label: 'Unavailable', disabled: true },
        { value: 'a', label: 'Alpha' },
      ],
    });

    expect(select.getValue()).toBe('a');
    select.setValue('');
    expect(select.getValue()).toBe('a');

    select.setOptions([
      { value: '', label: 'Unavailable', disabled: true },
      { value: 'b', label: 'Beta' },
    ]);
    expect(select.getValue()).toBe('b');
    select.setOptions([{ value: '', label: 'Unavailable', disabled: true }]);
    expect(select.input.selectedIndex).toBe(-1);

    select.setOptions([{ value: 'c', label: 'Gamma' }]);
    expect(select.input.selectedIndex).toBe(0);
    expect(select.input.options[0]?.disabled).toBe(true);
  });

  it('can reset a selection to the placeholder without emitting a change', () => {
    const onChange = vi.fn();
    const select = createSelect(ui, {
      placeholder: 'Choose one',
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'disabled', label: 'Unavailable', disabled: true },
      ],
      onChange,
    });

    select.setValue('a');
    expect(select.getValue()).toBe('a');

    select.setValue('');
    expect(select.getValue()).toBe('');
    expect(select.input.selectedIndex).toBe(0);
    expect(select.input.validity.valid).toBe(true);

    select.input.required = true;
    expect(select.input.validity.valueMissing).toBe(true);

    select.setValue('a');
    select.setValue('disabled');
    select.setValue('missing');
    expect(select.getValue()).toBe('a');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Switch', () => {
  it('uses a native checkbox with switch semantics', () => {
    const onChange = vi.fn();
    const control = createSwitch(ui, { checked: false, onChange });

    expect(control.input.type).toBe('checkbox');
    expect(control.input.getAttribute('role')).toBe('switch');
    expect(control.input.getAttribute('aria-checked')).toBe('false');

    control.input.checked = true;
    control.input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(control.isChecked()).toBe(true);
    expect(control.input.getAttribute('aria-checked')).toBe('true');
    expect(onChange).toHaveBeenCalledWith(true, expect.any(Event));

    control.setChecked(false);
    expect(control.input.getAttribute('aria-checked')).toBe('false');
  });
});

describe('Checkbox', () => {
  it('supports checked and indeterminate states', () => {
    const onChange = vi.fn();
    const control = createCheckbox(ui, {
      checked: true,
      indeterminate: true,
      onChange,
    });

    expect(control.isChecked()).toBe(true);
    expect(control.input.indeterminate).toBe(true);
    expect(control.input.getAttribute('aria-checked')).toBe('mixed');

    control.setIndeterminate(false);
    expect(control.input.indeterminate).toBe(false);
    expect(control.input.hasAttribute('aria-checked')).toBe(false);

    control.input.checked = false;
    control.input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(control.isChecked()).toBe(false);
    expect(onChange).toHaveBeenCalledWith(false, expect.any(Event));
  });

  it('clears the mixed ARIA state before notifying a native click change', () => {
    const onChange = vi.fn(() => {
      expect(control.input.indeterminate).toBe(false);
      expect(control.input.hasAttribute('aria-checked')).toBe(false);
    });
    const control = createCheckbox(ui, { indeterminate: true, onChange });
    ui.layers.base.appendChild(control.el);

    control.input.click();

    expect(control.isChecked()).toBe(true);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true, expect.any(Event));

    control.setIndeterminate(true);
    control.input.click();

    expect(control.isChecked()).toBe(false);
    expect(control.input.hasAttribute('aria-checked')).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('clears the mixed state when setChecked is used', () => {
    const control = createCheckbox(ui, { indeterminate: true });

    control.setChecked(true);

    expect(control.isChecked()).toBe(true);
    expect(control.input.indeterminate).toBe(false);
    expect(control.input.hasAttribute('aria-checked')).toBe(false);
  });

  it('preserves an explicit empty value for native form submission', () => {
    const control = createCheckbox(ui, { checked: true, name: 'choice', value: '' });
    const form = document.createElement('form');
    form.appendChild(control.el);
    ui.layers.base.appendChild(form);

    expect(control.input.value).toBe('');
    expect(new FormData(form).get('choice')).toBe('');
    expect(createCheckbox(ui).input.value).toBe('on');
  });
});

describe('Field', () => {
  it('links the label, description, and error to the control', () => {
    const input = createInput(ui, {});
    const field = createField(ui, {
      label: 'API 地址',
      description: '留空时使用默认值。',
      control: input,
    });

    const label = field.el.querySelector('label');
    expect(label?.htmlFor).toBe(input.input.id);
    expect(label?.textContent).toBe('API 地址');

    const describedBy = input.input.getAttribute('aria-describedby') ?? '';
    expect(describedBy).toContain('ds-field-description');
    expect(input.input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('shows and clears validation errors', () => {
    const input = createInput(ui, {});
    const field = createField(ui, { label: '名称', control: input });

    field.setError('必填');
    expect(field.el.hasAttribute('data-invalid')).toBe(true);
    expect(field.el.querySelector('.ds-field-error')?.textContent).toBe('必填');
    expect(input.input.getAttribute('aria-invalid')).toBe('true');

    field.setError(undefined);
    expect(field.el.hasAttribute('data-invalid')).toBe(false);
    expect(field.el.querySelector('.ds-field-error')?.hasAttribute('hidden')).toBe(true);
    expect(input.input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('uses an inline layout for rows such as switches', () => {
    const control = createSwitch(ui, {});
    const field = createField(ui, {
      label: '启用',
      description: '立即生效',
      control,
      inline: true,
    });

    expect(field.el.className).toContain('ds-field--inline');
    expect(field.control).toBe(control.el);
  });

  it('attaches descriptions added after creating an unlabeled field', () => {
    const input = createInput(ui, { ariaLabel: 'Name' });
    const field = createField(ui, { control: input });
    ui.layers.base.appendChild(field.el);

    field.setDescription('Added later');

    const description = field.el.querySelector<HTMLElement>('.ds-field-description');
    expect(description?.textContent).toBe('Added later');
    expect(description?.hidden).toBe(false);
    expect(description?.parentElement?.hidden).toBe(false);
    expect(input.input.getAttribute('aria-describedby')).toBe(description?.id);

    field.setDescription();

    expect(description?.hidden).toBe(true);
    expect(description?.parentElement?.hidden).toBe(true);
    expect(input.input.hasAttribute('aria-describedby')).toBe(false);
  });

  it('updates only its own description IDs and preserves initial invalid state', () => {
    const input = createInput(ui, { invalid: true });
    input.input.setAttribute('aria-describedby', 'initial-help');
    const field = createField(ui, { label: 'Name', control: input, description: 'Help' });
    const descriptionId = field.el.querySelector('.ds-field-description')!.id;
    const errorId = field.el.querySelector('.ds-field-error')!.id;

    input.input.setAttribute('aria-describedby', `${descriptionId} external-help`);
    field.setError('Required');

    expect(input.input.getAttribute('aria-describedby')?.split(/\s+/)).toEqual(
      expect.arrayContaining([descriptionId, errorId, 'external-help']),
    );
    expect(input.input.getAttribute('aria-describedby')).not.toContain('initial-help');

    field.setDescription();
    field.setError();

    expect(input.input.getAttribute('aria-describedby')).toBe('external-help');
    expect(input.input.getAttribute('aria-invalid')).toBe('true');
    expect(field.el.hasAttribute('data-invalid')).toBe(false);
  });
});

describe('Form control lifecycle', () => {
  it.each(['input', 'textarea', 'select', 'checkbox', 'switch'] as const)(
    'keeps programmatic %s updates silent and removes callbacks on UI destruction',
    (kind) => {
      const onChange = vi.fn();
      const onInput = vi.fn();
      const control =
        kind === 'input'
          ? createInput(ui, { onChange, onInput })
          : kind === 'textarea'
            ? createTextarea(ui, { onChange, onInput })
            : kind === 'select'
              ? createSelect(ui, {
                  options: [{ value: 'next', label: 'Next' }],
                  onChange,
                })
              : kind === 'checkbox'
                ? createCheckbox(ui, { onChange })
                : createSwitch(ui, { onChange });
      ui.layers.base.appendChild(control.el);

      if ('setValue' in control) control.setValue('next');
      else control.setChecked(true);

      expect(onChange).not.toHaveBeenCalled();
      expect(onInput).not.toHaveBeenCalled();

      control.input.dispatchEvent(new Event('change', { bubbles: true }));
      control.input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(onChange).toHaveBeenCalledExactlyOnceWith(
        kind === 'checkbox' || kind === 'switch' ? true : 'next',
        expect.any(Event),
      );
      expect(onInput).toHaveBeenCalledTimes(kind === 'input' || kind === 'textarea' ? 1 : 0);

      onChange.mockClear();
      onInput.mockClear();
      ui.destroy();
      control.input.dispatchEvent(new Event('change', { bubbles: true }));
      control.input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(onChange).not.toHaveBeenCalled();
      expect(onInput).not.toHaveBeenCalled();
    },
  );
});
