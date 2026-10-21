// ==UserScript==
// @name         选中复制
// @namespace    https://github.com/Wildfire2282
// @version      1.1.4
// @description  选中文本后自动纯文本复制到剪贴板，去除首尾空白
// @author       Wildfire2282
// @match        *://*/*
// @grant        GM_setClipboard
// @run-at       document-end
// @license MIT
// @downloadURL https://update.greasyfork.org/scripts/582576/%E9%80%89%E4%B8%AD%E5%A4%8D%E5%88%B6.user.js
// @updateURL https://update.greasyfork.org/scripts/582576/%E9%80%89%E4%B8%AD%E5%A4%8D%E5%88%B6.meta.js
// ==/UserScript==

"use strict";

// 目标环境：Windows 11 上的 Chrome / Chromium 系浏览器，不考虑触摸与 Firefox / Safari。
// 每个 frame 独立注入：父文档收不到 iframe 内的鼠标事件，加 @noframes 会丢掉 iframe 内的复制能力。
(() => {
  // 安装锁用 DOM 属性兜底：window 标记在不同管理器的沙箱之间不一定共享，
  // 而同一个文档的 DOM 一定共享，避免同一页面被注入两份、并排出现两个反馈标记。
  const INSTALL_LOCK_ATTRIBUTE = "data-selection-auto-copy-installed";
  const rootElement = document.documentElement;
  if (!rootElement ||
    window.__selectionAutoCopyInstalled ||
    rootElement.hasAttribute(INSTALL_LOCK_ATTRIBUTE)) {
    return;
  }
  window.__selectionAutoCopyInstalled = true;
  rootElement.setAttribute(INSTALL_LOCK_ATTRIBUTE, "");
  /** 行为开关 */
  const CONFIG = {
    enableForTextBoxes: false,
    enableForContentEditable: false,
    trimWhitespace: true,
    /** 鼠标位移超过该值即认定为拖动选区 */
    dragThresholdPx: 3,
    indicatorSizePx: 14,
    indicatorGapPx: 8,
    indicatorMarginPx: 8,
    indicatorHoldMs: 1000,
    indicatorFadeMs: 300,
  };

  /** 标记几何：这些内联值必须盖掉 popover 的 UA 默认样式（inset:0 + margin:auto 会把标记居中） */
  const INDICATOR_STYLE = {
    position: "fixed",
    inset: "auto",
    margin: "0",
    border: "0",
    padding: "0",
    overflow: "visible",
    boxSizing: "border-box",
    width: `${CONFIG.indicatorSizePx}px`,
    height: `${CONFIG.indicatorSizePx}px`,
    borderRadius: "50%",
    backgroundColor: "#22c55e",
    pointerEvents: "none",
    zIndex: "2147483647",
    opacity: "0",
    transition: `opacity ${CONFIG.indicatorFadeMs}ms ease`,
  };

  /** 对钩：放在内层元素上，popover 元素自身不能有内联 display */
  const CHECKMARK_STYLE = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: "100%",
    color: "#fff",
    fontSize: "10px",
    fontWeight: "bold",
    lineHeight: "1",
  };

  /** 会改变选区的按键，Ctrl+A 另行判断 */
  const SELECTION_EXTEND_KEYS = new Set([
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
    "PageUp",
    "PageDown",
  ]);

  /** Popover API（Chrome 114+）把标记放进顶层；更老的 Chromium 退回普通 fixed 定位 */
  const SUPPORTS_POPOVER =
    typeof HTMLElement.prototype.showPopover === "function" &&
    typeof HTMLElement.prototype.hidePopover === "function";

  /**
   * @typedef {{ anchorNode: Node | null, anchorOffset: number, focusNode: Node | null, focusOffset: number, rangeCount: number }} SelectionSnapshot
   * @typedef {{ startX: number, startY: number, target: EventTarget | null, selection: SelectionSnapshot | null }} Gesture
   * @typedef {{ left: number, right: number, top: number, bottom: number, width: number, height: number }} AnchorBox
   */

  /** @type {Gesture | null} 当前鼠标手势，没有按下的键时为 null */
  let gesture = null;
  /** @type {HTMLElement | null} */
  let indicator = null;
  /** @type {number | undefined} */
  let indicatorHoldTimer;
  /** @type {number | undefined} */
  let indicatorFadeTimer;
  /** @type {number} 展示序号：每次展示自增，旧展示的隐藏/移除回调据此自我作废 */
  let indicatorToken = 0;
  /** @type {number} 复制请求序号：写入是异步的，只让最新一次请求点亮标记 */
  let copyRequestId = 0;

  /** @param {unknown} node @returns {Element | null} */
  const elementOf = (node) => {
    if (node instanceof Element) {
      return node;
    }
    return node instanceof Node ? node.parentElement : null;
  };

  // localName 恒为小写；nodeName 在 XHTML / XML 文档里是小写，用它比较会漏判文本框
  /** @param {Element | null} element @returns {element is HTMLInputElement | HTMLTextAreaElement} */
  const isTextControl = (element) =>
    element?.localName === "input" || element?.localName === "textarea";

  /** @param {Element | null} element */
  const isInsideEditable = (element) => {
    for (let node = element; node; node = node.parentElement) {
      if (node instanceof HTMLElement && node.isContentEditable) {
        return true;
      }
    }
    return false;
  };

  /** 焦点可能落在 shadow root 内部，document.activeElement 只会给出宿主元素 */
  /** @returns {Element | null} */
  const getActiveElement = () => {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement) {
      element = element.shadowRoot.activeElement;
    }
    return element;
  };

  /**
   * @param {Element | null} element
   * @returns {element is HTMLInputElement | HTMLTextAreaElement}
   */
  const hasOwnSelection = (element) => {
    if (!isTextControl(element)) {
      return false;
    }
    try {
      return element.selectionStart !== element.selectionEnd;
    } catch {
      // number / email 等 input type 不支持 selectionStart
      return false;
    }
  };

  // Chromium 会把控件选区镜像进 Document 选区，但 anchorNode 指向 body，
  // 键盘触发时也没有鼠标目标，所以门控仍需控件自身的 selectionStart/End。
  /** @returns {HTMLInputElement | HTMLTextAreaElement | null} */
  const getActiveTextControl = () => {
    const element = getActiveElement();
    return hasOwnSelection(element) ? element : null;
  };

  /** @param {unknown} node */
  const isGatedElement = (node) => {
    const element = elementOf(node);
    if (!element) {
      return false;
    }
    if (!CONFIG.enableForTextBoxes && isTextControl(element)) {
      return true;
    }
    return !CONFIG.enableForContentEditable && isInsideEditable(element);
  };

  /**
   * @param {Selection | null} selection
   * @param {EventTarget | null} target
   * @param {HTMLInputElement | HTMLTextAreaElement | null} control
   */
  const isDisabledTarget = (selection, target, control) =>
    isGatedElement(target) ||
    isGatedElement(selection?.anchorNode) ||
    isGatedElement(selection?.focusNode) ||
    (!CONFIG.enableForTextBoxes && control !== null) ||
    (!CONFIG.enableForContentEditable && isInsideEditable(getActiveElement()));

  /** @returns {SelectionSnapshot | null} */
  const snapshotSelection = () => {
    const selection = document.getSelection();
    if (!selection) {
      return null;
    }
    const { anchorNode, anchorOffset, focusNode, focusOffset, rangeCount } = selection;
    return { anchorNode, anchorOffset, focusNode, focusOffset, rangeCount };
  };

  /** @param {SelectionSnapshot | null} first @param {SelectionSnapshot | null} second */
  const isSameSelection = (first, second) =>
    first !== null &&
    second !== null &&
    first.anchorNode === second.anchorNode &&
    first.anchorOffset === second.anchorOffset &&
    first.focusNode === second.focusNode &&
    first.focusOffset === second.focusOffset &&
    first.rangeCount === second.rangeCount;

  /** @param {Selection} selection */
  const readSelectionText = (selection) => {
    const text = selection.toString();
    return CONFIG.trimWhitespace ? text.trim() : text;
  };

  /** @param {string} text */
  const writeClipboard = async (text) => {
    // 管理器 API 不受安全上下文、iframe 权限策略和焦点限制，优先使用。
    // 调用留在用户手势的同一个任务里：跨 await 会消耗 transient activation。
    try {
      if (typeof GM_setClipboard === "function") {
        await GM_setClipboard(text, "text");
        return true;
      }
      // 命名空间只能经 globalThis 取：裸写 GM?.setClipboard 在 GM 未定义时会抛 ReferenceError
      const gm = globalThis.GM;
      if (typeof gm?.setClipboard === "function") {
        await gm.setClipboard(text, "text");
        return true;
      }
    } catch {
      // 落到浏览器剪贴板 API 再试一次
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // 没有任何可用的写入通道
    }

    return false;
  };

  /**
   * 选区终点是否落在 range 的末端（正向拖选）
   * @param {Selection} selection
   * @param {Range} range
   */
  const isForwardSelection = (selection, range) =>
    selection.anchorNode === range.startContainer &&
    selection.anchorOffset === range.startOffset;

  /**
   * 选区终点所在行的行盒，退化成零宽锚点。
   * 跨行/跨块选区不能直接用整体包围盒：那会把标记甩到另一行甚至选区起点。
   * @param {Selection} selection
   * @param {Range} range
   * @returns {AnchorBox | null}
   */
  const getSelectionEndRect = (selection, range) => {
    try {
      const lineRects = range.getClientRects();
      const forward = isForwardSelection(selection, range);
      const lineRect = lineRects[forward ? lineRects.length - 1 : 0];
      if (!lineRect) {
        return null;
      }
      const edge = forward ? lineRect.right : lineRect.left;
      return {
        left: edge,
        right: edge,
        top: lineRect.top,
        bottom: lineRect.bottom,
        width: 0,
        height: lineRect.height,
      };
    } catch {
      // 选区节点已脱离文档等情况
      return null;
    }
  };

  /**
   * 兜底锚点：文本框与 shadow root 内的选区没有行盒、区间矩形也会退化为 0，
   * 只能退回控件矩形；再退回整体包围盒或容器元素矩形。
   * @param {Selection} selection
   * @param {Range | null} range
   * @returns {AnchorBox | null}
   */
  const getFallbackRect = (selection, range) => {
    const anchorElement = elementOf(selection.anchorNode);
    const documentBox = !anchorElement ||
      anchorElement === document.body ||
      anchorElement === document.documentElement;

    const activeElement = documentBox ? getActiveElement() : null;
    if (activeElement &&
      activeElement !== document.body &&
      activeElement !== document.documentElement) {
      const activeRect = activeElement.getBoundingClientRect();
      if (activeRect.width > 0 || activeRect.height > 0) {
        return activeRect;
      }
    }

    if (range) {
      try {
        const boxRect = range.getBoundingClientRect();
        if (boxRect.width > 0 || boxRect.height > 0) {
          return boxRect;
        }
      } catch {
        // 继续用容器元素兜底
      }
    }

    return anchorElement?.getBoundingClientRect() ?? null;
  };

  /** @param {Selection} selection @returns {AnchorBox | null} */
  const getAnchorRect = (selection) => {
    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    return (range && getSelectionEndRect(selection, range)) || getFallbackRect(selection, range);
  };

  /** @returns {HTMLElement | null} */
  const ensureIndicator = () => {
    const host = document.documentElement;
    if (!host) {
      return null;
    }

    if (!indicator) {
      indicator = document.createElement("div");
      indicator.setAttribute("aria-hidden", "true");
      // 不能给 popover 元素设内联 display：内联样式会盖掉 UA 的
      // [popover]:not(:popover-open){display:none}，标记关闭后会一直可见。
      Object.assign(indicator.style, INDICATOR_STYLE);
      if (SUPPORTS_POPOVER) {
        indicator.setAttribute("popover", "manual");
      }

      const checkmark = document.createElement("div");
      checkmark.textContent = "\u2713";
      Object.assign(checkmark.style, CHECKMARK_STYLE);
      indicator.append(checkmark);
    }

    // 页面可能整体替换 DOM（SPA 重渲染），断链后重新挂载
    if (!indicator.isConnected) {
      host.append(indicator);
    }

    return indicator;
  };

  /** @param {number} value @param {number} min @param {number} max */
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  /** @param {AnchorBox | null} rect */
  const showCopyIndicator = (rect) => {
    const element = ensureIndicator();
    if (!element) {
      return;
    }

    const { indicatorSizePx: size, indicatorGapPx: gap, indicatorMarginPx: margin } = CONFIG;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // 选区贴边或已滚出视口时退回视口中央，标记不能跟着跑到视口外
    const anchored = rect !== null &&
      (rect.width > 0 || rect.height > 0) &&
      rect.bottom > 0 &&
      rect.top < viewportHeight &&
      rect.right > 0 &&
      rect.left < viewportWidth;

    const left = clamp(
      anchored ? rect.right - size / 2 : viewportWidth / 2 - size / 2,
      margin,
      viewportWidth - size - margin,
    );
    const top = clamp(
      anchored ? rect.top - size - gap : viewportHeight / 2 - size / 2,
      margin,
      viewportHeight - size - margin,
    );

    // 标记是文档级单例：先把上一次展示的隐藏/移除安排全部作废，
    // 再让这一次接管，保证任意时刻视口里只有一个反馈提示。
    const token = ++indicatorToken;
    clearTimeout(indicatorHoldTimer);
    clearTimeout(indicatorFadeTimer);
    indicatorHoldTimer = undefined;
    indicatorFadeTimer = undefined;

    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.opacity = "0.5";

    // 顶层渲染：不受祖先 transform / overflow 裁剪影响，也不用跟页面抢 z-index
    if (SUPPORTS_POPOVER) {
      try {
        if (!element.matches(":popover-open")) {
          element.showPopover();
        }
      } catch {
        // 只影响标记显示，不影响复制结果
      }
    }

    indicatorHoldTimer = setTimeout(() => {
      // 已被更新的展示顶掉：旧回调不得再改新标记的状态
      if (token !== indicatorToken) {
        return;
      }
      element.style.opacity = "0";
      indicatorFadeTimer = setTimeout(() => {
        if (token !== indicatorToken || !element.isConnected) {
          return;
        }
        element.remove();
      }, CONFIG.indicatorFadeMs);
    }, CONFIG.indicatorHoldMs);
  };

  /** @param {EventTarget | null} [target] */
  const autoCopy = async (target = null) => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const text = readSelectionText(selection);
    if (!text || isDisabledTarget(selection, target, getActiveTextControl())) {
      return;
    }

    // 与写入无关的几何信息先取，await 期间页面可能改动选区
    const anchorRect = getAnchorRect(selection);
    const requestId = ++copyRequestId;
    const written = await writeClipboard(text);
    // 写入完成顺序可能与发起顺序相反；只让最新一次请求点亮标记，
    // 否则更旧的那次会把新标记挪到旧位置，看起来像同时出现了多个提示。
    if (written && requestId === copyRequestId) {
      showCopyIndicator(anchorRect);
    }
  };

  const resetGesture = () => {
    gesture = null;
  };

  /**
   * capture 阶段会收到子树上任意元素的 mouseleave（mouseleave 不冒泡，但必然经过捕获），
   * 只有 target 是根节点时才真的离开了文档；否则拖动选区跨段落/跨元素时手势会被提前清掉，
   * mouseup 拿不到配对状态就直接不复制了。
   * @param {MouseEvent} e
   */
  const onMouseLeave = (e) => {
    if (e.target === document || e.target === document.documentElement || e.target === document.body) {
      resetGesture();
    }
  };

  /** @param {MouseEvent} e */
  const onMouseDown = (e) => {
    // 只跟踪主键的、用户真实产生的按下；右键/中键和页面合成的 mousedown 一律忽略
    if (!e.isTrusted || e.button !== 0) {
      return;
    }

    gesture = {
      startX: e.clientX,
      startY: e.clientY,
      target: e.target,
      selection: snapshotSelection(),
    };
  };

  /** @param {MouseEvent} e */
  const onMouseUp = (e) => {
    if (!e.isTrusted || e.button !== 0) {
      return;
    }

    // 没有配对的 mousedown（例如从 iframe 内拖出后在本帧释放）时不做判断
    if (gesture === null) {
      return;
    }

    const { startX, startY, target, selection } = gesture;
    gesture = null;

    const moved = Math.abs(e.clientX - startX) > CONFIG.dragThresholdPx ||
      Math.abs(e.clientY - startY) > CONFIG.dragThresholdPx;

    // 普通单击（无拖动、选区也没变）只是移动光标或取消选区，不复制。
    // 拖动由 moved 覆盖，双击/三击由 detail 覆盖，小范围拖动由选区变化覆盖。
    if (!moved && e.detail === 1 && isSameSelection(selection, snapshotSelection())) {
      return;
    }

    autoCopy(target);
  };

  /** @param {KeyboardEvent} e */
  const onKeyUp = (e) => {
    if (!e.isTrusted || e.altKey) {
      return;
    }

    const extendsSelection = e.shiftKey && SELECTION_EXTEND_KEYS.has(e.key);
    const selectsAll = e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "a";

    if (extendsSelection || selectsAll) {
      autoCopy();
    }
  };

  document.addEventListener("mousedown", onMouseDown, true);
  document.addEventListener("mouseup", onMouseUp, true);
  document.addEventListener("keyup", onKeyUp, true);
  // 指针离开文档或窗口失焦后，按下的配对状态不再可信
  document.addEventListener("mouseleave", onMouseLeave, true);
  window.addEventListener("blur", resetGesture);
})();
