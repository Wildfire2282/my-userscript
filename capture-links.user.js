// ==UserScript==
// @name         捕获链接
// @name:en      Link Capture
// @namespace    https://github.com/Wildfire2282
// @version      1.3.1
// @description  捕获页面中的全部链接，支持关键词筛选与批量复制
// @description:en Collect, filter, and copy all links on a page
// @author       Wildfire2282 (https://github.com/Wildfire2282)
// @license      MIT
// @homepageURL  https://github.com/Wildfire2282/my-userscript
// @supportURL   https://github.com/Wildfire2282/my-userscript/issues
// @source       https://github.com/Wildfire2282/my-userscript
// @match        https://*/*
// @match        http://*/*
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-end
// @noframes
// @downloadURL  https://update.greasyfork.org/scripts/582371/%E6%8D%95%E8%8E%B7%E9%93%BE%E6%8E%A5.user.js
// @updateURL    https://update.greasyfork.org/scripts/582371/%E6%8D%95%E8%8E%B7%E9%93%BE%E6%8E%A5.meta.js
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
	//#region scripts/capture-links/src/settings.ts
	/** 线上旧键，按 AGENTS.md 6.4 不改名，否则老用户设置会丢。 */
	var SETTINGS_KEY = "settings";
	/** 没有存量设置时使用的值。 */
	var DEFAULT_SETTINGS = {
		showFloatButton: true,
		copyFormat: "url"
	};
	/** 把任意存储值或控件值收敛成合法的复制格式。 */
	function toCopyFormat(value) {
		return value === "markdown" || value === "html" ? value : "url";
	}
	/**
	* 把存储里读到的任意值收敛成可用设置。
	*
	* 单个字段坏掉只回退该字段：存储可能被旧版本、手改或别的脚本写坏，
	* 不能让一个坏值把悬浮按钮或复制格式一起弄丢。
	*/
	function normalizeSettings(stored) {
		const merged = mergeDefaults(DEFAULT_SETTINGS, stored);
		return {
			showFloatButton: merged.showFloatButton !== false,
			copyFormat: toCopyFormat(merged.copyFormat)
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
	var SVG_NS$1 = "http://www.w3.org/2000/svg";
	function icon(paths, size = 16) {
		const svg = document.createElementNS(SVG_NS$1, "svg");
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
			const path = document.createElementNS(SVG_NS$1, "path");
			path.setAttribute("d", definition);
			svg.appendChild(path);
		}
		return svg;
	}
	var closeIcon = () => icon(["M18 6 6 18", "m6 6 12 12"]);
	var chevronDownIcon = () => icon(["m6 9 6 6 6-6"]);
	var slidersIcon = () => icon([
		"M4 21v-7",
		"M4 10V3",
		"M12 21v-9",
		"M12 8V3",
		"M20 21v-5",
		"M20 12V3",
		"M1 14h6",
		"M9 8h6",
		"M17 16h6"
	]);
	var circle = "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20";
	var infoIcon = () => icon([
		circle,
		"M12 16v-4",
		"M12 8h.01"
	]);
	var successIcon = () => icon([circle, "m8 12 3 3 5-6"]);
	var warningIcon = () => icon([
		"M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
		"M12 9v4",
		"M12 17h.01"
	]);
	var errorIcon = () => icon([
		circle,
		"m15 9-6 6",
		"m9 9 6 6"
	]);
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
	//#region packages/userscript-ui/src/components/checkbox.css?inline
	var checkbox_default = ".ds-checkbox {\n  position: relative;\n  display: inline-flex;\n  width: var(--ds-checkbox-size);\n  height: var(--ds-checkbox-size);\n  flex: none;\n  vertical-align: middle;\n}\n\n.ds-checkbox-input {\n  position: absolute;\n  inset: 0;\n  z-index: 1;\n  width: 100%;\n  height: 100%;\n  margin: 0;\n  opacity: 0;\n  cursor: pointer;\n}\n\n.ds-checkbox-box {\n  position: absolute;\n  inset: 0;\n  border: var(--ds-border-width) solid var(--ds-input);\n  border-radius: var(--ds-radius-sm);\n  background: transparent;\n  transition:\n    background-color var(--ds-duration-fast) var(--ds-ease),\n    border-color var(--ds-duration-fast) var(--ds-ease);\n}\n\n.ds-checkbox-input:hover:not(:disabled) + .ds-checkbox-box {\n  border-color: var(--ds-ring);\n}\n\n.ds-checkbox-input:checked + .ds-checkbox-box,\n.ds-checkbox-input:indeterminate + .ds-checkbox-box {\n  border-color: var(--ds-primary);\n  background: var(--ds-primary);\n}\n\n.ds-checkbox-input:checked + .ds-checkbox-box::after {\n  position: absolute;\n  inset-block-start: 2px;\n  inset-inline-start: 5px;\n  width: 4px;\n  height: 8px;\n  border: solid var(--ds-primary-foreground);\n  border-width: 0 2px 2px 0;\n  content: '';\n  transform: rotate(45deg);\n}\n\n.ds-checkbox-input:indeterminate + .ds-checkbox-box::after {\n  position: absolute;\n  inset-block-start: 6px;\n  inset-inline-start: 3px;\n  width: 8px;\n  height: 2px;\n  border-radius: 1px;\n  background: var(--ds-primary-foreground);\n  content: '';\n}\n\n.ds-checkbox-input:focus-visible + .ds-checkbox-box {\n  outline: var(--ds-ring-width) solid var(--ds-ring);\n  outline-offset: var(--ds-ring-offset);\n}\n\n.ds-checkbox-input:disabled {\n  cursor: not-allowed;\n}\n\n.ds-checkbox-input:disabled + .ds-checkbox-box {\n  opacity: 0.5;\n}\n";
	//#endregion
	//#region packages/userscript-ui/src/components/checkbox.ts
	function createCheckbox(ui, options = {}) {
		assertAlive(ui, "checkbox");
		ui.useStyles(checkbox_default);
		const scope = createScope(ui);
		const root = document.createElement("span");
		root.className = "ds-checkbox";
		const input = document.createElement("input");
		input.type = "checkbox";
		input.className = "ds-checkbox-input";
		input.checked = options.checked ?? false;
		if (options.name) input.name = options.name;
		if (options.value != null) input.value = options.value;
		if (options.id) input.id = options.id;
		if (options.disabled) input.disabled = true;
		if (options.ariaLabel) input.setAttribute("aria-label", options.ariaLabel);
		const box = document.createElement("span");
		box.className = "ds-checkbox-box";
		box.setAttribute("aria-hidden", "true");
		root.append(input, box);
		const applyIndeterminate = (indeterminate) => {
			input.indeterminate = indeterminate;
			if (indeterminate) input.setAttribute("aria-checked", "mixed");
			else input.removeAttribute("aria-checked");
		};
		applyIndeterminate(options.indeterminate ?? false);
		input.addEventListener("change", (event) => {
			applyIndeterminate(false);
			options.onChange?.(input.checked, event);
		}, { signal: scope.signal });
		return {
			el: root,
			input,
			setChecked(checked) {
				applyIndeterminate(false);
				input.checked = checked;
			},
			setIndeterminate(indeterminate) {
				applyIndeterminate(indeterminate);
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
	//#region packages/userscript-ui/src/components/feedback.ts
	function feedbackIcon(variant) {
		switch (variant) {
			case "success": return successIcon();
			case "warning": return warningIcon();
			case "error": return errorIcon();
			default: return infoIcon();
		}
	}
	//#endregion
	//#region packages/userscript-ui/src/core/top-layer.ts
	var states = /* @__PURE__ */ new WeakMap();
	function stateOf(ui) {
		let state = states.get(ui);
		if (!state) {
			state = {
				dialogs: [],
				listeners: /* @__PURE__ */ new Set()
			};
			states.set(ui, state);
		}
		return state;
	}
	function topLayerHost(ui) {
		const dialogs = states.get(ui)?.dialogs;
		if (!dialogs?.length) return null;
		return dialogs[dialogs.length - 1] ?? null;
	}
	function onTopLayerChange(ui, listener) {
		const state = stateOf(ui);
		state.listeners.add(listener);
		return () => {
			state.listeners.delete(listener);
		};
	}
	/**
	* Host for UI that must stay visible above a modal: the most recently opened
	* dialog of this UI, otherwise the given layer. The top layer is the only
	* place a shadow-tree element can paint above `::backdrop`.
	*/
	function overlayHost(ui, fallback) {
		return topLayerHost(ui) ?? fallback;
	}
	//#endregion
	//#region packages/userscript-ui/src/components/toast.css?inline
	var toast_default = ".ds-toast-viewport {\n  position: fixed;\n  inset-block-start: var(--ds-launcher-offset);\n  inset-inline-end: var(--ds-launcher-offset);\n  display: flex;\n  flex-direction: column;\n  gap: var(--ds-space-2);\n  width: min(var(--ds-toast-width), calc(100vw - 2 * var(--ds-launcher-offset)));\n  pointer-events: none;\n}\n\n.ds-toast {\n  display: flex;\n  align-items: flex-start;\n  gap: var(--ds-space-2-5);\n  padding: var(--ds-space-3);\n  border: var(--ds-border-width) solid var(--ds-border);\n  border-inline-start: var(--ds-accent-width) solid var(--ds-muted-foreground);\n  border-radius: var(--ds-radius-md);\n  background: var(--ds-card);\n  color: var(--ds-card-foreground);\n  box-shadow: var(--ds-shadow-md);\n  pointer-events: auto;\n  animation: ds-toast-in var(--ds-duration-base) var(--ds-ease);\n}\n\n.ds-toast--success {\n  border-inline-start-color: var(--ds-success);\n}\n\n.ds-toast--info {\n  border-inline-start-color: var(--ds-primary);\n}\n\n.ds-toast--warning {\n  border-inline-start-color: var(--ds-warning);\n}\n\n.ds-toast--error {\n  border-inline-start-color: var(--ds-destructive);\n}\n\n.ds-toast-icon {\n  display: flex;\n  flex: none;\n  margin-block-start: var(--ds-border-width);\n  color: var(--ds-muted-foreground);\n}\n\n.ds-toast-icon svg {\n  width: var(--ds-icon);\n  height: var(--ds-icon);\n}\n\n.ds-toast--success .ds-toast-icon {\n  color: var(--ds-success);\n}\n\n.ds-toast--info .ds-toast-icon {\n  color: var(--ds-primary);\n}\n\n.ds-toast--warning .ds-toast-icon {\n  color: var(--ds-warning);\n}\n\n.ds-toast--error .ds-toast-icon {\n  color: var(--ds-destructive);\n}\n\n.ds-toast-content {\n  display: flex;\n  flex: 1;\n  flex-direction: column;\n  gap: var(--ds-space-0-5);\n  min-width: 0;\n}\n\n.ds-toast-title {\n  margin: 0;\n  font-size: var(--ds-text-sm);\n  font-weight: var(--ds-weight-medium);\n  line-height: var(--ds-leading-snug);\n}\n\n.ds-toast-description {\n  margin: 0;\n  color: var(--ds-muted-foreground);\n  font-size: var(--ds-text-xs);\n  line-height: var(--ds-leading-snug);\n}\n\n.ds-toast-close {\n  flex: none;\n  margin-block-start: calc(-1 * var(--ds-space-1));\n  margin-inline-end: calc(-1 * var(--ds-space-1));\n}\n\n/* Visually hidden live regions stay in the DOM so announcements are reliable. */\n.ds-toast-announcer {\n  position: absolute;\n  width: var(--ds-border-width);\n  height: var(--ds-border-width);\n  margin: calc(-1 * var(--ds-border-width));\n  padding: 0;\n  overflow: hidden;\n  clip: rect(0 0 0 0);\n  clip-path: inset(50%);\n  white-space: nowrap;\n  border: 0;\n  pointer-events: none;\n}\n\n@keyframes ds-toast-in {\n  from {\n    opacity: 0;\n    transform: translateY(-4px);\n  }\n\n  to {\n    opacity: 1;\n    transform: none;\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .ds-toast {\n    animation: none;\n  }\n}\n";
	//#endregion
	//#region packages/userscript-ui/src/components/toast.ts
	var DEFAULT_DURATION = {
		success: 4e3,
		info: 4e3,
		warning: 6e3,
		error: 8e3
	};
	function createToast(ui, options = {}) {
		assertAlive(ui, "toast");
		ui.useStyles(toast_default);
		const scope = createScope(ui);
		let destroyed = false;
		const max = Math.max(1, options.max ?? 4);
		const records = [];
		const viewport = document.createElement("div");
		viewport.className = "ds-toast-viewport";
		viewport.setAttribute("data-ds-toast-viewport", "");
		viewport.setAttribute("role", "region");
		viewport.setAttribute("aria-label", options.regionLabel ?? ui.labels.notifications);
		const announcers = {
			polite: createAnnouncer("polite"),
			assertive: createAnnouncer("assertive")
		};
		viewport.append(announcers.polite, announcers.assertive);
		const announcementVersions = {
			polite: 0,
			assertive: 0
		};
		const announce = (variant, title, description) => {
			const politeness = variant === "error" ? "assertive" : "polite";
			const target = announcers[politeness];
			const version = ++announcementVersions[politeness];
			const message = [title, description].filter(Boolean).join(" ");
			if (target.textContent === message) {
				target.textContent = "";
				queueMicrotask(() => {
					if (!destroyed && announcementVersions[politeness] === version) target.textContent = message;
				});
				return;
			}
			target.textContent = message;
		};
		const attachViewport = () => {
			if (destroyed) return;
			const host = overlayHost(ui, ui.layers.toast);
			if (viewport.parentElement !== host) host.appendChild(viewport);
		};
		attachViewport();
		const detachTopLayer = onTopLayerChange(ui, attachViewport);
		scope.onDestroy(() => {
			detachTopLayer();
			viewport.remove();
		});
		const dismiss = (id) => {
			records.find((item) => item.id === id)?.remove();
		};
		const clear = () => {
			let failed = false;
			let failure;
			for (const record of [...records]) try {
				record.remove();
			} catch (error) {
				if (!failed) {
					failed = true;
					failure = error;
				}
			}
			if (failed) throw failure;
		};
		const show = (toastOptions) => {
			if (destroyed) throw new Error("Cannot show a toast after its controller is destroyed.");
			if (!toastOptions.title && !toastOptions.description) throw new Error("Toasts require a title or description.");
			const id = toastOptions.id ?? uid("ds-toast");
			dismiss(id);
			if (destroyed) throw new Error("Cannot show a toast after its controller is destroyed.");
			const variant = toastOptions.variant ?? "info";
			const duration = toastOptions.duration ?? DEFAULT_DURATION[variant];
			const autoDismiss = duration > 0;
			const local = new AbortController();
			const el = document.createElement("div");
			el.className = `ds-toast ds-toast--${variant}`;
			el.setAttribute("data-ds-toast", "");
			const icon = document.createElement("span");
			icon.className = "ds-toast-icon";
			icon.setAttribute("aria-hidden", "true");
			icon.appendChild(feedbackIcon(variant));
			const content = document.createElement("div");
			content.className = "ds-toast-content";
			if (toastOptions.title) {
				const title = document.createElement("p");
				title.className = "ds-toast-title";
				title.textContent = toastOptions.title;
				content.appendChild(title);
			}
			if (toastOptions.description) {
				const description = document.createElement("p");
				description.className = "ds-toast-description";
				description.textContent = toastOptions.description;
				content.appendChild(description);
			}
			let timer = null;
			let remaining = duration;
			let startedAt = 0;
			let removed = false;
			let hovered = false;
			let focused = false;
			const startTimer = () => {
				if (!autoDismiss || removed || destroyed || remaining <= 0) return;
				startedAt = Date.now();
				timer = window.setTimeout(() => remove(), remaining);
			};
			const pause = () => {
				if (timer == null) return;
				window.clearTimeout(timer);
				timer = null;
				remaining -= Date.now() - startedAt;
			};
			const resume = () => {
				if (!autoDismiss || hovered || focused || timer != null || removed) return;
				if (remaining <= 0) {
					remove();
					return;
				}
				startTimer();
			};
			const remove = () => {
				if (removed) return;
				removed = true;
				if (timer != null) window.clearTimeout(timer);
				local.abort();
				close.destroy();
				el.remove();
				const index = records.indexOf(record);
				if (index >= 0) records.splice(index, 1);
				toastOptions.onDismiss?.();
			};
			const close = createButton(ui, {
				size: "sm",
				variant: "ghost",
				iconOnly: true,
				ariaLabel: options.dismissLabel ?? ui.labels.dismissNotification,
				icon: closeIcon()
			});
			close.el.classList.add("ds-toast-close");
			close.el.addEventListener("click", remove, { signal: local.signal });
			el.append(icon, content, close.el);
			el.addEventListener("pointerenter", () => {
				hovered = true;
				pause();
			}, { signal: local.signal });
			el.addEventListener("pointerleave", () => {
				hovered = false;
				resume();
			}, { signal: local.signal });
			el.addEventListener("focusin", () => {
				focused = true;
				pause();
			}, { signal: local.signal });
			el.addEventListener("focusout", (event) => {
				if (!el.contains(event.relatedTarget)) {
					focused = false;
					resume();
				}
			}, { signal: local.signal });
			const record = {
				id,
				el,
				variant,
				dismiss: remove,
				remove
			};
			records.unshift(record);
			viewport.prepend(el);
			announce(variant, toastOptions.title, toastOptions.description);
			startTimer();
			while (records.length > max) records[records.length - 1]?.remove();
			return record;
		};
		const teardown = () => {
			if (destroyed) return;
			destroyed = true;
			try {
				clear();
			} finally {
				scope.destroy();
			}
		};
		scope.onDestroy(teardown);
		return {
			show,
			success: (title, extra) => show({
				...extra,
				title,
				variant: "success"
			}),
			info: (title, extra) => show({
				...extra,
				title,
				variant: "info"
			}),
			warning: (title, extra) => show({
				...extra,
				title,
				variant: "warning"
			}),
			error: (title, extra) => show({
				...extra,
				title,
				variant: "error"
			}),
			dismiss,
			clear,
			destroy: teardown
		};
	}
	function createAnnouncer(politeness) {
		const announcer = document.createElement("div");
		announcer.className = "ds-toast-announcer";
		announcer.setAttribute("aria-live", politeness);
		announcer.setAttribute("aria-atomic", "true");
		return announcer;
	}
	//#endregion
	//#region packages/userscript-ui/src/components/floating-launcher.css?inline
	var floating_launcher_default = ".ds-launcher {\n  position: fixed;\n  z-index: 1;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: var(--ds-launcher-size);\n  height: var(--ds-launcher-size);\n  padding: 0;\n  border: var(--ds-border-width) solid var(--ds-border);\n  border-radius: var(--ds-radius-full);\n  background: var(--ds-card);\n  color: var(--ds-foreground);\n  box-shadow: var(--ds-shadow-md);\n  cursor: pointer;\n  pointer-events: auto;\n  transition:\n    background-color var(--ds-duration-fast) var(--ds-ease),\n    border-color var(--ds-duration-fast) var(--ds-ease),\n    box-shadow var(--ds-duration-fast) var(--ds-ease),\n    transform var(--ds-duration-fast) var(--ds-ease);\n}\n\n.ds-launcher:hover {\n  border-color: var(--ds-input);\n  background: var(--ds-muted);\n}\n\n.ds-launcher:active {\n  transform: translateY(var(--ds-border-width));\n}\n\n.ds-launcher:focus-visible {\n  outline: var(--ds-ring-width) solid var(--ds-ring);\n  outline-offset: var(--ds-ring-offset);\n}\n\n.ds-launcher[aria-expanded='true'] {\n  border-color: var(--ds-ring);\n  background: var(--ds-muted);\n}\n\n.ds-launcher svg {\n  width: var(--ds-launcher-icon);\n  height: var(--ds-launcher-icon);\n}\n\n.ds-launcher[data-position='bottom-right'] {\n  inset-block-end: calc(var(--ds-launcher-offset) + env(safe-area-inset-bottom, 0px));\n  inset-inline-end: calc(var(--ds-launcher-offset) + env(safe-area-inset-right, 0px));\n}\n\n.ds-launcher[data-position='bottom-left'] {\n  inset-block-end: calc(var(--ds-launcher-offset) + env(safe-area-inset-bottom, 0px));\n  inset-inline-start: calc(var(--ds-launcher-offset) + env(safe-area-inset-left, 0px));\n}\n\n.ds-launcher[data-position='top-right'] {\n  inset-block-start: calc(var(--ds-launcher-offset) + env(safe-area-inset-top, 0px));\n  inset-inline-end: calc(var(--ds-launcher-offset) + env(safe-area-inset-right, 0px));\n}\n\n.ds-launcher[data-position='top-left'] {\n  inset-block-start: calc(var(--ds-launcher-offset) + env(safe-area-inset-top, 0px));\n  inset-inline-start: calc(var(--ds-launcher-offset) + env(safe-area-inset-left, 0px));\n}\n";
	//#endregion
	//#region packages/userscript-ui/src/components/floating-launcher.ts
	function createLauncher(ui, options) {
		assertAlive(ui, "launcher");
		ui.useStyles(floating_launcher_default);
		const scope = createScope(ui);
		const position = options.position ?? "bottom-right";
		const el = document.createElement("button");
		el.type = "button";
		el.className = "ds-launcher";
		el.setAttribute("data-ds-launcher", "");
		el.dataset.position = position;
		el.setAttribute("aria-label", options.label);
		const icon = options.icon ?? slidersIcon();
		el.appendChild(icon);
		const syncExpanded = (open) => {
			el.setAttribute("aria-expanded", String(open));
			el.setAttribute("aria-label", open ? options.closeLabel ?? ui.labels.closeSettings : options.label);
		};
		let unsubscribe;
		if (options.panel) {
			options.panel.setPosition(position);
			if (!options.panel.el.id) options.panel.el.id = uid("ds-panel");
			el.setAttribute("aria-controls", options.panel.el.id);
			syncExpanded(options.panel.isOpen());
			unsubscribe = options.panel.onOpenChange(syncExpanded);
			scope.onDestroy(() => unsubscribe?.());
		}
		el.addEventListener("pointerdown", (event) => event.stopPropagation(), { signal: scope.signal });
		el.addEventListener("click", (event) => {
			event.stopPropagation();
			if (options.panel) {
				if (options.panel.isOpen()) options.panel.close();
				else options.panel.open();
			}
			options.onClick?.();
		}, { signal: scope.signal });
		ui.layers.base.appendChild(el);
		return {
			el,
			setExpanded(expanded) {
				if (!scope.destroyed) syncExpanded(expanded);
			},
			destroy() {
				scope.destroy();
				el.remove();
			}
		};
	}
	//#endregion
	//#region scripts/capture-links/src/ui/icons.ts
	var SVG_NS = "http://www.w3.org/2000/svg";
	/**
	* 悬浮按钮用的链接图标。
	*
	* `@ui` 只导出了设计体系里已有的图标，没有链接图标，而这里又需要与面板入口
	* 一致的语义，所以在脚本内用同一套线条规则画一个（颜色继承按钮的 `currentColor`）。
	*/
	function linkIcon(size = 18) {
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
		for (const definition of ["M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 4", "M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07L13 20"]) {
			const path = document.createElementNS(SVG_NS, "path");
			path.setAttribute("d", definition);
			svg.appendChild(path);
		}
		return svg;
	}
	//#endregion
	//#region scripts/capture-links/src/ui/link-list.css?inline
	var link_list_default = "/**\n * 面板列表的样式。\n *\n * 列表行是可能上千条的数据行，用原生 checkbox + DOM 节点逐行拼，而不是为每一行\n * 创建一套 `@ui` 组件：组件带来的无障碍包装在数据行里没有增量，反而会让每次筛选\n * 都重建大量句柄。颜色与间距全部取自 `--ds-*` Token，不写死取值。\n */\n\n.cl-toolbar {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: var(--ds-space-2);\n}\n\n.cl-search {\n  flex: 1 1 220px;\n  min-width: 0;\n}\n\n.cl-toggle {\n  display: inline-flex;\n  align-items: center;\n  gap: var(--ds-space-1-5);\n  color: var(--ds-muted-foreground);\n  font-size: var(--ds-text-xs);\n  white-space: nowrap;\n  cursor: pointer;\n}\n\n.cl-stats {\n  margin-inline-start: auto;\n  color: var(--ds-muted-foreground);\n  font-size: var(--ds-text-xs);\n  font-variant-numeric: tabular-nums;\n  white-space: nowrap;\n}\n\n.cl-list {\n  display: flex;\n  flex-direction: column;\n}\n\n.cl-row {\n  display: flex;\n  align-items: center;\n  gap: var(--ds-space-3);\n  min-width: 0;\n  padding: var(--ds-space-2) var(--ds-space-1);\n  border-radius: var(--ds-radius-md);\n  cursor: pointer;\n}\n\n.cl-row:hover {\n  background: var(--ds-muted);\n}\n\n.cl-check {\n  flex: none;\n  width: var(--ds-checkbox-size);\n  height: var(--ds-checkbox-size);\n  margin: 0;\n  accent-color: var(--ds-primary);\n  cursor: pointer;\n}\n\n.cl-index {\n  flex: none;\n  width: 28px;\n  color: var(--ds-muted-foreground);\n  font-size: var(--ds-text-xs);\n  font-variant-numeric: tabular-nums;\n  text-align: end;\n}\n\n.cl-info {\n  display: flex;\n  flex-direction: column;\n  gap: var(--ds-space-0-5);\n  min-width: 0;\n}\n\n.cl-title {\n  overflow: hidden;\n  color: var(--ds-foreground);\n  font-size: var(--ds-text-sm);\n  font-weight: var(--ds-weight-medium);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.cl-url {\n  overflow: hidden;\n  color: var(--ds-muted-foreground);\n  font-size: var(--ds-text-xs);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.cl-empty {\n  padding: var(--ds-space-6);\n  color: var(--ds-muted-foreground);\n  font-size: var(--ds-text-sm);\n  text-align: center;\n}\n\n/* \"显示更多\"按钮：现在和空状态长一样，但类名分开，改空状态样式时不会误伤按钮。\n * button 自带的边框底色也一起清掉，只留一行可点的灰字。 */\n.cl-more {\n  width: 100%;\n  padding: var(--ds-space-6);\n  border: none;\n  background: none;\n  color: var(--ds-muted-foreground);\n  font-size: var(--ds-text-sm);\n  text-align: center;\n  cursor: pointer;\n}\n";
	//#endregion
	//#region scripts/capture-links/src/links.ts
	/** DOM 已解码 HTML 实体，地址只去掉首尾空白，不能再次解码。 */
	function normalizeUrl(url) {
		return url.trim();
	}
	/** 不执行的链接协议：不能打开、复制出来也是坏地址，列表里直接不要。 */
	var BLOCKED_SCHEMES = /^(javascript|data|vbscript):/i;
	/**
	* 把 `href` 补成绝对地址。
	*
	* @param rawHref DOM `getAttribute('href')` 的值，HTML 实体已由浏览器解码
	* @param baseHref 页面地址，用来解析相对地址
	* @param absoluteHref 浏览器已经解析好的 `a.href`，解析失败时用它兜底
	* @returns 归一化后的地址；空地址或不可执行的协议返回 `null`
	*/
	function resolveUrl(rawHref, baseHref, absoluteHref = "") {
		const raw = rawHref.trim();
		if (raw === "" || BLOCKED_SCHEMES.test(raw)) return null;
		let resolved;
		try {
			resolved = new URL(raw, baseHref).toString();
		} catch {
			resolved = absoluteHref || raw;
		}
		const normalized = normalizeUrl(resolved);
		if (normalized === "" || BLOCKED_SCHEMES.test(normalized)) return null;
		return normalized;
	}
	/**
	* 汇总页面链接：忽略空地址，按绝对地址去重，第一条出现的标题优先。
	*
	* @param candidates 扫描到的候选链接
	* @param baseHref 页面地址，用来解析相对地址
	*/
	function collectLinks(candidates, baseHref) {
		const seen = /* @__PURE__ */ new Map();
		for (const candidate of candidates) {
			const url = resolveUrl(candidate.rawHref, baseHref, candidate.absoluteHref);
			if (url === null || seen.has(url)) continue;
			seen.set(url, {
				id: url,
				url,
				title: candidate.title.trim() || url
			});
		}
		return [...seen.values()];
	}
	function isMagnetLink(url) {
		return url.toLowerCase().startsWith("magnet:");
	}
	/**
	* 按关键词与“仅磁链”筛选。
	*
	* 关键词同时匹配标题和地址，大小写不敏感；空关键词表示不过滤。
	*/
	function filterLinks(items, keyword, onlyMagnet) {
		const needle = keyword.trim().toLowerCase();
		return items.filter((item) => {
			if (onlyMagnet && !isMagnetLink(item.url)) return false;
			if (needle === "") return true;
			return item.title.toLowerCase().includes(needle) || item.url.toLowerCase().includes(needle);
		});
	}
	//#endregion
	//#region scripts/capture-links/src/features/titles.ts
	/**
	* 链接标题的取值策略，与线上旧版一致：先找能代表整行的 `title` 属性，
	* 再用链接自身的文字，最后退回地址本身。
	*
	* 列表里的链接常常只是“下载”两个字，光看链接文字没有信息量；外层行 / 列表项 /
	* 表格行上的 `title` 往往才是用户能认出的名字。
	*/
	var MAX_TITLE_LENGTH = 200;
	function usableTitle(value) {
		const text = value?.trim() ?? "";
		return text.length > 0 && text.length < MAX_TITLE_LENGTH ? text : null;
	}
	/**
	* 取一条链接的展示标题。
	*
	* @param node 链接元素；允许为空
	* @param fallback 都取不到时使用的文字（通常是地址）
	*/
	function bestTitle(node, fallback) {
		const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
		if (!element) return fallback;
		const candidates = [
			element.closest("[title]"),
			element.closest("tr"),
			element.closest("li"),
			element.parentElement
		];
		for (const candidate of candidates) {
			if (!candidate) continue;
			const title = usableTitle(candidate.getAttribute("title"));
			if (title !== null) return title;
		}
		return usableTitle((element.textContent ?? "").replace(/\s+/g, " ").trim()) ?? fallback;
	}
	//#endregion
	//#region scripts/capture-links/src/features/scan-page.ts
	/** 本脚本自己的界面宿主：扫进去只会把面板里的按钮和目标当链接。 */
	var OWN_UI_SELECTOR = "userscript-ui-root, [data-ds-root]";
	/**
	* 递归收 `open` 影子节点里的链接：组件化页面常把弹窗、播放器里的 `<a>` 藏在这里。
	* `closed` 影子节点浏览器不让进，只能放弃。
	*
	* 一遍遍历：先取本层全部元素，再对带 shadowRoot 的下钻；不对每个元素重复查子树，
	* 否则大页面是 O(n²)。
	*/
	function collectAnchors(root, found = []) {
		const scope = root;
		if (typeof scope.querySelectorAll !== "function") return found;
		for (const element of scope.querySelectorAll("*")) {
			if (element.matches(OWN_UI_SELECTOR)) continue;
			if (element.tagName === "A" && element.hasAttribute("href")) found.push(element);
			if (element.shadowRoot) collectAnchors(element.shadowRoot, found);
		}
		return found;
	}
	/**
	* 扫描页面里的全部 `<a href>`。
	*
	* 只读 DOM：把元素上的字段交给 `collectLinks` 做补全与去重，方便单测直接覆盖
	* 地址规则；标题策略单独放在 `titles.ts`。
	*
	* @param doc 目标文档，默认当前页面
	* @param baseHref 解析相对地址用的基准地址；默认取文档 baseURI（含 `<base href>`）
	*/
	function scanLinks(doc = document, baseHref) {
		if (!doc.body) return [];
		const base = baseHref ?? doc.baseURI;
		return collectLinks(collectAnchors(doc).map((anchor) => {
			const resolved = anchor.href;
			return {
				rawHref: anchor.getAttribute("href") ?? "",
				absoluteHref: typeof resolved === "string" ? resolved : "",
				title: bestTitle(anchor, "")
			};
		}), base);
	}
	//#endregion
	//#region scripts/capture-links/src/format.ts
	/**
	* 把选中的链接拼成剪贴板文本，每行一条。
	*
	* 输出目标是剪贴板而不是本页 DOM：标题里的括号、引号、尖括号要转义，
	* 否则粘到别处会得到坏掉的 Markdown / HTML。
	*/
	function escapeMarkdownTitle(title) {
		return title.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
	}
	/** Markdown 链接地址里的括号用反斜杠转义：`<>` 包裹法遇到地址自带 `>` 就提前闭合。 */
	function escapeMarkdownUrl(url) {
		return url.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
	}
	function escapeHtml(text) {
		return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}
	function formatLinks(items, format) {
		if (format === "markdown") return items.map((item) => `[${escapeMarkdownTitle(item.title)}](${escapeMarkdownUrl(item.url)})`).join("\n");
		if (format === "html") return items.map((item) => `<a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a>`).join("\n");
		return items.map((item) => item.url).join("\n");
	}
	//#endregion
	//#region scripts/capture-links/src/selection.ts
	/**
	* 批量勾选只影响当前筛选结果：用户看不到的链接不应该被“全选”带上，
	* 否则复制结果里会混进被筛掉的地址。
	*/
	function selectAll(selected, items) {
		const next = new Set(selected);
		for (const item of items) next.add(item.id);
		return next;
	}
	function selectNone(selected, items) {
		const next = new Set(selected);
		for (const item of items) next.delete(item.id);
		return next;
	}
	function invertSelection(selected, items) {
		const next = new Set(selected);
		for (const item of items) if (next.has(item.id)) next.delete(item.id);
		else next.add(item.id);
		return next;
	}
	/** 当前筛选结果里被选中的条目，保持列表顺序。 */
	function pickedItems(selected, items) {
		return items.filter((item) => selected.has(item.id));
	}
	//#endregion
	//#region scripts/capture-links/src/ui/link-panel.ts
	/** 首屏最多建这么多行，剩下的点“显示更多”再加。 */
	var PAGE_SIZE = 200;
	function createLinkPanel(options) {
		const { ui } = options;
		ui.useStyles(link_list_default);
		const panel = createPanel(ui, {
			title: "操作面板",
			open: false,
			position: "center",
			closeLabel: "关闭链接面板"
		});
		const toolbar = document.createElement("div");
		toolbar.className = "cl-toolbar";
		const search = createInput(ui, {
			type: "search",
			placeholder: "输入关键词筛选，例如 magnet:、.torrent、ed2k",
			ariaLabel: "按关键词筛选链接",
			onInput: () => applyFilter()
		});
		search.el.classList.add("cl-search");
		const magnet = createCheckbox(ui, {
			ariaLabel: "仅显示磁力链接",
			onChange: () => applyFilter()
		});
		const magnetLabel = document.createElement("label");
		magnetLabel.className = "cl-toggle";
		magnetLabel.append(magnet.el, document.createTextNode("仅磁链"));
		const stats = document.createElement("span");
		stats.className = "cl-stats";
		toolbar.append(search.el, magnetLabel, stats);
		const list = document.createElement("div");
		list.className = "cl-list";
		panel.body.append(toolbar, list);
		let allItems = [];
		let filteredItems = [];
		let selectedIds = /* @__PURE__ */ new Set();
		let shownCount = PAGE_SIZE;
		/** 勾选状态与“显示更多”都用事件委托：行会被反复重建，逐行挂监听会随重画次数累积。 */
		list.addEventListener("change", (event) => {
			const target = event.target;
			if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;
			const id = target.dataset.id;
			if (id === void 0) return;
			if (target.checked) selectedIds.add(id);
			else selectedIds.delete(id);
			updateStats();
		}, { signal: ui.signal });
		list.addEventListener("click", (event) => {
			const target = event.target;
			if (!(target instanceof Element) || !target.closest(".cl-more")) return;
			shownCount += PAGE_SIZE;
			render();
		}, { signal: ui.signal });
		function updateStats() {
			const chosen = filteredItems.filter((item) => selectedIds.has(item.id)).length;
			stats.textContent = `共 ${allItems.length} / 筛选 ${filteredItems.length} / 选中 ${chosen}`;
		}
		function createRow(item, index) {
			const row = document.createElement("label");
			row.className = "cl-row";
			const checkbox = document.createElement("input");
			checkbox.type = "checkbox";
			checkbox.className = "cl-check";
			checkbox.dataset.id = item.id;
			checkbox.checked = selectedIds.has(item.id);
			checkbox.setAttribute("aria-label", `选择 ${item.title}`);
			const number = document.createElement("span");
			number.className = "cl-index";
			number.textContent = String(index + 1);
			const info = document.createElement("span");
			info.className = "cl-info";
			const title = document.createElement("span");
			title.className = "cl-title";
			title.textContent = item.title;
			const url = document.createElement("span");
			url.className = "cl-url";
			url.textContent = item.url;
			info.append(title, url);
			row.append(checkbox, number, info);
			return row;
		}
		function render() {
			list.replaceChildren();
			if (filteredItems.length === 0) {
				const empty = document.createElement("div");
				empty.className = "cl-empty";
				empty.textContent = "无匹配结果";
				list.appendChild(empty);
			} else {
				filteredItems.slice(0, shownCount).forEach((item, index) => list.appendChild(createRow(item, index)));
				if (filteredItems.length > shownCount) {
					const more = document.createElement("button");
					more.type = "button";
					more.className = "cl-more";
					more.textContent = `显示更多（剩余 ${filteredItems.length - shownCount} 条）`;
					list.appendChild(more);
				}
			}
			updateStats();
		}
		function applyFilter() {
			filteredItems = filterLinks(allItems, search.getValue(), magnet.isChecked());
			shownCount = PAGE_SIZE;
			render();
		}
		async function copySelected() {
			const items = pickedItems(selectedIds, filteredItems);
			if (items.length === 0) {
				options.notify("未选中任何链接", "warning");
				return;
			}
			const written = await options.copy(formatLinks(items, options.getCopyFormat()));
			options.notify(written ? `已复制 ${items.length} 条链接` : "复制失败，请检查剪贴板权限", written ? "success" : "error");
		}
		const selectAllButton = createButton(ui, {
			label: "全选",
			variant: "secondary",
			onClick: () => {
				selectedIds = selectAll(selectedIds, filteredItems);
				render();
			}
		});
		const selectNoneButton = createButton(ui, {
			label: "全不选",
			variant: "secondary",
			onClick: () => {
				selectedIds = selectNone(selectedIds, filteredItems);
				render();
			}
		});
		const invertButton = createButton(ui, {
			label: "反选",
			variant: "secondary",
			onClick: () => {
				selectedIds = invertSelection(selectedIds, filteredItems);
				render();
			}
		});
		const copyButton = createButton(ui, {
			label: "复制选中",
			variant: "primary",
			onClick: () => void copySelected()
		});
		panel.setFooter([
			selectAllButton.el,
			selectNoneButton.el,
			invertButton.el,
			copyButton.el
		]);
		return {
			panel,
			open() {
				allItems = scanLinks();
				selectedIds = /* @__PURE__ */ new Set();
				shownCount = PAGE_SIZE;
				search.setValue("");
				magnet.setChecked(false);
				applyFilter();
				panel.open();
			},
			close: () => panel.close(),
			isOpen: () => panel.isOpen()
		};
	}
	//#endregion
	//#region scripts/capture-links/src/ui/settings-panel.ts
	function createSettingsPanel(options) {
		const { ui } = options;
		const panel = createPanel(ui, {
			title: "功能设置",
			open: false,
			position: "center",
			closeLabel: "关闭设置"
		});
		const generalSection = createSection(ui, { title: "常规" });
		const floatSwitch = createSwitch(ui, {
			checked: options.getSettings().showFloatButton,
			onChange: (checked) => {
				options.updateSettings({ showFloatButton: checked });
				options.onFloatButtonChange();
			}
		});
		generalSection.body.append(createField(ui, {
			label: "显示浮动按钮",
			description: "关掉后仍可从油猴菜单打开链接面板",
			control: floatSwitch,
			inline: true
		}).el);
		const copySection = createSection(ui, { title: "复制格式" });
		const formatSelect = createSelect(ui, {
			options: [
				{
					value: "url",
					label: "纯链接"
				},
				{
					value: "markdown",
					label: "Markdown"
				},
				{
					value: "html",
					label: "HTML"
				}
			],
			value: options.getSettings().copyFormat,
			onChange: (value) => {
				options.updateSettings({ copyFormat: toCopyFormat(value) });
			}
		});
		copySection.body.append(createField(ui, {
			label: "复制格式",
			description: "纯链接最省事；Markdown 与 HTML 适合直接贴进笔记",
			control: formatSelect
		}).el);
		panel.body.append(generalSection.el, copySection.el);
		const closeButton = createButton(ui, {
			label: "关闭",
			variant: "secondary",
			onClick: () => panel.close()
		});
		panel.setFooter([closeButton.el]);
		return {
			panel,
			open() {
				const settings = options.getSettings();
				floatSwitch.setChecked(settings.showFloatButton);
				formatSelect.setValue(settings.copyFormat);
				panel.open();
			},
			close: () => panel.close(),
			isOpen: () => panel.isOpen()
		};
	}
	//#endregion
	//#region scripts/capture-links/src/ui/app.ts
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
	function createApp(options) {
		let session = null;
		const notify = (message, variant) => {
			session?.toast[variant](message);
		};
		const syncLauncher = () => {
			if (!options.getSettings().showFloatButton) {
				session?.launcher?.destroy();
				if (session) session.launcher = null;
				return;
			}
			const current = ensure();
			if (current.launcher) return;
			const launcherPanel = {
				...current.linkPanel.panel,
				open: () => current.linkPanel.open()
			};
			current.launcher = createLauncher(current.ui, {
				label: "打开链接面板",
				closeLabel: "关闭链接面板",
				panel: launcherPanel,
				icon: linkIcon()
			});
			current.linkPanel.panel.setPosition("center");
		};
		const ensure = () => {
			if (session) return session;
			const ui = mountUI({
				theme: "system",
				labels: LABELS
			});
			session = {
				ui,
				toast: createToast(ui),
				linkPanel: createLinkPanel({
					ui,
					getCopyFormat: () => options.getSettings().copyFormat,
					copy: options.copy,
					notify
				}),
				settingsPanel: createSettingsPanel({
					ui,
					getSettings: options.getSettings,
					updateSettings: options.updateSettings,
					onFloatButtonChange: syncLauncher
				}),
				launcher: null
			};
			return session;
		};
		return {
			syncLauncher,
			openLinks: () => ensure().linkPanel.open(),
			openSettings: () => ensure().settingsPanel.open(),
			destroy() {
				session?.ui.destroy();
				session = null;
			}
		};
	}
	//#endregion
	//#region scripts/capture-links/src/main.ts
	/**
	* 入口：读设置、按设置显示悬浮按钮、注册油猴菜单。
	*
	* 页面本体不放任何 DOM：UI 全部在 `@ui` 的 Shadow Root 里，关掉悬浮按钮后
	* 只有菜单入口，普通页面零节点零样式。
	*/
	var MENU_LINKS = "操作面板";
	var MENU_SETTINGS = "功能设置";
	function start() {
		const gm = createGmApi();
		const store = createSettingsStore(gm);
		const clipboard = createClipboard();
		const app = createApp({
			getSettings: store.get,
			updateSettings: (patch) => void store.update(patch),
			copy: clipboard.copy
		});
		app.syncLauncher();
		const register = (label, run) => {
			if (!gm.registerMenuCommand(label, run)) console.warn(`[capture-links] 菜单命令不可用：${label}`);
		};
		const openLinks = () => {
			try {
				app.openLinks();
			} catch (error) {
				console.error("[capture-links] 打开链接面板失败", error);
			}
		};
		const openSettings = () => {
			try {
				app.openSettings();
			} catch (error) {
				console.error("[capture-links] 打开设置面板失败", error);
			}
		};
		register(MENU_LINKS, openLinks);
		register(MENU_SETTINGS, openSettings);
	}
	try {
		start();
	} catch (error) {
		console.error("[capture-links] 启动失败", error);
	}
	//#endregion
})();
