import { setFieldInvalid, type FormControl } from '../core/form';
import { assertAlive, createScope } from '../core/lifecycle';
import { uid } from '../core/id';
import type { UI } from '../core/mount';
import fieldCss from './field.css?inline';

export interface FieldOptions {
  label?: string;
  description?: string;
  error?: string;
  control: FormControl;
  inline?: boolean;
  id?: string;
}

export interface FieldHandle {
  el: HTMLElement;
  control: HTMLElement;
  setError(message?: string): void;
  setDescription(message?: string): void;
  destroy(): void;
}

export function createField(ui: UI, options: FieldOptions): FieldHandle {
  assertAlive(ui, 'field');
  ui.useStyles(fieldCss);

  const scope = createScope(ui);
  const input = options.control.input;
  if (!input.id) input.id = options.id ?? uid('ds-control');

  const root = document.createElement('div');
  root.className = options.inline ? 'ds-field ds-field--inline' : 'ds-field';
  root.setAttribute('data-ds-field', '');

  const text = document.createElement('div');
  text.className = 'ds-field-text';

  const label = document.createElement('label');
  label.className = 'ds-field-label';
  label.htmlFor = input.id;
  label.textContent = options.label ?? '';
  label.hidden = !options.label;
  text.appendChild(label);

  const descriptionId = uid('ds-field-description');
  const description = document.createElement('p');
  description.className = 'ds-field-description';
  description.id = descriptionId;
  description.textContent = options.description ?? '';
  description.hidden = !options.description;
  text.appendChild(description);

  text.hidden = !options.label && !options.description;
  root.appendChild(text);

  const control = document.createElement('div');
  control.className = 'ds-field-control';
  control.appendChild(options.control.el);
  root.appendChild(control);

  const errorId = uid('ds-field-error');
  const error = document.createElement('p');
  error.className = 'ds-field-error';
  error.id = errorId;
  error.setAttribute('role', 'alert');
  error.hidden = true;
  root.appendChild(error);

  const syncDescribedBy = () => {
    const ids = new Set(
      (input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean),
    );
    ids.delete(descriptionId);
    ids.delete(errorId);
    if (!description.hidden) ids.add(descriptionId);
    if (!error.hidden) ids.add(errorId);
    if (ids.size) input.setAttribute('aria-describedby', [...ids].join(' '));
    else input.removeAttribute('aria-describedby');
  };

  // The control owns its invalid state; the field only adds its error flag on
  // top of it, and both sides share one derived `aria-invalid`.
  const syncInvalid = () => setFieldInvalid(input, !error.hidden);

  const setError = (message?: string) => {
    const hasError = Boolean(message);
    error.textContent = message ?? '';
    error.hidden = !hasError;
    root.toggleAttribute('data-invalid', hasError);
    syncInvalid();
    syncDescribedBy();
  };

  const setDescription = (message?: string) => {
    description.textContent = message ?? '';
    description.hidden = !message;
    text.hidden = label.hidden && description.hidden;
    syncDescribedBy();
  };

  // Adopt an invalid state that was set before the field existed, then make it
  // explicit so clearing a latter field error does not erase it.
  if (input.getAttribute('aria-invalid') === 'true') {
    input.setAttribute('data-ds-invalid', '');
  }
  if (options.error) setError(options.error);
  else {
    syncInvalid();
    syncDescribedBy();
  }

  return {
    el: root,
    control: options.control.el,
    setError,
    setDescription,
    destroy() {
      // Remove only the field's own contribution so a reused control keeps its
      // own invalid state and any external aria-describedby references.
      description.hidden = true;
      error.hidden = true;
      syncDescribedBy();
      setFieldInvalid(input, false);
      scope.destroy();
      root.remove();
    },
  };
}
