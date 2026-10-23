// ==UserScript==
// @name         YouTube 转写文稿复制
// @name:en      YouTube Transcript Copy
// @namespace    https://github.com/Wildfire2282
// @version      1.2.1
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
// @downloadURL https://update.greasyfork.org/scripts/579560/YouTube%20%E8%BD%AC%E5%86%99%E6%96%87%E7%A8%BF%E5%A4%8D%E5%88%B6.user.js
// @updateURL https://update.greasyfork.org/scripts/579560/YouTube%20%E8%BD%AC%E5%86%99%E6%96%87%E7%A8%BF%E5%A4%8D%E5%88%B6.meta.js
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
	function clamp(value, min, max) {
		if (max < min) return min;
		return Math.min(Math.max(value, min), max);
	}
	/** 把位置收回视口内；视口比按钮还小时贴住左上角。 */
	function clampPosition(position, viewport, size = 40) {
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
		const onDomChange = () => {
			if (doc.location.href !== lastHref) notify();
		};
		win.addEventListener("yt-navigate-finish", onNavigate);
		const observer = new MutationObserver(onDomChange);
		let observing = false;
		const observeBody = () => {
			if (observing || !doc.body) return;
			observer.observe(doc.body, {
				childList: true,
				subtree: true
			});
			observing = true;
		};
		observeBody();
		if (!observing) doc.addEventListener("DOMContentLoaded", observeBody, { once: true });
		const timer = win.setInterval(() => {
			if (doc.location.href !== lastHref) notify();
			else if (doc.location.href.includes("/watch")) onTick();
		}, options.intervalMs ?? 1500);
		return () => {
			win.removeEventListener("yt-navigate-finish", onNavigate);
			doc.removeEventListener("DOMContentLoaded", observeBody);
			observer.disconnect();
			win.clearInterval(timer);
		};
	}
	//#endregion
	//#region scripts/youtube-transcript-copy/src/features/visibility.ts
	function shouldShowButton(snapshot) {
		return snapshot.exists && !snapshot.paused && !snapshot.ended && snapshot.readyState > 2 && !snapshot.fullscreen;
	}
	function findVideo(doc = document) {
		return doc.querySelector("video.html5-main-video, #movie_player video");
	}
	function readVideoState(doc = document, fullscreen = void 0) {
		const video = findVideo(doc);
		const fullscreenElement = fullscreen === void 0 ? doc.fullscreenElement : fullscreen;
		return {
			exists: video !== null,
			paused: video?.paused ?? true,
			ended: video?.ended ?? false,
			readyState: video?.readyState ?? 0,
			fullscreen: fullscreenElement !== null
		};
	}
	/**
	* 监听播放状态与全屏变化。
	*
	* 只在结果变化时回调，避免每 500ms 写一次 DOM；视频节点被替换后自动重新绑定。
	*
	* @returns 清理函数（定时器与所有监听）
	*/
	function watchVisibility(onChange, options = {}) {
		const doc = options.doc ?? document;
		let video = null;
		let last = null;
		const emit = () => {
			const next = shouldShowButton(readVideoState(doc));
			if (next === last) return;
			last = next;
			onChange(next);
		};
		const detach = () => {
			if (!video) return;
			for (const type of [
				"play",
				"pause",
				"ended",
				"loadeddata"
			]) video.removeEventListener(type, emit);
			video = null;
		};
		const bind = () => {
			const found = findVideo(doc);
			if (found === video) return;
			detach();
			video = found;
			if (!video) return;
			for (const type of [
				"play",
				"pause",
				"ended",
				"loadeddata"
			]) video.addEventListener(type, emit);
		};
		const onFullscreen = () => emit();
		doc.addEventListener("fullscreenchange", onFullscreen);
		const timer = window.setInterval(() => {
			bind();
			emit();
		}, options.intervalMs ?? 500);
		bind();
		emit();
		return () => {
			window.clearInterval(timer);
			doc.removeEventListener("fullscreenchange", onFullscreen);
			detach();
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
	* 转写文稿的文本处理：清洗、时间戳互转、输出格式。
	*
	* 输出格式与线上旧版逐字一致：每条一行，有时间戳时加 `[分:秒] ` 前缀。
	* 时间戳只到分钟（`90:00` 表示 90 分钟），旧版没有小时位，这里保持不改。
	*/
	function clean(text) {
		return (text ?? "").replace(/\s+/g, " ").trim();
	}
	/**
	* 把页面上的时间戳文字换算成毫秒。
	*
	* @param text `m:ss` 或 `h:mm:ss`
	* @returns 毫秒；格式不认识时按 0 处理
	*/
	function tsToSec(text) {
		const parts = text.split(":").map(Number);
		if (parts.length === 2) {
			const [minutes, seconds] = parts;
			if (minutes === void 0 || seconds === void 0 || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return 0;
			return minutes * 60 + seconds;
		}
		if (parts.length === 3) {
			const [hours, minutes, seconds] = parts;
			if (hours === void 0 || minutes === void 0 || seconds === void 0 || !Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return 0;
			return hours * 3600 + minutes * 60 + seconds;
		}
		return 0;
	}
	/** 毫秒 → 复制到剪贴板里的 `分:秒`；未知时间戳返回空串。 */
	function fmtTs(ms) {
		if (ms === null || !Number.isFinite(ms)) return "";
		const total = Math.max(0, Math.floor(ms / 1e3));
		const minutes = Math.floor(total / 60);
		const seconds = total % 60;
		return `${minutes}:${String(seconds).padStart(2, "0")}`;
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
	/** `engagementPanels[*]...cueGroups` 里的转写；返回 null 表示这份响应没有文稿。 */
	function extractFromPanelResponse(data) {
		const root = asRecord$1(data);
		if (!root) return null;
		const segments = [];
		for (const entry of asArray(root.engagementPanels)) {
			const wrapper = asRecord$1(entry);
			if (!wrapper) continue;
			const panel = asRecord$1(wrapper.engagementPanelSectionListRenderer) ?? asRecord$1(wrapper.engagementPanel) ?? wrapper;
			if (!/transcript/i.test(asString(panel.panelIdentifier)) && !/cueGroup/i.test(JSON.stringify(panel))) continue;
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
					const text = asString(renderer?.simpleText) || asString(asRecord$1(renderer?.cue)?.simpleText);
					if (!text) continue;
					segments.push({
						start: numberOr(renderer?.startOffsetMs) ?? numberOr(cueRecord.startOffsetMs) ?? 0,
						text: clean(text)
					});
				}
			}
		}
		return segments.length > 0 ? segments : null;
	}
	/** json3 字幕（captionTracks[0].baseUrl + `fmt=json3`）里的转写。 */
	function extractFromJson3(data) {
		const root = asRecord$1(data);
		if (!root) return null;
		const segments = [];
		for (const event of asArray(root.events)) {
			const record = asRecord$1(event);
			if (!record) continue;
			const text = clean(asArray(record.segs).map((part) => asString(asRecord$1(part)?.utf8)).join(" "));
			if (!text) continue;
			segments.push({
				start: numberOr(record.tStartMs) ?? 0,
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
			if (text && text !== timestamp) segments.push({
				start: tsToSec(timestamp) * 1e3,
				text
			});
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
			if (text.length > 1) segments.push({
				start: tsToSec(timestamp) * 1e3,
				text
			});
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
			segments.push({
				start: tsToSec(match[1]) * 1e3,
				text: clean(match[2])
			});
		}
		return segments.length > 0 ? segments : null;
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
	var PANEL_URL = "https://www.youtube.com/youtubei/v1/get_panel?prettyPrint=false";
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
			return extractFromPanelResponse(await (await fetchImpl(PANEL_URL, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					context: { client: {
						clientName: "WEB",
						clientVersion
					} },
					panelIdentifier: "engagement-panel-searchable-transcript"
				})
			})).json());
		} catch {
			return null;
		}
	}
	//#endregion
	//#region scripts/youtube-transcript-copy/src/transcript/initial-track.ts
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
		const tracklist = asRecord(asRecord(asRecord(response)?.captions)?.playerCaptionsTracklistRenderer);
		const first = asRecord((Array.isArray(tracklist?.captionTracks) ? tracklist.captionTracks : [])[0]);
		const baseUrl = typeof first?.baseUrl === "string" ? first.baseUrl : "";
		return baseUrl === "" ? null : { baseUrl };
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
	function installNetworkCapture(win = window) {
		const globals = win;
		if (globals.__ytTxNetHooked) return {
			get: () => globals.__ytTxNetSegments ?? null,
			clear: () => {
				globals.__ytTxNetSegments = null;
			},
			restore: () => void 0
		};
		globals.__ytTxNetHooked = true;
		globals.__ytTxNetSegments = null;
		const originalFetch = win.fetch.bind(win);
		const wrappedFetch = (...args) => {
			const input = args[0];
			const url = typeof input === "string" ? input : input instanceof Request ? input.url : input instanceof URL ? input.href : "";
			const request = originalFetch(...args);
			if (CAPTURE_PATTERN.test(url)) request.then(async (response) => {
				try {
					const data = await response.clone().json();
					globals.__ytTxNetSegments = parseCapturedResponse(url, data) ?? globals.__ytTxNetSegments ?? null;
				} catch {}
			}).catch(() => void 0);
			return request;
		};
		win.fetch = wrappedFetch;
		const proto = win.XMLHttpRequest.prototype;
		const originalOpen = proto.open;
		const wrappedOpen = function(method, url, ...rest) {
			const target = typeof url === "string" ? url : url.href;
			if (CAPTURE_PATTERN.test(target)) this.addEventListener("load", () => {
				try {
					const data = this.responseType === "json" ? this.response : JSON.parse(this.responseText);
					globals.__ytTxNetSegments = parseCapturedResponse(target, data) ?? globals.__ytTxNetSegments ?? null;
				} catch {}
			});
			Reflect.apply(originalOpen, this, [
				method,
				url,
				...rest
			]);
		};
		proto.open = wrappedOpen;
		return {
			get: () => globals.__ytTxNetSegments ?? null,
			clear() {
				globals.__ytTxNetSegments = null;
			},
			restore() {
				win.fetch = originalFetch;
				proto.open = originalOpen;
				globals.__ytTxNetHooked = false;
			}
		};
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
	* 每轮：展开描述 → 等界面稳定 → 点按钮 → 最多等 3.6 秒让面板渲染。
	*
	* @returns 面板是否真的打开
	*/
	async function openTranscriptPanel(options = {}) {
		const doc = options.doc ?? document;
		const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
		const attempts = options.attempts ?? 4;
		for (let attempt = 0; attempt < attempts && !isPanelOpen(doc); attempt += 1) {
			expandDescription(doc);
			await sleep(400);
			const trigger = findTranscriptTrigger(doc);
			if (!trigger) continue;
			try {
				trigger.click();
			} catch {}
			try {
				trigger.dispatchEvent(new MouseEvent("click", {
					bubbles: true,
					cancelable: true
				}));
			} catch {}
			for (let wait = 0; wait < 12; wait += 1) {
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
			if (!await deps.ensurePanelOpen()) return [];
			if (deps.videoId() !== videoId) return [];
			const fromDom = await runStrategies("dom", [() => deps.fromViewModel(), () => deps.fromPanelDump()]);
			if (deps.videoId() !== videoId) return [];
			if (fromDom) {
				cache = {
					videoId,
					segments: fromDom
				};
				return fromDom;
			}
			try {
				const fromApi = await deps.fromApi(videoId);
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
	//#region scripts/youtube-transcript-copy/src/ui/transcript-button.css?inline
	var transcript_button_default = "/*\n * 悬浮按钮：尺寸、圆角、颜色全部取自 --ds-* Token。\n * 旧版是一个 40px 的红色圆形按钮，就绪时半透明、悬停时变亮，这里保持一致。\n */\n.yt-transcript-wrap {\n  position: fixed;\n  z-index: 1;\n  cursor: grab;\n  user-select: none;\n}\n\n.yt-transcript-wrap[data-dragging='true'] {\n  cursor: grabbing;\n}\n\n.yt-transcript-button {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: var(--ds-launcher-size);\n  height: var(--ds-launcher-size);\n  padding: 0;\n  border: 0;\n  border-radius: var(--ds-radius-full);\n  color: var(--ds-primary-foreground);\n  font-family: var(--ds-font-sans);\n  font-size: var(--ds-text-lg);\n  font-weight: var(--ds-weight-semibold);\n  line-height: 1;\n  cursor: pointer;\n  opacity: 0.5;\n  transition:\n    opacity var(--ds-duration-slow) var(--ds-ease),\n    background-color var(--ds-duration-slow) var(--ds-ease),\n    filter var(--ds-duration-slow) var(--ds-ease);\n}\n\n.yt-transcript-button[data-state='normal'],\n.yt-transcript-button[data-state='loading'],\n.yt-transcript-button[data-state='error'] {\n  background: var(--ds-destructive);\n}\n\n.yt-transcript-button[data-state='success'] {\n  background: var(--ds-success);\n}\n\n.yt-transcript-button[data-state='loading'],\n.yt-transcript-button[data-state='error'],\n.yt-transcript-button[data-state='success'] {\n  opacity: 0.7;\n}\n\n.yt-transcript-wrap:hover .yt-transcript-button {\n  opacity: 1;\n  filter: brightness(1.08);\n}\n\n.yt-transcript-button:focus-visible {\n  outline: var(--ds-ring-width) solid var(--ds-ring);\n  outline-offset: var(--ds-ring-offset);\n}\n\n.yt-transcript-label {\n  display: block;\n  min-width: 1ch;\n  text-align: center;\n}\n";
	//#endregion
	//#region scripts/youtube-transcript-copy/src/ui/button.ts
	var DRAG_THRESHOLD_PX = 3;
	var RESET_DELAY_MS = 1500;
	var DOT_INTERVAL_MS = 300;
	var CLICK_SUPPRESS_MS = 50;
	var LABELS$1 = {
		normal: "T",
		loading: ".",
		success: "✓",
		error: "✕"
	};
	function createTranscriptButton(options) {
		options.ui.useStyles(transcript_button_default);
		const wrap = document.createElement("div");
		wrap.className = "yt-transcript-wrap";
		wrap.dataset.dragging = "false";
		const button = document.createElement("button");
		button.type = "button";
		button.className = "yt-transcript-button";
		button.dataset.state = "normal";
		button.setAttribute("aria-label", options.label);
		button.title = options.label;
		const label = document.createElement("span");
		label.className = "yt-transcript-label";
		label.textContent = LABELS$1.normal;
		button.appendChild(label);
		wrap.appendChild(button);
		options.ui.layers.base.appendChild(wrap);
		let state = "normal";
		let position = {
			right: 30,
			top: 30
		};
		let dotsTimer;
		let resetTimer;
		let suppressClick = false;
		const clearTimers = () => {
			if (dotsTimer !== void 0) window.clearInterval(dotsTimer);
			if (resetTimer !== void 0) window.clearTimeout(resetTimer);
			dotsTimer = void 0;
			resetTimer = void 0;
		};
		const applyPosition = () => {
			wrap.style.right = `${position.right}px`;
			wrap.style.top = `${position.top}px`;
		};
		const applyState = (next) => {
			state = next;
			button.dataset.state = next;
			button.disabled = next === "loading";
			clearTimers();
			if (next === "loading") {
				let count = 1;
				label.textContent = LABELS$1.loading;
				dotsTimer = window.setInterval(() => {
					count = count % 3 + 1;
					label.textContent = ".".repeat(count);
				}, DOT_INTERVAL_MS);
				return;
			}
			label.textContent = LABELS$1[next];
			if (next === "success" || next === "error") resetTimer = window.setTimeout(() => applyState("normal"), RESET_DELAY_MS);
		};
		button.addEventListener("click", (event) => {
			event.stopPropagation();
			if (suppressClick || state === "loading") return;
			options.onClick();
		});
		wrap.addEventListener("pointerdown", (event) => {
			if (event.button !== 0) return;
			const rect = wrap.getBoundingClientRect();
			const startRight = window.innerWidth - rect.right;
			const startTop = rect.top;
			const startX = event.clientX;
			const startY = event.clientY;
			let moved = false;
			const onMove = (moveEvent) => {
				const dx = moveEvent.clientX - startX;
				const dy = moveEvent.clientY - startY;
				if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) moved = true;
				position = clampPosition({
					right: startRight - dx,
					top: startTop + dy
				}, {
					width: window.innerWidth,
					height: window.innerHeight
				});
				applyPosition();
			};
			const onUp = () => {
				document.removeEventListener("pointermove", onMove);
				document.removeEventListener("pointerup", onUp);
				wrap.dataset.dragging = "false";
				options.onMoveEnd(position);
				if (moved) {
					suppressClick = true;
					window.setTimeout(() => {
						suppressClick = false;
					}, CLICK_SUPPRESS_MS);
				}
			};
			wrap.dataset.dragging = "true";
			document.addEventListener("pointermove", onMove);
			document.addEventListener("pointerup", onUp);
		});
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
			destroy() {
				clearTimers();
				wrap.remove();
			}
		};
	}
	//#endregion
	//#region scripts/youtube-transcript-copy/src/ui/app.ts
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
	function createTranscriptButtonApp(options) {
		let ui = null;
		let button = null;
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
		const activate = async (target) => {
			if (busy) return;
			busy = true;
			target.setState("loading");
			try {
				const outcome = await options.activate();
				target.setState(outcome === "success" ? "success" : "error");
			} catch {
				target.setState("error");
			} finally {
				busy = false;
			}
		};
		function sync() {
			const current = mount();
			if (!current) return;
			current.setVisible(visible);
			current.setPosition(autoPosition ? options.getDefaultPosition() ?? current.getPosition() : current.getPosition());
		}
		function mount() {
			if (button) return button;
			const position = options.getSavedPosition() ?? options.getDefaultPosition();
			if (!position) return null;
			const mounted = mountUI({
				theme: "system",
				labels: LABELS
			});
			const created = createTranscriptButton({
				ui: mounted,
				label: "复制当前转写文稿",
				onClick: () => void activate(created),
				onMoveEnd: (next) => {
					autoPosition = false;
					options.savePosition(next);
				}
			});
			created.setPosition(position);
			created.setVisible(visible);
			ui = mounted;
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
				button?.setVisible(next);
			},
			resetPosition() {
				autoPosition = false;
				button?.setPosition({
					right: 30,
					top: 30
				});
			},
			isMounted: () => button !== null,
			destroy() {
				if (settleTimer !== void 0) {
					window.clearTimeout(settleTimer);
					settleTimer = void 0;
				}
				ui?.destroy();
				ui = null;
				button = null;
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
	var MENU_COPY = "复制当前转写文稿";
	var MENU_RESET_POSITION = "重置按钮位置";
	var MENU_CLEAR_STRATEGY = "清空策略记忆";
	function start() {
		if (window.top !== window.self) return;
		const gm = createGmApi();
		const store = createStore(gm);
		const clipboard = createClipboard();
		const network = installNetworkCapture(window);
		const currentVideoId = () => new URLSearchParams(location.search).get("v") ?? "";
		let initialTrack = null;
		const captureInitialTrack = () => {
			const track = readInitialTrack(window.ytInitialPlayerResponse);
			if (track) initialTrack = {
				videoId: currentVideoId(),
				track
			};
		};
		const service = createTranscriptService({
			videoId: currentVideoId,
			fromInitialTrack: () => initialTrack && initialTrack.videoId === currentVideoId() ? fetchInitialTrack(initialTrack.track) : Promise.resolve(null),
			fromNetworkCache: () => network.get(),
			ensurePanelOpen: () => openTranscriptPanel(),
			fromViewModel: () => extractFromViewModel(document.body),
			fromPanelDump: () => extractFromPanelDump(document.body),
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
			activate: copyTranscript
		});
		const register = (label, run) => {
			if (!gm.registerMenuCommand(label, run)) console.warn(`[youtube-transcript-copy] 菜单命令不可用：${label}`);
		};
		register(MENU_COPY, () => {
			(async () => {
				const outcome = await copyTranscript();
				if (outcome !== "success") console.warn(`[youtube-transcript-copy] 复制未成功：${outcome}`);
			})();
		});
		register(MENU_RESET_POSITION, () => {
			store.clearPosition();
			app.resetPosition();
		});
		register(MENU_CLEAR_STRATEGY, () => store.clearStrategy());
		const boot = () => {
			app.sync();
			watchVisibility((visible) => app.setVisible(visible));
			let lastVideoId = currentVideoId();
			watchNavigation(() => {
				const videoId = currentVideoId();
				if (videoId !== lastVideoId) {
					lastVideoId = videoId;
					network.clear();
				}
				app.sync();
			});
			window.addEventListener("resize", () => app.sync());
		};
		if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => {
			captureInitialTrack();
			boot();
		}, { once: true });
		else {
			captureInitialTrack();
			boot();
		}
	}
	try {
		start();
	} catch (error) {
		console.error("[youtube-transcript-copy] 启动失败", error);
	}
	//#endregion
})();
