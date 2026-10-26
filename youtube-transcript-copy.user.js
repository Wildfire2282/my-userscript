// ==UserScript==
// @name         YouTube 转写文稿复制
// @name:en      YouTube Transcript Copy
// @namespace    https://github.com/Wildfire2282
// @version      1.4.10
// @description  视频播放页面出现可拖拽悬浮按钮，可一键复制转写文稿（transcript），支持英语等多语言界面
// @description:en Add a draggable button to copy YouTube transcripts
// @author       Wildfire2282 (https://github.com/Wildfire2282)
// @license      MIT
// @homepageURL  https://github.com/Wildfire2282/my-userscript
// @supportURL   https://github.com/Wildfire2282/my-userscript/issues
// @source       https://github.com/Wildfire2282/my-userscript
// @match        https://www.youtube.com/*
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @run-at       document-start
// @downloadURL  https://update.greasyfork.org/scripts/579560/YouTube%20%E8%BD%AC%E5%86%99%E6%96%87%E7%A8%BF%E5%A4%8D%E5%88%B6.user.js
// @updateURL    https://update.greasyfork.org/scripts/579560/YouTube%20%E8%BD%AC%E5%86%99%E6%96%87%E7%A8%BF%E5%A4%8D%E5%88%B6.meta.js
// ==/UserScript==
(function() {
	//#region packages/shared/src/host/gm.ts
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
	//#region packages/shared/src/dom/editable.ts
	/**
	* 穿透 open shadow root 取真正的焦点元素。
	*
	* `document.activeElement` 在焦点落在 Shadow Root 内部时只给出宿主元素。
	*
	* @param doc 文档；默认当前文档
	*/
	function deepActiveElement(doc = document) {
		let element = doc.activeElement;
		while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
		return element;
	}
	//#endregion
	//#region packages/shared/src/host/clipboard.ts
	/**
	* 剪贴板写入。
	*
	* 三个通道按可靠性排序：
	*
	* 1. `GM_setClipboard`：不受安全上下文、iframe 权限策略与焦点限制，脚本管理器直接写入；
	* 2. `navigator.clipboard`：没有管理器时用浏览器 API，需要安全上下文与用户手势；
	* 3. 隐藏 textarea + `execCommand('copy')`：老浏览器与受限 iframe 的最后兜底。
	*
	* 全部失败返回 `false`，提示文案由调用方决定；这里不抛错，避免一次复制失败打断页面。
	*/
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
		const active = deepActiveElement(document);
		const control = active?.tagName === "INPUT" || active?.tagName === "TEXTAREA" ? active : null;
		let controlStart = null;
		let controlEnd = null;
		let controlDirection = null;
		try {
			controlStart = control?.selectionStart ?? null;
			controlEnd = control?.selectionEnd ?? null;
			controlDirection = control?.selectionDirection ?? null;
		} catch {}
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
			area.focus();
			area.select();
			return document.execCommand("copy");
		} catch {
			return false;
		} finally {
			area.remove();
			try {
				active?.focus?.();
			} catch {}
			try {
				if (anchor?.isConnected && focus?.isConnected) selection?.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
			} catch {}
			try {
				if (controlStart != null && controlEnd != null) control?.setSelectionRange(controlStart, controlEnd, controlDirection ?? void 0);
			} catch {}
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
	//#region packages/shared/src/runtime/logger.ts
	/**
	* 创建带 `[slug]` 前缀的日志器。
	*
	* @param slug 脚本标识，如 `super-drag`
	*/
	function createLogger(slug) {
		return {
			warn: (message) => console.warn(`[${slug}] ${message}`),
			error: (message, detail) => detail === void 0 ? console.error(`[${slug}] ${message}`) : console.error(`[${slug}] ${message}`, detail)
		};
	}
	/**
	* 菜单 / 启动 / 面板打开三层错误边界的最小包装：失败只记日志，不抛给管理器与宿主页面。
	*
	* @param log 统一日志器
	* @param message 失败时的中文说明
	* @param run 实际回调
	*/
	function guard(log, message, run) {
		try {
			run();
		} catch (error) {
			log.error(message, error);
		}
	}
	//#endregion
	//#region packages/shared/src/runtime/boot.ts
	/**
	* 安装锁：同一文档只装一份。
	*
	* 不同管理器的沙箱之间 window 不一定共享，DOM 一定共享，所以用元素属性而不用
	* window 标记。selection-copy 的 `data-selection-auto-copy-installed` 沿用此实现。
	*/
	function installOnce(attribute) {
		const root = document.documentElement;
		if (!root || root.hasAttribute(attribute)) return false;
		root.setAttribute(attribute, "");
		return true;
	}
	/**
	* 脚本启动器：安装锁、frame 判断、菜单注册、DOM 就绪、pagehide 清理。
	*
	* - 顶层 `guard` 兜住同步启动异常（与各脚本原有顶层 try/catch 同语义）。
	* - `onStart` 同步执行，不等 DOM；`onReady` 等 DOM 就绪。
	* - 清理函数幂等；`pagehide` 且 `persisted === false` 时自动调用。
	* - 菜单回调统一 `guard` 包裹；注册失败只告警，不阻断脚本主功能。
	*
	* @param gmApi GM 适配层；测试里传假实现
	* @param options 启动参数
	* @returns `destroy` 供页面卸载与测试调用
	*/
	function createUserscript(gmApi, options) {
		const { slug, installLock = true, topFrameOnly = false, menus = [] } = options;
		const log = createLogger(slug);
		const cleanups = [];
		let destroyed = false;
		const destroy = () => {
			if (destroyed) return;
			destroyed = true;
			for (const cleanup of [...cleanups].reverse()) try {
				cleanup();
			} catch {}
			cleanups.length = 0;
		};
		const controller = new AbortController();
		cleanups.push(() => controller.abort());
		const onPageHide = (event) => {
			if (!event.persisted) destroy();
		};
		window.addEventListener("pagehide", onPageHide);
		cleanups.push(() => window.removeEventListener("pagehide", onPageHide));
		const menu = (item) => {
			if ((item.topFrameOnly ?? false) && window.top !== window.self) return;
			const wrapped = () => guard(log, `打开${item.label}失败`, item.run);
			if (!gmApi.registerMenuCommand(item.label, wrapped)) log.warn(`菜单命令不可用：${item.label}`);
		};
		guard(log, "启动失败", () => {
			if (topFrameOnly && window.top !== window.self) return;
			if (typeof installLock === "string" && !installOnce(installLock)) return;
			const startCleanup = options.onStart?.();
			if (typeof startCleanup === "function") cleanups.push(startCleanup);
			for (const item of menus) menu(item);
			const runReady = () => {
				if (destroyed) return;
				guard(log, "初始化失败", () => {
					const readyCleanup = options.onReady?.({
						gm: gmApi,
						log,
						signal: controller.signal,
						menu
					});
					if (typeof readyCleanup === "function") cleanups.push(readyCleanup);
				});
			};
			if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", runReady, {
				once: true,
				signal: controller.signal
			});
			else runReady();
		});
		return { destroy };
	}
	//#endregion
	//#region packages/shared/src/dom/position.ts
	/**
	* 视口夹紧原语：selection-copy 的提示标签定位与 youtube 的悬浮按钮定位
	* 各写了一份逐字相同的 `clamp`，收拢到一处。
	*/
	/**
	* 把值钳在 `[min, max]` 内。
	*
	* 视口比内容还窄时 `max < min`：贴住 `min`（左上角），不要算出负坐标。
	*/
	function clamp(value, min, max) {
		if (max < min) return min;
		return Math.min(Math.max(value, min), max);
	}
	/** 把位置收回视口内；视口比按钮还小时贴住左上角。 */
	function clampPosition(position, viewport, size = 36) {
		return {
			right: clamp(position.right, 0, viewport.width - size),
			top: clamp(position.top, 0, viewport.height - size)
		};
	}
	/**
	* 播放器右上角偏移 30px 的默认位置。
	*
	* @param playerRect 播放器矩形；没有播放器或不可见时返回 null
	* @param viewport 视口尺寸
	*/
	function defaultButtonPosition(playerRect, viewport) {
		if (!playerRect) return null;
		return clampPosition({
			right: viewport.width - playerRect.right + 30,
			top: playerRect.top + 30
		}, viewport);
	}
	/** 找到播放器并返回它的矩形；播放器不可见时返回 null。 */
	function readPlayerRect(doc = document) {
		const player = doc.querySelector("#movie_player, #player");
		if (!player) return null;
		const rect = player.getBoundingClientRect();
		return rect.width > 0 ? rect : null;
	}
	//#endregion
	//#region scripts/youtube-transcript-copy/src/features/spa.ts
	function watchNavigation(onTick, options = {}) {
		const win = options.win ?? window;
		const doc = options.doc ?? document;
		let lastHref = doc.location.href;
		const notify = () => {
			lastHref = doc.location.href;
			onTick();
		};
		const onNavigate = () => notify();
		win.addEventListener("yt-navigate-finish", onNavigate);
		const timer = win.setInterval(() => {
			if (doc.location.href !== lastHref) notify();
			else if (doc.location.href.includes("/watch")) onTick();
		}, options.intervalMs ?? 1500);
		return () => {
			win.removeEventListener("yt-navigate-finish", onNavigate);
			win.clearInterval(timer);
		};
	}
	//#endregion
	//#region scripts/youtube-transcript-copy/src/features/visibility.ts
	function shouldShowButton(snapshot) {
		return snapshot.exists && !snapshot.fullscreen;
	}
	function findVideo(doc = document) {
		return doc.querySelector("video.html5-main-video, #movie_player video");
	}
	function readVideoState(doc = document, fullscreen = void 0) {
		const fullscreenElement = fullscreen === void 0 ? doc.fullscreenElement : fullscreen;
		return {
			exists: findVideo(doc) !== null,
			fullscreen: fullscreenElement != null
		};
	}
	/** 播放器当前承载的视频 ID；页面还没挂播放器或读不到时返回空串。 */
	function readPlayerVideoId(doc = document) {
		const player = doc.querySelector("#movie_player");
		try {
			const id = player?.getVideoData?.()?.video_id;
			if (typeof id === "string") return id;
		} catch {}
		return doc.querySelector("ytd-watch-flexy")?.getAttribute("video-id")?.trim() ?? "";
	}
	/**
	* DOM 里的转写面板是否属于当前视频。
	*
	* 地址栏已经换台、面板节点却还是上一个视频的：同步读 DOM 会复制到别的内容。
	* 读不到播放器 ID 时按同一视频处理，保留没有播放器信息的页面上的旧行为。
	*/
	function isPlayerOnVideo(videoId, doc = document) {
		const playerId = readPlayerVideoId(doc);
		return playerId === "" || playerId === videoId;
	}
	/**
	* 监听播放器出现 / 消失与全屏变化。
	*
	* 只在结果变化时回调，避免每 500ms 写一次 DOM。
	*
	* @returns 清理函数（定时器与全屏监听）
	*/
	function watchVisibility(onChange, options = {}) {
		const doc = options.doc ?? document;
		let last = null;
		const emit = () => {
			const next = shouldShowButton(readVideoState(doc));
			if (next === last) return;
			last = next;
			onChange(next);
		};
		doc.addEventListener("fullscreenchange", emit);
		const timer = window.setInterval(emit, options.intervalMs ?? 500);
		emit();
		return () => {
			window.clearInterval(timer);
			doc.removeEventListener("fullscreenchange", emit);
		};
	}
	var STRATEGY_KEY = "strategy";
	/**
	* 删除存储值。
	*
	* 只有本脚本需要“恢复默认 / 清空记忆”，所以不放进 `@shared`：共享代码会进入每个
	* 脚本的产物，那样三个脚本都会凭空多出一个 GM 调用、并要求新增授权。
	*/
	function deleteStoredValue(key) {
		const globals = globalThis;
		if (typeof globals.GM_deleteValue !== "function") return false;
		try {
			globals.GM_deleteValue(key);
			return true;
		} catch {
			return false;
		}
	}
	function normalizePosition(value) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
		const { right, top } = value;
		if (typeof right !== "number" || typeof top !== "number") return null;
		if (!Number.isFinite(right) || !Number.isFinite(top) || right < 0 || top < 0) return null;
		return {
			right,
			top
		};
	}
	function normalizeStrategy(value) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
		const memory = {};
		for (const [kind, choice] of Object.entries(value)) {
			if (typeof choice !== "object" || choice === null) continue;
			const record = choice;
			if (typeof record.idx !== "number" || !Number.isInteger(record.idx) || record.idx < 0) continue;
			memory[kind] = {
				idx: record.idx,
				at: typeof record.at === "number" ? record.at : 0
			};
		}
		return memory;
	}
	function createStore(api = createGmApi(), remove = deleteStoredValue) {
		let positionLoaded = false;
		let position = null;
		let memory = null;
		const getStrategy = () => {
			if (!memory) memory = normalizeStrategy(api.getValue(STRATEGY_KEY, null));
			return memory;
		};
		return {
			getPosition() {
				if (!positionLoaded) {
					position = normalizePosition(api.getValue("pos", null));
					positionLoaded = true;
				}
				return position;
			},
			savePosition(next) {
				position = next;
				positionLoaded = true;
				api.setValue("pos", next);
			},
			clearPosition() {
				position = null;
				positionLoaded = true;
				remove("pos");
			},
			getStrategy,
			rememberStrategy(kind, index) {
				const next = {
					...getStrategy(),
					[kind]: {
						idx: index,
						at: Date.now()
					}
				};
				memory = next;
				api.setValue(STRATEGY_KEY, next);
			},
			clearStrategy() {
				memory = {};
				remove(STRATEGY_KEY);
			}
		};
	}
	//#endregion
	//#region scripts/youtube-transcript-copy/src/transcript/format.ts
	/**
	* 转写文稿的文本处理：清洗、时间戳互换、输出格式。
	*
	* 输出格式与线上旧版逐字一致：每条一行，有时间戳时加 `[分:秒] ` 前缀。
	* 一小时以内沿用旧版的 `分:秒`（如 `1:05`），一小时及以上用 `时:分:秒`
	* （如 `1:30:00`）：旧版无小时位，90 分钟的视频会印成 `90:00` 看不懂。
	*/
	function clean(text) {
		return (text ?? "").replace(/\s+/g, " ").trim();
	}
	/**
	* 把页面上的时间戳文字换算成毫秒。
	*
	* @param text `m:ss` 或 `h:mm:ss`
	* @returns 毫秒；格式不认识时返回 null，调用方跳过这条而不是印成 `[0:00]`
	*/
	function tsToSec(text) {
		const parts = text.split(":").map(Number);
		if (parts.length === 2) {
			const [minutes, seconds] = parts;
			if (minutes === void 0 || seconds === void 0 || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
			return minutes * 60 + seconds;
		}
		if (parts.length === 3) {
			const [hours, minutes, seconds] = parts;
			if (hours === void 0 || minutes === void 0 || seconds === void 0 || !Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
			return hours * 3600 + minutes * 60 + seconds;
		}
		return null;
	}
	/** 毫秒 → 复制到剪贴板里的时间戳；一小时及以上带小时位，未知返回空串。 */
	function fmtTs(ms) {
		if (ms === null || !Number.isFinite(ms)) return "";
		const total = Math.max(0, Math.floor(ms / 1e3));
		const hours = Math.floor(total / 3600);
		const minutes = Math.floor(total / 60);
		const seconds = total % 60;
		return hours > 0 ? `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
	}
	/** 每条一行；没有时间戳的片段只输出文字。 */
	function formatLines(segments) {
		return segments.map((segment) => {
			const timestamp = fmtTs(segment.start);
			return timestamp ? `[${timestamp}] ${segment.text}` : segment.text;
		}).join("\n");
	}
	//#endregion
	//#region scripts/youtube-transcript-copy/src/transcript/extract.ts
	function asRecord$1(value) {
		return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
	}
	function asArray(value) {
		return Array.isArray(value) ? value : [];
	}
	function asString(value) {
		return typeof value === "string" ? value : "";
	}
	function numberOr(value) {
		return typeof value === "number" && Number.isFinite(value) ? value : null;
	}
	/** 数字或数字字符串；面板两种形状的时间字段类型不一致。 */
	function numberOrNumericString(value) {
		const numeric = numberOr(value);
		if (numeric !== null) return numeric;
		return typeof value === "string" && value.trim() !== "" ? numberOr(Number(value)) : null;
	}
	/**
	* 面板里是否出现 cueGroup：直接按 key 找，比整块 JSON.stringify 快得多。
	* 面板响应可能很大，每份都序列化一次会拖慢每次复制。
	*/
	function hasCueGroup(value, depth = 0) {
		if (depth > 6) return false;
		if (Array.isArray(value)) return value.some((entry) => hasCueGroup(entry, depth + 1));
		if (typeof value !== "object" || value === null) return false;
		const record = value;
		if ("transcriptCueGroupRenderer" in record || "cueGroup" in record) return true;
		return Object.values(record).some((entry) => hasCueGroup(entry, depth + 1));
	}
	/** 面板与 get_transcript actions 里的转写；没有文稿时返回 null。 */
	function extractFromPanelResponse(data) {
		const root = asRecord$1(data);
		if (!root) return null;
		const segments = [];
		for (const entry of asArray(root.actions)) {
			const list = asRecord$1(asRecord$1(asRecord$1(asRecord$1(asRecord$1(asRecord$1(asRecord$1(asRecord$1(entry)?.updateEngagementPanelAction)?.content)?.transcriptRenderer)?.content)?.transcriptSearchPanelRenderer)?.body)?.transcriptSegmentListRenderer);
			for (const segment of asArray(list?.initialSegments)) {
				const item = asRecord$1(asRecord$1(segment)?.transcriptSegmentRenderer);
				const text = clean(asArray(asRecord$1(item?.snippet)?.runs).map((run) => asString(asRecord$1(run)?.text)).join(""));
				if (!text) continue;
				const startMs = numberOrNumericString(item?.startMs);
				const seconds = startMs === null ? tsToSec(asString(asRecord$1(item?.startTimeText)?.simpleText)) : null;
				segments.push({
					start: startMs ?? (seconds === null ? null : seconds * 1e3),
					text
				});
			}
		}
		for (const entry of asArray(root.engagementPanels)) {
			const wrapper = asRecord$1(entry);
			if (!wrapper) continue;
			const panel = asRecord$1(wrapper.engagementPanelSectionListRenderer) ?? asRecord$1(wrapper.engagementPanel) ?? wrapper;
			if (!/transcript/i.test(asString(panel.panelIdentifier)) && !hasCueGroup(panel)) continue;
			const bodyRenderer = asRecord$1(asRecord$1(asRecord$1(asRecord$1(panel.content)?.transcriptRenderer)?.body)?.transcriptBodyRenderer);
			for (const group of asArray(bodyRenderer?.cueGroups)) {
				const groupRecord = asRecord$1(group);
				if (!groupRecord) continue;
				const cueGroup = asRecord$1(groupRecord.transcriptCueGroupRenderer);
				const cues = asArray(cueGroup?.cues).length ? asArray(cueGroup?.cues) : asArray(groupRecord.cues);
				for (const cue of cues) {
					const cueRecord = asRecord$1(cue);
					if (!cueRecord) continue;
					const renderer = asRecord$1(cueRecord.transcriptCueRenderer);
					const cueRecord2 = asRecord$1(renderer?.cue) ?? asRecord$1(cueRecord.cue);
					const runs = asArray(cueRecord2?.runs ?? renderer?.runs).map((run) => asString(asRecord$1(run)?.text)).join("");
					const cleaned = clean(runs !== "" && clean(runs) !== "" ? clean(runs) : asString(renderer?.simpleText) || asString(cueRecord2?.simpleText) || asString(asRecord$1(renderer?.cue)?.simpleText));
					if (cleaned === "") continue;
					segments.push({
						start: numberOrNumericString(renderer?.startOffsetMs) ?? numberOrNumericString(cueRecord.startOffsetMs),
						text: cleaned
					});
				}
			}
		}
		const unique = dedupeSegments(segments);
		return unique.length > 0 ? unique : null;
	}
	/** 中日韩文字之间没有空格分隔：两边都是 CJK 字符时直接拼接，否则补一个空格。 */
	function isCjk(char) {
		return /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff]/.test(char);
	}
	function joinSegs(parts) {
		let out = "";
		for (const part of parts) {
			if (part === "") continue;
			if (out === "") {
				out = part;
				continue;
			}
			const prev = out[out.length - 1] ?? "";
			const next = part[0] ?? "";
			out += isCjk(prev) && isCjk(next) ? part : ` ${part}`;
		}
		return out;
	}
	/** json3 字幕（captionTracks[0].baseUrl + `fmt=json3`）里的转写。 */
	function extractFromJson3(data) {
		const root = asRecord$1(data);
		if (!root) return null;
		const segments = [];
		for (const event of asArray(root.events)) {
			const record = asRecord$1(event);
			if (!record) continue;
			const text = clean(joinSegs(asArray(record.segs).map((part) => asString(asRecord$1(part)?.utf8))));
			if (!text) continue;
			segments.push({
				start: numberOr(record.tStartMs),
				text
			});
		}
		return segments.length > 0 ? segments : null;
	}
	/** 同一时间戳 + 同一文字的片段只保留一条：面板会同时挂一份隐藏副本，不去重会整篇翻倍。 */
	function dedupeSegments(segments) {
		const seen = /* @__PURE__ */ new Set();
		const unique = [];
		for (const segment of segments) {
			const key = `${segment.start}\t${segment.text}`;
			if (seen.has(key)) continue;
			seen.add(key);
			unique.push(segment);
		}
		return unique;
	}
	/** 面板里新的 view-model 结构：每个片段一个节点，时间戳与文字分开。 */
	function extractFromViewModel(root) {
		const segments = [];
		for (const host of root.querySelectorAll("transcript-segment-view-model, ytd-transcript-segment-renderer")) {
			const timestamp = (host.querySelector(".ytwTranscriptSegmentViewModelTimestamp, #timestamp, .segment-timestamp, [aria-hidden=\"true\"]")?.textContent ?? "").trim();
			const text = clean((host.querySelector("span[role=\"text\"], #segment-text, .segment-text") ?? findLeafWithText(host))?.textContent);
			if (text && text !== timestamp) {
				const seconds = tsToSec(timestamp);
				segments.push({
					start: seconds === null ? null : seconds * 1e3,
					text
				});
			}
		}
		const fromNodes = dedupeSegments(segments);
		if (fromNodes.length > 0) return fromNodes;
		const scope = scopeRoot(root);
		const timestampPattern = /^\d{1,2}(:\d{2}){1,2}$/;
		const seen = /* @__PURE__ */ new WeakSet();
		const candidates = [...scope.querySelectorAll("span, div")].filter((node) => node.children.length === 0 && timestampPattern.test((node.textContent ?? "").trim()));
		for (const node of candidates) {
			let block = node.closest("[role=\"button\"], button, ytd-transcript-segment-renderer, transcript-segment-view-model") ?? node.parentElement;
			while (block && seen.has(block)) block = block.parentElement;
			if (!block || seen.has(block)) continue;
			seen.add(block);
			const timestamp = clean(node.textContent);
			const blockText = clean(block.textContent);
			if (timestampPattern.test(blockText) && blockText.length < 30) continue;
			const text = blockText.replace(/^\d{1,2}(:\d{2}){1,2}/, "").trim();
			if (text.length > 1) {
				const seconds = tsToSec(timestamp);
				segments.push({
					start: seconds === null ? null : seconds * 1e3,
					text
				});
			}
		}
		const unique = dedupeSegments(segments);
		return unique.length > 0 ? unique : null;
	}
	/** 最老的结构：每个时间戳与文字在同一行文本里（`0:05 你好`）。 */
	function extractFromPanelDump(root) {
		const linePattern = /^\d{1,2}(?::\d{2}){1,2}\s+/;
		const segments = [];
		for (const node of scopeRoot(root).querySelectorAll("div, span, p")) {
			if (node.children.length !== 0) continue;
			const content = node.textContent ?? "";
			if (!linePattern.test(content)) continue;
			const match = /^(\d{1,2}(?::\d{2}){1,2})\s+(.*)$/.exec(content);
			if (!match?.[1] || match[2] === void 0) continue;
			const cleaned = clean(match[2]);
			if (cleaned === "") continue;
			const seconds = tsToSec(match[1]);
			segments.push({
				start: seconds === null ? null : seconds * 1e3,
				text: cleaned
			});
		}
		const unique = dedupeSegments(segments);
		return unique.length > 0 ? unique : null;
	}
	/** 转写面板容器：兜底扫描只在这里面找，找不到才退回全页。
	*
	* 只认转写特有的容器：通用的 engagement-panel 也长这样（评论区、简介区都是），
	* 写进去的话，改版后兜底会去扫评论区，把“0:05 这里好笑”当成字幕抄回来。 */
	function scopeRoot(root) {
		const doc = root;
		if (typeof doc.querySelector !== "function") return root;
		return doc.querySelector("ytd-transcript-renderer, [target-id*=\"transcript\"]") ?? root;
	}
	/** 片段容器里第一个有文字的叶子节点；不要求英文字母，中文也能命中。 */
	function findLeafWithText(root) {
		for (const node of root.querySelectorAll("*")) if (node.children.length === 0 && clean(node.textContent) !== "") return node;
		return null;
	}
	//#endregion
	//#region scripts/youtube-transcript-copy/src/transcript/api.ts
	/**
	* 直接问 YouTube 要转写面板。
	*
	* 这是最后一条路：前面的网络缓存与 DOM 都拿不到时才发请求。客户端版本优先读
	* 页面自己的配置，读不到才用写死的兜底，这样 YouTube 升级后主路径不受影响。
	*/
	var API_ROOT = "https://www.youtube.com/youtubei/v1/";
	var FALLBACK_CLIENT_VERSION = "2.20260710.06.00";
	/** 读页面当前的客户端版本，读不到返回 null（调用方用写死的兜底）。 */
	function readPageClientVersion(scope = globalThis) {
		try {
			const version = scope.ytcfg?.get?.("CLIENT_VERSION");
			return typeof version === "string" && version !== "" ? version : null;
		} catch {
			return null;
		}
	}
	/**
	* 请求当前视频的转写面板。
	*
	* @param videoId 视频 ID；为空时不发请求
	* @param fetchImpl 便于测试替换的 fetch
	* @param clientVersion 客户端版本；不传时读页面配置，读不到用写死的兜底
	*/
	async function requestPanel(videoId, fetchImpl = fetch, clientVersion = readPageClientVersion() ?? FALLBACK_CLIENT_VERSION) {
		if (videoId === "") return null;
		try {
			const context = { client: {
				clientName: "WEB",
				clientVersion
			} };
			const request = async (endpoint, payload, query = "") => {
				return (await fetchImpl(`${API_ROOT}${endpoint}?prettyPrint=false${query === "" ? "" : `&${query}`}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						context,
						...payload
					})
				})).json();
			};
			const panels = (await request("next", { videoId }))?.engagementPanels;
			if (!Array.isArray(panels)) return null;
			const params = (panels.find((entry) => entry?.engagementPanelSectionListRenderer?.panelIdentifier === "engagement-panel-searchable-transcript")?.engagementPanelSectionListRenderer)?.content?.continuationItemRenderer?.continuationEndpoint?.getTranscriptEndpoint?.params;
			if (typeof params !== "string" || params === "") return null;
			return extractFromPanelResponse(await request("get_transcript", { params }, `v=${encodeURIComponent(videoId)}`));
		} catch {
			return null;
		}
	}
	//#endregion
	//#region scripts/youtube-transcript-copy/src/transcript/initial-track.ts
	/**
	* 播放器当前挂的响应；SPA 换台后 `ytInitialPlayerResponse` 可能不更新，
	* 这一份才是新视频的字幕轨来源。
	*/
	function readPlayerResponse(doc = document) {
		try {
			return doc.querySelector("#movie_player")?.getPlayerResponse?.() ?? null;
		} catch {
			return null;
		}
	}
	function asRecord(value) {
		return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
	}
	/**
	* 从播放器响应里取第一条字幕轨。
	*
	* @param response 通常是 `window.ytInitialPlayerResponse`
	* @returns 有 `baseUrl` 的字幕轨；没有字幕时返回 null
	*/
	function readInitialTrack(response) {
		const root = asRecord(response);
		const tracklist = asRecord(asRecord(root?.captions)?.playerCaptionsTracklistRenderer);
		const first = asRecord((Array.isArray(tracklist?.captionTracks) ? tracklist.captionTracks : [])[0]);
		const baseUrl = typeof first?.baseUrl === "string" ? first.baseUrl : "";
		const details = asRecord(root?.videoDetails);
		let videoId = typeof details?.videoId === "string" ? details.videoId : "";
		if (!videoId && baseUrl) try {
			videoId = new URL(baseUrl).searchParams.get("v") ?? "";
		} catch {}
		return baseUrl && videoId ? {
			baseUrl,
			videoId
		} : null;
	}
	/**
	* 下载并解析字幕轨。
	*
	* @param track 字幕轨
	* @param fetchImpl 便于测试替换的 fetch
	* @returns 转写片段；失败或没有内容时返回 null，由调用方继续下一个策略
	*/
	async function fetchInitialTrack(track, fetchImpl = fetch) {
		const url = `${track.baseUrl}${track.baseUrl.includes("?") ? "&" : "?"}fmt=json3`;
		try {
			return extractFromJson3(await (await fetchImpl(url, { credentials: "include" })).json());
		} catch {
			return null;
		}
	}
	//#endregion
	//#region scripts/youtube-transcript-copy/src/transcript/network.ts
	/**
	* 网络层：钩住 `fetch` 与 `XMLHttpRequest`，在 YouTube 自己请求转写面板时顺手把
	* 结果留下来。用户点“显示转写文稿”产生的响应一定能被这里捕获，不用重新请求。
	*
	* 只观察，不改写请求与响应；解析失败静默跳过，不影响页面。
	*
	* safety-allow-file: 只旁听页面自己发的转写请求，不新发任何请求（见 architecture.md 页面变化观察）。
	*/
	/**
	* 需要旁听的地址：
	*
	* - `get_panel` / `get_transcript`：转写面板的接口，不同年代的名字；
	* - `/api/timedtext`：播放器自己拉字幕的地址。2026 起不带 `pot` 的裸字幕地址
	*   会返回空响应，只有播放器请求里的完整地址（含 `pot`）能拿到内容，所以顺带缓存它。
	*/
	var CAPTURE_PATTERN = /(?:youtubei\/v1\/(?:get_panel|get_transcript)|\/api\/timedtext)/i;
	var TIMEDTEXT_PATTERN = /\/api\/timedtext/i;
	/** 按地址选择解析方式；解析不出来返回 null。 */
	function parseCapturedResponse(url, data) {
		return TIMEDTEXT_PATTERN.test(url) ? extractFromJson3(data) : extractFromPanelResponse(data);
	}
	/** 地址里能读到的信息：`v=` 是视频 ID，`tlang` 表示这是翻译字幕。 */
	function readCapturedUrl(url) {
		try {
			const parsed = new URL(url, "https://www.youtube.com");
			return {
				videoId: parsed.searchParams.get("v") ?? "",
				translated: parsed.searchParams.get("tlang") !== null
			};
		} catch {
			return {
				videoId: "",
				translated: false
			};
		}
	}
	/**
	* 当前视频 ID：先读 `?v=`，再认 `/shorts/…`、`/embed/…`、`/live/…` 的路径。
	*
	* 只读 `?v=` 时这三种页面得到空串，网络捕获与 API 兜底会全部失效。
	*
	* @param search 地址栏查询串，如 `location.search`
	* @param pathname 地址栏路径，如 `location.pathname`
	*/
	function readVideoId(search, pathname) {
		const fromQuery = (new URLSearchParams(search).get("v") ?? "").trim();
		if (fromQuery !== "") return fromQuery;
		return (/^\/(?:shorts|embed|live)\/([^/?#]+)/.exec(pathname)?.[1] ?? "").trim();
	}
	/**
	* 决定这次抓到的内容要不要留下。
	*
	* 页面同一时刻只留一份：播放器会为别的视频（下一个视频、迷你播放器）和翻译字幕
	* 也发同样的请求，谁的响应后到就覆盖谁的做法会让人复制到别的内容。
	*
	* @param state 已缓存的内容
	* @param currentVideoId 当前地址栏里的视频
	* @param url 这次响应的地址
	* @param segments 这次解析出的片段；null 表示这份响应没有文稿
	* @returns 新的缓存内容；`null` 表示丢掉这次响应
	*/
	function nextCapture(state, currentVideoId, url, segments) {
		if (!segments || segments.length === 0 || currentVideoId === "") return null;
		const { videoId, translated } = readCapturedUrl(url);
		const fromPanel = !TIMEDTEXT_PATTERN.test(url);
		if (videoId !== "" && videoId !== currentVideoId) return null;
		if (!fromPanel && translated) return null;
		if (state?.videoId === currentVideoId && state.fromPanel && !fromPanel) return null;
		return {
			videoId: currentVideoId,
			fromPanel,
			segments
		};
	}
	var captures = /* @__PURE__ */ new WeakMap();
	function installNetworkCapture(win = window, options = {}) {
		const existing = captures.get(win);
		if (existing) return existing;
		let state = null;
		let active = true;
		const currentVideoId = options.currentVideoId ?? (() => readVideoId(win.location.search, win.location.pathname));
		const read = () => {
			return state !== null && state.videoId === currentVideoId() ? state.segments : null;
		};
		const accept = (url, data, videoIdAtRequest) => {
			if (!active) return;
			if (videoIdAtRequest !== currentVideoId()) return;
			const next = nextCapture(state, videoIdAtRequest, url, parseCapturedResponse(url, data));
			if (next) state = next;
		};
		const originalFetch = win.fetch;
		const wrappedFetch = (...args) => {
			const input = args[0];
			const url = typeof input === "string" ? input : input instanceof Request ? input.url : input instanceof URL ? input.href : "";
			const request = Reflect.apply(originalFetch, win, args);
			if (CAPTURE_PATTERN.test(url)) {
				const videoIdAtRequest = currentVideoId();
				request.then(async (response) => {
					try {
						accept(url, await response.clone().json(), videoIdAtRequest);
					} catch {}
				}).catch(() => void 0);
			}
			return request;
		};
		win.fetch = wrappedFetch;
		const proto = win.XMLHttpRequest.prototype;
		const originalOpen = proto.open;
		const listeners = /* @__PURE__ */ new WeakMap();
		const wrappedOpen = function(method, url, ...rest) {
			const previous = listeners.get(this);
			if (previous) {
				this.removeEventListener("load", previous);
				listeners.delete(this);
			}
			const target = typeof url === "string" ? url : url.href;
			if (CAPTURE_PATTERN.test(target)) {
				const videoIdAtRequest = currentVideoId();
				const listener = () => {
					listeners.delete(this);
					try {
						const data = this.responseType === "json" ? this.response : JSON.parse(this.responseText);
						accept(target, data, videoIdAtRequest);
					} catch {}
				};
				listeners.set(this, listener);
				this.addEventListener("load", listener, { once: true });
			}
			Reflect.apply(originalOpen, this, [
				method,
				url,
				...rest
			]);
		};
		proto.open = wrappedOpen;
		const capture = {
			get: read,
			clear(keepVideoId) {
				if (keepVideoId !== void 0 && state?.videoId === keepVideoId) return;
				state = null;
			},
			restore() {
				if (!active) return;
				active = false;
				state = null;
				if (win.fetch === wrappedFetch) win.fetch = originalFetch;
				if (proto.open === wrappedOpen) proto.open = originalOpen;
				captures.delete(win);
			}
		};
		captures.set(win, capture);
		return capture;
	}
	//#endregion
	//#region scripts/youtube-transcript-copy/src/transcript/open-panel.ts
	/**
	* 打开转写面板。
	*
	* YouTube 没有稳定的按钮选择器，只能按行为信号找：描述区里的“Show transcript”、
	* 或任何 aria-label / 文字里带 transcript 的按钮。找不到就展开描述再找一次；
	* 面板节点出现且真的占据版面才算打开。
	*/
	function fireClick(element) {
		if (element instanceof HTMLElement && !isElementVisible(element)) element.scrollIntoView({
			block: "center",
			behavior: "instant"
		});
		element.click();
	}
	function isVisible(element) {
		if (!(element instanceof HTMLElement)) return false;
		const style = getComputedStyle(element);
		return style.display !== "none" && style.visibility !== "hidden" && element.offsetParent !== null;
	}
	function isElementVisible(element) {
		if (!element) return false;
		const rect = element.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0 && isVisible(element);
	}
	function ariaOrText(element) {
		return clean(element.getAttribute("aria-label")) || clean(element.textContent);
	}
	/** 各语言里“显示转写文稿”的说法；英文之外至少覆盖简中、日、韩、俄与拉丁语系。 */
	var TRANSCRIPT_LABEL = /transcript|转写|转文字|文字起こし|스크립트|транскрип|transcri/i;
	/** 按 aria-label 优先、按钮文字兜底的顺序找“显示转写文稿”。 */
	function findTranscriptTrigger(doc = document) {
		const section = doc.querySelector("ytd-video-description-transcript-section-renderer");
		if (section && section.getBoundingClientRect().width > 0) {
			const buttons = [...section.querySelectorAll("button, [role=\"button\"], tp-yt-paper-button, yt-button-shape, button-view-model")];
			const button = buttons.find((candidate) => candidate.tagName === "BUTTON" || candidate.getAttribute("role") === "button") ?? buttons[0];
			if (button) return button;
		}
		const expander = doc.querySelector("ytd-text-inline-expander");
		if (expander) {
			const buttons = [...expander.querySelectorAll("button, [role=\"button\"], yt-button-shape, button-view-model")].filter((button) => clean(button.getAttribute("aria-label")) !== "");
			const byAriaShow = buttons.find((button) => /show\s+transcript/i.test(clean(button.getAttribute("aria-label"))));
			if (byAriaShow) return byAriaShow;
			const byAria = buttons.find((button) => TRANSCRIPT_LABEL.test(clean(button.getAttribute("aria-label"))));
			if (byAria) return byAria;
			const byText = buttons.find((button) => TRANSCRIPT_LABEL.test(clean(button.textContent)));
			if (byText) return byText;
		}
		for (const button of doc.querySelectorAll("button, [role=\"button\"], yt-button-shape, button-view-model")) {
			if (!(button instanceof HTMLElement) || !button.offsetParent) continue;
			if (TRANSCRIPT_LABEL.test(clean(button.getAttribute("aria-label")) + clean(button.textContent))) return button;
		}
		return null;
	}
	/** 展开被折叠的视频描述，转写按钮通常藏在里面。 */
	function expandDescription(doc = document) {
		const expander = doc.querySelector("ytd-text-inline-expander, ytd-expandable-video-description-body-renderer");
		if (!expander) return false;
		const moreButton = [...expander.querySelectorAll("button, [role=\"button\"], tp-yt-paper-button, yt-button-shape")].find((button) => /(?:\.{3}\s*more|\.\.\.更多|展开更多|show more|展开)/i.test(ariaOrText(button)) || button.id === "expand");
		if (!moreButton) return false;
		fireClick(moreButton);
		return true;
	}
	/** 面板里已经有可见的片段节点。 */
	function isPanelOpen(doc = document) {
		for (const node of doc.querySelectorAll("transcript-segment-view-model, ytd-transcript-segment-renderer")) if (node.getBoundingClientRect().width > 0) return true;
		return false;
	}
	/**
	* 打开转写面板。
	*
	* 每轮：展开描述 → 等界面稳定 → 点一次按钮 → 等面板渲染。
	* 只点一次：click() 与合成 MouseEvent 会各触发一次面板切换，连点两次等于又关上。
	* 第一轮给足 3.6 秒（面板首次展开最慢）；之后每轮只等 1.2 秒，避免打不开时
	* 每次点击都卡十几秒。
	*
	* @returns 面板是否真的打开
	*/
	async function openTranscriptPanel(options = {}) {
		const doc = options.doc ?? document;
		const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
		const attempts = options.attempts ?? 4;
		for (let attempt = 0; attempt < attempts && !isPanelOpen(doc); attempt += 1) {
			const waits = attempt === 0 ? 12 : 4;
			expandDescription(doc);
			await sleep(400);
			const candidate = findTranscriptTrigger(doc);
			if (!candidate) continue;
			const trigger = candidate.querySelector("button, [role=\"button\"], tp-yt-paper-button") ?? candidate;
			let clicked = false;
			try {
				trigger.click();
				clicked = true;
			} catch {}
			if (clicked) {
				for (let wait = 0; wait < waits; wait += 1) {
					await sleep(300);
					if (isPanelOpen(doc)) return true;
				}
				continue;
			}
			try {
				trigger.dispatchEvent(new MouseEvent("click", {
					bubbles: true,
					cancelable: true
				}));
			} catch {}
			for (let wait = 0; wait < waits; wait += 1) {
				await sleep(300);
				if (isPanelOpen(doc)) return true;
			}
		}
		return isPanelOpen(doc);
	}
	//#endregion
	//#region scripts/youtube-transcript-copy/src/transcript/strategy.ts
	/**
	* 策略顺序。
	*
	* 上一次成功的策略下次优先：YouTube 改版时往往只有一种结构还能用，记住它可以让
	* 后续每次复制都少走几条注定失败的路径。记住的下标只在合法范围内生效，
	* 存储被写坏时退回默认顺序。
	*/
	function prioritize(count, savedIndex) {
		const order = Array.from({ length: count }, (_, index) => index);
		if (savedIndex === void 0 || !Number.isInteger(savedIndex) || savedIndex <= 0 || savedIndex >= count) return order;
		return [savedIndex, ...order.filter((index) => index !== savedIndex)];
	}
	//#endregion
	//#region scripts/youtube-transcript-copy/src/transcript/service.ts
	function createTranscriptService(deps) {
		/** 只缓存一个视频：YouTube 是 SPA，同一标签页里换视频后旧缓存必须失效。 */
		let cache = null;
		const runStrategies = async (kind, strategies) => {
			const saved = deps.memory.get()[kind]?.idx;
			for (const index of prioritize(strategies.length, saved)) {
				const strategy = strategies[index];
				if (!strategy) continue;
				try {
					const result = await strategy();
					if (result !== null && result.length > 0) {
						deps.memory.remember(kind, index);
						return result;
					}
				} catch {}
			}
			return null;
		};
		return { async fetchTranscript() {
			const videoId = deps.videoId();
			if (videoId === "") return [];
			if (cache !== null && cache.videoId === videoId) return cache.segments;
			const fromNetwork = await runStrategies("net", [deps.fromInitialTrack, () => deps.fromNetworkCache()]);
			if (deps.videoId() !== videoId) return [];
			if (fromNetwork) {
				cache = {
					videoId,
					segments: fromNetwork
				};
				return fromNetwork;
			}
			const panelOpen = await deps.ensurePanelOpen();
			if (deps.videoId() !== videoId) return [];
			const captured = deps.fromNetworkCache();
			if (captured && captured.length > 0) {
				cache = {
					videoId,
					segments: captured
				};
				return captured;
			}
			if (panelOpen) {
				const fromDom = await runStrategies("dom", [() => deps.fromViewModel(), () => deps.fromPanelDump()]);
				if (deps.videoId() !== videoId) return [];
				if (fromDom) return fromDom;
			}
			try {
				const fromApi = await deps.fromApi(videoId);
				if (deps.videoId() !== videoId) return [];
				if (fromApi && fromApi.length > 0) {
					cache = {
						videoId,
						segments: fromApi
					};
					return fromApi;
				}
			} catch {}
			return [];
		} };
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
	/**
	* 中文文案预设：四个脚本的 `LABELS` 逐字相同且都缺 `operation`，
	* 无标题操作面板的 aria 名会回落到英文 `Operations`。
	* 脚本侧 `mountUI({ theme: 'system', labels: ZH_LABELS })` 即可，不再各写一份。
	*/
	var ZH_LABELS = {
		close: "关闭",
		settings: "设置",
		operation: "操作",
		notifications: "通知",
		dismissNotification: "关闭通知",
		closeSettings: "关闭设置",
		scrollHint: "向下滚动查看更多内容",
		cancel: "取消",
		confirm: "确定"
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
	var ROOT_ATTRIBUTE = "data-ds-root";
	function mountUI(options = {}) {
		const host = document.createElement(HOST_TAG);
		host.setAttribute(ROOT_ATTRIBUTE, "");
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
	//#region packages/userscript-ui/src/patterns/app-host.ts
	/**
	* 创建界面宿主。
	*
	* @param options 主题选项
	*/
	function createUiHost(options = {}) {
		let ui = null;
		return {
			ensure: () => ui ??= mountUI({
				theme: options.theme ?? "system",
				labels: ZH_LABELS
			}),
			destroy: () => {
				ui?.destroy();
				ui = null;
			}
		};
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
			const next = scrollable && !atEnd ? "visible" : "hidden";
			if (el.dataset.state !== next) el.dataset.state = next;
		};
		let frame = 0;
		const scheduleUpdate = () => {
			if (frame !== 0) return;
			if (typeof requestAnimationFrame !== "function") {
				update();
				return;
			}
			frame = requestAnimationFrame(() => {
				frame = 0;
				update();
			});
		};
		scroller.addEventListener("scroll", scheduleUpdate, {
			passive: true,
			signal: scope.signal
		});
		window.addEventListener("resize", scheduleUpdate, {
			passive: true,
			signal: scope.signal
		});
		const mutations = new MutationObserver(scheduleUpdate);
		mutations.observe(scroller, {
			childList: true,
			subtree: true,
			characterData: true
		});
		const resize = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleUpdate) : null;
		resize?.observe(scroller);
		update();
		return {
			el,
			update,
			destroy() {
				scope.destroy();
				mutations.disconnect();
				resize?.disconnect();
				if (frame !== 0 && typeof cancelAnimationFrame === "function") {
					cancelAnimationFrame(frame);
					frame = 0;
				}
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
	//#region scripts/youtube-transcript-copy/src/ui/transcript-button.css?inline
	var transcript_button_default = "/*\n * 只负责定位与拖动光标：尺寸、颜色、悬停、焦点环、加载态都由 @ui 的按钮组件提供。\n */\n.yt-transcript-wrap {\n  position: fixed;\n  z-index: 1;\n  cursor: grab;\n  user-select: none;\n}\n\n.yt-transcript-wrap[data-dragging='true'] {\n  cursor: grabbing;\n}\n";
	//#endregion
	//#region scripts/youtube-transcript-copy/src/ui/button.ts
	var DRAG_THRESHOLD_PX = 3;
	var RESET_DELAY_MS = 1500;
	var CLICK_SUPPRESS_MS = 50;
	var LABELS = {
		normal: "T",
		loading: "",
		success: "✓",
		error: "✕"
	};
	function createTranscriptButton(options) {
		const { ui } = options;
		if (ui.destroyed) throw new Error("Cannot create a transcript button after ui.destroy().");
		ui.useStyles(transcript_button_default);
		const wrap = document.createElement("div");
		wrap.className = "yt-transcript-wrap";
		wrap.dataset.dragging = "false";
		wrap.dataset.state = "normal";
		const stateLabel = document.createElement("span");
		stateLabel.textContent = LABELS.normal;
		let state = "normal";
		let position = {
			right: 30,
			top: 30
		};
		let suppressClick = false;
		let resetTimer;
		let dragScope = null;
		const button = createButton(ui, {
			label: stateLabel,
			variant: "destructive",
			size: "lg",
			iconOnly: true,
			ariaLabel: options.label,
			title: options.label,
			onClick: (event) => {
				event.stopPropagation();
				if (suppressClick || state === "loading") return;
				options.onClick();
			}
		});
		wrap.appendChild(button.el);
		ui.mount(wrap);
		/** 已写进样式的坐标；定时校正每次都会调用，值没变就不碰 DOM（写样式会触发重排）。 */
		let applied = null;
		const applyPosition = () => {
			if (applied?.right === position.right && applied.top === position.top) return;
			applied = { ...position };
			wrap.style.right = `${position.right}px`;
			wrap.style.top = `${position.top}px`;
		};
		const applyState = (next) => {
			state = next;
			wrap.dataset.state = next;
			stateLabel.textContent = LABELS[next];
			button.setLoading(next === "loading");
			if (resetTimer !== void 0) {
				window.clearTimeout(resetTimer);
				resetTimer = void 0;
			}
			if (next === "success" || next === "error") resetTimer = window.setTimeout(() => applyState("normal"), RESET_DELAY_MS);
		};
		wrap.addEventListener("pointerdown", (event) => {
			event.stopPropagation();
			if (event.button !== 0 || state === "loading") return;
			const rect = wrap.getBoundingClientRect();
			const startRight = window.innerWidth - rect.right;
			const startTop = rect.top;
			const startX = event.clientX;
			const startY = event.clientY;
			const pointerId = event.pointerId;
			let moved = false;
			let captured = false;
			const capture = () => {
				if (captured) return;
				try {
					wrap.setPointerCapture?.(pointerId);
					captured = true;
				} catch {}
			};
			const release = () => {
				if (!captured) return;
				captured = false;
				try {
					wrap.releasePointerCapture?.(pointerId);
				} catch {}
			};
			dragScope?.abort();
			const scope = new AbortController();
			dragScope = scope;
			const { signal } = scope;
			const onMove = (moveEvent) => {
				if (moveEvent.buttons === 0) {
					finish(true);
					return;
				}
				const dx = moveEvent.clientX - startX;
				const dy = moveEvent.clientY - startY;
				if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) {
					moved = true;
					capture();
				}
				position = clampPosition({
					right: startRight - dx,
					top: startTop + dy
				}, {
					width: window.innerWidth,
					height: window.innerHeight
				});
				applyPosition();
			};
			/** 结束这次拖动；`save` 为 false 表示被系统取消（触摸滚动），位置不落存储。 */
			const finish = (save) => {
				release();
				scope.abort();
				dragScope = null;
				wrap.dataset.dragging = "false";
				if (!save) return;
				if (!moved) return;
				options.onMoveEnd(position);
				suppressClick = true;
				window.setTimeout(() => {
					suppressClick = false;
				}, CLICK_SUPPRESS_MS);
			};
			const onUp = () => finish(true);
			const onCancel = () => finish(false);
			wrap.dataset.dragging = "true";
			document.addEventListener("pointermove", onMove, { signal });
			document.addEventListener("pointerup", onUp, { signal });
			document.addEventListener("pointercancel", onCancel, { signal });
		});
		const cleanup = () => {
			if (resetTimer !== void 0) window.clearTimeout(resetTimer);
			resetTimer = void 0;
			dragScope?.abort();
			dragScope = null;
		};
		ui.onDestroy(cleanup);
		applyPosition();
		return {
			el: wrap,
			setState: applyState,
			setVisible(visible) {
				wrap.hidden = !visible;
			},
			setPosition(next) {
				position = clampPosition(next, {
					width: window.innerWidth,
					height: window.innerHeight
				});
				applyPosition();
			},
			getPosition: () => position,
			isDragging: () => dragScope !== null,
			destroy() {
				cleanup();
				button.destroy();
				wrap.remove();
			}
		};
	}
	//#endregion
	//#region scripts/youtube-transcript-copy/src/ui/app.ts
	function createTranscriptButtonApp(options) {
		const host = createUiHost();
		let button = null;
		let toast = null;
		let panels = null;
		let visible = options.isVisible();
		let busy = false;
		let autoPosition = options.getSavedPosition() === null;
		let settleTimer;
		const SETTLE_DELAYS_MS = [
			300,
			1e3,
			2e3,
			4e3
		];
		const ensureUI = () => host.ensure();
		/** 抓取并复制；按钮和面板共用，同一时刻只跑一个。 */
		const copy = async () => {
			if (busy) return "skipped";
			busy = true;
			try {
				return await options.activate();
			} catch {
				return "error";
			} finally {
				busy = false;
			}
		};
		const activateFromButton = async (target) => {
			if (busy) return;
			target.setState("loading");
			const outcome = await copy();
			target.setState(outcome === "success" ? "success" : "error");
		};
		/** 回到播放器右上角并清掉位置记忆：之后重新跟着播放器走。 */
		const resetPosition = () => {
			autoPosition = true;
			options.clearSavedPosition();
			const next = options.getDefaultPosition();
			if (next) button?.setPosition(next);
		};
		const ensurePanels = () => {
			if (panels) return panels;
			const current = ensureUI();
			toast ??= createToast(current);
			const notify = toast;
			const actions = createPanel(current, {
				title: "操作面板",
				description: "复制本页的转写文稿，或把悬浮按钮放回右上角。",
				open: false,
				closeLabel: "关闭操作面板"
			});
			const copyButton = createButton(current, {
				label: "复制当前转写文稿",
				onClick: () => {
					copyButton.setLoading(true);
					copy().then((outcome) => {
						copyButton.setLoading(false);
						if (outcome === "skipped") return;
						if (outcome === "success") {
							notify.success("已复制转写文稿");
							actions.close();
						} else if (outcome === "empty") notify.warning("没有找到转写文稿");
						else notify.error("复制失败，请稍后重试");
					});
				}
			});
			const resetButton = createButton(current, {
				label: "重置按钮位置",
				variant: "secondary",
				onClick: () => {
					resetPosition();
					notify.success("按钮已回到播放器右上角");
					actions.close();
				}
			});
			const actionSection = createSection(current, { title: "操作" });
			actionSection.body.append(copyButton.el, resetButton.el);
			actions.body.append(actionSection.el);
			const settings = createPanel(current, {
				title: "功能设置",
				description: "这里只放会影响脚本行为的开关；改动立即生效。",
				open: false,
				closeLabel: "关闭功能设置"
			});
			const memorySection = createSection(current, {
				title: "记忆",
				description: "脚本会记住上次能用的转写抓取方式，下次优先用它；清空后重新按默认顺序尝试。"
			});
			const clearStrategy = createButton(current, {
				label: "清空策略记忆",
				variant: "destructive",
				onClick: () => {
					options.clearStrategy();
					notify.success("已清空策略记忆");
				}
			});
			memorySection.body.append(clearStrategy.el);
			settings.body.append(memorySection.el);
			panels = {
				actions,
				settings
			};
			return panels;
		};
		function sync() {
			const current = mount();
			if (!current) return;
			current.setVisible(visible);
			if (current.isDragging()) return;
			current.setPosition(autoPosition ? options.getDefaultPosition() ?? current.getPosition() : current.getPosition());
		}
		function mount() {
			if (button) return button;
			const position = options.getSavedPosition() ?? options.getDefaultPosition();
			if (!position) return null;
			const created = createTranscriptButton({
				ui: ensureUI(),
				label: "复制当前转写文稿",
				onClick: () => void activateFromButton(created),
				onMoveEnd: (next) => {
					autoPosition = false;
					options.savePosition(next);
				}
			});
			created.setPosition(position);
			created.setVisible(visible);
			button = created;
			scheduleSettle(0);
			return created;
		}
		/** 首屏布局稳定前按固定节奏再算几次默认位置；用户拖动后 autoPosition 关闭，不再校正。 */
		function scheduleSettle(index) {
			const delay = SETTLE_DELAYS_MS[index];
			if (delay === void 0) {
				settleTimer = void 0;
				return;
			}
			settleTimer = window.setTimeout(() => {
				settleTimer = void 0;
				sync();
				scheduleSettle(index + 1);
			}, delay);
		}
		return {
			sync,
			setVisible(next) {
				visible = next;
				if (next && !button) sync();
				button?.setVisible(next);
			},
			openActions() {
				ensurePanels().actions.open();
			},
			openSettings() {
				ensurePanels().settings.open();
			},
			destroy() {
				if (settleTimer !== void 0) {
					window.clearTimeout(settleTimer);
					settleTimer = void 0;
				}
				button?.destroy();
				button = null;
				toast = null;
				panels = null;
				host.destroy();
			}
		};
	}
	//#endregion
	//#region scripts/youtube-transcript-copy/src/main.ts
	/**
	* 入口：先装网络钩子（越早越好），DOM 就绪后再建悬浮按钮、挂 SPA 与播放状态监听。
	*
	* 只在顶层 frame 运行：转写面板与播放器都在主文档里，iframe 里跑一份只会重复请求。
	*/
	createUserscript(createGmApi(), {
		slug: "youtube-transcript-copy",
		topFrameOnly: true,
		installLock: false,
		onStart: () => {
			const currentVideoId = () => readVideoId(location.search, location.pathname);
			const network = installNetworkCapture(window, { currentVideoId });
			return () => network.restore();
		},
		onReady: (kit) => {
			const store = createStore(kit.gm);
			const clipboard = createClipboard();
			const currentVideoId = () => readVideoId(location.search, location.pathname);
			const network = installNetworkCapture(window, { currentVideoId });
			let initialTrack = null;
			const captureInitialTrack = () => {
				const videoId = currentVideoId();
				initialTrack = [readPlayerResponse(), window.ytInitialPlayerResponse].map(readInitialTrack).find((track) => track !== null && track.videoId === videoId) ?? null;
			};
			captureInitialTrack();
			const service = createTranscriptService({
				videoId: currentVideoId,
				fromInitialTrack: () => initialTrack && initialTrack.videoId === currentVideoId() ? fetchInitialTrack(initialTrack) : Promise.resolve(null),
				fromNetworkCache: () => network.get(),
				ensurePanelOpen: () => openTranscriptPanel(),
				fromViewModel: () => isPlayerOnVideo(currentVideoId()) ? extractFromViewModel(document.body) : null,
				fromPanelDump: () => isPlayerOnVideo(currentVideoId()) ? extractFromPanelDump(document.body) : null,
				fromApi: (videoId) => requestPanel(videoId),
				memory: {
					get: store.getStrategy,
					remember: (kind, index) => store.rememberStrategy(kind, index)
				}
			});
			const copyTranscript = async () => {
				const segments = await service.fetchTranscript();
				if (segments.length === 0) return "empty";
				return await clipboard.copy(formatLines(segments)) ? "success" : "error";
			};
			const app = createTranscriptButtonApp({
				getSavedPosition: store.getPosition,
				savePosition: store.savePosition,
				getDefaultPosition: () => defaultButtonPosition(readPlayerRect(), {
					width: window.innerWidth,
					height: window.innerHeight
				}),
				isVisible: () => shouldShowButton(readVideoState()),
				activate: copyTranscript,
				clearSavedPosition: store.clearPosition,
				clearStrategy: store.clearStrategy
			});
			kit.menu({
				label: "操作面板",
				run: () => app.openActions()
			});
			kit.menu({
				label: "功能设置",
				run: () => app.openSettings()
			});
			app.sync();
			const stopVisibility = watchVisibility((visible) => app.setVisible(visible));
			let lastVideoId = currentVideoId();
			const stopNavigation = watchNavigation(() => {
				const videoId = currentVideoId();
				if (videoId !== lastVideoId) {
					lastVideoId = videoId;
					network.clear(videoId);
					captureInitialTrack();
				}
				app.sync();
			});
			let resizeFrame = 0;
			const onResize = () => {
				if (resizeFrame !== 0) return;
				resizeFrame = window.requestAnimationFrame(() => {
					resizeFrame = 0;
					app.sync();
				});
			};
			window.addEventListener("resize", onResize, { signal: kit.signal });
			return () => {
				stopVisibility();
				stopNavigation();
				window.cancelAnimationFrame(resizeFrame);
				app.destroy();
			};
		}
	});
	//#endregion
})();
