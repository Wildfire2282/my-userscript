// ==UserScript==
// @name         超级拖拽
// @namespace    https://github.com/Wildfire2282
// @version      2.2.1
// @description  拖拽文本搜索，拖拽链接在新标签页打开，拖拽图片查看。
// @author       Wildfire2282
// @license      MIT
// @run-at       document-end
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @match        https://*/*
// @match        http://*/*
// @noframes
// @downloadURL https://update.greasyfork.org/scripts/580630/%E8%B6%85%E7%BA%A7%E6%8B%96%E6%8B%BD.user.js
// @updateURL https://update.greasyfork.org/scripts/580630/%E8%B6%85%E7%BA%A7%E6%8B%96%E6%8B%BD.meta.js
// ==/UserScript==

"use strict";

/* ================= Config ================= */

const BLOB_REVOKE_DELAY_MS = 5 * 60 * 1000;
const PREVIEW_SAMPLE_KEYWORD = "hello";
// Upper bound for direct-open URL detection: longer single-token drops are
// never treated as URLs (avoids running the URL regex over megabytes).
const DIRECT_URL_MAX_LEN = 2048;

const DEFAULT_SETTINGS = {
  defaultEngine: "google",
  customEngineUrl: "",
  engines: {
    "cn.bing": "https://cn.bing.com/search?q={keyword}",
    bing: "https://www.bing.com/search?q={keyword}",
    google: "https://www.google.com/search?q={keyword}",
    baidu: "https://www.baidu.com/s?wd={keyword}",
  },
  enabled: true,
  linkOpenMode: "background", // "background" | "foreground"
};

const ENGINE_NAMES = {
  "cn.bing": "Bing (CN)",
  bing: "Bing",
  google: "Google",
  baidu: "Baidu",
};

/* ================= Settings (cached, GM I/O only on load/save) ================= */

function cloneDefaults() {
  if (typeof structuredClone === "function") return structuredClone(DEFAULT_SETTINGS);
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function loadSettings() {
  let stored = null;
  try {
    stored = GM_getValue("settings");
  } catch {
    stored = null; // storage unavailable: run on defaults
  }
  if (!stored || typeof stored !== "object") return cloneDefaults();
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    engines: { ...DEFAULT_SETTINGS.engines, ...(stored.engines || {}) },
  };
}

let settings = null; // lazy: GM read once on first gesture/panel, not page load

function getSettings() {
  if (!settings) settings = loadSettings();
  return settings;
}

function saveSettings(patch) {
  settings = { ...getSettings(), ...patch };
  try {
    GM_setValue("settings", settings);
  } catch {
    // storage write failed (quota/denied): keep the in-memory copy
  }
}

/* ================= State ================= */

const state = {
  phase: "idle", // "idle" | "dragging" (motion is owned by native DnD)
  dragType: null, // "link" | "text" | "image"
  dragData: null,
  blockNextClick: false,
};

function resetDrag() {
  state.phase = "idle";
  state.dragType = null;
  state.dragData = null;
}

/* ================= DOM helpers ================= */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function addStyle(css) {
  const style = document.createElement("style");
  style.setAttribute("data-super-drag", "1");
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
  return style;
}

let panelStyleLoaded = false;

function ensurePanelStyle() {
  if (panelStyleLoaded) return;
  panelStyleLoaded = true;
  addStyle(PANEL_STYLES);
}

/* ================= Hit testing (single elementFromPoint per event) ================= */

