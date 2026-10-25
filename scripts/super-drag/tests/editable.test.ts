// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { isInputElement } from '../src/features/editable';

beforeEach(() => {
  document.body.replaceChildren();
});

function dispatchedOn(el: Element): boolean {
  const captured = { value: false };
  el.addEventListener(
    'click',
    (event) => {
      captured.value = isInputElement(event);
    },
    { once: true },
  );
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return captured.value;
}

describe('isInputElement', () => {
  it('输入框自身的拖拽不接管', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(dispatchedOn(input)).toBe(true);
  });

  it('label 里的说明文字不算输入框（只认祖先链上的控件）', () => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    const span = document.createElement('span');
    label.append(span, input);
    document.body.appendChild(label);
    expect(dispatchedOn(span)).toBe(false);
  });

  it('静态文字不接管', () => {
    const p = document.createElement('p');
    p.textContent = '评论文字';
    document.body.appendChild(p);
    expect(dispatchedOn(p)).toBe(false);
  });

  it('contenteditable 容器内的文字按可编辑处理（浏览器让该属性继承）', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const span = document.createElement('span');
    span.textContent = '子节点';
    editable.appendChild(span);
    document.body.appendChild(editable);
    expect(dispatchedOn(span)).toBe(true);
  });

  it('容器内被显式排除的区域仍然可拖拽', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const readonly = document.createElement('span');
    readonly.setAttribute('contenteditable', 'false');
    readonly.textContent = '只读片段';
    editable.appendChild(readonly);
    document.body.appendChild(editable);
    expect(dispatchedOn(readonly)).toBe(false);
  });
});
