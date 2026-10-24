import type { SelectionSnapshot } from './gesture';

/**
 * 选区与焦点相关的 DOM 读取。
 *
 * 这些函数只读页面状态，不做判断、不写剪贴板；门控规则集中在 `isDisabledTarget`，
 * 判断函数在 `gesture.ts`，复制动作在 `features/copy-action.ts`。
 */

/** 哪些区域算复制范围；与设置里的两个开关一一对应。 */
export interface CopyScope {
  copyInInputs: boolean;
  copyInEditors: boolean;
}

/** 与 1.2.0 一致：输入框与富文本编辑器默认都不复制。 */
export const DEFAULT_COPY_SCOPE: CopyScope = {
  copyInInputs: false,
  copyInEditors: false,
};

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
 * 元素是不是本脚本（或多个脚本共用的界面）自己的 Shadow DOM。
 *
 * 在设置面板里选中说明文字不该触发复制，否则用户的剪贴板会被自己刚读的文案覆盖。
 * `data-ds-root` 是 `@ui` 挂载宿主的固定标记，跨脚本也成立。
 */
export function isInsideOwnUi(node: Node | null): boolean {
  if (!node) return false;
  const element = elementOf(node);
  if (element?.closest('[data-ds-root]')) return true;
  const root = node.getRootNode();
  return root instanceof ShadowRoot && root.host?.hasAttribute('data-ds-root') === true;
}

/**
 * 元素是不是可编辑区域或它的后代。
 *
 * 优先用浏览器的 `isContentEditable`（能正确处理嵌套的 `contenteditable="false"`）；
 * 测试环境没有实现该属性时退回读祖先链上的属性值。
 * `designMode` 打开的文档整页都是编辑器（老式富文本），也一并排除。
 */
export function isInsideEditable(element: Element | null): boolean {
  const designMode = document.designMode;
  if (typeof designMode === 'string' && designMode.toLowerCase() === 'on') return true;

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
export function getActiveElement(doc: Document = document): Element | null {
  let element: Element | null = doc.activeElement;
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

/**
 * 这次手势对应的文本控件。
 *
 * 鼠标手势以事件目标为准：在页面正文里拖动时，即使焦点仍在某个输入框里，
 * 也不能把输入框里的旧选区当成用户这次选中的内容。键盘手势没有目标，
 * 只能看当前焦点。
 */
export function selectedTextControl(
  target: EventTarget | null,
): HTMLInputElement | HTMLTextAreaElement | null {
  if (target !== null) {
    const element = elementOf(target);
    return hasOwnSelection(element) ? element : null;
  }
  return getActiveTextControl();
}

export function snapshotSelection(selection: Selection | null): SelectionSnapshot | null {
  if (!selection) return null;
  const { anchorNode, anchorOffset, focusNode, focusOffset, rangeCount } = selection;
  return { anchorNode, anchorOffset, focusNode, focusOffset, rangeCount };
}

/** 复制前是否要去掉首尾空白；行内换行与缩进保留，只 trim 两端。 */
export function readSelectionText(selection: Selection, trimWhitespace = true): string {
  const text = selection.toString();
  return trimWhitespace ? text.trim() : text;
}

/** 文本框 / 文本域的选区文本；不支持选区的 input 类型返回空串。 */
export function readTextControlText(
  control: HTMLInputElement | HTMLTextAreaElement,
  trimWhitespace = true,
): string {
  try {
    const start = control.selectionStart;
    const end = control.selectionEnd;
    if (start === null || end === null || start === end) return '';
    const text = control.value.slice(Math.min(start, end), Math.max(start, end));
    return trimWhitespace ? text.trim() : text;
  } catch {
    // 部分 input 类型（number、email、date）访问 selectionStart 会抛错。
    return '';
  }
}

/** 目标本身、选区端点或当前焦点任一处落在被排除的区域，就整次跳过。 */
export function isDisabledTarget(
  selection: Selection | null,
  target: EventTarget | null,
  control: HTMLInputElement | HTMLTextAreaElement | null,
  scope: CopyScope = DEFAULT_COPY_SCOPE,
): boolean {
  // 自己的界面永远不参与：面板里的说明文字被选中时不能覆盖剪贴板。
  if (
    isInsideOwnUi(target instanceof Node ? target : null) ||
    isInsideOwnUi(selection?.anchorNode ?? null) ||
    isInsideOwnUi(selection?.focusNode ?? null)
  ) {
    return true;
  }

  if (!scope.copyInInputs) {
    if (isTextControl(elementOf(target))) return true;
    if (isTextControl(elementOf(selection?.anchorNode))) return true;
    if (isTextControl(elementOf(selection?.focusNode))) return true;
    if (control !== null && target === null) return true;
  }
  if (!scope.copyInEditors) {
    if (isInsideEditable(elementOf(target))) return true;
    if (isInsideEditable(elementOf(selection?.anchorNode))) return true;
    if (isInsideEditable(elementOf(selection?.focusNode))) return true;
    // 只在键盘手势（没有鼠标目标）时才查当前焦点：鼠标在正文里拖选时，
    // 焦点仍留在评论框里是常态，不能因此把正文选区也拦掉。
    if (target === null && isInsideEditable(getActiveElement())) return true;
  }
  return false;
}
