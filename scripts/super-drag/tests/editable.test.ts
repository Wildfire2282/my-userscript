// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { draggableHostOf, isInputElement } from '../src/features/editable';

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

describe('draggableHostOf', () => {
  it('页面自己声明 draggable="true" 的元素与其子节点都算', () => {
    const card = document.createElement('div');
    card.setAttribute('draggable', 'true');
    const label = document.createElement('span');
    card.appendChild(label);
    document.body.appendChild(card);

    expect(draggableHostOf(card)).toBe(card);
    expect(draggableHostOf(label)).toBe(card);
  });

  it('普通元素与 draggable="false" 不算', () => {
    const plain = document.createElement('div');
    const fixed = document.createElement('div');
    fixed.setAttribute('draggable', 'false');
    document.body.append(plain, fixed);

    expect(draggableHostOf(plain)).toBeNull();
    expect(draggableHostOf(fixed)).toBeNull();
    expect(draggableHostOf(null)).toBeNull();
  });

  it('链接或图片自己标了 draggable="true" 也算页面可拖拽宿主', () => {
    const link = document.createElement('a');
    link.setAttribute('draggable', 'true');
    const img = document.createElement('img');
    img.setAttribute('draggable', 'true');
    document.body.append(link, img);

    // 是否把这次拖拽交还页面，由调用方结合链接 / 图片地址判断。
    expect(draggableHostOf(link)).toBe(link);
    expect(draggableHostOf(img)).toBe(img);
  });
});