function deepElementFromPoint(x, y) {
  let root = document;
  let element = null;
  for (;;) {
    let next = null;
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

function parentAcrossShadow(node) {
  if (node.parentElement) return node.parentElement;
  const root = typeof node.getRootNode === "function" ? node.getRootNode() : null;
  return root instanceof ShadowRoot ? root.host : null;
}

function isIgnorableHref(href) {
  return !href || href === "#" || href.toLowerCase().startsWith("javascript:");
}

// HTMLAnchorElement.href is already an absolute URL string, but SVG <a>
// returns SVGAnimatedString instead. Resolve the raw attribute manually so
// SVG/MathML links (and xlink:href) also work.
function resolveLinkHref(node) {
  const raw =
    node.getAttribute("href") ||
    (typeof node.getAttributeNS === "function" &&
      node.getAttributeNS("http://www.w3.org/1999/xlink", "href")) ||
    "";
  if (!raw) return "";
  try {
    return new URL(raw, document.baseURI).href;
  } catch {
    return "";
  }
}

// Fast path: closest() on the press target covers the flat-DOM case without
// elementFromPoint + manual climbing. Shadow DOM falls back to hitTestSlow.
function hitTestFast(target) {
  if (!target || target.nodeType !== 1 || typeof target.closest !== "function") return null;
  const tag = (target.tagName || "").toUpperCase();
  let link = null;
  const linkEl = tag === "A" ? target : target.closest("a");
  if (linkEl && !isIgnorableHref(linkEl.getAttribute("href"))) {
    link = resolveLinkHref(linkEl);
  }
  let imgSrc = "";
  if (tag === "IMG") imgSrc = target.currentSrc || target.src || "";
  if (link || imgSrc) return { link, imgSrc };
  return null;
}

// One lookup per dragstart: walk up once, collect nearest link / image.
function hitTestSlow(x, y) {
  const found = { link: null, imgSrc: "" };
  let node = deepElementFromPoint(x, y);
  while (node) {
    const tag = node.tagName || "";
    if (!found.link && (tag === "A" || tag === "a")) {
      if (!isIgnorableHref(node.getAttribute("href"))) {
        found.link = resolveLinkHref(node);
        // A link decides the outcome (callers prefer it over images),
        // so stop climbing instead of walking to the document root.
        if (found.link) break;
      }
    } else if (!found.imgSrc && (tag === "IMG" || tag === "img")) {
      found.imgSrc = node.currentSrc || node.src || "";
    }
    node = parentAcrossShadow(node);
  }
  return found;
}

function hitTest(x, y, target) {
  return hitTestFast(target) || hitTestSlow(x, y);
}

const SELECTION_HIT_SLOP_PX = 4; // tolerate presses just outside selection rects

function isEditableField(node) {
  if (!node || node.nodeType !== 1) return false;
  const tag = (node.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (node.isContentEditable) return true;
  if (typeof node.getAttribute === "function") {
    if (node.getAttribute("contenteditable") === "true") return true;
    if (node.getAttribute("role") === "textbox") return true;
  }
  return false;
}

// Only the actual press target (and a real form control ancestor, e.g. an
// input nested in a label) can veto text drag. A contenteditable ancestor such
// as a comment rich-text container must not veto static comment text.
// Events observed at window capture are retargeted out of shadow DOM; the
// composed path reveals the real node (e.g. an <input> inside a component).
function realTarget(e) {
  try {
    if (typeof e.composedPath === "function") {
      const path = e.composedPath();
      if (path && path.length) return path[0];
    }
  } catch {
    // fall through to e.target
  }
  return e.target;
}

function isInputElement(e) {
  const raw = realTarget(e);
  const target = raw && raw.nodeType === 1 ? raw : null;
  if (target && isEditableField(target)) return true;
  let node = target ? target.parentElement : null;
  while (node) {
    const tag = (node.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (node.isContentEditable) break;
    node = node.parentElement;
  }
  return false;
}

function pointInRect(x, y, r) {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function pointNearRect(x, y, r, slop) {
  return (
    x >= r.left - slop && x <= r.right + slop && y >= r.top - slop && y <= r.bottom + slop
  );
}

function caretRangeFromPoint(x, y) {
  try {
    if (typeof document.caretRangeFromPoint === "function") {
      return document.caretRangeFromPoint(x, y);
    }
  } catch {
    // fall through to caretPositionFromPoint
  }
  try {
    if (typeof document.caretPositionFromPoint === "function") {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        const range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
        return range;
      }
    }
  } catch {
    // unsupported; caller falls back to rect checks
  }
  return null;
}

function isPointInSelection(x, y) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  let rects = [];
  try {
    rects = Array.from(range.getClientRects());
  } catch {
    rects = [];
  }
  for (const r of rects) {
    if (pointInRect(x, y, r)) return true;
    // Comment UIs often wrap text in padded containers or overlay gesture
    // layers, so the press can land a few pixels outside the glyph rects.
    if (pointNearRect(x, y, r, SELECTION_HIT_SLOP_PX)) return true;
  }
  // Strongest signal: the pressed character itself is inside the selection.
  const caret = caretRangeFromPoint(x, y);
  if (caret && typeof sel.containsNode === "function") {
    try {
      const anchor = caret.startContainer;
      if (anchor && sel.containsNode(anchor, true)) return true;
    } catch {
      // containsNode may throw on detached nodes; use rect fallback below
    }
  }
  if (rects.length > 0) return false;
  const anchor = range.commonAncestorContainer;
  const host = anchor && anchor.nodeType === 1 ? anchor : anchor && anchor.parentElement;
  if (host && typeof host.getBoundingClientRect === "function") {
    return pointInRect(x, y, host.getBoundingClientRect());
  }
  return false;
}

function getSelectionText() {
  const sel = window.getSelection();
  if (!sel) return "";
  return sel.toString().trim();
}

/* ================= Icons (used by the settings panel) ================= */

const ICONS = {
  link: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-1 1"/><path d="M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l1-1"/></svg>',
  image:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="3" width="13" height="10" rx="2"/><circle cx="5.5" cy="7" r="1.2"/><path d="M13.5 11l-3-3-5 5"/></svg>',
  search:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14.5 14.5"/></svg>',
  text: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5h10M8 4.5v8M6 12.5h4"/></svg>',
  bulb: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8a4.2 4.2 0 0 0-2.4 7.6c.6.5 1 1.2 1.1 2H9.3c.1-.8.5-1.5 1.1-2A4.2 4.2 0 0 0 8 1.8z"/><path d="M6.5 13.5h3"/></svg>',
};

function svgIcon(name, cls) {
  const wrap = document.createElement("span");
  wrap.className = cls;
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML = ICONS[name];
  return wrap;
}

/* ================= Resolver (ported from reference extension) ================= */

// Verbatim port of the reference extension service-worker's URL test: only
// absolute http(s)/ftp URLs count, so plain words never navigate by accident.
function isURL(s) {
  return /(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!-/]))?/.test(
    s
  );
}

// Dragged text that is a bare URL (no surrounding whitespace) opens directly
// instead of going through search.
function asDirectURL(text) {
  const keyword = typeof text === "string" ? text.trim() : "";
  if (!keyword || keyword.length > DIRECT_URL_MAX_LEN || /\s/.test(keyword)) return "";
  return isURL(keyword) ? keyword : "";
}

/* ================= Openers ================= */

function openUrl(url, active) {
  try {
    if (typeof GM_openInTab === "function") {
      GM_openInTab(url, { active: !!active, insert: true });
      return;
    }
  } catch {
    // fall through to window.open
  }
  const win = window.open(url, "_blank", "noopener");
  if (win && !active) {
    try {
      win.blur();
    } catch {
      // ignore
    }
    window.focus();
  }
}

function getSearchUrl(keyword) {
  const cfg = getSettings();
  const template =
    cfg.defaultEngine === "custom" ? cfg.customEngineUrl : cfg.engines[cfg.defaultEngine];
  const valid =
    typeof template === "string" && template.includes("{keyword}")
      ? template
      : DEFAULT_SETTINGS.engines.google;
  return valid.replace("{keyword}", encodeURIComponent(keyword));
}

function openImageViewer(imageUrl, active) {
  const html =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Image</title>' +
    "<style>*{margin:0;padding:0}body{display:flex;align-items:center;justify-content:center;min-height:100vh;background:#000}" +
    "img{max-width:100%;max-height:100vh;object-fit:contain}</style></head>" +
    '<body><img src="' + escapeHtml(imageUrl) + '" alt="image"></body></html>';
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  openUrl(url, active);
  // Revoke late: a background tab may not have loaded the blob within seconds.
  setTimeout(() => URL.revokeObjectURL(url), BLOB_REVOKE_DELAY_MS);
}

function openImage(imageUrl, active) {
  // Page-owned blob:/data: images break when re-wrapped in a viewer blob,
  // so open them directly; http(s) keeps the dark viewer shell.
  if (/^(blob:|data:)/i.test(imageUrl)) {
    openUrl(imageUrl, active);
    return;
  }
  openImageViewer(imageUrl, active);
}

/* ================= Sensor (native DnD, cf. reference extension) ================= */

// Delegated listeners only: dragstart/dragover/drop/dragend bubble, so one
// capture listener per event covers the whole document. The reference
// extension instead attaches to every element plus a MutationObserver, which
// is far heavier. Anything we do not claim is left to the browser untouched.

let ghostPixel = null;

// Hide the OS drag ghost: no visual feedback during the drag.
function ensureGhostPixel() {
  if (!ghostPixel) {
    ghostPixel = document.createElement("img");
    ghostPixel.src =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  }
  return ghostPixel;
}

function safeSetDragData(transfer, data) {
  try {
    // Required: without setData, Firefox never starts the drag.
    transfer.setData("text/plain", data);
    return true;
  } catch {
    // Oversized selections etc: give up and let the native drag run alone.
    return false;
  }
}

function beginNativeDrag(type, data) {
  state.phase = "dragging";
  state.dragType = type;
  state.dragData = data;
}

function handleDragStart(e) {
  if (state.phase !== "idle" || getSettings().enabled === false) return;
  // Leave multi-select / OS-level gestures alone. Shift is allowed:
  // it forces this drop into the foreground (see handleDrop).
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Editable fields keep their native move-text drag.
  if (isInputElement(e)) return;
  const transfer = e.dataTransfer;
  if (!transfer) return;

  // Cheap selection presence check first: sel.toString() copies the whole
  // selection, so only pay for it when a selection actually exists.
  const sel = window.getSelection();
  const selected = sel && !sel.isCollapsed ? getSelectionText() : "";

  let type = null;
  let data = "";
  if (selected && isPointInSelection(e.clientX, e.clientY)) {
    // Press began inside the selection (even on a link): drag the text,
    // mirroring the reference extension's selection-first rule. Skips
    // hit-testing entirely (no forced layout).
    type = "text";
    data = selected;
  } else {
    const rawTarget = realTarget(e);
    const hit = hitTest(
      e.clientX,
      e.clientY,
      rawTarget && rawTarget.nodeType === 1 ? rawTarget : null
    );
    if (hit && hit.link) {
      type = "link";
      data = hit.link;
    } else if (hit && hit.imgSrc) {
      type = "image";
      data = hit.imgSrc;
    } else if (selected) {
      // Draggable element carrying a stray selection: search it.
      type = "text";
      data = selected;
    }
  }
  if (!type || !data) return; // not ours: page widgets, bare draggables, etc.

  if (!safeSetDragData(transfer, data)) return;
  try {
    transfer.effectAllowed = "copy";
    transfer.setDragImage(ensureGhostPixel(), 0, 0);
  } catch {
    // setDragImage unsupported: the native ghost remains visible.
  }
  beginNativeDrag(type, data);
}

function handleDragOver(e) {
  if (state.phase !== "dragging") return; // not our drag: OS files etc.
  // Required: without preventDefault the browser will not fire drop.
  e.preventDefault();
  e.stopPropagation();
  try {
    e.dataTransfer.dropEffect = "copy";
  } catch {
    // Read-only dataTransfer on some engines; harmless.
  }
}

function handleDrop(e) {
  if (state.phase !== "dragging") return; // not our drag: OS files etc.
  // Drops into editable fields belong to the page (native paste-drop).
  if (isInputElement(e)) {
    resetDrag();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  state.blockNextClick = true;
  // Shift forces this drop into the foreground (mirrors the reference
  // extension, which reports `foreground: e.shiftKey` on drop).
  const foreground =
    e.shiftKey === true ||
    (state.dragType === "link" && getSettings().linkOpenMode === "foreground");
  try {
    dispatchDrop(state.dragType, state.dragData, foreground);
  } finally {
    // Never leave a half-open drag: a throwing opener must not disable
    // all future drags for the rest of the page session.
    resetDrag();
  }
}

function handleDragEnd() {
  // Fires after drop AND on cancel (Esc / dropped outside the page).
  // Drop already reset and set blockNextClick; cancel just needs cleanup.
  if (state.phase !== "idle") resetDrag();
}

// Action dispatch: the content-side equivalent of the reference extension's
// service-worker (URL-vs-search decision + open).
function dispatchDrop(type, data, foreground) {
  if (!data) return;
  if (type === "link") {
    openUrl(data, foreground);
  } else if (type === "image") {
    openImage(data, foreground);
  } else if (type === "text") {
    const direct = asDirectURL(data);
    openUrl(direct || getSearchUrl(data), foreground);
  }
}

function handleClickCapture(e) {
  if (state.blockNextClick) {
    state.blockNextClick = false;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    return;
  }
  // Safety net: never leave a stale drag behind.
  if (state.phase !== "idle") resetDrag();
}

function handleKeyDown(e) {
  if (e.key === "Escape") {
    if (state.phase !== "idle") resetDrag();
    closeSettingsPanel();
  }
}

function initDrag() {
  // One capture listener per native DnD event covers the whole document:
  // these events bubble, so no per-element attach is needed and idle pages
  // stay cheap (mousedown/click/keydown only).
  window.addEventListener("dragstart", handleDragStart, true);
  window.addEventListener("dragover", handleDragOver, true);
  window.addEventListener("drop", handleDrop, true);
  // dragend fires both after drop and on cancel (Esc / outside the window).
  window.addEventListener("dragend", handleDragEnd, true);
  document.addEventListener("click", handleClickCapture, true);
  document.addEventListener("keydown", handleKeyDown, true);
  // Safety net for lost context (e.g. window blurred mid-drag).
  window.addEventListener("blur", resetDrag);
}

/* ================= Styles (lazy: panel styles on open) ================= */

const PANEL_STYLES = `
.sd-overlay {
  --sd-bg: hsl(0, 0%, 100%);
  --sd-fg: hsl(222, 47%, 11%);
  --sd-muted: hsl(215, 16%, 47%);
  --sd-border: hsl(214, 32%, 91%);
  --sd-soft: hsl(210, 40%, 98%);
  --sd-field: hsl(0, 0%, 100%);
  --sd-ring: hsl(210, 40%, 96%);
  --sd-danger: hsl(0, 72%, 51%);
  --sd-focus: hsl(222, 47%, 11%);
  --sd-control: hsl(215, 16%, 47%);
  display: flex !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483646 !important;
  background: hsla(0, 0%, 0%, .6) !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 24px !important;
  box-sizing: border-box !important;
  overflow-y: auto !important;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
  font-size: 16px !important;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased !important;
}
@media (prefers-color-scheme: dark) {
  .sd-overlay {
    --sd-bg: hsl(222, 47%, 11%);
    --sd-fg: hsl(210, 40%, 96%);
    --sd-muted: hsl(215, 20%, 65%);
    --sd-border: hsl(217, 33%, 17%);
    --sd-soft: hsl(222, 84%, 5%);
    --sd-field: hsl(222, 84%, 5%);
    --sd-ring: hsl(217, 33%, 17%);
    --sd-danger: hsl(0, 94%, 82%);
    --sd-focus: hsl(214, 32%, 91%);
    --sd-control: hsl(209, 23%, 60%);
  }
}
.sd-panel {
  box-sizing: border-box !important;
  margin: auto !important;
  background: var(--sd-bg) !important;
  color: var(--sd-fg) !important;
  border-radius: 12px !important;
  border: 1px solid var(--sd-border) !important;
  box-shadow: 0 15px 35px hsla(0, 0%, 0%, .2) !important;
  width: 100% !important;
  max-width: 384px !important;
  max-height: calc(100vh - 48px) !important;
  display: flex !important;
  flex-direction: column !important;
  overflow: hidden !important;
}
.sd-panel * { box-sizing: border-box !important; }
.sd-head { padding: 24px 24px 0 !important; }
.sd-title { font-size: 18px !important; font-weight: 600 !important; line-height: 20px !important; color: var(--sd-fg) !important; margin: 0 0 4px !important; letter-spacing: -.025em !important; }
.sd-subtitle { font-size: 12px !important; line-height: 18px !important; color: var(--sd-muted) !important; margin: 0 !important; }
.sd-body { padding: 24px !important; display: flex !important; flex-direction: column !important; gap: 24px !important; overflow-y: auto !important; }
.sd-section { display: flex !important; flex-direction: column !important; gap: 16px !important; }
.sd-section-title { display: flex !important; align-items: center !important; gap: 8px !important; font-size: 14px !important; font-weight: 600 !important; line-height: 20px !important; color: var(--sd-fg) !important; }
.sd-title-icon { flex: none !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; width: 24px !important; height: 24px !important; border-radius: 8px !important; background: var(--sd-soft) !important; color: var(--sd-muted) !important; }
.sd-title-icon svg { display: block !important; }
.sd-field { display: flex !important; flex-direction: column !important; gap: 8px !important; }
.sd-label { font-size: 14px !important; font-weight: 500 !important; line-height: 20px !important; color: var(--sd-muted) !important; }
.sd-hint { margin: 0 !important; font-size: 12px !important; line-height: 18px !important; color: var(--sd-muted) !important; }
.sd-error { margin: 0 !important; font-size: 12px !important; line-height: 18px !important; color: var(--sd-danger) !important; }
.sd-select, .sd-input {
  display: block !important;
  width: 100% !important;
  height: 48px !important;
  padding: 8px 12px !important;
  font-size: 14px !important;
  line-height: 20px !important;
  color: var(--sd-fg) !important;
  background-color: var(--sd-field) !important;
  border: 1px solid var(--sd-control) !important;
  border-radius: 8px !important;
  outline: none !important;
  transition: border-color .15s, box-shadow .15s !important;
}
.sd-select { padding-right: 32px !important; appearance: none !important; cursor: pointer !important;
  background-image: url(data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E) !important;
  background-repeat: no-repeat !important;
  background-position: right 12px center !important;
}
.sd-select:focus, .sd-input:focus { border-color: var(--sd-focus) !important; box-shadow: 0 0 0 2px var(--sd-ring) !important; }
.sd-preview {
  border-radius: 8px !important;
  background: var(--sd-soft) !important;
  padding: 12px !important;
  display: flex !important;
  flex-direction: column !important;
  gap: 4px !important;
}
.sd-preview-label { font-size: 12px !important; font-weight: 600 !important; line-height: 18px !important; color: var(--sd-muted) !important; }
.sd-preview-url {
  font-size: 12px !important;
  line-height: 18px !important;
  color: var(--sd-muted) !important;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
  word-break: break-all !important;
  display: -webkit-box !important;
  -webkit-line-clamp: 2 !important;
  -webkit-box-orient: vertical !important;
  overflow: hidden !important;
}
.sd-switch-row { display: flex !important; align-items: center !important; gap: 12px !important; cursor: pointer !important; }
.sd-switch-input { position: absolute !important; opacity: 0 !important; width: 1px !important; height: 1px !important; margin: 0 !important; }
.sd-switch {
  flex: none !important;
  width: 48px !important;
  height: 24px !important;
  border-radius: 999px !important;
  background: var(--sd-control) !important;
  position: relative !important;
  transition: background .15s !important;
}
.sd-switch-thumb {
  position: absolute !important;
  top: 4px !important;
  left: 4px !important;
  width: 16px !important;
  height: 16px !important;
  border-radius: 50% !important;
  background: hsl(0, 0%, 100%) !important;
  box-shadow: 0 1px 3px hsla(0, 0%, 0%, .2) !important;
  transition: transform .15s !important;
}
.sd-switch-input:checked + .sd-switch { background: var(--sd-focus) !important; }
.sd-switch-input:checked + .sd-switch .sd-switch-thumb { transform: translateX(24px) !important; }
.sd-switch-input:focus-visible + .sd-switch { box-shadow: 0 0 0 2px var(--sd-bg), 0 0 0 4px var(--sd-focus) !important; }
.sd-switch-text { display: flex !important; flex-direction: column !important; gap: 4px !important; }
.sd-check-title { font-size: 14px !important; font-weight: 600 !important; line-height: 20px !important; color: var(--sd-fg) !important; }
.sd-check-desc { font-size: 12px !important; line-height: 18px !important; color: var(--sd-muted) !important; }
.sd-tips { margin: 0 !important; padding: 12px !important; list-style: none !important; display: flex !important; flex-direction: column !important; gap: 12px !important; background: var(--sd-soft) !important; border-radius: 8px !important; }
.sd-tips li { font-size: 14px !important; line-height: 20px !important; color: var(--sd-muted) !important; display: flex !important; align-items: center !important; gap: 8px !important; margin: 0 !important; padding: 0 !important; }
.sd-tip-icon { flex: none !important; display: inline-flex !important; color: var(--sd-muted) !important; }
.sd-tip-icon svg { display: block !important; }
.sd-footer { display: flex !important; justify-content: space-between !important; align-items: center !important; gap: 8px !important; padding: 16px 24px !important; background: var(--sd-soft) !important; }
.sd-footer-actions { display: flex !important; gap: 8px !important; }
.sd-btn { padding: 8px 16px !important; font-size: 14px !important; font-weight: 500 !important; line-height: 20px !important; border-radius: 8px !important; cursor: pointer !important; transition: background .15s !important; }
.sd-btn-ghost { color: var(--sd-muted) !important; background: transparent !important; border: 1px solid transparent !important; }
.sd-btn-ghost:hover { color: var(--sd-fg) !important; background: var(--sd-ring) !important; }
.sd-btn-cancel { color: var(--sd-fg) !important; background: var(--sd-field) !important; border: 1px solid var(--sd-border) !important; }
.sd-btn-cancel:hover { background: var(--sd-ring) !important; }
.sd-btn-save { color: hsl(0, 0%, 100%) !important; background: hsl(222, 47%, 11%) !important; border: 1px solid hsl(222, 47%, 11%) !important; box-shadow: 0 1px 3px hsla(0, 0%, 0%, .2) !important; }
.sd-btn-save:hover { background: hsl(217, 33%, 17%) !important; }
@media (prefers-color-scheme: dark) {
  .sd-btn-save { background: hsl(214, 32%, 91%) !important; border-color: hsl(214, 32%, 91%) !important; color: hsl(222, 47%, 11%) !important; box-shadow: 0 1px 3px hsla(0, 0%, 0%, .4) !important; }
  .sd-btn-save:hover { background: hsl(210, 40%, 96%) !important; }
  .sd-switch-input:checked + .sd-switch .sd-switch-thumb { background: hsl(222, 47%, 11%) !important; }
}
@media (max-width: 480px) {
  .sd-overlay { padding: 12px !important; }
  .sd-panel { max-height: calc(100vh - 24px) !important; }
  .sd-head { padding: 16px 16px 0 !important; }
  .sd-body { padding: 16px !important; }
  .sd-footer { padding: 12px 16px !important; }
}
`;

/* ================= Settings panel ================= */

let panelLastFocused = null;
let panelSavedOverflow = null;

function closeSettingsPanel() {
  const overlay = document.getElementById("super-drag-settings-overlay");
  if (!overlay) return;
  overlay.remove();
  if (panelSavedOverflow !== null) {
    if (panelSavedOverflow) document.documentElement.style.overflow = panelSavedOverflow;
    else document.documentElement.style.removeProperty("overflow");
    panelSavedOverflow = null;
  }
  if (panelLastFocused && typeof panelLastFocused.focus === "function") {
    try {
      panelLastFocused.focus();
    } catch {
      // original element may be gone; ignore
    }
  }
  panelLastFocused = null;
}

function isValidCustomEngine(url) {
  if (!url.includes("{keyword}")) return "自定义搜索 URL 必须包含 {keyword} 占位符";
  if (!/^https?:\/\/[^/\s]+/i.test(url)) return "自定义搜索 URL 必须以 http:// 或 https:// 开头";
  return null;
}

function appendOption(select, value, label, selected) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  if (value === selected) opt.selected = true;
  select.appendChild(opt);
}

function buildEngineOptions(select, engines, selected) {
  select.textContent = "";
  for (const key of Object.keys(engines)) {
    appendOption(select, key, ENGINE_NAMES[key] || key, selected);
  }
  appendOption(select, "custom", "自定义", selected);
}

function sectionTitle(icon, text) {
  const title = el("div", "sd-section-title");
  title.append(svgIcon(icon, "sd-title-icon"), document.createTextNode(text));
  return title;
}

function makeButton(className, text) {
  const btn = el("button", className, text);
  btn.type = "button";
  return btn;
}

function showFieldError(errorLine, message) {
  errorLine.textContent = message;
  errorLine.style.display = "";
}

function hideFieldError(errorLine) {
  errorLine.style.display = "none";
}

function buildEnabledSection(current) {
  const section = el("div", "sd-section");
  const row = el("label", "sd-switch-row");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.className = "sd-switch-input";
  box.checked = current.enabled !== false;
  const track = el("span", "sd-switch");
  track.appendChild(el("span", "sd-switch-thumb"));
  const labelWrap = el("div", "sd-switch-text");
  labelWrap.append(
    el("div", "sd-check-title", "启用超级拖拽"),
    el("div", "sd-check-desc", "关闭后拖拽文字、链接、图片均无响应")
  );
  row.append(box, track, labelWrap);
  section.appendChild(row);
  return { section, enabledBox: box };
}

function buildTextSection(current) {
  const section = el("div", "sd-section");
  section.appendChild(sectionTitle("text", "文字拖拽"));

  const engineField = el("div", "sd-field");
  engineField.appendChild(el("label", "sd-label", "搜索引擎"));
  const engineSelect = el("select", "sd-select");
  buildEngineOptions(engineSelect, current.engines, current.defaultEngine);
  engineField.appendChild(engineSelect);
  section.appendChild(engineField);

  const customRow = el("div", "sd-field");
  if (current.defaultEngine !== "custom") customRow.style.display = "none";
  customRow.appendChild(el("label", "sd-label", "自定义搜索 URL"));
  const customInput = el("input", "sd-input");
  customInput.type = "text";
  customInput.value = current.customEngineUrl || "";
  customInput.placeholder = "https://www.google.com/search?q={keyword}";
  customInput.spellcheck = false;
  customInput.setAttribute("aria-describedby", "sd-custom-error");
  customRow.appendChild(customInput);
  customRow.appendChild(el("p", "sd-hint", "使用 {keyword} 作为搜索关键词占位符"));
  const errorLine = el("p", "sd-error");
  errorLine.id = "sd-custom-error";
  errorLine.setAttribute("aria-live", "polite");
  errorLine.style.display = "none";
  customRow.appendChild(errorLine);
  section.appendChild(customRow);

  const previewBox = el("div", "sd-preview");
  previewBox.appendChild(el("div", "sd-preview-label", `效果预览（示例关键词 ${PREVIEW_SAMPLE_KEYWORD}）`));
  const previewUrl = el("div", "sd-preview-url");
  previewUrl.setAttribute("aria-live", "polite");
  previewBox.appendChild(previewUrl);
  section.appendChild(previewBox);

  return { section, engineSelect, customRow, customInput, errorLine, previewUrl };
}

function buildLinkSection(current) {
  const section = el("div", "sd-section");
  section.appendChild(sectionTitle("link", "链接拖拽"));
  const openField = el("div", "sd-field");
  openField.appendChild(el("label", "sd-label", "新窗口打开方式"));
  const openSelect = el("select", "sd-select");
  appendOption(openSelect, "background", "后台打开（停留在当前页）", current.linkOpenMode);
  appendOption(openSelect, "foreground", "前台打开（立即切换过去）", current.linkOpenMode);
  openField.appendChild(openSelect);
  section.appendChild(openField);
  return { section, openSelect };
}

const TIP_ITEMS = [
  ["search", "选中文字并拖动 —— 搜索，网址文本直接打开"],
  ["link", "按住链接拖动 —— 新标签页打开"],
  ["image", "按住图片拖动 —— 新标签页查看"],
  ["link", "拖拽时按住 Shift —— 本次前台打开"],
  ["text", "按 Esc —— 取消本次拖拽"],
];

function buildTipsSection() {
  const section = el("div", "sd-section");
  section.appendChild(sectionTitle("bulb", "使用方式"));
  const tips = el("ul", "sd-tips");
  for (const [icon, text] of TIP_ITEMS) {
    const li = document.createElement("li");
    li.append(svgIcon(icon, "sd-tip-icon"), document.createTextNode(text));
    tips.appendChild(li);
  }
  section.appendChild(tips);
  return section;
}

function buildFooter() {
  const footer = el("div", "sd-footer");
  const btnReset = makeButton("sd-btn sd-btn-ghost", "恢复默认");
  const actions = el("div", "sd-footer-actions");
  const btnCancel = makeButton("sd-btn sd-btn-cancel", "取消");
  const btnSave = makeButton("sd-btn sd-btn-save", "保存");
  actions.append(btnCancel, btnSave);
  footer.append(btnReset, actions);
  return { footer, btnReset, btnCancel, btnSave };
}

function trapTabFocus(e, panel) {
  if (e.key !== "Tab") return;
  const items = Array.from(panel.querySelectorAll("button, select, input")).filter(
    (n) => !n.disabled && n.offsetParent !== null
  );
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function createSettingsPanel() {
  ensurePanelStyle();
  closeSettingsPanel();
  const current = loadSettings();
  panelLastFocused = document.activeElement;
  panelSavedOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";

  const overlay = el("div", "sd-overlay");
  overlay.id = "super-drag-settings-overlay";

  const panel = el("div", "sd-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "超级拖拽设置");

  const head = el("div", "sd-head");
  head.appendChild(el("h2", "sd-title", "超级拖拽设置"));
  head.appendChild(el("p", "sd-subtitle", "拖拽文字搜索，拖拽链接、图片在新标签页打开"));
  panel.appendChild(head);

  const body = el("div", "sd-body");
  const { section: general, enabledBox } = buildEnabledSection(current);
  body.appendChild(general);

  const { section: textSection, engineSelect, customRow, customInput, errorLine, previewUrl } =
    buildTextSection(current);
  body.appendChild(textSection);

  const { section: linkSection, openSelect } = buildLinkSection(current);
  body.appendChild(linkSection);
  body.appendChild(buildTipsSection());
  panel.appendChild(body);

  const { footer, btnReset, btnCancel, btnSave } = buildFooter();
  panel.appendChild(footer);

  overlay.appendChild(panel);
  (document.body || document.documentElement).appendChild(overlay);

  // Live preview + validation
  function setPreviewText(message, resolved) {
    previewUrl.textContent = message;
    if (resolved) previewUrl.title = resolved;
    else previewUrl.removeAttribute("title");
  }

  function refreshPreview() {
    const isCustom = engineSelect.value === "custom";
    customRow.style.display = isCustom ? "" : "none";
    const template = isCustom ? customInput.value.trim() : current.engines[engineSelect.value];
    if (!template) {
      setPreviewText(isCustom ? "请填写自定义搜索 URL" : "—");
      return;
    }
    if (!template.includes("{keyword}")) {
      setPreviewText("URL 中缺少 {keyword} 占位符，保存时将回退默认搜索引擎");
      return;
    }
    const resolved = template.replace("{keyword}", encodeURIComponent(PREVIEW_SAMPLE_KEYWORD));
    setPreviewText(resolved, resolved);
  }

  function validateLive() {
    const value = customInput.value.trim();
    if (engineSelect.value !== "custom" || !value) {
      hideFieldError(errorLine);
      return;
    }
    const problem = isValidCustomEngine(value);
    if (problem) showFieldError(errorLine, problem);
    else hideFieldError(errorLine);
  }

  engineSelect.addEventListener("change", () => {
    hideFieldError(errorLine);
    refreshPreview();
  });
  customInput.addEventListener("input", () => {
    validateLive();
    refreshPreview();
  });

  btnReset.addEventListener("click", () => {
    const def = cloneDefaults();
    enabledBox.checked = def.enabled;
    buildEngineOptions(engineSelect, { ...current.engines, ...def.engines }, def.defaultEngine);
    customInput.value = "";
    openSelect.value = def.linkOpenMode;
    hideFieldError(errorLine);
    refreshPreview();
  });

  btnCancel.addEventListener("click", closeSettingsPanel);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeSettingsPanel();
  });
  // Keep Tab focus inside the dialog while it is open.
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeSettingsPanel();
      return;
    }
    trapTabFocus(e, panel);
  });

  btnSave.addEventListener("click", () => {
    const customUrl = customInput.value.trim();
    if (engineSelect.value === "custom" && customUrl) {
      const problem = isValidCustomEngine(customUrl);
      if (problem) {
        showFieldError(errorLine, problem);
        customInput.focus();
        return;
      }
    }
    saveSettings({
      ...current,
      enabled: enabledBox.checked,
      defaultEngine: engineSelect.value,
      customEngineUrl: customUrl,
      linkOpenMode: openSelect.value,
    });
    closeSettingsPanel();
  });

  refreshPreview();
  try {
    enabledBox.focus();
  } catch {
    // focus optional; panel is fully usable without it
  }
}

/* ================= Main ================= */

function init() {
  initDrag();
  try {
    if (typeof GM_registerMenuCommand === "function") {
      GM_registerMenuCommand("超级拖拽：设置", createSettingsPanel);
    }
  } catch {
    // menu command unavailable; panel stays unreachable but drag still works
  }
}

try {
  init();
} catch (err) {
  console.error("[Super Drag] Fatal error", err);
}
