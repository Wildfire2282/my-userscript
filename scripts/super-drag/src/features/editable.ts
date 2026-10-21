/**
 * 判断事件发生在可编辑控件上。
 *
 * 输入框里的拖拽是浏览器原生的“移动文字 / 拖入粘贴”，脚本不能抢；
 * 但 contenteditable 祖先（例如评论富文本容器）不能一层层往上否决，否则静态评论文字也会失效。
 */

/** 元素本身是否是表单控件或可编辑区域。 */
export function isEditableField(node: Element | null): boolean {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
  const tag = node.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((node as HTMLElement).isContentEditable) return true;
  if (node.getAttribute('contenteditable') === 'true') return true;
  if (node.getAttribute('role') === 'textbox') return true;
  return false;
}

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
