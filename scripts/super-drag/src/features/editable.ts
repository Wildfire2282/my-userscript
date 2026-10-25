import { isEditableField } from '@shared';

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

  let node = target?.parentElement ?? null;
  while (node) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (node.isContentEditable) break;
    node = node.parentElement;
  }
  return false;
}
