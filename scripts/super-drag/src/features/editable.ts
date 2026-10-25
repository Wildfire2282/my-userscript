import { isEditableField } from '@shared';
import { parentAcrossShadow } from './hit-test';

/**
 * 取真实的事件目标。
 *
 * 在 window 捕获阶段监听时，Shadow DOM 内的事件会被重定向到宿主；
 * `composedPath()` 能拿回真正的内部节点（例如组件里的 `<input>`）。
 */
export function realTarget(event: Event): EventTarget | null {
  try {
    if (typeof event.composedPath === 'function') {
      const path = event.composedPath();
      if (path.length > 0) return path[0] ?? null;
    }
  } catch {
    // 退回 event.target
  }
  return event.target;
}

/**
 * 事件是否发生在输入框里（含 label 包着 input 这类结构）。
 */
export function isInputElement(event: Event): boolean {
  const raw = realTarget(event);
  const target = raw instanceof Element ? raw : null;
  if (isEditableField(target)) return true;
  if (!target) return false;
  // 目标本身被显式标成不可编辑时，交还给页面原生拖拽。
  if (target.getAttribute('contenteditable') === 'false') return false;

  for (let node = parentAcrossShadow(target); node; node = parentAcrossShadow(node)) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    // 编辑器里显式标成只读的子树可以拖，不要把拖拽当成编辑文字。
    if (node.getAttribute('contenteditable') === 'false') return false;
    if (node instanceof HTMLElement && node.isContentEditable) return true;
  }
  return false;
}
