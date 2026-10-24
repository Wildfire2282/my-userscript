// ==UserScript==
// @name         拖拽打开
// @name:en      Drag to Open
// @namespace    https://github.com/Wildfire2282
// @version      2.8.3
// @description  拖拽文本搜索，拖拽链接在新标签页打开，拖拽图片查看
// @description:en Drag text to search, links to open, and images to view
// @author       Wildfire2282 (https://github.com/Wildfire2282)
// @license      MIT
// @homepageURL  https://github.com/Wildfire2282/my-userscript
// @supportURL   https://github.com/Wildfire2282/my-userscript/issues
// @source       https://github.com/Wildfire2282/my-userscript
// @match        https://*/*
// @match        http://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @run-at       document-end
// @noframes
// @downloadURL  https://update.greasyfork.org/scripts/580630/%E8%B6%85%E7%BA%A7%E6%8B%96%E6%8B%BD.user.js
// @updateURL    https://update.greasyfork.org/scripts/580630/%E8%B6%85%E7%BA%A7%E6%8B%96%E6%8B%BD.meta.js
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
	//#region scripts/super-drag/src/settings.ts
	/** 「自定义」引擎在 `defaultEngine` 里的取值；`engines` 里不会有这个键。 */
	var CUSTOM_ENGINE_ID = "custom";
	/** 线上旧键，按 AGENTS.md 6.4 不改名，否则老用户设置会丢。 */
	var SETTINGS_KEY = "settings";
	/** 没有存量设置时使用的值。 */
	var DEFAULT_SETTINGS = {
		defaultEngine: "google",
		customEngineUrl: "",
		engines: {
			"cn.bing": "https://cn.bing.com/search?q={keyword}",
			bing: "https://www.bing.com/search?q={keyword}",
			google: "https://www.google.com/search?q={keyword}",
			baidu: "https://www.baidu.com/s?wd={keyword}"
		},
		linkOpenMode: "background",
		urlTextAction: "open",
		imageAction: "viewer",
		dragKinds: {
			text: true,
			link: true,
			image: true
		}
	};
	function sanitizeEngines(value) {
		if (typeof value !== "object" || value === null) return { ...DEFAULT_SETTINGS.engines };
		const engines = {};
		for (const [id, template] of Object.entries(value)) {
			if (id === "custom") continue;
			if (typeof template === "string" && template.includes("{keyword}")) engines[id] = template;
		}
		return Object.keys(engines).length > 0 ? engines : { ...DEFAULT_SETTINGS.engines };
	}
	/**
	* 归一化三类拖拽开关。
	*
	* 只认显式的 `false`：存储里多出来的键、字符串、缺字段都按“开启”处理，
	* 避免坏值把用户唯一能用的拖拽也关掉。
	*/
	function sanitizeDragKinds(value) {
		const stored = typeof value === "object" && value !== null ? value : {};
		return {
			text: stored.text !== false,
			link: stored.link !== false,
			image: stored.image !== false
		};
	}
	/**
	* 把存储里读到的任意值收敛成可用设置。
	*
	* 存储可能被旧版本、手改或别的脚本写坏；单个字段坏掉只回退该字段，不让整页拖拽失效。
	* 旧版的 `enabled` 总开关不再读取：整体停用交给脚本管理器的开关。
	*/
	function normalizeSettings(stored) {
		const merged = mergeDefaults(DEFAULT_SETTINGS, stored);
		const engines = sanitizeEngines(merged.engines);
		const engine = typeof merged.defaultEngine === "string" && merged.defaultEngine !== "" ? merged.defaultEngine : DEFAULT_SETTINGS.defaultEngine;
		return {
			defaultEngine: engine === "custom" || Object.hasOwn(engines, engine) ? engine : Object.keys(engines)[0] ?? DEFAULT_SETTINGS.defaultEngine,
			customEngineUrl: typeof merged.customEngineUrl === "string" ? merged.customEngineUrl : "",
			engines,
			linkOpenMode: merged.linkOpenMode === "foreground" ? "foreground" : "background",
			urlTextAction: merged.urlTextAction === "search" ? "search" : "open",
			imageAction: merged.imageAction === "original" ? "original" : "viewer",
			dragKinds: sanitizeDragKinds(merged.dragKinds)
		};
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
	//#region scripts/super-drag/src/search.ts
	/** 设置面板里“效果预览”使用的示例关键词。 */
	var PREVIEW_KEYWORD = "hello";
	/** 内置引擎的显示名；存储里新增的引擎直接用 ID 当名字。 */
	var ENGINE_LABELS = {
		"cn.bing": "Bing (CN)",
		bing: "Bing",
		google: "Google",
		baidu: "Baidu"
	};
	var GOOGLE_FALLBACK = "https://www.google.com/search?q={keyword}";
	/** 未知引擎 ID 的显示名：把 `my-engine` 转成 `My Engine`，而不是直接甩出原始 ID。 */
	function humanizeEngineId(id) {
		return id.split(/[-_]/).map((part) => part === "" ? part : part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
	}
	/** 下拉选项：存储里的引擎 + 自定义。顺序沿用存储顺序，保证旧用户看到的顺序不变。 */
	function engineOptions(settings) {
		const options = Object.keys(settings.engines).map((id) => ({
			value: id,
			label: Object.hasOwn(ENGINE_LABELS, id) ? ENGINE_LABELS[id] : humanizeEngineId(id)
		}));
		options.push({
			value: CUSTOM_ENGINE_ID,
			label: "自定义"
		});
		return options;
	}
	/** 解析当前引擎的地址模板；配置无效时回退 Google，而不是打开一个坏地址。 */
	function resolveSearchTemplate(settings) {
		const template = settings.defaultEngine === "custom" ? settings.customEngineUrl : settings.engines[settings.defaultEngine];
		if (typeof template !== "string" || !template.includes("{keyword}")) return GOOGLE_FALLBACK;
		return template;
	}
	/** 把关键词编码后填进模板，得到最终搜索地址。 */
	function buildSearchUrl(settings, keyword) {
		return resolveSearchTemplate(settings).replaceAll("{keyword}", encodeURIComponent(keyword));
	}
	/**
	* 校验自定义搜索地址。
	*
	* @returns 错误文案；`null` 表示可用
	*/
	function validateCustomEngineUrl(url) {
		const value = url.trim();
		if (value === "") return "请填写自定义搜索 URL";
		if (!value.includes("{keyword}")) return "自定义搜索 URL 必须包含 {keyword} 占位符";
		if (!/^https?:\/\//i.test(value)) return "自定义搜索 URL 必须以 http:// 或 https:// 开头";
		let parsed;
		try {
			parsed = new URL(value.replaceAll("{keyword}", "x"));
		} catch {
			return "自定义搜索 URL 不是有效地址";
		}
		if (parsed.hostname === "") return "自定义搜索 URL 缺少域名";
		if (/\s/.test(value)) return "自定义搜索 URL 不能包含空格";
		return null;
	}
	/** 默认设置的深拷贝，供“恢复默认”按钮使用。 */
	function defaultSettings() {
		return {
			...DEFAULT_SETTINGS,
			engines: { ...DEFAULT_SETTINGS.engines },
			dragKinds: { ...DEFAULT_SETTINGS.dragKinds }
		};
	}
	var URL_PATTERN = /(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!-/]))?/i;
	/** @param text 任意文本 */
	function looksLikeUrl(text) {
		return URL_PATTERN.test(text);
	}
	/** 中文标点不可能出现在地址里：第一次出现就截断（`https://a。这是说明` → `https://a`）。 */
	var CJK_PUNCT = /[。、，．・…？！；：『』「」《》（）【】\u3000]/u;
	/** 地址结尾不可能是这些符号（句尾的 `。，;!?` 和全角引号括号）；半角 `)]}` 不在这里剥，
	* Wikipedia 的 `..._(film)` 就是右括号结尾，见 `balanceTrailingParen`。 */
	var TRAILING_PUNCT = /[。.，,;；:：!！?？'"'""…、〉》」』〕）]+$/u;
	/** 括号配平：右括号比左括号多时，多出来的只能是句尾混进来的，剥掉一个。
	*
	* `（见https://a)` → `https://a`；`..._(film)` 配平，保留。 */
	function balanceTrailingParen(url) {
		if (!url.endsWith(")")) return url;
		let depth = 0;
		for (const char of url) if (char === "(") depth += 1;
		else if (char === ")") depth -= 1;
		return depth < 0 ? url.slice(0, -1) : url;
	}
	/**
	* 从一段无空格的文字里切出地址：从协议头开始，到中文标点结束。
	*
	* `见https://example.com/a好` 这种粘在一起的也能切出中间的地址；
	* 纯 IDN（`https://例子.测试`，半角点）不受影响，只有全角标点会截断。
	*/
	function extractUrlCandidate(keyword) {
		const start = keyword.search(/(ftp|https?):\/\//i);
		const fromStart = start >= 0 ? keyword.slice(start) : keyword;
		const cut = fromStart.search(CJK_PUNCT);
		return balanceTrailingParen((cut >= 0 ? fromStart.slice(0, cut) : fromStart).replace(TRAILING_PUNCT, ""));
	}
	/**
	* 把拖拽的文本转成“直接打开”的地址。
	*
	* @returns 可直接打开的地址；`''` 表示应当走搜索
	*/
	function asDirectUrl(text) {
		const keyword = typeof text === "string" ? text.trim() : "";
		if (keyword === "" || keyword.length > 2048 || /\s/.test(keyword)) return "";
		const stripped = extractUrlCandidate(keyword);
		if (stripped === "") return "";
		return looksLikeUrl(stripped) ? stripped : "";
	}
	//#endregion
	//#region scripts/super-drag/src/features/drop-action.ts
	/**
	* 决定这次拖拽归不归脚本处理。
	*
	* 规则与线上原版一致：选区优先（按在选区里拖连接也是搜索），其次链接，再次图片，
	* 最后才是“可拖拽元素上带着一段选区”的兜底。
	*
	* 按在选区里但文字拖拽被关掉时直接不接管：用户此刻想拖的是文字，交还给网页原生拖拽，
	* 而不是突然打开压在下面的链接。
	*
	* @param kinds 三类拖拽各自的开关
	* @returns 要接管的内容；`null` 表示交给浏览器原生拖拽
	*/
	function decideDrag(candidate, kinds) {
		if (candidate.selection !== "" && candidate.selectionHit) return kinds.text ? {
			kind: "text",
			data: candidate.selection
		} : null;
		if (kinds.link && candidate.link !== "") return {
			kind: "link",
			data: candidate.link
		};
		if (kinds.image && candidate.image !== "") return {
			kind: "image",
			data: candidate.image
		};
		if (kinds.text && candidate.selection !== "") return {
			kind: "text",
			data: candidate.selection
		};
		return null;
	}
	/** 本次打开是否切到前台：按住 Shift，或设置里选了前台打开。 */
	function shouldOpenInForeground(shiftKey, linkOpenMode) {
		return shiftKey || linkOpenMode === "foreground";
	}
	/**
	* 把拖拽内容转成“打开什么”。
	*
	* 文本：网址且设置为直接打开时打开它，否则拼搜索地址；链接：打开链接；
	* 图片：交给图片打开流程（可能是查看器页面）。
	*/
	function resolveDropAction(kind, data, settings) {
		if (data === "") return null;
		if (kind === "link") return {
			kind: "url",
			url: data
		};
		if (kind === "image") return {
			kind: "image",
			url: data
		};
		if (settings.urlTextAction === "open") {
			const direct = asDirectUrl(data);
			if (direct !== "") return {
				kind: "url",
				url: direct
			};
		}
		return {
			kind: "search",
			url: buildSearchUrl(settings, data)
		};
	}
	//#endregion
	//#region scripts/super-drag/src/features/editable.ts
	/**
	* 判断事件发生在可编辑控件上。
	*
	* 输入框里的拖拽是浏览器原生的“移动文字 / 拖入粘贴”，脚本不能抢；
	* 但 contenteditable 祖先（例如评论富文本容器）不能一层层往上否决，否则静态评论文字也会失效。
	*/
	/** 元素本身是否是表单控件或可编辑区域。 */
	function isEditableField(node) {
		if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
		const tag = node.tagName.toLowerCase();
		if (tag === "input" || tag === "textarea" || tag === "select") return true;
		if (node.isContentEditable) return true;
		if (node.getAttribute("contenteditable") === "true") return true;
		if (node.getAttribute("role") === "textbox") return true;
		return false;
	}
	/**
	* 事件是否发生在页面自己声明的可拖动元素里（`draggable="true"`）。
	*
	* 卡片排序、上传区、看板列都用它实现原生拖拽；页面上只要存在一段文字选区，
	* 脚本的文字兜底就会把这类拖拽抢过来，用户原本的拖拽动作变成“搜索选中文字”。
	*/
	function isDraggableHost(node) {
		return node?.closest("[draggable=\"true\"]") != null;
	}
	/**
	* 取真实的事件目标。
	*
	* 在 window 捕获阶段监听时，Shadow DOM 内的事件会被重定向到宿主；
	* `composedPath()` 能拿回真正的内部节点（例如组件里的 `<input>`）。
	*/
	function realTarget(event) {
		try {
			if (typeof event.composedPath === "function") {
				const path = event.composedPath();
				if (path.length > 0) return path[0] ?? null;
			}
		} catch {}
		return event.target;
	}
	/**
	* 事件是否发生在输入框里（含 label 包着 input 这类结构）。
	*/
	function isInputElement(event) {
		const raw = realTarget(event);
		const target = raw instanceof Element ? raw : null;
		if (isEditableField(target)) return true;
		let node = target?.parentElement ?? null;
		while (node) {
			const tag = node.tagName.toLowerCase();
			if (tag === "input" || tag === "textarea" || tag === "select") return true;
			if (node.isContentEditable) break;
			node = node.parentElement;
		}
		return false;
	}
	//#endregion
	//#region scripts/super-drag/src/features/hit-test.ts
	var XLINK_NS = "http://www.w3.org/1999/xlink";
	/** 跨 Shadow 边界找父元素：先看 parentElement，再回到宿主。 */
	function parentAcrossShadow(node) {
		if (node.parentElement) return node.parentElement;
		const root = node.getRootNode();
		return root instanceof ShadowRoot ? root.host : null;
	}
	function isIgnorableHref(href) {
		return !href || href === "#" || href.toLowerCase().startsWith("javascript:");
	}
	/**
	* 解析链接地址。
	*
	* HTML 的 `a.href` 已是绝对地址，但 SVG 的 `<a>` 返回 SVGAnimatedString，
	* 所以统一读原始属性并用 `document.baseURI` 补全，顺带支持 `xlink:href`。
	*/
	function resolveLinkHref(node) {
		const raw = node.getAttribute("href") ?? node.getAttributeNS(XLINK_NS, "href") ?? "";
		if (raw === "") return "";
		try {
			return new URL(raw, document.baseURI).href;
		} catch {
			return "";
		}
	}
	/** 逐层穿透 open Shadow Root 取真实元素。 */
	function deepElementFromPoint(x, y) {
		let root = document;
		let element = null;
		for (;;) {
			let next;
			try {
				next = root.elementFromPoint(x, y);
			} catch {
				next = null;
			}
			if (!next) break;
			element = next;
			if (next.shadowRoot && next.shadowRoot.mode === "open") root = next.shadowRoot;
			else break;
		}
		return element;
	}
	/** 快路径：事件目标本身或其祖先就是链接 / 图片。 */
	function hitTestFast(target) {
		if (!target || target.nodeType !== Node.ELEMENT_NODE || typeof target.closest !== "function") return null;
		const tag = target.tagName.toUpperCase();
		let link = "";
		const linkEl = tag === "A" ? target : target.closest("a");
		if (linkEl && !isIgnorableHref(linkEl.getAttribute("href"))) link = resolveLinkHref(linkEl);
		let image = "";
		if (tag === "IMG") {
			const img = target;
			image = img.currentSrc || img.src || "";
		}
		return link || image ? {
			link,
			image
		} : null;
	}
	/** 慢路径：一次命中测试后往上爬，收集最近的链接 / 图片。 */
	function hitTestSlow(x, y) {
		const found = {
			link: "",
			image: ""
		};
		let node = deepElementFromPoint(x, y);
		while (node) {
			const tag = node.tagName.toUpperCase();
			if (found.link === "" && tag === "A") {
				if (!isIgnorableHref(node.getAttribute("href"))) {
					found.link = resolveLinkHref(node);
					if (found.link !== "") break;
				}
			} else if (found.image === "" && tag === "IMG") {
				const img = node;
				found.image = img.currentSrc || img.src || "";
			}
			node = parentAcrossShadow(node);
		}
		return found;
	}
	function hitTest(x, y, target) {
		return hitTestFast(target) ?? hitTestSlow(x, y);
	}
	/** 当前选中文本；没有选区时返回空字符串。 */
	function getSelectionText() {
		const selection = window.getSelection();
		return selection ? selection.toString().trim() : "";
	}
	function pointInRect(x, y, rect) {
		return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
	}
	function pointNearRect(x, y, rect, slop) {
		return x >= rect.left - slop && x <= rect.right + slop && y >= rect.top - slop && y <= rect.bottom + slop;
	}
	function caretRangeFromPoint(x, y) {
		try {
			if (typeof document.caretRangeFromPoint === "function") return document.caretRangeFromPoint(x, y);
		} catch {}
		return null;
	}
	/**
	* 判断按下点上的字符是否在选区内部。
	*
	* 不用 `selection.containsNode(node, true)`：它只要求节点与选区有交集，同一段文字里
	* 选区之外的按下点也算命中；`comparePoint` 比的是具体偏移，才对得上“按下的字符”。
	*/
	function isCaretInsideRange(range, container, offset) {
		if (typeof range.comparePoint === "function") try {
			return range.comparePoint(container, offset) === 0;
		} catch {}
		const selection = window.getSelection();
		if (selection && typeof selection.containsNode === "function") try {
			return selection.containsNode(container, true);
		} catch {
			return false;
		}
		return false;
	}
	/**
	* @param path 按下点途经的事件路径（内 → 外）；文档级选区被折叠时依次问带 `getSelection` 的节点
	*/
	function isPointInSelection(x, y, path = []) {
		const selection = window.getSelection();
		const active = selection && !selection.isCollapsed ? selection : path.map((node) => node.getSelection?.() ?? null).find((s) => s && !s.isCollapsed) ?? null;
		if (!active) return false;
		const range = active.getRangeAt(0);
		let rects = [];
		try {
			rects = Array.from(range.getClientRects());
		} catch {}
		for (const rect of rects) if (pointNearRect(x, y, rect, 4)) return true;
		const caret = caretRangeFromPoint(x, y);
		if (caret && isCaretInsideRange(range, caret.startContainer, caret.startOffset)) return true;
		if (rects.length > 0) return false;
		const anchor = range.commonAncestorContainer;
		const host = anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement;
		return !!host && pointInRect(x, y, host.getBoundingClientRect());
	}
	//#endregion
	//#region scripts/super-drag/src/features/dnd.ts
	var CLICK_SWALLOW_MS = 400;
	var GHOST_PIXEL_SRC = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
	/** 事件发生处最里层的元素；Shadow DOM 内的拖拽要拿到内部节点而不是宿主。 */
	function targetOf(event) {
		const target = realTarget(event);
		return target instanceof Element ? target : null;
	}
	function installDragSensor(deps) {
		const controller = new AbortController();
		const { signal } = controller;
		const listenerOptions = {
			capture: true,
			signal
		};
		let dragStart = null;
		let kind = "text";
		let data = "";
		let swallowClickUntil = 0;
		let dragSource = null;
		const ghost = document.createElement("img");
		ghost.src = GHOST_PIXEL_SRC;
		const reset = () => {
			dragStart = null;
			kind = "text";
			data = "";
		};
		const claim = (transfer, text) => {
			try {
				transfer.setData("text/plain", text);
				return true;
			} catch {
				return false;
			}
		};
		/** 事件发生处的链接 / 图片。 */
		const hitTestAt = (event) => {
			const target = realTarget(event);
			return hitTest(event.clientX, event.clientY, target instanceof Element ? target : null);
		};
		const handleDragStart = (event) => {
			reset();
			if (event.defaultPrevented) return;
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			if (isInputElement(event)) return;
			const transfer = event.dataTransfer;
			if (!transfer) return;
			const settings = deps.getSettings();
			const selected = getSelectionText();
			const selectionHit = selected !== "" && isPointInSelection(event.clientX, event.clientY, event.composedPath());
			if (!selectionHit && isDraggableHost(targetOf(event))) return;
			const hit = selectionHit ? {
				link: "",
				image: ""
			} : hitTestAt(event);
			const payload = decideDrag({
				link: hit.link,
				image: hit.image,
				selection: selected,
				selectionHit
			}, settings.dragKinds);
			if (!payload || !claim(transfer, payload.data)) return;
			try {
				transfer.effectAllowed = "copy";
				if (ghost.complete && ghost.naturalWidth > 0) transfer.setDragImage(ghost, 0, 0);
			} catch {}
			dragStart = event;
			kind = payload.kind;
			data = payload.data;
			dragSource = targetOf(event);
		};
		const isActiveDrag = (event) => {
			if (!dragStart) return false;
			if (dragStart.defaultPrevented || event.dataTransfer?.types.includes("Files")) {
				reset();
				return false;
			}
			return true;
		};
		const handleDragOver = (event) => {
			if (!isActiveDrag(event)) return;
			event.preventDefault();
			event.stopPropagation();
			try {
				if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
			} catch {}
		};
		const handleDrop = (event) => {
			if (!isActiveDrag(event)) return;
			if (isInputElement(event)) {
				reset();
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			swallowClickUntil = performance.now() + CLICK_SWALLOW_MS;
			const settings = deps.getSettings();
			const foreground = shouldOpenInForeground(event.shiftKey === true, settings.linkOpenMode);
			const action = resolveDropAction(kind, data, settings);
			try {
				if (action?.kind === "image") {
					if (settings.imageAction === "original") deps.openUrl(action.url, foreground);
					else deps.openImage(action.url, foreground);
				} else if (action) deps.openUrl(action.url, foreground);
			} finally {
				reset();
			}
		};
		const handleDragEnd = () => {
			reset();
		};
		const handleClickCapture = (event) => {
			if (swallowClickUntil !== 0 && performance.now() <= swallowClickUntil) {
				if (dragSource !== null && event.composedPath().includes(dragSource)) {
					swallowClickUntil = 0;
					dragSource = null;
					event.preventDefault();
					event.stopPropagation();
					event.stopImmediatePropagation();
					return;
				}
			}
			swallowClickUntil = 0;
			dragSource = null;
			reset();
		};
		const handleKeyDown = (event) => {
			if (event.key === "Escape") reset();
		};
		const handlePressStart = () => {
			swallowClickUntil = 0;
			dragSource = null;
			reset();
		};
		window.addEventListener("dragstart", handleDragStart, listenerOptions);
		window.addEventListener("dragover", handleDragOver, listenerOptions);
		window.addEventListener("drop", handleDrop, listenerOptions);
		window.addEventListener("dragend", handleDragEnd, listenerOptions);
		window.addEventListener("blur", reset, { signal });
		document.addEventListener("click", handleClickCapture, listenerOptions);
		document.addEventListener("keydown", handleKeyDown, listenerOptions);
		document.addEventListener("mousedown", handlePressStart, listenerOptions);
		return { destroy() {
			controller.abort();
			reset();
			swallowClickUntil = 0;
		} };
	}
	//#endregion
	//#region scripts/super-drag/src/features/openers.ts
	/**
	* 打开新标签页：链接直接打开；图片包一层深色查看器；后台打开时把焦点还给当前页。
	*
	* GM_openInTab 优先（脚本管理器能正确处理后台标签页），没有时退回 window.open。
	* 查看器 blob 只在 5 分钟后回收：提前回收会让刚打开、还没加载完的标签页变成空白页。
	*/
	var BLOB_REVOKE_DELAY_MS = 3e5;
	var VIEWER_CSS = "*{margin:0;padding:0}body{display:flex;align-items:center;justify-content:center;min-height:100vh;background:#000}img{max-width:100%;max-height:100vh;object-fit:contain}";
	/**
	* 生成图片查看器页面。
	*
	* 用 `createHTMLDocument` 建 DOM 再序列化，而不是拼 HTML 字符串：图片地址里的引号、
	* `&`、`<` 由浏览器负责转义，不会把地址拼成标签。
	*/
	function buildImageViewerHtml(imageUrl) {
		const doc = document.implementation.createHTMLDocument("Image");
		const meta = doc.createElement("meta");
		meta.setAttribute("charset", "utf-8");
		doc.head.prepend(meta);
		const style = doc.createElement("style");
		style.textContent = VIEWER_CSS;
		doc.head.appendChild(style);
		const img = doc.createElement("img");
		img.setAttribute("src", imageUrl);
		img.setAttribute("alt", "image");
		doc.body.appendChild(img);
		return `<!DOCTYPE html>${new XMLSerializer().serializeToString(doc.documentElement)}`;
	}
	function defaultScope() {
		const globals = globalThis;
		return {
			GM_openInTab: typeof globals.GM_openInTab === "function" ? globals.GM_openInTab.bind(globals) : void 0,
			open: window.open.bind(window),
			focus: () => window.focus()
		};
	}
	function createOpeners(scope = defaultScope()) {
		const openUrl = (url, active) => {
			if (typeof scope.GM_openInTab === "function") try {
				scope.GM_openInTab(url, {
					active,
					insert: true
				});
				return;
			} catch {}
			scope.open?.(url, "_blank", "noopener");
			if (!active) scope.focus?.();
		};
		const openImage = (imageUrl, active) => {
			if (/^(blob:|data:)/i.test(imageUrl)) {
				openUrl(imageUrl, active);
				return;
			}
			let url;
			try {
				url = URL.createObjectURL(new Blob([buildImageViewerHtml(imageUrl)], { type: "text/html" }));
			} catch {
				openUrl(imageUrl, active);
				return;
			}
			setTimeout(() => URL.revokeObjectURL(url), BLOB_REVOKE_DELAY_MS);
			openUrl(url, active);
		};
		return {
			openUrl,
			openImage
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
	/**
	* Invalid state has two independent owners: the control (`data-ds-invalid`)
	* and its Field (`data-ds-field-invalid`). `aria-invalid` is always the union,
	* so either side can change state without erasing the other's decision.
	*/
	function applyInvalid(input, invalid) {
		input.toggleAttribute("data-ds-invalid", invalid);
		syncAriaInvalid(input);
	}
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
	//#region packages/userscript-ui/src/components/input.css?inline
	var input_default = ".ds-input,\n.ds-textarea {\n  width: 100%;\n  min-width: 0;\n  border: var(--ds-border-width) solid var(--ds-input);\n  border-radius: var(--ds-radius-md);\n  background: transparent;\n  color: var(--ds-foreground);\n  font-family: inherit;\n  font-size: var(--ds-text-sm);\n  transition:\n    border-color var(--ds-duration-fast) var(--ds-ease),\n    box-shadow var(--ds-duration-fast) var(--ds-ease);\n}\n\n.ds-input {\n  height: var(--ds-control-h);\n  padding: 0 var(--ds-space-2-5);\n  line-height: normal;\n}\n\n.ds-textarea {\n  min-height: var(--ds-textarea-min-h);\n  padding: var(--ds-space-2) var(--ds-space-2-5);\n  line-height: var(--ds-leading-normal);\n  resize: vertical;\n}\n\n.ds-input::placeholder,\n.ds-textarea::placeholder {\n  color: var(--ds-muted-foreground);\n  opacity: 1;\n}\n\n.ds-input:hover:not(:disabled),\n.ds-textarea:hover:not(:disabled) {\n  border-color: color-mix(in srgb, var(--ds-input) 65%, var(--ds-foreground));\n}\n\n.ds-input:focus-visible,\n.ds-textarea:focus-visible {\n  border-color: var(--ds-ring);\n  outline: none;\n  box-shadow: 0 0 0 var(--ds-ring-width) color-mix(in srgb, var(--ds-ring) 24%, transparent);\n}\n\n.ds-input[aria-invalid='true'],\n.ds-textarea[aria-invalid='true'] {\n  border-color: var(--ds-destructive);\n}\n\n.ds-input[aria-invalid='true']:focus-visible,\n.ds-textarea[aria-invalid='true']:focus-visible {\n  box-shadow: 0 0 0 var(--ds-ring-width) color-mix(in srgb, var(--ds-destructive) 24%, transparent);\n}\n\n.ds-input:disabled,\n.ds-textarea:disabled {\n  opacity: 0.55;\n  cursor: not-allowed;\n}\n";
	//#endregion
	//#region packages/userscript-ui/src/components/input.ts
	/**
	* `data-ds-invalid` mirrors the control's own invalid state so a Field can add
	* a validation error without owning — or clearing — the control's state.
	*/
	function createInput(ui, options = {}) {
		assertAlive(ui, "input");
		ui.useStyles(input_default);
		const scope = createScope(ui);
		const input = document.createElement("input");
		input.className = "ds-input";
		input.type = options.type ?? "text";
		if (options.value != null) input.value = options.value;
		if (options.placeholder) input.placeholder = options.placeholder;
		if (options.name) input.name = options.name;
		if (options.id) input.id = options.id;
		if (options.disabled) input.disabled = true;
		if (options.readonly) input.readOnly = true;
		if (options.required) input.required = true;
		if (options.autocomplete) input.autocomplete = options.autocomplete;
		if (options.inputMode) input.inputMode = options.inputMode;
		if (options.min != null) input.min = String(options.min);
		if (options.max != null) input.max = String(options.max);
		if (options.step != null) input.step = String(options.step);
		if (options.ariaLabel) input.setAttribute("aria-label", options.ariaLabel);
		const setInvalid = (invalid) => applyInvalid(input, invalid);
		if (options.invalid) setInvalid(true);
		if (options.onInput) input.addEventListener("input", (event) => options.onInput?.(input.value, event), { signal: scope.signal });
		if (options.onChange) input.addEventListener("change", (event) => options.onChange?.(input.value, event), { signal: scope.signal });
		return {
			el: input,
			input,
			setValue(value) {
				input.value = value;
			},
			getValue() {
				return input.value;
			},
			setInvalid,
			destroy() {
				scope.destroy();
				input.remove();
			}
		};
	}
	//#endregion
	//#region packages/userscript-ui/src/components/select.css?inline
	var select_default = ".ds-select-wrap {\n  position: relative;\n  width: 100%;\n  min-width: 0;\n}\n\n.ds-select {\n  width: 100%;\n  height: var(--ds-control-h);\n  padding: 0 var(--ds-space-8) 0 var(--ds-space-2-5);\n  border: var(--ds-border-width) solid var(--ds-input);\n  border-radius: var(--ds-radius-md);\n  background: transparent;\n  color: var(--ds-foreground);\n  font-family: inherit;\n  font-size: var(--ds-text-sm);\n  line-height: normal;\n  appearance: none;\n  cursor: pointer;\n  transition:\n    border-color var(--ds-duration-fast) var(--ds-ease),\n    box-shadow var(--ds-duration-fast) var(--ds-ease);\n}\n\n.ds-select:hover:not(:disabled) {\n  border-color: color-mix(in srgb, var(--ds-input) 65%, var(--ds-foreground));\n}\n\n.ds-select:focus-visible {\n  border-color: var(--ds-ring);\n  outline: none;\n  box-shadow: 0 0 0 var(--ds-ring-width) color-mix(in srgb, var(--ds-ring) 24%, transparent);\n}\n\n.ds-select[aria-invalid='true'] {\n  border-color: var(--ds-destructive);\n}\n\n.ds-select[aria-invalid='true']:focus-visible {\n  box-shadow: 0 0 0 var(--ds-ring-width) color-mix(in srgb, var(--ds-destructive) 24%, transparent);\n}\n\n.ds-select:disabled {\n  opacity: 0.55;\n  cursor: not-allowed;\n}\n\n.ds-select option {\n  background: var(--ds-card);\n  color: var(--ds-card-foreground);\n}\n\n.ds-select-chevron {\n  position: absolute;\n  inset-block-start: 50%;\n  inset-inline-end: var(--ds-space-2);\n  width: var(--ds-icon-sm);\n  height: var(--ds-icon-sm);\n  color: var(--ds-muted-foreground);\n  pointer-events: none;\n  transform: translateY(-50%);\n}\n\n.ds-select:focus-visible + .ds-select-chevron {\n  color: var(--ds-foreground);\n}\n";
	//#endregion
	//#region packages/userscript-ui/src/components/select.ts
	function createSelect(ui, options) {
		assertAlive(ui, "select");
		ui.useStyles(select_default);
		const scope = createScope(ui);
		const wrap = document.createElement("span");
		wrap.className = "ds-select-wrap";
		const select = document.createElement("select");
		select.className = "ds-select";
		if (options.name) select.name = options.name;
		if (options.id) select.id = options.id;
		if (options.disabled) select.disabled = true;
		if (options.required) select.required = true;
		if (options.ariaLabel) select.setAttribute("aria-label", options.ariaLabel);
		const chevron = chevronDownIcon();
		chevron.classList.add("ds-select-chevron");
		let placeholderOption = null;
		const renderOptions = (next) => {
			select.replaceChildren();
			placeholderOption = null;
			if (options.placeholder && !next.some((item) => item.value === "")) {
				const placeholder = document.createElement("option");
				placeholder.value = "";
				placeholder.textContent = options.placeholder;
				placeholder.disabled = true;
				select.appendChild(placeholder);
				placeholderOption = placeholder;
			}
			for (const item of next) {
				const option = document.createElement("option");
				option.value = item.value;
				option.textContent = item.label;
				if (item.disabled) option.disabled = true;
				select.appendChild(option);
			}
		};
		renderOptions(options.options);
		const selectFirstEnabled = (items) => {
			const first = items.find((item) => !item.disabled);
			if (first) select.value = first.value;
			else select.selectedIndex = -1;
		};
		const requested = options.value;
		if (requested != null && options.options.some((item) => item.value === requested && !item.disabled)) select.value = requested;
		else if (placeholderOption) select.value = "";
		else selectFirstEnabled(options.options);
		wrap.append(select, chevron);
		const setInvalid = (invalid) => applyInvalid(select, invalid);
		if (options.invalid) setInvalid(true);
		if (options.onChange) select.addEventListener("change", (event) => options.onChange?.(select.value, event), { signal: scope.signal });
		return {
			el: wrap,
			input: select,
			setValue(value) {
				if (value === "" && placeholderOption || [...select.options].some((option) => option.value === value && !option.disabled)) select.value = value;
			},
			getValue() {
				return select.value;
			},
			setOptions(next) {
				const current = select.value;
				renderOptions(next);
				if ([...select.options].some((option) => option.value === current && !option.disabled)) select.value = current;
				else if (placeholderOption) select.value = "";
				else selectFirstEnabled(next);
			},
			setInvalid,
			destroy() {
				scope.destroy();
				wrap.remove();
			}
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
	//#region scripts/super-drag/src/ui/settings-panel.ts
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
	function createSettingsPanel(options) {
		const ui = mountUI({
			theme: "system",
			labels: LABELS
		});
		const initial = options.getSettings();
		const panel = createPanel(ui, {
			title: "功能设置",
			description: "拖拽选中文字搜索，拖拽链接或图片在新标签页打开；按住 Shift 这一次前台打开，按 Esc 取消。",
			open: false,
			position: "center",
			closeLabel: "关闭设置"
		});
		const kindsSection = createSection(ui, {
			title: "拖拽类型",
			description: "关掉某一类后，这类拖拽交还网页的原生行为"
		});
		const textSwitch = createSwitch(ui, { checked: initial.dragKinds.text });
		const linkSwitch = createSwitch(ui, { checked: initial.dragKinds.link });
		const imageSwitch = createSwitch(ui, { checked: initial.dragKinds.image });
		kindsSection.body.append(createField(ui, {
			label: "文字",
			description: "选中文字后拖动即搜索",
			control: textSwitch,
			inline: true
		}).el, createField(ui, {
			label: "链接",
			description: "拖动链接在新标签页打开",
			control: linkSwitch,
			inline: true
		}).el, createField(ui, {
			label: "图片",
			description: "拖动图片在新标签页查看",
			control: imageSwitch,
			inline: true
		}).el);
		const textSection = createSection(ui, { title: "文字拖拽" });
		const engine = createSelect(ui, {
			options: engineOptions(initial),
			value: initial.defaultEngine,
			onChange: () => refresh()
		});
		const engineField = createField(ui, {
			label: "搜索引擎",
			description: "拖动选中的文字即用它搜索",
			control: engine
		});
		const customInput = createInput(ui, {
			type: "url",
			placeholder: "https://www.google.com/search?q={keyword}",
			autocomplete: "off",
			onInput: () => refresh()
		});
		const customField = createField(ui, {
			label: "自定义搜索地址",
			description: "用 {keyword} 占位，需以 http:// 或 https:// 开头",
			control: customInput
		});
		const urlTextAction = createSelect(ui, {
			options: [{
				value: "open",
				label: "直接打开"
			}, {
				value: "search",
				label: "仍然搜索"
			}],
			value: initial.urlTextAction,
			onChange: () => refresh()
		});
		const urlTextActionField = createField(ui, {
			label: "拖动的文字是网址时",
			description: "选「直接打开」时不再经过搜索引擎",
			control: urlTextAction
		});
		textSection.body.append(engineField.el, customField.el, urlTextActionField.el);
		const linkSection = createSection(ui, { title: "链接与图片" });
		const openMode = createSelect(ui, {
			options: [{
				value: "background",
				label: "后台打开（停留在当前页）"
			}, {
				value: "foreground",
				label: "前台打开（立即切换过去）"
			}],
			value: initial.linkOpenMode,
			onChange: () => refresh()
		});
		const openModeField = createField(ui, {
			label: "新标签页打开方式",
			description: "链接、图片和搜索结果都按这里的方式打开；按住 Shift 时这一次总是前台打开",
			control: openMode
		});
		const imageAction = createSelect(ui, {
			options: [{
				value: "viewer",
				label: "打开深色查看器"
			}, {
				value: "original",
				label: "直接打开原图"
			}],
			value: initial.imageAction,
			onChange: () => refresh()
		});
		const imageActionField = createField(ui, {
			label: "拖拽图片时",
			description: "查看器适合专注看图；原图适合保存或交给浏览器自带的图片页",
			control: imageAction
		});
		linkSection.body.append(openModeField.el, imageActionField.el);
		panel.body.append(kindsSection.el, textSection.el, linkSection.el);
		/** 表单当前值；不改动已保存的设置。 */
		const draft = () => ({
			...options.getSettings(),
			dragKinds: {
				text: textSwitch.isChecked(),
				link: linkSwitch.isChecked(),
				image: imageSwitch.isChecked()
			},
			defaultEngine: engine.getValue(),
			customEngineUrl: customInput.getValue().trim(),
			urlTextAction: urlTextAction.getValue() === "search" ? "search" : "open",
			imageAction: imageAction.getValue() === "original" ? "original" : "viewer",
			linkOpenMode: openMode.getValue() === "foreground" ? "foreground" : "background"
		});
		/** 只刷新派生显示：自定义行的显隐、示例地址、错误提示。 */
		function refresh() {
			const current = draft();
			const isCustom = current.defaultEngine === CUSTOM_ENGINE_ID;
			customField.el.hidden = !isCustom;
			engineField.setDescription(`示例：${buildSearchUrl(current, PREVIEW_KEYWORD)}`);
			if (isCustom && current.customEngineUrl !== "") customField.setError(validateCustomEngineUrl(current.customEngineUrl) ?? void 0);
			else customField.setError(void 0);
		}
		/** 用给定设置回填表单（打开、取消、恢复默认都走这里）。 */
		function fillForm(next) {
			textSwitch.setChecked(next.dragKinds.text);
			linkSwitch.setChecked(next.dragKinds.link);
			imageSwitch.setChecked(next.dragKinds.image);
			engine.setOptions(engineOptions(next));
			engine.setValue(next.defaultEngine);
			customInput.setValue(next.customEngineUrl);
			urlTextAction.setValue(next.urlTextAction);
			imageAction.setValue(next.imageAction);
			openMode.setValue(next.linkOpenMode);
			refresh();
		}
		const reset = createButton(ui, {
			label: "恢复默认",
			variant: "ghost",
			onClick: () => fillForm(defaultSettings())
		});
		const cancel = createButton(ui, {
			label: "取消",
			variant: "secondary",
			onClick: () => {
				fillForm(options.getSettings());
				panel.close();
			}
		});
		const save = createButton(ui, {
			label: "保存",
			variant: "primary",
			onClick: () => {
				const next = draft();
				if (next.defaultEngine === "custom") {
					const problem = validateCustomEngineUrl(next.customEngineUrl);
					if (problem) {
						customField.setError(problem);
						customInput.input.focus();
						return;
					}
				}
				options.save(next);
				panel.close();
			}
		});
		panel.setFooter([
			reset.el,
			cancel.el,
			save.el
		]);
		return {
			open() {
				fillForm(options.getSettings());
				panel.open();
			},
			close: () => panel.close(),
			isOpen: () => panel.isOpen(),
			destroy: () => ui.destroy()
		};
	}
	//#endregion
	//#region scripts/super-drag/src/main.ts
	/**
	* 入口：挂拖拽监听、注册菜单项。
	*
	* 设置面板与 UI 都在第一次打开设置时才创建，所以普通页面只有几条事件监听，
	* 不注入样式、不生成节点。
	*/
	var MENU_LABEL = "功能设置";
	function start() {
		const gm = createGmApi();
		const store = createSettingsStore(gm);
		const openers = createOpeners();
		installDragSensor({
			getSettings: store.get,
			openUrl: openers.openUrl,
			openImage: openers.openImage
		});
		let panel = null;
		const openSettings = () => {
			try {
				if (!panel) panel = createSettingsPanel({
					getSettings: store.get,
					save: (patch) => void store.update(patch)
				});
				panel.open();
			} catch (error) {
				console.error("[super-drag] 设置面板打开失败", error);
			}
		};
		if (!gm.registerMenuCommand(MENU_LABEL, openSettings)) console.warn("[super-drag] 菜单命令不可用，设置面板无法打开");
	}
	try {
		start();
	} catch (error) {
		console.error("[super-drag] 启动失败", error);
	}
	//#endregion
})();
