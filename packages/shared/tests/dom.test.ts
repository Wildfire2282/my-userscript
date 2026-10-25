import { describe, expect, it } from 'vitest';
import { deepActiveElement, isEditableField, isInsideEditable } from '../src/dom/editable';
import { clamp } from '../src/dom/position';

describe('isEditableField', () => {
  it('表单控件本身算可编辑', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(isEditableField(document.createElement(tag))).toBe(true);
    }
  });

  it('空 contenteditable 与 plaintext-only 算可编辑', () => {
    const plain = document.createElement('div');
    plain.setAttribute('contenteditable', '');
    expect(isEditableField(plain)).toBe(true);
    const rich = document.createElement('div');
    rich.setAttribute('contenteditable', 'plaintext-only');
    expect(isEditableField(rich)).toBe(true);
  });

  it('普通元素与 textbox 角色', () => {
    expect(isEditableField(document.createElement('div'))).toBe(false);
    expect(isEditableField(null)).toBe(false);
    const role = document.createElement('div');
    role.setAttribute('role', 'textbox');
    expect(isEditableField(role)).toBe(true);
  });
});

describe('isInsideEditable', () => {
  it('designMode 整页算可编辑', () => {
    const doc = { designMode: 'on' } as Document;
    expect(isInsideEditable(document.createElement('div'), doc)).toBe(true);
  });

  it('祖先可编辑则后代也算', () => {
    const outer = document.createElement('div');
    outer.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    outer.append(inner);
    expect(isInsideEditable(inner)).toBe(true);
  });

  it('contenteditable=false 继续看祖先', () => {
    const outer = document.createElement('div');
    outer.setAttribute('contenteditable', 'true');
    const middle = document.createElement('div');
    middle.setAttribute('contenteditable', 'false');
    const inner = document.createElement('span');
    outer.append(middle);
    middle.append(inner);
    expect(isInsideEditable(inner)).toBe(true);
    expect(isInsideEditable(document.createElement('span'))).toBe(false);
  });

  it('可编辑宿主在 shadow root 外时跨边界识别', () => {
    const host = document.createElement('div');
    host.setAttribute('contenteditable', 'true');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('span');
    shadow.appendChild(inner);
    expect(isInsideEditable(inner)).toBe(true);
  });
});

describe('deepActiveElement', () => {
  it('无 shadow 时返回 activeElement', () => {
    expect(deepActiveElement(document)).toBe(document.activeElement);
  });
});

describe('clamp', () => {
  it('钳在范围内，max<min 时贴 min', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(5, 8, 3)).toBe(8);
  });
});
