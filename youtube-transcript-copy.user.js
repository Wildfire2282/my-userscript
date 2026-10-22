// ==UserScript==
// @name         YouTube 转写文稿复制
// @name:en      YouTube Transcript Copy
// @namespace    https://github.com/Wildfire2282
// @version      1.1.3
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
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @run-at       document-start
// @downloadURL  https://update.greasyfork.org/scripts/579560/YouTube%20%E8%BD%AC%E5%86%99%E6%96%87%E7%A8%BF%E5%A4%8D%E5%88%B6.user.js
// @updateURL    https://update.greasyfork.org/scripts/579560/YouTube%20%E8%BD%AC%E5%86%99%E6%96%87%E7%A8%BF%E5%A4%8D%E5%88%B6.meta.js
// ==/UserScript==

/**
 * YouTube 转写文稿复制  v1.1.3
 *
 * 抗改版四层架构：
 *   L0  网络层           钩 fetch + XHR，捕获 get_panel 端点；抓 ytInitialPlayerResponse
 *   L1  行为信号驱动 DOM  按 role + 文本正则定位按钮，零硬编码 selector
 *   L2  面板+提取多策略    net > dom(view-model/dump) > api；DOM 必须先开面板
 *   L3  生命周期+策略记忆  MutationObserver + 策略索引持久化 + GM 菜单
 */

