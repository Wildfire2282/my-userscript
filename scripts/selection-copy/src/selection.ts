import { BEHAVIOR } from './config';
import type { SelectionSnapshot } from './gesture';

/**
 * 选区与焦点相关的 DOM 读取。
 *
 * 这些函数只读页面状态，不做判断、不写剪贴板；门控规则集中在 `isDisabledTarget`，
 * 判断函数在 `gesture.ts`，复制动作在 `features/copy-action.ts`。
 */

/** 事件目标可能是元素、文本节点或 window；统一收敛成元素。 */
export function elementOf(node: unknown): Element | null {
  if (node instanceof Element) return node;
  if (node instanceof Node) return node.parentElement;
  return null;
}

// localName 恒为小写；nodeName 在 XHTML / XML 文档里大小写不固定，用它比较会漏判。
export function isTextControl(
  element: Element | null,
): element is HTMLInputElement | HTMLTextAreaElement {
  return element?.localName === 'input' || element?.localName === 'textarea';
}

/**
 * 元素是不是可编辑区域或它的后代。
 *
 * 优先用浏览器的 `isContentEditable`（能正确处理嵌套的 `contenteditable="false"`）；
 * 测试环境没有实现该属性时退回读祖先链上的属性值。
 */
export function isInsideEditable(element: Element | null): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.isContentEditable) return true;
    const attribute = node.getAttribute('contenteditable');
    // contenteditable="false" 自己不是可编辑区，但要继续看祖先。
    if (attribute === '' || attribute === 'true' || attribute === 'plaintext-only') return true;
  }
  return false;
}

/** 焦点可能落在 Shadow Root 内部，`document.activeElement` 只会给出宿主元素。 */
export function getActiveElement(): Element | null {
  let element: Element | null = document.activeElement;
  while (element?.shadowRoot?.activeElement) {
    element = element.shadowRoot.activeElement;
  }
  return element;
}

/** 控件自己是否有一段非空选区；number / email 等 input 没有 selectionStart。 */
export function hasOwnSelection(
  element: Element | null,
): element is HTMLInputElement | HTMLTextAreaElement {
  if (!isTextControl(element)) return false;
  try {
    return element.selectionStart !== element.selectionEnd;
  } catch {
    return false;
  }
}

// Chromium 会把控件选区镜像进 Document 选区，但 anchorNode 指向 body，键盘触发时
// 也没有鼠标目标，所以门控仍需控件自身的 selectionStart/End。
export function getActiveTextControl(): HTMLInputElement | HTMLTextAreaElement | null {
  const element = getActiveElement();
  return hasOwnSelection(element) ? element : null;
}

export function snapshotSelection(selection: Selection | null): SelectionSnapshot | null {
  if (!selection) return null;
  const { anchorNode, anchorOffset, focusNode, focusOffset, rangeCount } = selection;
  return { anchorNode, anchorOffset, focusNode, focusOffset, rangeCount };
}

/** 复制前是否要去掉首尾空白；行内换行与缩进保留，只 trim 两端。 */
export function readSelectionText(selection: Selection): string {
  const text = selection.toString();
  return BEHAVIOR.trimWhitespace ? text.trim() : text;
}

/** 目标本身、选区端点或当前焦点任一处落在被排除的区域，就整次跳过。 */
export function isDisabledTarget(
  selection: Selection | null,
  target: EventTarget | null,
  control: HTMLInputElement | HTMLTextAreaElement | null,
): boolean {
  if (!BEHAVIOR.enableForTextBoxes) {
    if (isTextControl(elementOf(target))) return true;
    if (isTextControl(elementOf(selection?.anchorNode))) return true;
    if (isTextControl(elementOf(selection?.focusNode))) return true;
    if (control !== null) return true;
  }
  if (!BEHAVIOR.enableForContentEditable) {
    if (isInsideEditable(elementOf(target))) return true;
    if (isInsideEditable(elementOf(selection?.anchorNode))) return true;
    if (isInsideEditable(elementOf(selection?.focusNode))) return true;
    if (isInsideEditable(getActiveElement())) return true;
  }
  return false;
}
