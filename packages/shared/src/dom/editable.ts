/**
 * 可编辑判定：super-drag 的单元素判定 + selection-copy 的祖先链判定。
 *
 * 两套语义不同，不能互相替代：
 * - `isEditableField`：元素本身是不是表单控件或可编辑区（拖拽是否该让路）。
 * - `isInsideEditable`：元素或其祖先是不是可编辑区（含 `designMode` 整页编辑、
 *   `contenteditable="plaintext-only"` 与 `"false"` 继续上溯）。
 */

/** 元素本身是否是表单控件或可编辑区域。 */
export function isEditableField(node: Element | null): boolean {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
  const tag = node.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((node as HTMLElement).isContentEditable) return true;
  const editable = node.getAttribute('contenteditable');
  if (editable === '' || editable === 'true' || editable === 'plaintext-only') return true;
  if (node.getAttribute('role') === 'textbox') return true;
  return false;
}

/**
 * 元素或其祖先是不是可编辑区域。
 *
 * 优先用浏览器的 `isContentEditable`（能正确处理嵌套的 `contenteditable="false"`）；
 * `designMode` 打开的文档整页都是编辑器（老式富文本），也一并排除。
 *
 * @param element 待判定的元素
 * @param doc 文档；测试里可传入 `designMode` 不同的假文档
 */
export function isInsideEditable(element: Element | null, doc: Document = document): boolean {
  const designMode = doc.designMode;
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

/**
 * 穿透 open shadow root 取真正的焦点元素。
 *
 * `document.activeElement` 在焦点落在 Shadow Root 内部时只给出宿主元素。
 *
 * @param doc 文档；默认当前文档
 */
export function deepActiveElement(doc: Document = document): Element | null {
  let element: Element | null = doc.activeElement;
  while (element?.shadowRoot?.activeElement) {
    element = element.shadowRoot.activeElement;
  }
  return element;
}