(function () {
  "use strict";

  const NS = "yttx";
  const log = (...a) => console.info("%c[" + NS + "]", "color:#c00", ...a);
  const warn = (...a) => console.warn("[" + NS + "]", ...a);

  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function isVisible(el) { if (!el) return false; const s = getComputedStyle(el); return s.display !== "none" && s.visibility !== "hidden" && el.offsetParent !== null; }
  function isElVisible(el) { if (!el) return false; return el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && isVisible(el); }
  function fireClick(el) { if (!el) return false; if (!isElVisible(el)) el.scrollIntoView({ block: "center", behavior: "instant" }); el.click(); return true; }
  function ariaOrText(el) { if (!el) return ""; return clean(el.getAttribute ? el.getAttribute("aria-label") || "" : "") || clean(el.textContent || ""); }

  // 英语 / 德语 / 西班牙语 / 葡萄牙语 / 意大利语 / 法语 / 日语 / 韩语 / 中文 的 'transcript' 字样
  const TX_TEXT_RE = /transcript/i;

  // -------- GM 持久化 --------
  const state = {
    pos: null,
    strategyLog: {},
    transcriptCache: null,
    lastVideoId: null,
    initialTrack: null,
  };
  const GM = {
    get: (k, d) => {
      try {
        if (typeof GM_getValue === "function") return GM_getValue(k, d);
        const v = localStorage.getItem(NS + "." + k);
        return v == null ? d : JSON.parse(v);
      } catch { return d; }
    },
    set: (k, v) => {
      try {
        if (typeof GM_setValue === "function") GM_setValue(k, v);
        else localStorage.setItem(NS + "." + k, JSON.stringify(v));
      } catch {}
    },
    del: (k) => {
      try {
        if (typeof GM_deleteValue === "function") GM_deleteValue(k);
        else localStorage.removeItem(NS + "." + k);
      } catch {}
    },
  };
  try { state.pos = GM.get("pos", null); } catch {}
  try { state.strategyLog = GM.get("strategy", {}) || {}; } catch {}

  function rememberStrategy(kind, idx) {
    state.strategyLog[kind] = { idx: idx, at: Date.now() };
    GM.set("strategy", state.strategyLog);
  }
  function prioritize(kind, fns) {
    const order = [...fns.keys()];
    const saved = state.strategyLog[kind] && state.strategyLog[kind].idx;
    if (Number.isInteger(saved) && saved > 0 && saved < order.length) {
      const i = order.splice(saved, 1)[0];
      order.unshift(i);
    }
    return order;
  }

  function cleanTimestampNode(n) {
    if (n) { const c = n.cloneNode(true); c.textContent = ""; const ch = n.childNodes; for (const c2 in ch) { if (ch[c2].nodeType === 3) c2.textContent = c2.textContent.replace(/^\s+/, "").replace(/\s+$/, ""); } }
    return n;
  }

  // -------- L0: 网络层钩子 --------
  if (!window.__ytTxNetHooked) {
    window.__ytTxNetHooked = true;
    // YouTube 2024-2026 实际使用 get_panel 作为 transcript 端点
    const TX_RE = /youtubei\/v1\/get_panel/i;

    function tryExtractPanel(data) {
      if (!data || typeof data !== "object") return null;
      // 在整段响应中查找 transcriptSectionRenderer
      const json = JSON.stringify(data);
      const segs = [];

      // path 1 (modern): contents.twoColumnWatchNextResults.transcript...
      const m = json.match(/"transcriptSectionRenderer"\s*:\s*"(\{[^}]+\})/g);

      // path 2 (panel API): engagementPanels[*].engagementPanelSectionListRenderer.content.transcriptRenderer.body.transcriptBodyRenderer.cueGroups
      const panels = data.engagementPanels || [];
      for (const p of panels) {
        const panel = (p && p.engagementPanelSectionListRenderer) || (p && p.engagementPanel) || p;
        if (!panel) continue;
        const identifier = panel.panelIdentifier || "";
        // transcript 面板识别: 2025+ 起 identifier 为 "engagement-panel-searchable-transcript" 或包含 "transcript"
        if (!/transcript/i.test(identifier) && !/cueGroup/i.test(JSON.stringify(panel))) continue;
        const bodyRenderer = (((((panel.content || {}).transcriptRenderer || {}).body || {}).transcriptBodyRenderer) || {});
        const cueGroups = bodyRenderer.cueGroups || [];
        for (const g of cueGroups) {
          const cues = (g.transcriptCueGroupRenderer && g.transcriptCueGroupRenderer.cues) || g.cues || [];
          for (const c of cues) {
            const cr = c.transcriptCueRenderer || {};
            const text = cr.simpleText || (cr.cue && cr.cue.simpleText) || "";
            if (text) segs.push({ start: cr.startOffsetMs || c.startOffsetMs || 0, text: clean(text) });
          }
        }
      }
      return segs.length ? segs : null;
    }

    function tryExtractInitial(data) {
      if (!data || typeof data !== "object") return null;
      // todo
      return null;
    }

    const O_FETCH = window.fetch;
    window.fetch = function () {
      const a = arguments;
      const u = typeof a[0] === "string" ? a[0] : (a[0] && a[0].url ? a[0].url : "");
      const p = O_FETCH.apply(this, a);
      if (TX_RE.test(u)) {
        p.then((res) => {
          try {
            const clone = res.clone();
            clone.json().then((d) => {
              const segs = tryExtractPanel(d);
              if (segs) { state.transcriptCache = segs; log("net:fetch get_panel OK", segs.length); }
              else log("net:fetch get_panel no-capture");
            }).catch(()=>{});
          } catch (e) {}
        }).catch(()=>{});
      }
      return p;
    };

    const XO = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function () {
      const a = arguments;
      const u = a[1] || "";
      if (TX_RE.test(u)) {
        this.addEventListener("load", () => {
          try {
            const segs = tryExtractPanel(JSON.parse(this.responseText));
            if (segs) { state.transcriptCache = segs; log("net:xhr OK", segs.length); }
          } catch(e){}
        });
      }
      return XO.apply(this, a);
    };
  }

  // 早期抓 ytInitialPlayerResponse 中的 caption track
  document.addEventListener("DOMContentLoaded", () => {
    try {
      const initial = window.ytInitialPlayerResponse;
      if (initial && !state.initialTrack) {
        const tracks = (initial.captions && initial.captions.playerCaptionsTracklistRenderer && initial.captions.playerCaptionsTracklistRenderer.captionTracks) || [];
        if (tracks[0] && tracks[0].baseUrl) state.initialTrack = tracks[0];
      }
    } catch {}
  }, { once: true });

  // -------- 提取策略 --------
  function viaNetCache() { return state.transcriptCache && state.transcriptCache.length ? state.transcriptCache : null; }

  async function viaInitialTrack() {
    if (!state.initialTrack || !state.initialTrack.baseUrl) return null;
    try {
      const url = state.initialTrack.baseUrl + (state.initialTrack.baseUrl.indexOf("?") >= 0 ? "&" : "?") + "fmt=json3";
      const d = await fetch(url, { credentials: "include" }).then((r) => r.json());
      const events = d.events || [];
      const segs = events.map((e) => ({ start: e.tStartMs, text: Array.isArray(e.segs) ? e.segs.map((s) => s.utf8 || "").join(" ").replace(/\s+/g, " ").trim() : "" })).filter((x) => x.text);
      return segs.length ? segs : null;
    } catch { return null; }
  }

  function tsToSec(t) {
    const p = (t || "").split(":").map(Number);
    if (p.length === 2) return p[0] * 60 + p[1];
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
    return 0;
  }

  function viaViewModel(panel) {
    const root = panel === document ? document.body : panel;
    if (!root) return null;
    const out = [];
    const segHosts = root.querySelectorAll('transcript-segment-view-model, ytd-transcript-segment-renderer');
    for (const s of segHosts) {
      const tsNode = s.querySelector('.ytwTranscriptSegmentViewModelTimestamp, #timestamp, .segment-timestamp, [aria-hidden="true"]');
      const tsTxt = (tsNode && tsNode.textContent || "").trim();
      const textNode = s.querySelector('span[role="text"], #segment-text, .segment-text')
        || (function () { const all = s.querySelectorAll("*"); for (const n of all) if (!n.children.length && /[A-Za-z]/.test(n.textContent || "")) return n; return null; })();
      const text = clean(textNode && textNode.textContent || "");
      if (text && text !== tsTxt) out.push({ start: tsToSec(tsTxt) * 1000, text });
    }
    if (out.length) return out;

    const tsRegex = /^\d{1,2}(:\d{2}){1,2}$/;
    const tsNodes = [...root.querySelectorAll("span, div")].filter((n) => tsRegex.test((n.textContent || "").trim()) && n.children.length === 0);
    const seen = new WeakSet();
    for (const n of tsNodes) {
      let block = n.closest('[role="button"], button, ytd-transcript-segment-renderer, transcript-segment-view-model');
      if (!block) block = n.parentElement;
      while (block && seen.has(block)) block = block.parentElement;
      if (!block || seen.has(block)) continue;
      seen.add(block);
      const tsTxt = clean(n.textContent || "");
      const blockText = clean(block.textContent || "");
      if (tsRegex.test(blockText) && blockText.length < 30) continue;
      const text = blockText.replace(/^\d{1,2}(:\d{2}){1,2}/, "").trim();
      if (text && text.length > 1 && /[A-Za-z]/.test(text)) out.push({ start: tsToSec(tsTxt) * 1000, text });
    }
    return out.length ? out : null;
  }

  function viaPanelDump(panel) {
    const root = panel === document ? document.body : panel;
    if (!root) return null;
    const tsRegex = /^\d{1,2}(:\d{2}){1,2}\s+/;
    const lines = [];
    for (const n of root.querySelectorAll("div, span, p")) {
      if (n.children.length === 0 && tsRegex.test(n.textContent || "")) {
        const m = (n.textContent || "").match(/^(\d{1,2}(?::\d{2}){1,2})\s+(.*)$/);
        if (m) lines.push({ start: tsToSec(m[1]) * 1000, text: clean(m[2]) });
      }
    }
    return lines.length ? lines : null;
  }

  async function viaPlayerApi() {
    const videoId = new URLSearchParams(location.search).get("v");
    if (!videoId) return null;
    try {
      const resp = await fetch("https://www.youtube.com/youtubei/v1/get_panel?prettyPrint=false", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          context: { client: { clientName: "WEB", clientVersion: "2.20260710.06.00" } },
          panelIdentifier: "engagement-panel-searchable-transcript",
        }),
      }).then((r) => r.json());
      const panels = resp && resp.engagementPanels || [];
      const segs = [];
      for (const p of panels) {
        const panel = (p && p.engagementPanelSectionListRenderer) || {};
        const bodyRenderer = (panel.content && panel.content.transcriptRenderer && panel.content.transcriptRenderer.body && panel.content.transcriptRenderer.body.transcriptBodyRenderer) || {};
        const cueGroups = bodyRenderer.cueGroups || [];
        for (const g of cueGroups) {
          const cues = (g.transcriptCueGroupRenderer && g.transcriptCueGroupRenderer.cues) || [];
          for (const c of cues) {
            const text = (c.transcriptCueRenderer && (c.transcriptCueRenderer.simpleText || (c.transcriptCueRenderer.cue && c.transcriptCueRenderer.cue.simpleText))) || "";
            if (text) segs.push({ start: (c.transcriptCueRenderer && c.transcriptCueRenderer.startOffsetMs) || 0, text: clean(text) });
          }
        }
      }
      return segs.length ? segs : null;
    } catch { return null; }
  }

  // -------- L1: 行为信号驱动发现 --------
  function findTranscriptTrigger() {
    const inExp = document.querySelector("ytd-text-inline-expander");
    if (inExp) {
      const withAria = [...inExp.querySelectorAll('button, [role="button"], yt-button-shape, button-view-model')]
        .filter((b) => (b.getAttribute("aria-label") || "").trim().length > 0);
      // 优先 aria 含 'Show transcript'
      let btn = withAria.find((b) => /show\s+transcript/i.test((b.getAttribute("aria-label") || "").trim()));
      if (btn) return btn;
      // 下一档: aria 含任何 transcript
      btn = withAria.find((b) => /transcript/i.test((b.getAttribute("aria-label") || "").trim()));
      if (btn) return btn;
      // 最后: 文本含 transcript
      btn = withAria.find((b) => /transcript/i.test((b.textContent || "").trim()));
      if (btn) return btn;
    }
    // 非 expander 内的按钮按 offsetParent 可见过滤
    for (const b of document.querySelectorAll('button, [role="button"], yt-button-shape, button-view-model')) {
      if (b.offsetParent && /transcript/i.test((b.getAttribute("aria-label") || "") + (b.textContent || ""))) return b;
    }
    return null;
  }

  function tryExpandDescription() {
    const exp = document.querySelector("ytd-text-inline-expander, ytd-expandable-video-description-body-renderer");
    if (!exp) return false;
    const moreBtn = (function () {
      for (const b of exp.querySelectorAll('button, [role="button"], tp-yt-paper-button, yt-button-shape')) {
        if (/(?:\.{3}\s*more|\.\.\.更多|展开更多|show more|展开)/i.test(ariaOrText(b)) || b.id === "expand") return b;
      }
      return null;
    })();
    if (!moreBtn) return false;
    fireClick(moreBtn);
    return true;
  }

  function isPanelOpen() {
    const modern = document.querySelectorAll("transcript-segment-view-model");
    for (const n of modern) if (n.getBoundingClientRect().width > 0) return true;
    const legacy = document.querySelectorAll("ytd-transcript-segment-renderer");
    for (const n of legacy) if (n.getBoundingClientRect().width > 0) return true;
    return false;
  }

  async function openPanel() {
    if (isPanelOpen()) return true;
    for (let attempt = 0; attempt < 4 && !isPanelOpen(); attempt++) {
      tryExpandDescription();
      await sleep(400);
      const btn = findTranscriptTrigger();
      if (!btn) continue;
      // 不管是否可见都直接点击
      try { btn.click(); } catch (e) {}
      try { btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); } catch (e) {}
      for (let i = 0; i < 12; i++) {
        await sleep(300);
        if (isPanelOpen()) return true;
      }
    }
    return isPanelOpen();
  }

  function videoId() { return new URLSearchParams(location.search).get("v") || ""; }

  async function fetchTranscript() {
    if (state.transcriptCache && state.transcriptCache.length && state.lastVideoId === videoId()) return state.transcriptCache;

    // 阶段 1：网络层（无需打开面板）
    const netFns = [["initial", viaInitialTrack], ["net", viaNetCache]];
    const netOrder = prioritize("net", netFns);
    for (const i of netOrder) {
      try {
        const r = await netFns[i][1]();
        if (r && r.length) {
          rememberStrategy("net", i);
          state.transcriptCache = r;
          state.lastVideoId = videoId();
          log("net OK via", netFns[i][0], r.length);
          return r;
        }
      } catch (e) { warn(netFns[i][0], e && e.message || e); }
    }

    // 阶段 2：DOM 提取（必须先开面板）
    if (!isPanelOpen()) {
      const ok = await openPanel();
      if (!ok) { warn("openPanel failed"); return []; }
    }
    const domFns = [["vmodel", () => viaViewModel(document.body)], ["dump", () => viaPanelDump(document.body)]];
    const domOrder = prioritize("dom", domFns);
    for (const i of domOrder) {
      try {
        const r = await domFns[i][1]();
        if (r && r.length) {
          rememberStrategy("dom", i);
          state.transcriptCache = r;
          state.lastVideoId = videoId();
          log("dom OK via", domFns[i][0], r.length);
          return r;
        }
      } catch (e) { warn(domFns[i][0], e && e.message || e); }
    }

    // 阶段 3：API 兜底
    try {
      const r = await viaPlayerApi();
      if (r && r.length) {
        state.transcriptCache = r;
        state.lastVideoId = videoId();
        log("api OK", r.length);
        return r;
      }
    } catch (e) { warn("api", e && e.message || e); }

    warn("extract: all strategies exhausted");
    return [];
  }

  function formatLines(segs) {
    return segs.map((s) => { const t = fmtTs(s.start); return t ? "[" + t + "] " + s.text : s.text; }).join("\n");
  }

  function fmtTs(ms) {
    if (ms == null) return "";
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return m + ":" + String(ss).padStart(2, "0");
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.cssText = "position:fixed;left:-9999px";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
      return true;
    } catch { return false; }
  }

  // -------- L2: 浮动按钮 --------
  const BTN_ID = NS + "-btn";
  const WRAP_ID = NS + "-wrap";
  const KEY_POS = "pos";
  const COLORS = { red: "#CC0000", green: "#00A000", err: "#cc5555" };
  const SIZE = 40;
  let dragging = false;
  let dotsT = null;

  function btnStyle(btn, st) {
    const base = {
      width: SIZE + "px", height: SIZE + "px", borderRadius: "50%",
      display: "flex", alignItems: "center", justifyContent: "center",
      lineHeight: "1", transition: "all 0.25s ease",
    };
    if (st === "normal") {
      Object.assign(btn.style, base, { background: COLORS.red, color: "#fff", fontSize: "18px", fontWeight: "700", opacity: "0.5" });
      btn.textContent = "T";
    } else if (st === "loading") {
      clearInterval(dotsT);
      Object.assign(btn.style, base, { background: COLORS.red, color: "#fff", fontWeight: "700", fontSize: "18px", opacity: "0.7" });
      btn.textContent = ".";
      let n = 1;
      dotsT = setInterval(() => { n = n % 3 + 1; btn.textContent = ".".repeat(n); }, 300);
    } else if (st === "success") {
      clearInterval(dotsT);
      Object.assign(btn.style, base, { background: COLORS.green, color: "#fff", fontSize: "20px", fontWeight: "700", opacity: "0.7" });
      btn.textContent = "\u2713";
    } else {
      clearInterval(dotsT);
      Object.assign(btn.style, base, { background: COLORS.err, color: "#fff", fontSize: "18px", fontWeight: "700", opacity: "0.7" });
      btn.textContent = "\u2715";
    }
  }

  function clamp(p) {
    return {
      right: Math.max(0, Math.min(p.right, window.innerWidth - SIZE)),
      top: Math.max(0, Math.min(p.top, window.innerHeight - SIZE)),
    };
  }
  function defaultPos() {
    const p = document.getElementById("movie_player") || document.getElementById("player");
    if (!p) return null;
    const r = p.getBoundingClientRect();
    if (r.width > 0) return { right: window.innerWidth - r.right + 30, top: r.top + 30 };
    return null;
  }

  function createButton() {
    if (document.getElementById(WRAP_ID)) return;
    const pos = state.pos || defaultPos();
    if (!pos) return;

    const wrap = document.createElement("div");
    wrap.id = WRAP_ID;
    Object.assign(wrap.style, {
      position: "fixed", zIndex: "999999", cursor: "grab",
      userSelect: "none", touchAction: "none",
      right: pos.right + "px", top: pos.top + "px",
    });
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.style.cssText = "padding:0;border:none;cursor:pointer;font-family:system-ui,sans-serif;overflow:hidden";
    btnStyle(btn, "normal");
    wrap.appendChild(btn);
    document.body.appendChild(wrap);

    wrap.addEventListener("mouseenter", () => { btn.style.filter = "brightness(1.2)"; btn.style.opacity = "1"; });
    wrap.addEventListener("mouseleave", () => { btn.style.filter = "brightness(1)"; btn.style.opacity = "0.5"; });

    btn.addEventListener("click", async (e) => {
      if (dragging) return;
      e.stopPropagation();
      btnStyle(btn, "loading");
      btn.disabled = true;
      const segs = await fetchTranscript();
      if (!segs.length) {
        btnStyle(btn, "error");
        setTimeout(() => { btnStyle(btn, "normal"); btn.disabled = false; }, 1500);
        warn("copy failed: no segments");
        return;
      }
      const ok = await copyText(formatLines(segs));
      btnStyle(btn, ok ? "success" : "error");
      setTimeout(() => { btnStyle(btn, "normal"); btn.disabled = false; }, 1500);
    });

    wrap.addEventListener("pointerdown", (e) => {
      dragging = false;
      const rect = wrap.getBoundingClientRect();
      const sRight = window.innerWidth - rect.right;
      const sTop = rect.top;
      const sx = e.clientX, sy = e.clientY;
      wrap.style.cursor = "grabbing";
      const onMove = (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragging = true;
        state.pos = clamp({ right: sRight - dx, top: sTop + dy });
        wrap.style.right = state.pos.right + "px";
        wrap.style.top = state.pos.top + "px";
      };
      const onUp = () => {
        wrap.style.cursor = "grab";
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        if (state.pos) GM.set(KEY_POS, state.pos);
        setTimeout(() => { dragging = false; }, 50);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });

    let rT;
    window.addEventListener("resize", () => {
      clearTimeout(rT);
      rT = setTimeout(() => {
        if (state.pos) {
          state.pos = clamp(state.pos);
          wrap.style.right = state.pos.right + "px";
          wrap.style.top = state.pos.top + "px";
        }
      }, 150);
    });

    updateVisibility();
  }

  function getVideo() { return document.querySelector("video.html5-main-video, #movie_player video"); }
  function updateVisibility() {
    const wrap = document.getElementById(WRAP_ID); if (!wrap) return;
    const v = getVideo();
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    wrap.style.display = v && !v.paused && !v.ended && v.readyState > 2 && !fs ? "block" : "none";
  }
  function setupVisibility() {
    if (window.__ytTxVis) return; window.__ytTxVis = true;
    const bind = () => {
      const v = getVideo();
      if (v && !v.__bound) {
        v.__bound = true;
        v.addEventListener("play", updateVisibility);
        v.addEventListener("pause", updateVisibility);
        v.addEventListener("ended", updateVisibility);
        v.addEventListener("loadeddata", updateVisibility);
      }
    };
    bind();
    document.addEventListener("fullscreenchange", updateVisibility);
    document.addEventListener("webkitfullscreenchange", updateVisibility);
    setInterval(() => { bind(); updateVisibility(); }, 500);
  }

  function setupSPA() {
    if (window.__ytTxSPA) return; window.__ytTxSPA = true;
    let last = location.href;
    const tryInit = () => {
      const v = videoId();
      if (!v) return;
      if (v !== state.lastVideoId) {
        state.transcriptCache = null;
        state.lastVideoId = v;
      }
      createButton();
    };
    window.addEventListener("yt-navigate-finish", tryInit);
    new MutationObserver(() => {
      if (location.href !== last) { last = location.href; tryInit(); }
    }).observe(document.body, { childList: true, subtree: true });
    setInterval(() => {
      if (location.href !== last) { last = location.href; tryInit(); }
      else if (location.href.includes("/watch") && !document.getElementById(WRAP_ID)) tryInit();
    }, 1500);
  }

  function setupProbeWatcher() {
    if (window.__ytTxProbe) return; window.__ytTxProbe = true;
    new MutationObserver(()=>{}).observe(document.body, { childList: true, subtree: true });
  }

  function setupMenu() {
    if (typeof GM_registerMenuCommand !== "function") return;
    try {
      GM_registerMenuCommand("复制当前转写文稿", async () => {
        const segs = await fetchTranscript();
        if (!segs.length) { warn("菜单: 未取到"); return; }
        copyText(formatLines(segs));
      });
      GM_registerMenuCommand("重置按钮位置", () => {
        GM.del(KEY_POS); state.pos = null;
        const wrap = document.getElementById(WRAP_ID);
        if (wrap) { wrap.style.right = "30px"; wrap.style.top = "30px"; }
      });
      GM_registerMenuCommand("清空策略记忆", () => { GM.del("strategy"); state.strategyLog = {}; });
    } catch (e) { warn("menu:", e && e.message); }
  }

  // -------- init --------
  if (window.top !== window.self) return;

  const boot = () => {
    setupVisibility();
    setupSPA();
    setupProbeWatcher();
    setupMenu();
    log("v1.1.3 booted");
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
