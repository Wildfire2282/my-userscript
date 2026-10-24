// ==UserScript==
// @name         选中复制
// @name:en      Copy on Select
// @namespace    https://github.com/Wildfire2282
// @version      1.4.2
// @description  选中文本后自动纯文本复制到剪贴板，去除首尾空白
// @description:en Copy selected text as plain text with whitespace trimmed
// @author       Wildfire2282 (https://github.com/Wildfire2282)
// @license      MIT
// @homepageURL  https://github.com/Wildfire2282/my-userscript
// @supportURL   https://github.com/Wildfire2282/my-userscript/issues
// @source       https://github.com/Wildfire2282/my-userscript
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @run-at       document-end
// @downloadURL  https://update.greasyfork.org/scripts/582576/%E9%80%89%E4%B8%AD%E5%A4%8D%E5%88%B6.user.js
// @updateURL    https://update.greasyfork.org/scripts/582576/%E9%80%89%E4%B8%AD%E5%A4%8D%E5%88%B6.meta.js
// ==/UserScript==
(function() {
	//#region packages/shared/src/gm.ts
	/**
	* 把全局 GM 函数包成可注入的接口。
	*
	* @param scope 通常是 `globalThis`；测试里传假对象即可验证降级分支。
	*/
	function createGmApi(scope = globalThis) {
		return {
			getValue(key, fallback) {
				if (typeof scope.GM_getValue !== "function") return fallback;
				try {
					const stored = scope.GM_getValue(key, fallback);
					return stored === void 0 ? fallback : stored;
				} catch {
					return fallback;
				}
			},
			setValue(key, value) {
				if (typeof scope.GM_setValue !== "function") return false;
				try {
					scope.GM_setValue(key, value);
					return true;
				} catch {
					return false;
				}
			},
			registerMenuCommand(label, run) {
				if (typeof scope.GM_registerMenuCommand !== "function") return false;
				try {
					scope.GM_registerMenuCommand(label, run);
					return true;
				} catch {
					return false;
				}
			}
		};
	}
	//#endregion
	//#region packages/shared/src/clipboard.ts
	function defaultScope() {
		const globals = globalThis;
		const browser = globalThis;
		return {
			get GM_setClipboard() {
				return typeof globals.GM_setClipboard === "function" ? globals.GM_setClipboard.bind(globals) : void 0;
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
		let active = document.activeElement;
		while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
		const control = active?.tagName === "INPUT" || active?.tagName === "TEXTAREA" ? active : null;
		const controlStart = control?.selectionStart;
		const controlEnd = control?.selectionEnd;
		const controlDirection = control?.selectionDirection;
		const selection = document.getSelection();
		const anchor = selection?.anchorNode;
		const focus = selection?.focusNode;
		const anchorOffset = selection?.anchorOffset ?? 0;
		const focusOffset = selection?.focusOffset ?? 0;
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
			if (anchor?.isConnected && focus?.isConnected) selection?.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
			if (controlStart != null && controlEnd != null) control?.setSelectionRange(controlStart, controlEnd, controlDirection ?? void 0);
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
	//#region packages/shared/src/storage.ts
	/**
	* 设置读写：默认值合并 + 异常兜底。
	*
	* 合并规则刻意与线上脚本 `{ ...DEFAULT, ...stored }` 的行为保持一致：
	* 只合并普通对象，数组和标量整体覆盖，`null`/`undefined` 视为“没存过”。
	* 存储里多出来的键会保留，避免旧版本回退时丢掉新版本写入的字段。
	*/
	function isRecord(value) {
		return typeof value === "object" && value !== null && !Array.isArray(value);
	}
	function clone(value) {
		return structuredClone(value);
	}
	function mergeValue(defaultValue, storedValue) {
		if (storedValue == null) return isRecord(defaultValue) ? mergeRecords(defaultValue, {}) : clone(defaultValue);
		if (isRecord(defaultValue) && isRecord(storedValue)) return mergeRecords(defaultValue, storedValue);
		return clone(storedValue);
	}
	function mergeRecords(defaults, stored) {
		const merged = {};
		for (const [key, value] of Object.entries(defaults)) Object.defineProperty(merged, key, {
			value: Object.hasOwn(stored, key) ? mergeValue(value, stored[key]) : mergeValue(value, void 0),
			enumerable: true,
			writable: true,
			configurable: true
		});
		for (const [key, value] of Object.entries(stored)) if (!Object.hasOwn(merged, key)) Object.defineProperty(merged, key, {
			value: clone(value),
			enumerable: true,
			writable: true,
			configurable: true
		});
		return merged;
	}
	/**
	* 把存储里读到的任意值合并到默认值上。
	*
	* @param defaults 默认设置（不会被修改）
	* @param stored 存储里读到的原始值，可能是 null、字符串或残缺对象
	* @returns 新对象；调用方可以安全修改
	*/
	function mergeDefaults(defaults, stored) {
		if (!isRecord(defaults)) throw new TypeError("mergeDefaults 需要一个对象作为默认值");
		if (!isRecord(stored)) return mergeRecords(defaults, {});
		return mergeRecords(defaults, stored);
	}
	//#endregion
	//#region packages/shared/src/settings-store.ts
	/**
	* 写失败时的基线比较：存储值变了就说明别处写过，本页副本作废。
	*
	* 必须逐层比较：GM 每次返回的是新反序列化对象，且设置里普遍有数组
	* （`disabledSites`）与嵌套对象（`engines`、`dragKinds`）。只看一层引用的话，
	* 写失败后的第一个 `get()` 就会把内存里的新值丢掉，用户改的设置当场失效。
	*/
	function sameValue(left, right) {
		if (left === right) return true;
		if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
		if (Array.isArray(left) || Array.isArray(right)) {
			if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
			return left.every((value, index) => sameValue(value, right[index]));
		}
		const leftEntries = Object.entries(left);
		const rightRecord = right;
		if (leftEntries.length !== Object.keys(rightRecord).length) return false;
		return leftEntries.every(([key, value]) => Object.hasOwn(rightRecord, key) && sameValue(value, rightRecord[key]));
	}
	/**
	* 创建设置仓库。
	*
	* @param options GM 适配层、存储键与收敛函数；测试里传假实现即可
	*/
	function createSettingsStore$1(options) {
		let pending = null;
		const get = () => {
			const raw = options.api.getValue(options.key, null);
			if (pending && !sameValue(raw, pending.base)) pending = null;
			return pending?.value ?? options.normalize(raw);
		};
		return {
			get,
			update(patch) {
				const raw = options.api.getValue(options.key, null);
				const next = options.normalize({
					...get(),
					...patch
				});
				pending = options.api.setValue(options.key, next) ? null : {
					value: next,
					base: raw
				};
				return next;
			}
		};
	}
	//#endregion
	//#region scripts/selection-copy/src/settings.ts
	/** 新键按 AGENTS.md 6.4 的 `<slug>:<area>.<key>` 命名。 */
	var SETTINGS_KEY = "selection-copy:config.settings";
	var DEFAULT_SETTINGS = {
		enabled: true,
		copyInInputs: false,
		copyInEditors: false,
		trimWhitespace: true,
		disabledSites: []
	};
	function normalizeSites(value) {
		if (!Array.isArray(value)) return [];
		const sites = /* @__PURE__ */ new Set();
		for (const item of value) {
			if (typeof item !== "string") continue;
			const site = item.trim().toLowerCase();
			if (site !== "") sites.add(site);
		}
		return [...sites];
	}
	/**
	* 把存储里读到的任意值收敛成可用设置。
	*
	* 布尔字段只在“明确写了”时改变默认值：旧版没有这些字段，缺字段必须保持旧行为。
	*/
	function normalizeSettings(stored) {
		const merged = mergeDefaults(DEFAULT_SETTINGS, stored);
		return {
			enabled: merged.enabled !== false,
			copyInInputs: merged.copyInInputs === true,
			copyInEditors: merged.copyInEditors === true,
			trimWhitespace: merged.trimWhitespace !== false,
			disabledSites: normalizeSites(merged.disabledSites)
		};
	}
	/**
	* 站点标识：HTTP(S) 用主机名，`file:` 等没有主机名的页面用协议名。
	*
	* 不用完整 origin：同一站点在 http / https 下应共用“本站暂停”的选择。
	*/
	function siteKey(location) {
		const host = location.hostname.trim().toLowerCase();
		if (host !== "") return host;
		const protocol = location.protocol.replace(/:$/, "").toLowerCase();
		return protocol === "" ? "unknown" : protocol;
	}
	/** 面板里展示的站点名；`file` 不是真实主机名，换成中文说明。 */
	function siteLabel(site) {
		return site === "file" ? "本机文件" : site;
	}
	/** 当前站点是否允许自动复制。 */
	function isEnabledOn(settings, site) {
		return settings.enabled && !settings.disabledSites.includes(site);
	}
	/** 生成“在 / 不在本站复制”的新设置，不改原对象。 */
	function withSiteEnabled(settings, site, enabled) {
		const others = settings.disabledSites.filter((item) => item !== site);
		return {
			...settings,
			disabledSites: enabled ? others : [...others, site]
		};
	}
	/**
	* 顶层页面决定“当前网站”。
	*
	* 用户在面板里看到的是地址栏里的站点，不是某个广告 / 播放器等 iframe 的域名；
	* 暂停顶层站点后，同页 iframe 也应当停止复制。优先读同源 `top.location`，
	* 跨域时退到 Chromium / WebKit 的 `ancestorOrigins`，再退到本帧。
	*/
	function frameSiteKey(context) {
		if (context.top) return siteKey(context.top);
		for (let index = context.ancestorOrigins.length - 1; index >= 0; index -= 1) {
			const origin = context.ancestorOrigins[index];
			if (!origin) continue;
			try {
				return siteKey(new URL(origin));
			} catch {}
		}
		return siteKey(context.self);
	}
	function readAncestorOrigins(location) {
		const origins = location.ancestorOrigins;
		if (!origins) return [];
		const list = [];
		for (let index = 0; index < origins.length; index += 1) {
			const value = origins.item(index);
			if (value) list.push(value);
		}
		return list;
	}
	/** 当前 frame 所属的站点；顶层页面就是它自己。 */
	function topSiteKey(win) {
		if (win.top === win) return siteKey(win.location);
		let top = null;
		try {
			const location = win.top?.location;
			if (location) top = {
				hostname: location.hostname,
				protocol: location.protocol
			};
		} catch {}
		return frameSiteKey({
			self: win.location,
			top,
			ancestorOrigins: readAncestorOrigins(win.location)
		});
	}
	/**
	* 创建设置仓库；读取与写回的通用逻辑在 `@shared`。
	*
	* @param api GM 适配层；测试里可以传入假实现
	*/
	function createSettingsStore(api = createGmApi()) {
		return createSettingsStore$1({
			api,
			key: SETTINGS_KEY,
			normalize: normalizeSettings
		});
	}
	//#endregion
	//#region scripts/selection-copy/src/selection.ts
	/** 与 1.2.0 一致：输入框与富文本编辑器默认都不复制。 */
	var DEFAULT_COPY_SCOPE = {
		copyInInputs: false,
		copyInEditors: false
	};
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
	* 元素是不是本脚本（或多个脚本共用的界面）自己的 Shadow DOM。
	*
	* 在设置面板里选中说明文字不该触发复制，否则用户的剪贴板会被自己刚读的文案覆盖。
	* `data-ds-root` 是 `@ui` 挂载宿主的固定标记，跨脚本也成立。
	*/
	function isInsideOwnUi(node) {
		if (!node) return false;
		if (elementOf(node)?.closest("[data-ds-root]")) return true;
		const root = node.getRootNode();
		return root instanceof ShadowRoot && root.host?.hasAttribute("data-ds-root") === true;
	}
	/**
	* 元素是不是可编辑区域或它的后代。
	*
	* 优先用浏览器的 `isContentEditable`（能正确处理嵌套的 `contenteditable="false"`）；
	* 测试环境没有实现该属性时退回读祖先链上的属性值。
	* `designMode` 打开的文档整页都是编辑器（老式富文本），也一并排除。
	*/
	function isInsideEditable(element) {
		const designMode = document.designMode;
		if (typeof designMode === "string" && designMode.toLowerCase() === "on") return true;
		for (let node = element; node; node = node.parentElement) {
			if (!(node instanceof HTMLElement)) continue;
			if (node.isContentEditable) return true;
			const attribute = node.getAttribute("contenteditable");
			if (attribute === "" || attribute === "true" || attribute === "plaintext-only") return true;
		}
		return false;
	}
	/** 焦点可能落在 Shadow Root 内部，`document.activeElement` 只会给出宿主元素。 */
	function getActiveElement(doc = document) {
		let element = doc.activeElement;
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
	/**
	* 这次手势对应的文本控件。
	*
	* 鼠标手势以事件目标为准：在页面正文里拖动时，即使焦点仍在某个输入框里，
	* 也不能把输入框里的旧选区当成用户这次选中的内容。键盘手势没有目标，
	* 只能看当前焦点。
	*/
	function selectedTextControl(target) {
		if (target !== null) {
			const element = elementOf(target);
			return hasOwnSelection(element) ? element : null;
		}
		return getActiveTextControl();
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
	function readSelectionText(selection, trimWhitespace = true) {
		const text = selection.toString();
		return trimWhitespace ? text.trim() : text;
	}
	/** 文本框 / 文本域的选区文本；不支持选区的 input 类型返回空串。 */
	function readTextControlText(control, trimWhitespace = true) {
		try {
			const start = control.selectionStart;
			const end = control.selectionEnd;
			if (start === null || end === null || start === end) return "";
			const text = control.value.slice(Math.min(start, end), Math.max(start, end));
			return trimWhitespace ? text.trim() : text;
		} catch {
			return "";
		}
	}
	/** 目标本身、选区端点或当前焦点任一处落在被排除的区域，就整次跳过。 */
	function isDisabledTarget(selection, target, control, scope = DEFAULT_COPY_SCOPE) {
		if (isInsideOwnUi(target instanceof Node ? target : null) || isInsideOwnUi(selection?.anchorNode ?? null) || isInsideOwnUi(selection?.focusNode ?? null)) return true;
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
			if (target === null && isInsideEditable(getActiveElement())) return true;
		}
		return false;
	}
	//#endregion
	//#region scripts/selection-copy/src/features/geometry.ts
	/** 在给定水平位置构造零宽锚点；`x` 是提示标签的中心。 */
	function pointAt(rect, x) {
		return {
			left: x,
			right: x,
			top: rect.top,
			bottom: rect.bottom,
			width: 0,
			height: rect.height
		};
	}
	function centerX(rect) {
		return rect.left + rect.width / 2;
	}
	/** 焦点处的零宽插入点；浏览器还没算出布局时返回 null。 */
	function getCaretRect(selection, doc) {
		const node = selection.focusNode;
		if (!node) return null;
		const range = doc.createRange();
		try {
			range.setStart(node, selection.focusOffset);
			range.collapse(true);
			const [first] = range.getClientRects();
			const rect = first ?? range.getBoundingClientRect();
			if (rect.width === 0 && rect.height === 0) return null;
			return pointAt(rect, rect.left);
		} catch {
			return null;
		}
	}
	function isForwardSelection(selection, range) {
		return selection.anchorNode === range.startContainer && selection.anchorOffset === range.startOffset;
	}
	/** 选区终点所在行的行盒；拿不到插入点时的退路。 */
	function getSelectionEndRect(selection, range) {
		try {
			const lineRects = range.getClientRects();
			const forward = isForwardSelection(selection, range);
			const lineRect = lineRects[forward ? lineRects.length - 1 : 0];
			if (!lineRect) return null;
			return pointAt(lineRect, forward ? lineRect.right : lineRect.left);
		} catch {
			return null;
		}
	}
	function getFallbackRect(selection, range, doc) {
		const anchorElement = elementOf(selection.anchorNode);
		const activeElement = !anchorElement || anchorElement === doc.body || anchorElement === doc.documentElement ? getActiveElement(doc) : null;
		if (activeElement && activeElement !== doc.body && activeElement !== doc.documentElement) {
			const activeRect = activeElement.getBoundingClientRect();
			if (activeRect.width > 0 || activeRect.height > 0) return pointAt(activeRect, centerX(activeRect));
		}
		if (range) try {
			const boxRect = range.getBoundingClientRect();
			if (boxRect.width > 0 || boxRect.height > 0) return pointAt(boxRect, centerX(boxRect));
		} catch {}
		const box = anchorElement?.getBoundingClientRect();
		if (box && (box.width > 0 || box.height > 0)) return pointAt(box, centerX(box));
		return null;
	}
	/**
	* 取标记要贴住的位置。
	*
	* @param selection 当前文档选区
	* @param doc 选区所属文档；默认当前页面
	* @returns 焦点处的插入点或兜底矩形；都没有时返回 null（标记会落在视口中央）
	*/
	function getAnchorRect(selection, doc = document) {
		const caret = getCaretRect(selection, doc);
		if (caret) return caret;
		const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
		if (!range) return getFallbackRect(selection, null, doc);
		return getSelectionEndRect(selection, range) ?? getFallbackRect(selection, range, doc);
	}
	/**
	* 文本框没有可读的插入点矩形，只能贴住控件本身。
	*
	* 水平方向取控件中线，让提示落在输入框上方居中，而不是跑到宽输入框的右端。
	*/
	function getControlAnchorRect(element) {
		const rect = element.getBoundingClientRect();
		if (rect.width === 0 && rect.height === 0) return null;
		return pointAt(rect, centerX(rect));
	}
	//#endregion
	//#region scripts/selection-copy/src/features/copy-action.ts
	/**
	* 决定这次手势复制什么。
	*
	* @param target 手势目标；键盘触发时为 null
	* @param settings 复制范围与首尾空白设置
	* @param doc 目标文档
	* @returns 要写入的文字与反馈锚点；这次不该复制时返回 null
	*/
	function resolveCopySource(target, settings, doc) {
		const control = selectedTextControl(target);
		if (control) {
			if (!settings.copyInInputs) return null;
			const text = readTextControlText(control, settings.trimWhitespace);
			if (text === "") return null;
			return {
				text,
				rect: getControlAnchorRect(control)
			};
		}
		const selection = doc.getSelection();
		if (!selection || selection.rangeCount === 0) return null;
		if (isDisabledTarget(selection, target, getActiveTextControl(), settings)) return null;
		const text = readSelectionText(selection, settings.trimWhitespace);
		if (text === "") return null;
		return {
			text,
			rect: getAnchorRect(selection, doc)
		};
	}
	function createCopyAction(options) {
		const doc = options.doc ?? document;
		let requestId = 0;
		return async (target = null) => {
			const settings = options.getSettings();
			if (!isEnabledOn(settings, options.site)) return "skipped";
			const source = resolveCopySource(target, settings, doc);
			if (!source) return "skipped";
			const current = ++requestId;
			let written = false;
			try {
				const latest = await options.clipboard.copy(source.text);
				if (current !== requestId) return "skipped";
				written = latest;
			} catch {
				if (current !== requestId) return "skipped";
			}
			options.showFeedback({
				variant: written ? "success" : "failure",
				rect: source.rect
			});
			return written ? "copied" : "failed";
		};
	}
	//#endregion
	//#region scripts/selection-copy/src/config.ts
	/**
	* 行为常量。
	*
	* 用户能改的项（输入框 / 富文本 / 首尾空白 / 站点开关）在 `settings.ts`；
	* 这里只放不随设置变化的几何与手势阈值，方便测试引用。
	*/
	var BEHAVIOR = { 
	/** 鼠标位移超过该值即认定为拖动选区。 */
dragThresholdPx: 3 };
	/**
	* 复制反馈标签。
	*
	* 宽高必须与 `indicator.css` 的宽度、`--ds-control-h-sm` 高度保持一致：
	* 位置是纯函数算出来的，尺寸对不上会贴边时露出一截或压住选区。
	*/
	var INDICATOR = {
		widthPx: {
			success: 68,
			failure: 80
		},
		heightPx: 28,
		gapPx: 6,
		marginPx: 8,
		holdMs: {
			success: 1200,
			failure: 1800
		},
		fadeMs: 180
	};
	/** 会改变选区的按键；`Ctrl+A` / `Cmd+A` 在键盘处理里单独判断。 */
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
		const isA = event.code === "KeyA" || event.key.toLowerCase() === "a";
		const selectsAll = event.ctrlKey && !event.shiftKey && isA;
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
			if (event.relatedTarget === null) gesture = null;
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
	var tokens_default = ":host {\n  --ds-font-sans:\n    ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,\n    'Helvetica Neue', Arial, 'Noto Sans', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei',\n    sans-serif;\n  --ds-font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;\n\n  --ds-text-xs: 12px;\n  --ds-text-sm: 13px;\n  --ds-text-base: 14px;\n  --ds-text-lg: 16px;\n  --ds-text-xl: 18px;\n\n  --ds-weight-normal: 400;\n  --ds-weight-medium: 500;\n  --ds-weight-semibold: 600;\n\n  --ds-leading-tight: 1.25;\n  --ds-leading-snug: 1.4;\n  --ds-leading-normal: 1.5;\n\n  --ds-space-0-5: 2px;\n  --ds-space-1: 4px;\n  --ds-space-1-5: 6px;\n  --ds-space-2: 8px;\n  --ds-space-2-5: 10px;\n  --ds-space-3: 12px;\n  --ds-space-4: 16px;\n  --ds-space-5: 20px;\n  --ds-space-6: 24px;\n  --ds-space-8: 32px;\n\n  --ds-control-h-sm: 28px;\n  --ds-control-h: 32px;\n  --ds-control-h-lg: 36px;\n  --ds-textarea-min-h: 72px;\n\n  --ds-icon-sm: 14px;\n  --ds-icon-xs: 12px;\n  --ds-icon: 16px;\n  --ds-accent-width: 3px;\n\n  --ds-radius-sm: 4px;\n  --ds-radius-md: 6px;\n  --ds-radius-lg: 8px;\n  --ds-radius-xl: 12px;\n  --ds-radius-full: 9999px;\n\n  --ds-border-width: 1px;\n  --ds-ring-width: 2px;\n  --ds-ring-offset: 2px;\n\n  --ds-shadow-sm: 0 1px 2px rgb(0 0 0 / 0.05);\n  --ds-shadow-md: 0 4px 12px rgb(0 0 0 / 0.08);\n  --ds-shadow-lg: 0 12px 32px rgb(0 0 0 / 0.16);\n\n  --ds-duration-fast: 120ms;\n  --ds-duration-base: 180ms;\n  --ds-duration-slow: 240ms;\n  --ds-ease: cubic-bezier(0.2, 0, 0, 1);\n\n  /* Panel sizes: compact settings surface, wider operation surface, and a\n     slightly wider settings panel when centered. */\n  --ds-panel-width-settings: 360px;\n  --ds-panel-width-wide: 440px;\n  --ds-panel-width-operation: 560px;\n  /* Backwards-compatible alias for the settings size. */\n  --ds-panel-width: var(--ds-panel-width-settings);\n  --ds-panel-padding: var(--ds-space-4);\n  --ds-panel-max-h-settings: 70vh;\n  --ds-panel-max-h-operation: 80vh;\n  --ds-panel-max-h: var(--ds-panel-max-h-settings);\n  --ds-dialog-width: 440px;\n  --ds-dialog-max-h: 640px;\n  --ds-dialog-max-h-vh: 80vh;\n  --ds-dialog-inset: 32px;\n  --ds-switch-width: 36px;\n  --ds-switch-height: 20px;\n  --ds-switch-thumb-size: 16px;\n  --ds-checkbox-size: 16px;\n  --ds-launcher-size: 40px;\n  --ds-launcher-offset: 20px;\n  --ds-launcher-icon: 18px;\n  --ds-toast-width: 320px;\n  --ds-tooltip-max-w: 240px;\n  --ds-tooltip-arrow-size: 8px;\n  --ds-scroll-hint-height: 56px;\n}\n";
	//#endregion
	//#region packages/userscript-ui/src/core/labels.ts
	var DEFAULT_LABELS = {
		close: "Close",
		settings: "Settings",
		operation: "Operations",
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
	var stylesByRoot = /* @__PURE__ */ new WeakMap();
	function useStyles(root, css) {
		let entry = stylesByRoot.get(root);
		if (!entry) {
			entry = {
				seen: /* @__PURE__ */ new Set(),
				sheets: /* @__PURE__ */ new Map()
			};
			stylesByRoot.set(root, entry);
		}
		if (entry.seen.has(css)) return;
		entry.seen.add(css);
		if (canAdopt(root)) try {
			let sheet = entry.sheets.get(css);
			if (!sheet) {
				sheet = new CSSStyleSheet();
				sheet.replaceSync(css);
				entry.sheets.set(css, sheet);
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
				destroyCallbacks.clear();
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
	//#region packages/userscript-ui/src/core/lifecycle.ts
	function createScope(ui) {
		const controller = new AbortController();
		const callbacks = /* @__PURE__ */ new Set();
		let destroyed = false;
		let unregister = () => {};
		const scope = {
			signal: controller.signal,
			get destroyed() {
				return destroyed;
			},
			onDestroy(callback) {
				if (destroyed) {
					callback();
					return () => {};
				}
				callbacks.add(callback);
				return () => {
					callbacks.delete(callback);
				};
			},
			destroy() {
				if (destroyed) return;
				destroyed = true;
				unregister();
				for (const callback of [...callbacks].reverse()) try {
					callback();
				} catch {}
				callbacks.clear();
				controller.abort();
			}
		};
		unregister = ui.onDestroy(() => scope.destroy());
		return scope;
	}
	/**
	* Components are unusable once the UI is destroyed: listeners on an aborted
	* signal never fire and the host is detached. Fail loudly instead of returning
	* a dead component.
	*/
	function assertAlive(ui, component) {
		if (ui.destroyed) throw new Error(`Cannot create a ${component} after ui.destroy().`);
	}
	//#endregion
	//#region packages/userscript-ui/src/components/button.css?inline
	var button_default = ".ds-button {\n  --ds-button-bg: var(--ds-primary);\n  --ds-button-fg: var(--ds-primary-foreground);\n  --ds-button-border: transparent;\n  --ds-button-hover: color-mix(in srgb, var(--ds-primary) 90%, var(--ds-background));\n\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: var(--ds-space-2);\n  min-width: 0;\n  height: var(--ds-control-h);\n  padding: 0 var(--ds-space-3);\n  border: var(--ds-border-width) solid var(--ds-button-border);\n  border-radius: var(--ds-radius-md);\n  background: var(--ds-button-bg);\n  color: var(--ds-button-fg);\n  font-family: inherit;\n  font-size: var(--ds-text-sm);\n  font-weight: var(--ds-weight-medium);\n  line-height: 1;\n  white-space: nowrap;\n  cursor: pointer;\n  user-select: none;\n  touch-action: manipulation;\n  transition:\n    background-color var(--ds-duration-fast) var(--ds-ease),\n    border-color var(--ds-duration-fast) var(--ds-ease),\n    color var(--ds-duration-fast) var(--ds-ease),\n    opacity var(--ds-duration-fast) var(--ds-ease);\n}\n\n.ds-button:hover:not(:disabled):not([aria-disabled='true']) {\n  background: var(--ds-button-hover);\n}\n\n.ds-button:active:not(:disabled):not([aria-disabled='true']) {\n  transform: translateY(var(--ds-border-width));\n}\n\n.ds-button:focus-visible {\n  outline: var(--ds-ring-width) solid var(--ds-ring);\n  outline-offset: var(--ds-ring-offset);\n}\n\n.ds-button:disabled,\n.ds-button[aria-disabled='true'] {\n  opacity: 0.5;\n  cursor: not-allowed;\n}\n\n.ds-button[data-loading='true'] {\n  cursor: progress;\n}\n\n.ds-button svg {\n  width: var(--ds-icon);\n  height: var(--ds-icon);\n  flex: none;\n}\n\n.ds-button--secondary {\n  --ds-button-bg: var(--ds-secondary);\n  --ds-button-fg: var(--ds-secondary-foreground);\n  --ds-button-hover: color-mix(in srgb, var(--ds-secondary) 92%, var(--ds-foreground));\n}\n\n.ds-button--outline {\n  --ds-button-bg: transparent;\n  --ds-button-fg: var(--ds-foreground);\n  --ds-button-border: var(--ds-input);\n  --ds-button-hover: var(--ds-muted);\n}\n\n.ds-button--ghost {\n  --ds-button-bg: transparent;\n  --ds-button-fg: var(--ds-foreground);\n  --ds-button-hover: var(--ds-muted);\n}\n\n.ds-button--destructive {\n  --ds-button-bg: var(--ds-destructive);\n  --ds-button-fg: var(--ds-destructive-foreground);\n  --ds-button-hover: color-mix(in srgb, var(--ds-destructive) 88%, var(--ds-foreground));\n}\n\n.ds-button--sm {\n  height: var(--ds-control-h-sm);\n  padding: 0 var(--ds-space-2-5);\n  font-size: var(--ds-text-xs);\n}\n\n.ds-button--lg {\n  height: var(--ds-control-h-lg);\n  padding: 0 var(--ds-space-4);\n  font-size: var(--ds-text-base);\n}\n\n.ds-button--icon {\n  width: var(--ds-control-h);\n  padding: 0;\n}\n\n.ds-button--icon.ds-button--sm {\n  width: var(--ds-control-h-sm);\n}\n\n.ds-button--icon.ds-button--lg {\n  width: var(--ds-control-h-lg);\n}\n\n.ds-button-label {\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.ds-button[data-loading='true'] .ds-button-icon {\n  display: none;\n}\n\n.ds-button-spinner {\n  width: var(--ds-icon-sm);\n  height: var(--ds-icon-sm);\n  flex: none;\n  border: var(--ds-ring-width) solid currentColor;\n  border-right-color: transparent;\n  border-radius: var(--ds-radius-full);\n  animation: ds-button-spin 700ms linear infinite;\n}\n\n@keyframes ds-button-spin {\n  to {\n    transform: rotate(360deg);\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .ds-button-spinner {\n    animation-duration: 1400ms;\n  }\n}\n";
	//#endregion
	//#region packages/userscript-ui/src/components/button.ts
	function createButton(ui, options = {}) {
		assertAlive(ui, "button");
		const iconOnly = options.size === "icon" || options.iconOnly === true;
		const variant = options.variant ?? "primary";
		const size = options.size ?? "md";
		if (iconOnly && !options.ariaLabel) throw new Error("Icon-only buttons require an ariaLabel.");
		if (!iconOnly && (options.label == null || typeof options.label === "string" && options.label.trim() === "")) throw new Error("Buttons require a label.");
		const scope = createScope(ui);
		ui.useStyles(button_default);
		const el = document.createElement("button");
		el.type = options.type ?? "button";
		el.className = `ds-button ds-button--${variant} ds-button--${size}`;
		if (iconOnly) el.classList.add("ds-button--icon");
		el.setAttribute("data-ds-button", "");
		if (options.ariaLabel) el.setAttribute("aria-label", options.ariaLabel);
		if (options.title) el.title = options.title;
		const spinner = document.createElement("span");
		spinner.className = "ds-button-spinner";
		spinner.setAttribute("aria-hidden", "true");
		if (options.icon) {
			options.icon.classList.add("ds-button-icon");
			el.appendChild(options.icon);
		}
		if (options.label != null) {
			const label = document.createElement("span");
			label.className = "ds-button-label";
			appendContent(label, options.label);
			el.appendChild(label);
		}
		let disabled = options.disabled ?? false;
		let loading = options.loading ?? false;
		const sync = () => {
			el.disabled = disabled || loading;
			el.dataset.loading = loading ? "true" : "false";
			if (loading) {
				el.setAttribute("aria-busy", "true");
				el.setAttribute("aria-disabled", "true");
				if (!spinner.isConnected) el.prepend(spinner);
			} else {
				el.removeAttribute("aria-busy");
				el.removeAttribute("aria-disabled");
				spinner.remove();
			}
		};
		if (options.onClick) el.addEventListener("click", options.onClick, { signal: scope.signal });
		sync();
		return {
			el,
			setLoading(next) {
				loading = next;
				sync();
			},
			setDisabled(next) {
				disabled = next;
				sync();
			},
			destroy() {
				scope.destroy();
				el.remove();
			}
		};
	}
	function appendContent(parent, content) {
		if (typeof content === "string") parent.textContent = content;
		else if (content) parent.appendChild(content);
	}
	//#endregion
	//#region packages/userscript-ui/src/core/dom.ts
	function append(parent, ...items) {
		for (const item of items) {
			if (item == null) continue;
			parent.appendChild(typeof item === "string" ? document.createTextNode(item) : item);
		}
	}
	/**
	* 合并 `aria-describedby`：保留外部已有的 ID，只增删自己负责的那几个。
	* field、panel、tooltip 各写一份后改一处会漏两处，收到这里只留一份。
	*/
	function syncDescribedBy(element, owned, active) {
		const ids = new Set((element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean));
		for (const id of owned) ids.delete(id);
		for (const id of active) ids.add(id);
		if (ids.size > 0) element.setAttribute("aria-describedby", [...ids].join(" "));
		else element.removeAttribute("aria-describedby");
	}
	//#endregion
	//#region packages/userscript-ui/src/core/focus.ts
	var FOCUSABLE = [
		"a[href]",
		"button:not([disabled])",
		"input:not([disabled])",
		"select:not([disabled])",
		"textarea:not([disabled])",
		"[tabindex]:not([tabindex=\"-1\"])"
	].join(",");
	function focusFirst(container) {
		const root = container.getRootNode();
		for (const target of container.querySelectorAll(FOCUSABLE)) {
			target.focus({ preventScroll: true });
			if (root.activeElement === target) return;
		}
		container.focus({ preventScroll: true });
	}
	function focusIfConnected(target) {
		if (target?.isConnected) target.focus({ preventScroll: true });
	}
	//#endregion
	//#region packages/userscript-ui/src/core/id.ts
	/**
	* Element ids are global to the page, not to a shadow root. A per-module random
	* token keeps them unique when two copies of the library (two userscripts, or
	* an upgrade window with both versions loaded) run in the same document.
	*/
	var PAGE_TOKEN = Math.random().toString(36).slice(2, 8);
	var counter = 0;
	function uid(prefix = "ds") {
		counter += 1;
		return `${prefix}-${PAGE_TOKEN}-${counter}`;
	}
	//#endregion
	//#region packages/userscript-ui/src/icons.ts
	var SVG_NS = "http://www.w3.org/2000/svg";
	function icon(paths, size = 16) {
		const svg = document.createElementNS(SVG_NS, "svg");
		svg.setAttribute("viewBox", "0 0 24 24");
		svg.setAttribute("width", String(size));
		svg.setAttribute("height", String(size));
		svg.setAttribute("fill", "none");
		svg.setAttribute("stroke", "currentColor");
		svg.setAttribute("stroke-width", "2");
		svg.setAttribute("stroke-linecap", "round");
		svg.setAttribute("stroke-linejoin", "round");
		svg.setAttribute("aria-hidden", "true");
		svg.setAttribute("focusable", "false");
		for (const definition of paths) {
			const path = document.createElementNS(SVG_NS, "path");
			path.setAttribute("d", definition);
			svg.appendChild(path);
		}
		return svg;
	}
	var closeIcon = () => icon(["M18 6 6 18", "m6 6 12 12"]);
	var chevronDownIcon = () => icon(["m6 9 6 6 6-6"]);
	//#endregion
	//#region packages/userscript-ui/src/styles/scroll-hint.css?inline
	var scroll_hint_default = ".ds-scroll-hint {\n  position: absolute;\n  inset-inline: 0;\n  bottom: 0;\n  display: flex;\n  align-items: flex-end;\n  justify-content: center;\n  height: var(--ds-scroll-hint-height);\n  padding-bottom: var(--ds-space-1-5);\n  background: linear-gradient(to top, var(--ds-card) 30%, transparent);\n  color: var(--ds-muted-foreground);\n  font-size: var(--ds-text-xs);\n  pointer-events: none;\n  opacity: 1;\n  visibility: visible;\n  transition: opacity var(--ds-duration-fast) var(--ds-ease);\n}\n\n.ds-scroll-hint[data-state='hidden'] {\n  opacity: 0;\n  visibility: hidden;\n}\n\n.ds-scroll-hint-label {\n  display: inline-flex;\n  align-items: center;\n  gap: var(--ds-space-1);\n  padding: var(--ds-space-0-5) var(--ds-space-2);\n  border-radius: var(--ds-radius-full);\n  background: var(--ds-muted);\n  white-space: nowrap;\n}\n\n.ds-scroll-hint-label svg {\n  width: var(--ds-icon-xs);\n  height: var(--ds-icon-xs);\n  flex: none;\n}\n";
	//#endregion
	//#region packages/userscript-ui/src/core/scroll-hint.ts
	var EDGE = 2;
	function resolveScrollHint(option) {
		if (option === false) return null;
		if (option === true || option === void 0) return {};
		return option;
	}
	/**
	* Shows a hint above a scrollable area while more content is hidden below.
	* The hint is decorative; the scroll area itself stays keyboard scrollable.
	*/
	function createScrollHint(ui, container, scroller, options = {}) {
		ui.useStyles(scroll_hint_default);
		const scope = createScope(ui);
		const el = document.createElement("div");
		el.className = "ds-scroll-hint";
		el.setAttribute("data-ds-scroll-hint", "");
		el.setAttribute("aria-hidden", "true");
		el.dataset.state = "hidden";
		const label = document.createElement("span");
		label.className = "ds-scroll-hint-label";
		label.appendChild(chevronDownIcon());
		const text = document.createElement("span");
		text.textContent = options.text ?? ui.labels.scrollHint;
		label.appendChild(text);
		el.appendChild(label);
		container.appendChild(el);
		const update = () => {
			const scrollable = scroller.scrollHeight > scroller.clientHeight + EDGE;
			const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - EDGE;
			el.dataset.state = scrollable && !atEnd ? "visible" : "hidden";
		};
		scroller.addEventListener("scroll", update, {
			passive: true,
			signal: scope.signal
		});
		window.addEventListener("resize", update, {
			passive: true,
			signal: scope.signal
		});
		const mutations = new MutationObserver(update);
		mutations.observe(scroller, {
			childList: true,
			subtree: true,
			characterData: true
		});
		const resize = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
		resize?.observe(scroller);
		update();
		return {
			el,
			update,
			destroy() {
				scope.destroy();
				mutations.disconnect();
				resize?.disconnect();
				el.remove();
			}
		};
	}
	//#endregion
	//#region packages/userscript-ui/src/components/panel.css?inline
	var panel_default = ".ds-panel {\n  position: fixed;\n  z-index: 1;\n  display: flex;\n  flex-direction: column;\n  width: min(var(--ds-panel-width), calc(100vw - 2 * var(--ds-launcher-offset)));\n  max-height: min(var(--ds-panel-max-h), calc(100vh - 2 * var(--ds-launcher-offset)));\n  overflow: hidden;\n  border: var(--ds-border-width) solid var(--ds-border);\n  border-radius: var(--ds-radius-lg);\n  background: var(--ds-card);\n  color: var(--ds-card-foreground);\n  box-shadow: var(--ds-shadow-lg);\n  pointer-events: auto;\n}\n\n/* Operation panels host script functions, so they get a wider working area and\n   a taller scroll region. Padding, typography and the footer stay identical. */\n.ds-panel[data-size='operation'] {\n  width: min(var(--ds-panel-width-operation), calc(100vw - 2 * var(--ds-launcher-offset)));\n  max-height: min(var(--ds-panel-max-h-operation), calc(100vh - 2 * var(--ds-launcher-offset)));\n}\n\n/* 居中位置不跟 Launcher 的角落偏移；左右用 auto 外边距居中，避免 transform 影响 RTL。 */\n.ds-panel[data-position='center'] {\n  inset-block-start: 50%;\n  inset-inline: 0;\n  margin-inline: auto;\n  transform: translateY(-50%);\n}\n\n/* 居中时设置面板放宽到 440px；操作面板保留自己的 560px 画布。 */\n.ds-panel[data-position='center'][data-size='settings'] {\n  width: min(var(--ds-panel-width-wide), calc(100vw - 2 * var(--ds-launcher-offset)));\n}\n\n.ds-panel[data-position='bottom-right'] {\n  inset-block-end: calc(\n    var(--ds-launcher-offset) + env(safe-area-inset-bottom, 0px) + var(--ds-launcher-size) +\n      var(--ds-space-2)\n  );\n  inset-inline-end: calc(var(--ds-launcher-offset) + env(safe-area-inset-right, 0px));\n}\n\n.ds-panel[data-position='bottom-left'] {\n  inset-block-end: calc(\n    var(--ds-launcher-offset) + env(safe-area-inset-bottom, 0px) + var(--ds-launcher-size) +\n      var(--ds-space-2)\n  );\n  inset-inline-start: calc(var(--ds-launcher-offset) + env(safe-area-inset-left, 0px));\n}\n\n.ds-panel[data-position='top-right'] {\n  inset-block-start: calc(\n    var(--ds-launcher-offset) + env(safe-area-inset-top, 0px) + var(--ds-launcher-size) +\n      var(--ds-space-2)\n  );\n  inset-inline-end: calc(var(--ds-launcher-offset) + env(safe-area-inset-right, 0px));\n}\n\n.ds-panel[data-position='top-left'] {\n  inset-block-start: calc(\n    var(--ds-launcher-offset) + env(safe-area-inset-top, 0px) + var(--ds-launcher-size) +\n      var(--ds-space-2)\n  );\n  inset-inline-start: calc(var(--ds-launcher-offset) + env(safe-area-inset-left, 0px));\n}\n\n.ds-panel-header {\n  display: flex;\n  align-items: flex-start;\n  gap: var(--ds-space-3);\n  padding: var(--ds-panel-padding);\n  border-bottom: var(--ds-border-width) solid var(--ds-border);\n}\n\n.ds-panel-heading {\n  display: flex;\n  flex: 1;\n  flex-direction: column;\n  gap: var(--ds-space-0-5);\n  min-width: 0;\n}\n\n.ds-panel-title {\n  margin: 0;\n  font-size: var(--ds-text-lg);\n  font-weight: var(--ds-weight-semibold);\n  line-height: var(--ds-leading-tight);\n}\n\n.ds-panel-description {\n  margin: 0;\n  color: var(--ds-muted-foreground);\n  font-size: var(--ds-text-xs);\n  line-height: var(--ds-leading-snug);\n}\n\n.ds-panel-close {\n  flex: none;\n  margin-block-start: calc(-1 * var(--ds-space-1));\n  margin-inline-end: calc(-1 * var(--ds-space-1));\n}\n\n.ds-panel-content {\n  position: relative;\n  display: flex;\n  flex: 1;\n  flex-direction: column;\n  min-height: 0;\n}\n\n.ds-panel-body {\n  display: flex;\n  flex: 1;\n  flex-direction: column;\n  gap: var(--ds-space-4);\n  min-height: 0;\n  padding: var(--ds-panel-padding);\n  overflow-y: auto;\n  overscroll-behavior: contain;\n  scrollbar-width: thin;\n  scrollbar-color: var(--ds-border) transparent;\n}\n\n.ds-panel-body::-webkit-scrollbar {\n  width: var(--ds-space-2);\n}\n\n.ds-panel-body::-webkit-scrollbar-track {\n  background: transparent;\n}\n\n.ds-panel-body::-webkit-scrollbar-thumb {\n  border-radius: var(--ds-radius-full);\n  background: var(--ds-border);\n}\n\n.ds-panel-footer {\n  display: flex;\n  flex-wrap: wrap;\n  justify-content: flex-end;\n  gap: var(--ds-space-2);\n  padding: var(--ds-space-3) var(--ds-panel-padding);\n  border-top: var(--ds-border-width) solid var(--ds-border);\n}\n";
	//#endregion
	//#region packages/userscript-ui/src/components/panel.ts
	function createPanel(ui, options = {}) {
		assertAlive(ui, "panel");
		ui.useStyles(panel_default);
		const scope = createScope(ui);
		const titleId = uid("ds-panel-title");
		const descriptionId = uid("ds-panel-description");
		const el = document.createElement("section");
		el.className = "ds-panel";
		el.setAttribute("data-ds-panel", "");
		el.dataset.position = options.position ?? "bottom-right";
		el.setAttribute("role", "region");
		el.tabIndex = -1;
		let panelSize = options.size ?? "settings";
		el.dataset.size = panelSize;
		const header = document.createElement("header");
		header.className = "ds-panel-header";
		const heading = document.createElement("div");
		heading.className = "ds-panel-heading";
		const title = document.createElement("h2");
		title.className = "ds-panel-title";
		title.id = titleId;
		title.textContent = options.title ?? "";
		title.hidden = !options.title;
		const description = document.createElement("p");
		description.className = "ds-panel-description";
		description.id = descriptionId;
		description.textContent = options.description ?? "";
		description.hidden = !options.description;
		heading.append(title, description);
		heading.hidden = !options.title && !options.description;
		header.appendChild(heading);
		const body = document.createElement("div");
		body.className = "ds-panel-body";
		const content = document.createElement("div");
		content.className = "ds-panel-content";
		content.appendChild(body);
		const footer = document.createElement("div");
		footer.className = "ds-panel-footer";
		footer.hidden = true;
		let isOpen = false;
		let destroyed = false;
		let returnFocus = null;
		const openListeners = /* @__PURE__ */ new Set();
		/**
		* Listeners observe the current state, not a queue of transitions: when a
		* listener changes the state mid-broadcast, the remaining listeners are
		* skipped so nobody is told about a state that is already stale. The new
		* state is broadcast by the nested `open()` / `close()` call.
		*/
		const notify = (open) => {
			for (const listener of [...openListeners]) {
				if (isOpen !== open) break;
				if (!openListeners.has(listener)) continue;
				listener(open);
			}
		};
		const fallbackLabel = () => options.ariaLabel ?? (panelSize === "operation" ? ui.labels.operation : ui.labels.settings);
		const setTitle = (next) => {
			title.textContent = next ?? "";
			title.hidden = !next;
			heading.hidden = title.hidden && description.hidden;
			if (next) {
				el.setAttribute("aria-labelledby", titleId);
				el.removeAttribute("aria-label");
			} else {
				el.removeAttribute("aria-labelledby");
				el.setAttribute("aria-label", fallbackLabel());
			}
		};
		const setSize = (next) => {
			panelSize = next;
			el.dataset.size = next;
			if (title.hidden) el.setAttribute("aria-label", fallbackLabel());
		};
		const setDescription = (next) => {
			description.textContent = next ?? "";
			description.hidden = !next;
			heading.hidden = title.hidden && description.hidden;
			syncDescribedBy(el, [descriptionId], next ? [descriptionId] : []);
		};
		const setFooter = (next) => {
			footer.replaceChildren();
			if (next == null) {
				footer.hidden = true;
				return;
			}
			const items = Array.isArray(next) ? next : [next];
			append(footer, ...items);
			footer.hidden = items.length === 0;
		};
		const close = () => {
			if (!isOpen || destroyed) return;
			const active = ui.root.activeElement;
			const shouldRestoreFocus = active != null && el.contains(active);
			isOpen = false;
			el.hidden = true;
			el.dataset.open = "false";
			try {
				if (shouldRestoreFocus) focusIfConnected(returnFocus);
				options.onClose?.();
			} finally {
				if (!isOpen) notify(false);
			}
		};
		const open = () => {
			if (isOpen || destroyed) return;
			isOpen = true;
			returnFocus = ui.root.activeElement ?? document.activeElement;
			el.hidden = false;
			el.dataset.open = "true";
			if (options.autoFocus !== false) {
				focusFirst(body);
				const active = ui.root.activeElement;
				if (!active || !body.contains(active)) el.focus({ preventScroll: true });
			}
			hint?.update();
			try {
				options.onOpen?.();
			} finally {
				if (isOpen && !destroyed) notify(true);
			}
		};
		const closeButton = createButton(ui, {
			size: "sm",
			variant: "ghost",
			iconOnly: true,
			ariaLabel: options.closeLabel ?? ui.labels.close,
			icon: closeIcon()
		});
		closeButton.el.classList.add("ds-panel-close");
		closeButton.el.addEventListener("click", close, { signal: scope.signal });
		header.appendChild(closeButton.el);
		el.append(header, content, footer);
		const hintOptions = resolveScrollHint(options.scrollHint);
		const hint = hintOptions ? createScrollHint(ui, content, body, hintOptions) : null;
		el.addEventListener("keydown", (event) => {
			if (event.key === "Escape" && !event.isComposing && isOpen) {
				event.preventDefault();
				event.stopPropagation();
				close();
			}
		}, { signal: scope.signal });
		if (options.title) el.setAttribute("aria-labelledby", titleId);
		else el.setAttribute("aria-label", fallbackLabel());
		setDescription(options.description);
		if (options.footer) setFooter(options.footer);
		el.hidden = options.open === false;
		el.dataset.open = options.open === false ? "false" : "true";
		isOpen = options.open !== false;
		ui.layers.base.appendChild(el);
		/**
		* Runs for an explicit `destroy()` and for `ui.destroy()`: the scope callback
		* invokes it, so a panel is always torn down exactly once.
		*/
		const teardown = () => {
			if (destroyed) return;
			const wasOpen = isOpen;
			const active = ui.root.activeElement;
			const shouldRestoreFocus = wasOpen && active != null && el.contains(active);
			destroyed = true;
			isOpen = false;
			scope.destroy();
			hint?.destroy();
			closeButton.destroy();
			el.remove();
			if (wasOpen) try {
				if (shouldRestoreFocus) focusIfConnected(returnFocus);
				options.onClose?.();
			} finally {
				try {
					notify(false);
				} finally {
					openListeners.clear();
				}
			}
			else openListeners.clear();
		};
		scope.onDestroy(teardown);
		return {
			el,
			body,
			footer,
			open,
			close,
			toggle() {
				if (isOpen) close();
				else open();
			},
			isOpen() {
				return isOpen;
			},
			setTitle,
			setDescription,
			setFooter,
			setPosition(position) {
				el.dataset.position = position;
			},
			setSize,
			onOpenChange(listener) {
				if (destroyed) return () => {};
				openListeners.add(listener);
				return () => openListeners.delete(listener);
			},
			destroy: teardown
		};
	}
	//#endregion
	//#region packages/userscript-ui/src/components/section.css?inline
	var section_default = ".ds-section {\n  display: flex;\n  flex-direction: column;\n  gap: var(--ds-space-3);\n  min-width: 0;\n}\n\n.ds-section + .ds-section {\n  padding-top: var(--ds-space-3);\n  border-top: var(--ds-border-width) solid var(--ds-border);\n}\n\n.ds-section-header {\n  display: flex;\n  flex-direction: column;\n  gap: var(--ds-space-0-5);\n  min-width: 0;\n}\n\n.ds-section-title {\n  margin: 0;\n  color: var(--ds-foreground);\n  font-size: var(--ds-text-sm);\n  font-weight: var(--ds-weight-semibold);\n  line-height: var(--ds-leading-snug);\n}\n\n.ds-section-description {\n  margin: 0;\n  color: var(--ds-muted-foreground);\n  font-size: var(--ds-text-xs);\n  line-height: var(--ds-leading-snug);\n}\n\n.ds-section-body {\n  display: flex;\n  flex-direction: column;\n  gap: var(--ds-space-3);\n  min-width: 0;\n}\n";
	//#endregion
	//#region packages/userscript-ui/src/components/section.ts
	function createSection(ui, options = {}) {
		assertAlive(ui, "section");
		ui.useStyles(section_default);
		const root = document.createElement("section");
		root.className = "ds-section";
		root.setAttribute("data-ds-section", "");
		if (options.title || options.description) {
			const header = document.createElement("header");
			header.className = "ds-section-header";
			if (options.title) {
				const title = document.createElement("h3");
				title.className = "ds-section-title";
				title.textContent = options.title;
				header.appendChild(title);
			}
			if (options.description) {
				const description = document.createElement("p");
				description.className = "ds-section-description";
				description.textContent = options.description;
				header.appendChild(description);
			}
			root.appendChild(header);
		}
		const body = document.createElement("div");
		body.className = "ds-section-body";
		root.appendChild(body);
		return {
			el: root,
			body,
			destroy() {
				root.remove();
			}
		};
	}
	//#endregion
	//#region packages/userscript-ui/src/core/form.ts
	function setFieldInvalid(input, invalid) {
		input.toggleAttribute("data-ds-field-invalid", invalid);
		syncAriaInvalid(input);
	}
	function syncAriaInvalid(input) {
		if (input.hasAttribute("data-ds-invalid") || input.hasAttribute("data-ds-field-invalid")) input.setAttribute("aria-invalid", "true");
		else input.removeAttribute("aria-invalid");
	}
	//#endregion
	//#region packages/userscript-ui/src/components/field.css?inline
	var field_default = ".ds-field {\n  display: flex;\n  flex-direction: column;\n  gap: var(--ds-space-1-5);\n  min-width: 0;\n}\n\n.ds-field-text {\n  display: flex;\n  flex-direction: column;\n  gap: var(--ds-space-0-5);\n  min-width: 0;\n}\n\n.ds-field-label {\n  color: var(--ds-foreground);\n  font-size: var(--ds-text-sm);\n  font-weight: var(--ds-weight-medium);\n  line-height: var(--ds-leading-snug);\n  cursor: pointer;\n}\n\n.ds-field-description {\n  margin: 0;\n  color: var(--ds-muted-foreground);\n  font-size: var(--ds-text-xs);\n  line-height: var(--ds-leading-snug);\n}\n\n.ds-field-control {\n  min-width: 0;\n}\n\n.ds-field-error {\n  margin: 0;\n  color: var(--ds-destructive);\n  font-size: var(--ds-text-xs);\n  line-height: var(--ds-leading-snug);\n}\n\n.ds-field--inline {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) auto;\n  align-items: center;\n  column-gap: var(--ds-space-4);\n  row-gap: var(--ds-space-1);\n}\n\n.ds-field--inline .ds-field-text {\n  grid-column: 1;\n}\n\n.ds-field--inline .ds-field-control {\n  grid-column: 2;\n  width: auto;\n}\n\n.ds-field--inline .ds-field-error {\n  grid-column: 1 / -1;\n}\n";
	//#endregion
	//#region packages/userscript-ui/src/components/field.ts
	function createField(ui, options) {
		assertAlive(ui, "field");
		ui.useStyles(field_default);
		const scope = createScope(ui);
		const input = options.control.input;
		if (!input.id) input.id = options.id ?? uid("ds-control");
		const root = document.createElement("div");
		root.className = options.inline ? "ds-field ds-field--inline" : "ds-field";
		root.setAttribute("data-ds-field", "");
		const text = document.createElement("div");
		text.className = "ds-field-text";
		const label = document.createElement("label");
		label.className = "ds-field-label";
		label.htmlFor = input.id;
		label.textContent = options.label ?? "";
		label.hidden = !options.label;
		text.appendChild(label);
		const descriptionId = uid("ds-field-description");
		const description = document.createElement("p");
		description.className = "ds-field-description";
		description.id = descriptionId;
		description.textContent = options.description ?? "";
		description.hidden = !options.description;
		text.appendChild(description);
		text.hidden = !options.label && !options.description;
		root.appendChild(text);
		const control = document.createElement("div");
		control.className = "ds-field-control";
		control.appendChild(options.control.el);
		root.appendChild(control);
		const errorId = uid("ds-field-error");
		const error = document.createElement("p");
		error.className = "ds-field-error";
		error.id = errorId;
		error.setAttribute("role", "alert");
		error.hidden = true;
		root.appendChild(error);
		const syncFieldDescribedBy = () => {
			const active = [description, error].filter((node) => !node.hidden).map((node) => node.id);
			syncDescribedBy(input, [descriptionId, errorId], active);
		};
		const syncInvalid = () => setFieldInvalid(input, !error.hidden);
		const setError = (message) => {
			if (scope.destroyed) return;
			const hasError = Boolean(message);
			error.textContent = message ?? "";
			error.hidden = !hasError;
			root.toggleAttribute("data-invalid", hasError);
			syncInvalid();
			syncFieldDescribedBy();
		};
		const setDescription = (message) => {
			if (scope.destroyed) return;
			description.textContent = message ?? "";
			description.hidden = !message;
			text.hidden = label.hidden && description.hidden;
			syncFieldDescribedBy();
		};
		if (input.getAttribute("aria-invalid") === "true") input.setAttribute("data-ds-invalid", "");
		if (options.error) setError(options.error);
		else {
			syncInvalid();
			syncFieldDescribedBy();
		}
		scope.onDestroy(() => {
			description.hidden = true;
			error.hidden = true;
			syncFieldDescribedBy();
			setFieldInvalid(input, false);
			root.remove();
		});
		return {
			el: root,
			control: options.control.el,
			setError,
			setDescription,
			destroy: () => scope.destroy()
		};
	}
	//#endregion
	//#region packages/userscript-ui/src/components/switch.css?inline
	var switch_default = ".ds-switch {\n  position: relative;\n  display: inline-flex;\n  width: var(--ds-switch-width);\n  height: var(--ds-switch-height);\n  flex: none;\n  vertical-align: middle;\n}\n\n.ds-switch-input {\n  position: absolute;\n  inset: 0;\n  z-index: 1;\n  width: 100%;\n  height: 100%;\n  margin: 0;\n  opacity: 0;\n  cursor: pointer;\n}\n\n.ds-switch-track {\n  position: absolute;\n  inset: 0;\n  border-radius: var(--ds-radius-full);\n  background: var(--ds-track);\n  transition: background-color var(--ds-duration-fast) var(--ds-ease);\n}\n\n.ds-switch-thumb {\n  position: absolute;\n  inset-block-start: var(--ds-space-0-5);\n  inset-inline-start: var(--ds-space-0-5);\n  width: var(--ds-switch-thumb-size);\n  height: var(--ds-switch-thumb-size);\n  border-radius: var(--ds-radius-full);\n  background: var(--ds-switch-thumb);\n  box-shadow: var(--ds-shadow-sm);\n  transition:\n    transform var(--ds-duration-fast) var(--ds-ease),\n    background-color var(--ds-duration-fast) var(--ds-ease);\n}\n\n.ds-switch-input:checked + .ds-switch-track {\n  background: var(--ds-primary);\n}\n\n.ds-switch-input:checked + .ds-switch-track .ds-switch-thumb {\n  background: var(--ds-primary-foreground);\n  /* Travel is derived so the thumb always lands inside the track. */\n  transform: translateX(\n    calc(var(--ds-switch-width) - var(--ds-switch-thumb-size) - 2 * var(--ds-space-0-5))\n  );\n}\n\n.ds-switch-input:hover:not(:disabled) + .ds-switch-track {\n  background: color-mix(in srgb, var(--ds-track) 82%, var(--ds-foreground));\n}\n\n.ds-switch-input:checked:hover:not(:disabled) + .ds-switch-track {\n  background: color-mix(in srgb, var(--ds-primary) 90%, var(--ds-background));\n}\n\n.ds-switch-input:focus-visible + .ds-switch-track {\n  outline: var(--ds-ring-width) solid var(--ds-ring);\n  outline-offset: var(--ds-ring-offset);\n}\n\n.ds-switch-input:disabled {\n  cursor: not-allowed;\n}\n\n.ds-switch-input:disabled + .ds-switch-track {\n  opacity: 0.5;\n}\n";
	//#endregion
	//#region packages/userscript-ui/src/components/switch.ts
	function createSwitch(ui, options = {}) {
		assertAlive(ui, "switch");
		ui.useStyles(switch_default);
		const scope = createScope(ui);
		const root = document.createElement("span");
		root.className = "ds-switch";
		const input = document.createElement("input");
		input.type = "checkbox";
		input.className = "ds-switch-input";
		input.setAttribute("role", "switch");
		input.checked = options.checked ?? false;
		input.setAttribute("aria-checked", String(input.checked));
		if (options.name) input.name = options.name;
		if (options.id) input.id = options.id;
		if (options.disabled) input.disabled = true;
		if (options.ariaLabel) input.setAttribute("aria-label", options.ariaLabel);
		const track = document.createElement("span");
		track.className = "ds-switch-track";
		track.setAttribute("aria-hidden", "true");
		const thumb = document.createElement("span");
		thumb.className = "ds-switch-thumb";
		track.appendChild(thumb);
		root.append(input, track);
		input.addEventListener("change", (event) => {
			input.setAttribute("aria-checked", String(input.checked));
			options.onChange?.(input.checked, event);
		}, { signal: scope.signal });
		return {
			el: root,
			input,
			setChecked(checked) {
				input.checked = checked;
				input.setAttribute("aria-checked", String(checked));
			},
			isChecked() {
				return input.checked;
			},
			destroy() {
				scope.destroy();
				root.remove();
			}
		};
	}
	//#endregion
	//#region scripts/selection-copy/src/ui/indicator.css?inline
	var indicator_default = "/*\n * 复制结果标签：高度必须与 config.ts 的 INDICATOR.heightPx（28）和 --ds-control-h-sm 一致，\n * 宽度由脚本按成功 / 失败两种文案设置，定位函数用同一组数字计算贴边位置。\n *\n * 用中性卡片底 + 彩色图标，而不是整块填色：12px 文字在浅色主题的绿色 / 红色底上\n * 对比度不够，卡片底在浅色与深色主题下都能读清。\n */\n.sel-copy-pill {\n  position: fixed;\n  z-index: 1;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: var(--ds-space-1);\n  height: var(--ds-control-h-sm);\n  padding: 0 var(--ds-space-2);\n  border: var(--ds-border-width) solid var(--ds-border);\n  border-radius: var(--ds-radius-full);\n  background: var(--ds-card);\n  color: var(--ds-card-foreground);\n  box-shadow: var(--ds-shadow-md);\n  font-family: var(--ds-font-sans);\n  font-size: var(--ds-text-xs);\n  font-weight: var(--ds-weight-medium);\n  line-height: 1;\n  white-space: nowrap;\n  pointer-events: none;\n  opacity: 0;\n  transform: translateY(2px) scale(0.94);\n  transition:\n    opacity var(--ds-duration-base) var(--ds-ease),\n    transform var(--ds-duration-base) var(--ds-ease);\n}\n\n.sel-copy-pill[data-visible='true'] {\n  opacity: 1;\n  transform: none;\n}\n\n.sel-copy-pill-icon {\n  color: var(--ds-success);\n  font-weight: var(--ds-weight-semibold);\n}\n\n.sel-copy-pill[data-variant='failure'] .sel-copy-pill-icon {\n  color: var(--ds-destructive);\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .sel-copy-pill {\n    transform: none;\n    transition: none;\n  }\n}\n";
	//#endregion
	//#region scripts/selection-copy/src/ui/indicator-position.ts
	function clamp(value, min, max) {
		if (max < min) return min;
		return Math.min(Math.max(value, min), max);
	}
	/**
	* 计算标签左上角坐标。
	*
	* 默认贴在焦点正上方并水平居中；上方放不下时翻到下一行，避免挡住刚选中的文字。
	* 选区贴边或已滚出视口时退回视口中央：标签不能跟着跑到视口外。
	*
	* @param rect 选区焦点或控件锚点；没有可用位置时传 null
	* @param viewport 视口尺寸
	* @param variant 成功 / 失败两种标签宽度不同，贴边时要分别计算
	*/
	function indicatorPosition(rect, viewport, variant = "success") {
		const width = INDICATOR.widthPx[variant];
		const height = INDICATOR.heightPx;
		const margin = INDICATOR.marginPx;
		const maxLeft = viewport.width - width - margin;
		const maxTop = viewport.height - height - margin;
		const centered = () => ({
			left: clamp((viewport.width - width) / 2, margin, maxLeft),
			top: clamp((viewport.height - height) / 2, margin, maxTop)
		});
		if (rect === null) return centered();
		if (!((rect.width > 0 || rect.height > 0) && rect.bottom > 0 && rect.top < viewport.height && rect.left < viewport.width && rect.right >= 0)) return centered();
		const left = clamp(rect.right - width / 2, margin, maxLeft);
		const above = rect.top - height - INDICATOR.gapPx;
		if (above >= margin) return {
			left,
			top: clamp(above, margin, maxTop)
		};
		const below = rect.bottom + INDICATOR.gapPx;
		if (below + height <= viewport.height - margin) return {
			left,
			top: below
		};
		return {
			left,
			top: clamp(above, margin, maxTop)
		};
	}
	//#endregion
	//#region scripts/selection-copy/src/ui/indicator.ts
	/**
	* 复制结果标签。
	*
	* 标记是文档级单例：每次展示自增序号，旧的隐藏 / 移除回调据此自我作废，
	* 保证任意时刻视口里最多只有一个提示。
	*/
	var LABELS$1 = {
		success: "已复制",
		failure: "复制失败"
	};
	var ICONS = {
		success: "✓",
		failure: "!"
	};
	function createIndicator(ui) {
		ui.useStyles(indicator_default);
		const pill = document.createElement("div");
		pill.className = "sel-copy-pill";
		pill.setAttribute("aria-hidden", "true");
		const icon = document.createElement("span");
		icon.className = "sel-copy-pill-icon";
		const label = document.createElement("span");
		label.className = "sel-copy-pill-label";
		pill.append(icon, label);
		let holdTimer;
		let fadeTimer;
		let token = 0;
		const clearTimers = () => {
			if (holdTimer !== void 0) window.clearTimeout(holdTimer);
			if (fadeTimer !== void 0) window.clearTimeout(fadeTimer);
			holdTimer = void 0;
			fadeTimer = void 0;
		};
		const show = ({ variant, rect }) => {
			const point = indicatorPosition(rect, {
				width: window.innerWidth,
				height: window.innerHeight
			}, variant);
			const current = ++token;
			clearTimers();
			icon.textContent = ICONS[variant];
			label.textContent = LABELS$1[variant];
			pill.dataset.variant = variant;
			pill.style.width = `${INDICATOR.widthPx[variant]}px`;
			if (!pill.isConnected) ui.layers.base.appendChild(pill);
			pill.style.left = `${point.left}px`;
			pill.style.top = `${point.top}px`;
			pill.dataset.visible = "true";
			holdTimer = window.setTimeout(() => {
				if (current !== token) return;
				pill.dataset.visible = "false";
				fadeTimer = window.setTimeout(() => {
					if (current !== token || !pill.isConnected) return;
					pill.remove();
				}, INDICATOR.fadeMs);
			}, INDICATOR.holdMs[variant]);
		};
		const destroy = () => {
			token += 1;
			clearTimers();
			pill.remove();
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
	* 页面级界面宿主：复制反馈与设置面板共用一个 `@ui` Shadow Root。
	*
	* 第一次真的需要显示反馈或打开设置时才挂载；普通页面不产生任何节点与样式。
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
	function createUiHost() {
		let ui = null;
		let indicator = null;
		const ensure = () => {
			if (!ui) ui = mountUI({
				theme: "system",
				labels: LABELS
			});
			return ui;
		};
		return {
			ensure,
			showFeedback(feedback) {
				try {
					const mounted = ensure();
					indicator ??= createIndicator(mounted);
					indicator.show(feedback);
				} catch (error) {
					console.error("[selection-copy] 复制提示显示失败", error);
				}
			}
		};
	}
	//#endregion
	//#region scripts/selection-copy/src/ui/settings-panel.ts
	function createSettingsPanel(options) {
		const initial = options.getSettings();
		const siteName = siteLabel(options.site);
		const panel = createPanel(options.ui, {
			title: "功能设置",
			description: "选中文字后自动复制为纯文本；下面的开关改完立即生效。",
			open: false,
			position: "center",
			closeLabel: "关闭设置"
		});
		const switchesSection = createSection(options.ui, {
			title: "开关",
			description: "总开关关掉后所有网站都停下来；单个网站可以单独关掉"
		});
		const enabledSwitch = createSwitch(options.ui, {
			checked: initial.enabled,
			onChange: (checked) => apply({ enabled: checked })
		});
		const siteSwitch = createSwitch(options.ui, {
			checked: !initial.disabledSites.includes(options.site),
			onChange: (checked) => apply(withSiteEnabled(options.getSettings(), options.site, checked))
		});
		switchesSection.body.append(createField(options.ui, {
			label: "启用选中复制",
			description: "关闭后不再复制，脚本菜单仍可打开这个面板",
			control: enabledSwitch,
			inline: true
		}).el, createField(options.ui, {
			label: `当前网站：${siteName}`,
			description: "只影响当前网站；总开关关闭时此处不起作用",
			control: siteSwitch,
			inline: true
		}).el);
		const scopeSection = createSection(options.ui, {
			title: "复制范围",
			description: "这两类区域默认不复制，避免编辑文字时剪贴板被反复覆盖"
		});
		const inputsSwitch = createSwitch(options.ui, {
			checked: initial.copyInInputs,
			onChange: (checked) => apply({ copyInInputs: checked })
		});
		const editorsSwitch = createSwitch(options.ui, {
			checked: initial.copyInEditors,
			onChange: (checked) => apply({ copyInEditors: checked })
		});
		scopeSection.body.append(createField(options.ui, {
			label: "输入框里也复制",
			description: "包括搜索框、文本框与文本域",
			control: inputsSwitch,
			inline: true
		}).el, createField(options.ui, {
			label: "富文本编辑器里也复制",
			description: "包括 contenteditable 区域；这类区域通常自带复制行为",
			control: editorsSwitch,
			inline: true
		}).el);
		const contentSection = createSection(options.ui, { title: "内容" });
		const trimSwitch = createSwitch(options.ui, {
			checked: initial.trimWhitespace,
			onChange: (checked) => apply({ trimWhitespace: checked })
		});
		contentSection.body.append(createField(options.ui, {
			label: "去掉首尾空白",
			description: "关闭后按选中的原样复制，保留两端的空格与换行",
			control: trimSwitch,
			inline: true
		}).el);
		panel.body.append(switchesSection.el, scopeSection.el, contentSection.el);
		const reset = createButton(options.ui, {
			label: "恢复默认",
			variant: "ghost",
			onClick: () => {
				apply({
					...DEFAULT_SETTINGS,
					disabledSites: []
				});
			}
		});
		panel.setFooter(reset.el);
		/** 合并一次改动、保存并回填，保证界面与真实设置保持一致。 */
		function apply(patch) {
			const next = normalizeSettings({
				...options.getSettings(),
				...patch
			});
			options.save(next);
			fillForm(next);
		}
		function fillForm(next) {
			enabledSwitch.setChecked(next.enabled);
			siteSwitch.setChecked(!next.disabledSites.includes(options.site));
			inputsSwitch.setChecked(next.copyInInputs);
			editorsSwitch.setChecked(next.copyInEditors);
			trimSwitch.setChecked(next.trimWhitespace);
		}
		return {
			open() {
				fillForm(options.getSettings());
				panel.open();
			},
			close: () => panel.close(),
			isOpen: () => panel.isOpen(),
			destroy: () => panel.destroy()
		};
	}
	//#endregion
	//#region scripts/selection-copy/src/main.ts
	/**
	* 入口：安装选中传感器并按顶层站点注册设置菜单。
	*
	* 每个 frame 独立注入：父文档收不到 iframe 内的鼠标事件，加 `@noframes` 会丢掉
	* iframe 内的复制能力。同一文档只装一份，用 DOM 属性兜底——不同管理器的沙箱之间
	* window 不一定共享，DOM 一定共享。
	*
	* 总开关 / 本站开关在每次复制时检查，不在启动时决定是否监听：这样顶层页面关掉
	* 当前站点后，同页 iframe 的下一次复制也会停下；反过来打开也能立即恢复。
	*
	* 菜单只在顶层页面注册：每个 iframe 各注册一次会让管理器菜单里出现重复项，
	* 面板也可能被塞进看不见的小 iframe 里。
	*/
	var INSTALL_LOCK_ATTRIBUTE = "data-selection-auto-copy-installed";
	var MENU_LABEL = "功能设置";
	function start() {
		const root = document.documentElement;
		if (!root || root.hasAttribute(INSTALL_LOCK_ATTRIBUTE)) return;
		root.setAttribute(INSTALL_LOCK_ATTRIBUTE, "");
		const gm = createGmApi();
		const store = createSettingsStore(gm);
		const site = topSiteKey(window);
		const app = createUiHost();
		const copy = createCopyAction({
			clipboard: createClipboard(),
			getSettings: store.get,
			site,
			showFeedback: app.showFeedback
		});
		installCopySensor({ onCopy: (target) => void copy(target) });
		let panel = null;
		const openSettings = () => {
			try {
				if (!panel) panel = createSettingsPanel({
					ui: app.ensure(),
					site,
					getSettings: store.get,
					save: (next) => {
						store.update(next);
					}
				});
				panel.open();
			} catch (error) {
				console.error("[selection-copy] 设置面板打开失败", error);
			}
		};
		if (window.top === window.self && !gm.registerMenuCommand(MENU_LABEL, openSettings)) console.warn("[selection-copy] 菜单命令不可用，设置面板无法打开");
	}
	try {
		start();
	} catch (error) {
		console.error("[selection-copy] 启动失败", error);
	}
	//#endregion
})();
