// ==UserScript==
// @name         选中复制
// @name:en      Copy on Select
// @namespace    https://github.com/Wildfire2282
// @version      1.2.0
// @description  选中文本后自动纯文本复制到剪贴板，去除首尾空白
// @description:en Copy selected text as plain text with whitespace trimmed
// @author       Wildfire2282 (https://github.com/Wildfire2282)
// @license      MIT
// @homepageURL  https://github.com/Wildfire2282/my-userscript
// @supportURL   https://github.com/Wildfire2282/my-userscript/issues
// @source       https://github.com/Wildfire2282/my-userscript
// @match        *://*/*
// @grant        GM_setClipboard
// @run-at       document-end
// @downloadURL  https://update.greasyfork.org/scripts/582576/%E9%80%89%E4%B8%AD%E5%A4%8D%E5%88%B6.user.js
// @updateURL    https://update.greasyfork.org/scripts/582576/%E9%80%89%E4%B8%AD%E5%A4%8D%E5%88%B6.meta.js
// ==/UserScript==
(function() {
	//#region packages/shared/src/clipboard.ts
	function defaultScope() {
		const globals = globalThis;
		const browser = globalThis;
		return {
			get GM_setClipboard() {
				return typeof globals.GM_setClipboard === "function" ? globals.GM_setClipboard.bind(globals) : void 0;
			},
			get GM() {
				return globals.GM;
			},
			get clipboard() {
				return browser.navigator?.clipboard;
			},
			get document() {
				return browser.document;
			}
		};
	}
	/** textarea 兜底：必须在用户手势的同一个任务里同步执行，跨 await 会失去写权限。 */
	function copyWithTextarea(document, text) {
		if (!document?.body) return false;
		const active = document.activeElement;
		const area = document.createElement("textarea");
		area.value = text;
		area.setAttribute("readonly", "");
		area.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
		document.body.appendChild(area);
		try {
			area.select();
			return document.execCommand("copy");
		} catch {
			return false;
		} finally {
			area.remove();
			active?.focus?.();
		}
	}
	/**
	* 创建剪贴板写入器。
	*
	* @param scope 通常是 `globalThis`；测试里传假对象即可验证各通道的降级顺序
	*/
	function createClipboard(scope = defaultScope()) {
		return { async copy(text) {
			if (text === "") return true;
			try {
				if (typeof scope.GM_setClipboard === "function") {
					await scope.GM_setClipboard(text, "text");
					return true;
				}
				if (typeof scope.GM?.setClipboard === "function") {
					await scope.GM.setClipboard(text, "text");
					return true;
				}
			} catch {}
			try {
				if (typeof scope.clipboard?.writeText === "function") {
					await scope.clipboard.writeText(text);
					return true;
				}
			} catch {}
			return copyWithTextarea(scope.document, text);
		} };
	}
	//#endregion
	//#region scripts/selection-copy/src/config.ts
	/**
	* 行为常量。
	*
	* 线上旧版没有设置面板，所有行为写死在脚本里；迁移后继续保持“没有设置项”，
	* 这些值集中在这里，方便测试引用，也避免同一个数字散落在事件回调里。
	*/
	var BEHAVIOR = {
		/** 在输入框里选中文字是否也自动复制。 */
		enableForTextBoxes: false,
		/** 在富文本编辑器里选中文字是否也自动复制。 */
		enableForContentEditable: false,
		/** 复制前是否去掉首尾空白。 */
		trimWhitespace: true,
		/** 鼠标位移超过该值即认定为拖动选区。 */
		dragThresholdPx: 3
	};
	var INDICATOR = {
		sizePx: 14,
		gapPx: 8,
		marginPx: 8,
		holdMs: 1e3,
		fadeMs: 300
	};
	/** 会改变选区的按键；`Ctrl+A` 在键盘处理里单独判断。 */
	var SELECTION_EXTEND_KEYS = /* @__PURE__ */ new Set([
		"ArrowLeft",
		"ArrowRight",
		"ArrowUp",
		"ArrowDown",
		"Home",
		"End",
		"PageUp",
		"PageDown"
	]);
	//#endregion
	//#region scripts/selection-copy/src/selection.ts
	/**
	* 选区与焦点相关的 DOM 读取。
	*
	* 这些函数只读页面状态，不做判断、不写剪贴板；门控规则集中在 `isDisabledTarget`，
	* 判断函数在 `gesture.ts`，复制动作在 `features/copy-action.ts`。
	*/
	/** 事件目标可能是元素、文本节点或 window；统一收敛成元素。 */
	function elementOf(node) {
		if (node instanceof Element) return node;
		if (node instanceof Node) return node.parentElement;
		return null;
	}
	function isTextControl(element) {
		return element?.localName === "input" || element?.localName === "textarea";
	}
	/**
	* 元素是不是可编辑区域或它的后代。
	*
	* 优先用浏览器的 `isContentEditable`（能正确处理嵌套的 `contenteditable="false"`）；
	* 测试环境没有实现该属性时退回读祖先链上的属性值。
	*/
	function isInsideEditable(element) {
		for (let node = element; node; node = node.parentElement) {
			if (!(node instanceof HTMLElement)) continue;
			if (node.isContentEditable) return true;
			const attribute = node.getAttribute("contenteditable");
			if (attribute === "" || attribute === "true" || attribute === "plaintext-only") return true;
		}
		return false;
	}
	/** 焦点可能落在 Shadow Root 内部，`document.activeElement` 只会给出宿主元素。 */
	function getActiveElement() {
		let element = document.activeElement;
		while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
		return element;
	}
	/** 控件自己是否有一段非空选区；number / email 等 input 没有 selectionStart。 */
	function hasOwnSelection(element) {
		if (!isTextControl(element)) return false;
		try {
			return element.selectionStart !== element.selectionEnd;
		} catch {
			return false;
		}
	}
	function getActiveTextControl() {
		const element = getActiveElement();
		return hasOwnSelection(element) ? element : null;
	}
	function snapshotSelection(selection) {
		if (!selection) return null;
		const { anchorNode, anchorOffset, focusNode, focusOffset, rangeCount } = selection;
		return {
			anchorNode,
			anchorOffset,
			focusNode,
			focusOffset,
			rangeCount
		};
	}
	/** 复制前是否要去掉首尾空白；行内换行与缩进保留，只 trim 两端。 */
	function readSelectionText(selection) {
		const text = selection.toString();
		return BEHAVIOR.trimWhitespace ? text.trim() : text;
	}
	/** 目标本身、选区端点或当前焦点任一处落在被排除的区域，就整次跳过。 */
	function isDisabledTarget(selection, target, control) {
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
	//#endregion
	//#region scripts/selection-copy/src/features/geometry.ts
	function isForwardSelection(selection, range) {
		return selection.anchorNode === range.startContainer && selection.anchorOffset === range.startOffset;
	}
	/** 选区终点所在行的行盒；失败时返回 null。 */
	function getSelectionEndRect(selection, range) {
		try {
			const lineRects = range.getClientRects();
			const forward = isForwardSelection(selection, range);
			const lineRect = lineRects[forward ? lineRects.length - 1 : 0];
			if (!lineRect) return null;
			const edge = forward ? lineRect.right : lineRect.left;
			return {
				left: edge,
				right: edge,
				top: lineRect.top,
				bottom: lineRect.bottom,
				width: 0,
				height: lineRect.height
			};
		} catch {
			return null;
		}
	}
	function getFallbackRect(selection, range) {
		const anchorElement = elementOf(selection.anchorNode);
		const activeElement = !anchorElement || anchorElement === document.body || anchorElement === document.documentElement ? getActiveElement() : null;
		if (activeElement && activeElement !== document.body && activeElement !== document.documentElement) {
			const activeRect = activeElement.getBoundingClientRect();
			if (activeRect.width > 0 || activeRect.height > 0) return activeRect;
		}
		if (range) try {
			const boxRect = range.getBoundingClientRect();
			if (boxRect.width > 0 || boxRect.height > 0) return boxRect;
		} catch {}
		return anchorElement?.getBoundingClientRect() ?? null;
	}
	/**
	* 取标记要贴住的位置。
	*
	* @param selection 当前文档选区
	* @returns 选区终点的行盒或兜底矩形；都没有时返回 null（标记会落在视口中央）
	*/
	function getAnchorRect(selection) {
		const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
		if (!range) return getFallbackRect(selection, null);
		return getSelectionEndRect(selection, range) ?? getFallbackRect(selection, range);
	}
	//#endregion
	//#region scripts/selection-copy/src/features/copy-action.ts
	function createCopyAction(options) {
		const doc = options.doc ?? document;
		let requestId = 0;
		return async (target = null) => {
			const selection = doc.getSelection();
			if (!selection || selection.rangeCount === 0) return;
			const text = readSelectionText(selection);
			if (text === "" || isDisabledTarget(selection, target, getActiveTextControl())) return;
			const anchorRect = getAnchorRect(selection);
			const current = ++requestId;
			if (await options.clipboard.copy(text) && current === requestId) options.showIndicator(anchorRect);
		};
	}
	//#endregion
	//#region scripts/selection-copy/src/gesture.ts
	function isSameSelection(first, second) {
		return first !== null && second !== null && first.anchorNode === second.anchorNode && first.anchorOffset === second.anchorOffset && first.focusNode === second.focusNode && first.focusOffset === second.focusOffset && first.rangeCount === second.rangeCount;
	}
	/**
	* 松开鼠标后是否去复制。
	*
	* 普通单击（没有拖动、选区也没变）只是移动光标或取消选区，不复制；拖动、双击 /
	* 三击、以及选区确实变了的操作都算一次新选择。
	*/
	function shouldCopyOnMouseUp(gesture, end, current, threshold = BEHAVIOR.dragThresholdPx) {
		if (!(Math.abs(end.clientX - gesture.startX) > threshold || Math.abs(end.clientY - gesture.startY) > threshold) && end.detail === 1 && isSameSelection(gesture.selection, current)) return false;
		return true;
	}
	/**
	* 松开按键后是否去复制：Shift + 选区扩展键，或 Ctrl+A（不带 Shift）。
	*
	* Alt 组合交给系统；页面合成的键盘事件一律忽略，避免被脚本反复触发。
	*/
	function shouldCopyOnKeyUp(event) {
		if (!event.isTrusted || event.altKey) return false;
		const extendsSelection = event.shiftKey && SELECTION_EXTEND_KEYS.has(event.key);
		const selectsAll = event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "a";
		return extendsSelection || selectsAll;
	}
	//#endregion
	//#region scripts/selection-copy/src/features/sensor.ts
	function installCopySensor(options) {
		const doc = options.doc ?? document;
		const win = options.win ?? window;
		let gesture = null;
		const onMouseDown = (event) => {
			if (!event.isTrusted || event.button !== 0) return;
			gesture = {
				startX: event.clientX,
				startY: event.clientY,
				target: event.target,
				selection: snapshotSelection(doc.getSelection())
			};
		};
		const onMouseUp = (event) => {
			if (!event.isTrusted || event.button !== 0) return;
			if (gesture === null) return;
			const current = gesture;
			gesture = null;
			if (!shouldCopyOnMouseUp(current, event, snapshotSelection(doc.getSelection()))) return;
			options.onCopy(current.target);
		};
		const onKeyUp = (event) => {
			if (!shouldCopyOnKeyUp(event)) return;
			options.onCopy(null);
		};
		const onMouseLeave = (event) => {
			if (event.target === doc || event.target === doc.documentElement || event.target === doc.body) gesture = null;
		};
		const reset = () => {
			gesture = null;
		};
		doc.addEventListener("mousedown", onMouseDown, true);
		doc.addEventListener("mouseup", onMouseUp, true);
		doc.addEventListener("keyup", onKeyUp, true);
		doc.addEventListener("mouseleave", onMouseLeave, true);
		win.addEventListener("blur", reset);
		return () => {
			doc.removeEventListener("mousedown", onMouseDown, true);
			doc.removeEventListener("mouseup", onMouseUp, true);
			doc.removeEventListener("keyup", onKeyUp, true);
			doc.removeEventListener("mouseleave", onMouseLeave, true);
			win.removeEventListener("blur", reset);
		};
	}
	//#endregion
	//#region packages/userscript-ui/src/styles/base.css?inline
	var base_default = ":host {\n  all: initial;\n}\n\n.ds-root {\n  all: initial;\n  /* all:initial also resets color-scheme; restore the host's theme for native UI. */\n  color-scheme: inherit;\n  display: contents;\n  font-family: var(--ds-font-sans);\n  font-size: var(--ds-text-base);\n  line-height: var(--ds-leading-normal);\n  color: var(--ds-foreground);\n  text-align: start;\n  -webkit-font-smoothing: antialiased;\n  -moz-osx-font-smoothing: grayscale;\n  -webkit-text-size-adjust: 100%;\n  text-size-adjust: 100%;\n}\n\n*,\n*::before,\n*::after {\n  box-sizing: border-box;\n}\n\n[hidden] {\n  display: none !important;\n}\n\n:host([data-ds-theme-switching]) *,\n:host([data-ds-theme-switching]) *::before,\n:host([data-ds-theme-switching]) *::after {\n  transition: none !important;\n}\n\nbutton,\ninput,\nselect,\ntextarea {\n  margin: 0;\n  font: inherit;\n  letter-spacing: inherit;\n  color: inherit;\n}\n\n.ds-layer {\n  position: fixed;\n  inset: 0;\n  pointer-events: none;\n}\n\n.ds-layer-base {\n  z-index: 1;\n}\n\n.ds-layer-toast {\n  z-index: 2;\n}\n\n.ds-layer-tooltip {\n  z-index: 3;\n}\n\n.ds-layer > * {\n  pointer-events: auto;\n}\n\n@media (prefers-reduced-motion: reduce) {\n  :host {\n    --ds-duration-fast: 0ms;\n    --ds-duration-base: 0ms;\n    --ds-duration-slow: 0ms;\n  }\n}\n\n@media print {\n  :host {\n    display: none !important;\n  }\n}\n";
	//#endregion
	//#region packages/userscript-ui/src/tokens/themes.css?inline
	var themes_default = ":host,\n:host([data-ds-theme='light']) {\n  --ds-background: #ffffff;\n  --ds-foreground: #18181b;\n  --ds-card: #ffffff;\n  --ds-card-foreground: #18181b;\n  --ds-primary: #18181b;\n  --ds-primary-foreground: #fafafa;\n  --ds-secondary: #f4f4f5;\n  --ds-secondary-foreground: #18181b;\n  --ds-muted: #f4f4f5;\n  --ds-muted-foreground: #6b6b74;\n  --ds-border: #e4e4e7;\n  --ds-input: #8e8e97;\n  --ds-track: #8e8e97;\n  --ds-ring: #71717a;\n  --ds-destructive: #dc2626;\n  --ds-destructive-foreground: #fafafa;\n  --ds-success: #16a34a;\n  --ds-warning: #d97706;\n  --ds-switch-thumb: #ffffff;\n  --ds-overlay: rgb(9 9 11 / 0.45);\n}\n\n/* 深色主题遵循与浅色同一套语义 Token，只替换取值。\n   取值原则：\n   - 不使用纯黑/纯白：画布 #09090b，抬升表面 #18181b，正文 #fafafa。\n   - 深色下用“更亮的灰”表达层级：卡片 #18181b 浮于画布之上，边框 #2b2b31 与之分离。\n   - 状态色在深色背景上提亮，保证文字对比度 ≥ 4.5:1（destructive 改用亮红 + 深色前景）。 */\n:host([data-ds-theme='dark']) {\n  --ds-background: #09090b;\n  --ds-foreground: #fafafa;\n  --ds-card: #18181b;\n  --ds-card-foreground: #fafafa;\n  --ds-primary: #fafafa;\n  --ds-primary-foreground: #18181b;\n  --ds-secondary: #27272a;\n  --ds-secondary-foreground: #fafafa;\n  --ds-muted: #27272a;\n  --ds-muted-foreground: #a1a1aa;\n  --ds-border: #2b2b31;\n  --ds-input: #70707a;\n  --ds-track: #6b6b74;\n  --ds-ring: #d4d4d8;\n  --ds-destructive: #f87171;\n  --ds-destructive-foreground: #450a0a;\n  --ds-success: #4ade80;\n  --ds-warning: #fbbf24;\n  --ds-switch-thumb: #fafafa;\n  --ds-overlay: rgb(0 0 0 / 0.7);\n\n  --ds-shadow-sm: 0 1px 2px rgb(0 0 0 / 0.5);\n  --ds-shadow-md: 0 4px 14px rgb(0 0 0 / 0.6);\n  --ds-shadow-lg: 0 16px 40px rgb(0 0 0 / 0.72);\n}\n";
	//#endregion
	//#region packages/userscript-ui/src/tokens/tokens.css?inline
	var tokens_default = ":host {\n  --ds-font-sans:\n    ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,\n    'Helvetica Neue', Arial, 'Noto Sans', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei',\n    sans-serif;\n  --ds-font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;\n\n  --ds-text-xs: 12px;\n  --ds-text-sm: 13px;\n  --ds-text-base: 14px;\n  --ds-text-lg: 16px;\n  --ds-text-xl: 18px;\n\n  --ds-weight-normal: 400;\n  --ds-weight-medium: 500;\n  --ds-weight-semibold: 600;\n\n  --ds-leading-tight: 1.25;\n  --ds-leading-snug: 1.4;\n  --ds-leading-normal: 1.5;\n\n  --ds-space-0-5: 2px;\n  --ds-space-1: 4px;\n  --ds-space-1-5: 6px;\n  --ds-space-2: 8px;\n  --ds-space-2-5: 10px;\n  --ds-space-3: 12px;\n  --ds-space-4: 16px;\n  --ds-space-5: 20px;\n  --ds-space-6: 24px;\n  --ds-space-8: 32px;\n\n  --ds-control-h-sm: 28px;\n  --ds-control-h: 32px;\n  --ds-control-h-lg: 36px;\n  --ds-textarea-min-h: 72px;\n\n  --ds-icon-sm: 14px;\n  --ds-icon-xs: 12px;\n  --ds-icon: 16px;\n  --ds-accent-width: 3px;\n\n  --ds-radius-sm: 4px;\n  --ds-radius-md: 6px;\n  --ds-radius-lg: 8px;\n  --ds-radius-xl: 12px;\n  --ds-radius-full: 9999px;\n\n  --ds-border-width: 1px;\n  --ds-ring-width: 2px;\n  --ds-ring-offset: 2px;\n\n  --ds-shadow-sm: 0 1px 2px rgb(0 0 0 / 0.05);\n  --ds-shadow-md: 0 4px 12px rgb(0 0 0 / 0.08);\n  --ds-shadow-lg: 0 12px 32px rgb(0 0 0 / 0.16);\n\n  --ds-duration-fast: 120ms;\n  --ds-duration-base: 180ms;\n  --ds-duration-slow: 240ms;\n  --ds-ease: cubic-bezier(0.2, 0, 0, 1);\n\n  --ds-panel-width: 360px;\n  --ds-panel-width-wide: 440px;\n  --ds-panel-padding: var(--ds-space-4);\n  --ds-panel-max-h: 70vh;\n  --ds-dialog-width: 440px;\n  --ds-dialog-max-h: 640px;\n  --ds-dialog-max-h-vh: 80vh;\n  --ds-dialog-inset: 32px;\n  --ds-switch-width: 36px;\n  --ds-switch-height: 20px;\n  --ds-switch-thumb-size: 16px;\n  --ds-checkbox-size: 16px;\n  --ds-launcher-size: 40px;\n  --ds-launcher-offset: 20px;\n  --ds-launcher-icon: 18px;\n  --ds-toast-width: 320px;\n  --ds-tooltip-max-w: 240px;\n  --ds-tooltip-arrow-size: 8px;\n  --ds-scroll-hint-height: 56px;\n}\n";
	//#endregion
	//#region packages/userscript-ui/src/core/labels.ts
	var DEFAULT_LABELS = {
		close: "Close",
		settings: "Settings",
		notifications: "Notifications",
		dismissNotification: "Dismiss notification",
		closeSettings: "Close settings",
		scrollHint: "Scroll for more",
		cancel: "Cancel",
		confirm: "Confirm"
	};
	function resolveLabels(overrides) {
		return {
			...DEFAULT_LABELS,
			...overrides
		};
	}
	//#endregion
	//#region packages/userscript-ui/src/core/theme.ts
	function resolveTheme(theme, prefersDark) {
		if (theme === "system") return prefersDark ? "dark" : "light";
		return theme;
	}
	//#endregion
	//#region packages/userscript-ui/src/core/styles.ts
	var seenByRoot = /* @__PURE__ */ new WeakMap();
	var sheetCache = /* @__PURE__ */ new Map();
	function useStyles(root, css) {
		let seen = seenByRoot.get(root);
		if (!seen) {
			seen = /* @__PURE__ */ new Set();
			seenByRoot.set(root, seen);
		}
		if (seen.has(css)) return;
		seen.add(css);
		if (canAdopt(root)) try {
			let sheet = sheetCache.get(css);
			if (!sheet) {
				sheet = new CSSStyleSheet();
				sheet.replaceSync(css);
				sheetCache.set(css, sheet);
			}
			if (!root.adoptedStyleSheets.includes(sheet)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
			return;
		} catch {}
		const style = document.createElement("style");
		style.setAttribute("data-ds-style", "");
		style.textContent = css;
		root.appendChild(style);
	}
	function canAdopt(root) {
		return typeof CSSStyleSheet !== "undefined" && "replaceSync" in CSSStyleSheet.prototype && "adoptedStyleSheets" in root;
	}
	//#endregion
	//#region packages/userscript-ui/src/core/mount.ts
	var HOST_TAG = "userscript-ui-root";
	var DEFAULT_Z_INDEX = 2147483e3;
	function mountUI(options = {}) {
		const host = document.createElement(HOST_TAG);
		host.setAttribute("data-ds-root", "");
		setImportant(host, "all", "initial");
		setImportant(host, "position", "fixed");
		setImportant(host, "inset", "0");
		setImportant(host, "z-index", String(options.zIndex ?? DEFAULT_Z_INDEX));
		setImportant(host, "display", "block");
		setImportant(host, "pointer-events", "none");
		setImportant(host, "visibility", "visible");
		setImportant(host, "opacity", "1");
		setImportant(host, "transform", "none");
		setImportant(host, "filter", "none");
		const root = host.attachShadow({ mode: "open" });
		const container = document.createElement("div");
		container.className = "ds-root";
		const base = layer("ds-layer-base");
		const toast = layer("ds-layer-toast");
		const tooltip = layer("ds-layer-tooltip");
		container.append(base, toast, tooltip);
		root.append(container);
		for (const [name, value] of Object.entries(options.tokens ?? {})) {
			if (!name.startsWith("--")) throw new Error(`Token name must start with "--": ${name}`);
			host.style.setProperty(name, value);
		}
		const controller = new AbortController();
		const destroyCallbacks = /* @__PURE__ */ new Set();
		const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
		let requestedTheme = options.theme ?? "light";
		let resolvedTheme = resolveTheme(requestedTheme, media?.matches ?? false);
		const applyTheme = () => {
			resolvedTheme = resolveTheme(requestedTheme, media?.matches ?? false);
			host.setAttribute("data-ds-theme", resolvedTheme);
			setImportant(host, "color-scheme", resolvedTheme);
		};
		applyTheme();
		media?.addEventListener("change", () => {
			if (requestedTheme === "system") applyTheme();
		}, { signal: controller.signal });
		useStyles(root, tokens_default);
		useStyles(root, base_default);
		useStyles(root, themes_default);
		(options.target ?? document.documentElement).appendChild(host);
		let destroyed = false;
		const ensureAlive = (action) => {
			if (destroyed) throw new Error(`Cannot ${action} after ui.destroy().`);
		};
		const labels = resolveLabels(options.labels);
		return {
			host,
			root,
			container,
			layers: {
				base,
				toast,
				tooltip
			},
			signal: controller.signal,
			labels,
			get theme() {
				return resolvedTheme;
			},
			get destroyed() {
				return destroyed;
			},
			setTheme(theme) {
				ensureAlive("change the theme");
				const previous = resolvedTheme;
				requestedTheme = theme;
				host.setAttribute("data-ds-theme-switching", "");
				applyTheme();
				if (previous !== resolvedTheme) {
					const clear = () => host.removeAttribute("data-ds-theme-switching");
					if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(clear));
					else window.setTimeout(clear, 0);
				} else host.removeAttribute("data-ds-theme-switching");
			},
			useStyles(css) {
				ensureAlive("add styles");
				useStyles(root, css);
			},
			mount(node) {
				ensureAlive("mount content");
				base.appendChild(node);
			},
			onDestroy(callback) {
				if (destroyed) {
					callback();
					return () => {};
				}
				destroyCallbacks.add(callback);
				return () => destroyCallbacks.delete(callback);
			},
			destroy() {
				if (destroyed) return;
				destroyed = true;
				for (const callback of [...destroyCallbacks].reverse()) try {
					callback();
				} catch {}
				controller.abort();
				host.remove();
			}
		};
	}
	function layer(className) {
		const node = document.createElement("div");
		node.className = `ds-layer ${className}`;
		return node;
	}
	function setImportant(node, property, value) {
		node.style.setProperty(property, value, "important");
	}
	//#endregion
	//#region scripts/selection-copy/src/ui/indicator.css?inline
	var indicator_default = "/*\n * 勾号圆点：14px 与 10px 字号必须与 config.ts 的 INDICATOR.sizePx / 定位计算保持一致，\n * 所以这里直接引用同一组 Token，不在脚本里另写一套尺寸。\n */\n.sel-copy-dot {\n  position: fixed;\n  z-index: 1;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: var(--ds-icon-sm);\n  height: var(--ds-icon-sm);\n  border-radius: var(--ds-radius-full);\n  background: var(--ds-success);\n  color: var(--ds-primary-foreground);\n  font-size: 10px;\n  font-weight: var(--ds-weight-semibold);\n  line-height: 1;\n  pointer-events: none;\n  opacity: 0;\n  transition: opacity 300ms var(--ds-ease);\n}\n\n.sel-copy-dot[data-visible='true'] {\n  opacity: 0.5;\n}\n";
	//#endregion
	//#region scripts/selection-copy/src/ui/indicator-position.ts
	function clamp(value, min, max) {
		if (max < min) return min;
		return Math.min(Math.max(value, min), max);
	}
	/**
	* 计算圆点左上角坐标。
	*
	* 选区贴边或已滚出视口时退回视口中央：标记不能跟着跑到视口外。
	*
	* @param rect 选区终点的行盒；没有可用矩形时传 null
	* @param viewport 视口尺寸
	*/
	function indicatorPosition(rect, viewport) {
		const size = INDICATOR.sizePx;
		const anchored = rect !== null && (rect.width > 0 || rect.height > 0) && rect.bottom > 0 && rect.top < viewport.height && rect.right > 0 && rect.left < viewport.width;
		return {
			left: clamp(anchored ? rect.right - size / 2 : viewport.width / 2 - size / 2, INDICATOR.marginPx, viewport.width - size - INDICATOR.marginPx),
			top: clamp(anchored ? rect.top - size - INDICATOR.gapPx : viewport.height / 2 - size / 2, INDICATOR.marginPx, viewport.height - size - INDICATOR.marginPx)
		};
	}
	//#endregion
	//#region scripts/selection-copy/src/ui/indicator.ts
	function createIndicator(ui) {
		ui.useStyles(indicator_default);
		const dot = document.createElement("div");
		dot.className = "sel-copy-dot";
		dot.setAttribute("aria-hidden", "true");
		dot.textContent = "✓";
		let holdTimer;
		let fadeTimer;
		let token = 0;
		const clearTimers = () => {
			if (holdTimer !== void 0) window.clearTimeout(holdTimer);
			if (fadeTimer !== void 0) window.clearTimeout(fadeTimer);
			holdTimer = void 0;
			fadeTimer = void 0;
		};
		const show = (rect) => {
			const point = indicatorPosition(rect, {
				width: window.innerWidth,
				height: window.innerHeight
			});
			const current = ++token;
			clearTimers();
			if (!dot.isConnected) ui.layers.base.appendChild(dot);
			dot.style.left = `${point.left}px`;
			dot.style.top = `${point.top}px`;
			dot.dataset.visible = "true";
			holdTimer = window.setTimeout(() => {
				if (current !== token) return;
				dot.dataset.visible = "false";
				fadeTimer = window.setTimeout(() => {
					if (current !== token || !dot.isConnected) return;
					dot.remove();
				}, INDICATOR.fadeMs);
			}, INDICATOR.holdMs);
		};
		const destroy = () => {
			token += 1;
			clearTimers();
			dot.remove();
		};
		ui.onDestroy(destroy);
		return {
			show,
			destroy
		};
	}
	//#endregion
	//#region scripts/selection-copy/src/ui/app.ts
	/**
	* 界面外壳：第一次真的复制成功时才创建 UI。
	*
	* 普通页面不产生任何节点与样式；用户从没复制过，就相当于脚本只多了几个事件监听。
	*/
	var LABELS = {
		close: "关闭",
		settings: "设置",
		notifications: "通知",
		dismissNotification: "关闭通知",
		closeSettings: "关闭设置",
		scrollHint: "向下滚动查看更多内容",
		cancel: "取消",
		confirm: "确定"
	};
	function createIndicatorApp() {
		let ui = null;
		let indicator = null;
		return { show(rect) {
			if (!ui) {
				const mounted = mountUI({
					theme: "system",
					labels: LABELS
				});
				indicator = createIndicator(mounted);
				ui = mounted;
			}
			indicator?.show(rect);
		} };
	}
	//#endregion
	//#region scripts/selection-copy/src/main.ts
	/**
	* 入口：安装选中传感器，第一次复制成功时才创建 UI。
	*
	* 每个 frame 独立注入：父文档收不到 iframe 内的鼠标事件，加 `@noframes` 会丢掉
	* iframe 内的复制能力。同一文档只装一份，用 DOM 属性兜底——不同管理器的沙箱之间
	* window 不一定共享，DOM 一定共享。
	*/
	var INSTALL_LOCK_ATTRIBUTE = "data-selection-auto-copy-installed";
	function start() {
		const root = document.documentElement;
		if (!root || root.hasAttribute(INSTALL_LOCK_ATTRIBUTE)) return;
		root.setAttribute(INSTALL_LOCK_ATTRIBUTE, "");
		const indicator = createIndicatorApp();
		const copy = createCopyAction({
			clipboard: createClipboard(),
			showIndicator: indicator.show
		});
		installCopySensor({ onCopy: (target) => void copy(target) });
	}
	try {
		start();
	} catch (error) {
		console.error("[selection-copy] 启动失败", error);
	}
	//#endregion
})();
