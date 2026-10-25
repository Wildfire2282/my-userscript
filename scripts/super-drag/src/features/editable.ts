import { isEditableField } from '@shared';

export { isEditableField };

/**
 * 事件发生处最近的可拖动祖先（`draggable="true"`）。
 *
 * 卡片排序、上传区、看板列都用它实现原生拖拽；页面上只要存在一段文字选区，
 * 脚本的文字兜底就会把这类拖拽抢过来，用户原本的拖拽动作变成“搜索选中文字”。
 *
 * 是否豁免由调用方结合「宿主是不是真的有链接 / 图片地址」判断，见
 * `hit-test.ts` 的 `hasNativeDragContent`：没有地址的链接、图片只是页面自己的控件。
 */
export function draggableHostOf(node: Element | null): Element | null {
  return node?.closest('[draggable="true"]') ?? null;
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
