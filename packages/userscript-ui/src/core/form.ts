/**
 * The element to place in a Field plus the native control that receives the
 * label and ARIA attributes. For Switch and Checkbox these differ.
 */
export interface FormControl<E extends HTMLElement = HTMLElement, I extends HTMLElement = E> {
  readonly el: E;
  readonly input: I;
  /** 组件的清理入口；自定义控件可以不提供。 */
  readonly destroy?: () => void;
}

/**
 * Invalid state has two independent owners: the control (`data-ds-invalid`)
 * and its Field (`data-ds-field-invalid`). `aria-invalid` is always the union,
 * so either side can change state without erasing the other's decision.
 */
export function applyInvalid(input: HTMLElement, invalid: boolean): void {
  input.toggleAttribute('data-ds-invalid', invalid);
  syncAriaInvalid(input);
}

export function setFieldInvalid(input: HTMLElement, invalid: boolean): void {
  input.toggleAttribute('data-ds-field-invalid', invalid);
  syncAriaInvalid(input);
}

export function syncAriaInvalid(input: HTMLElement): void {
  if (input.hasAttribute('data-ds-invalid') || input.hasAttribute('data-ds-field-invalid')) {
    input.setAttribute('aria-invalid', 'true');
  } else {
    input.removeAttribute('aria-invalid');
  }
}
