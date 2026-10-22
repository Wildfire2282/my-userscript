// ==UserScript==
// @name         捕获链接
// @name:en      Link Capture
// @namespace    https://github.com/Wildfire2282
// @version      1.0.1
// @description  捕获页面中的全部链接，支持关键词筛选与批量复制
// @description:en Collect, filter, and copy all links on a page
// @author       Wildfire2282 (https://github.com/Wildfire2282)
// @license      MIT
// @homepageURL  https://github.com/Wildfire2282/my-userscript
// @supportURL   https://github.com/Wildfire2282/my-userscript/issues
// @source       https://github.com/Wildfire2282/my-userscript
// @match        https://*/*
// @match        http://*/*
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-end
// @noframes
// @downloadURL  https://update.greasyfork.org/scripts/582371/%E6%8D%95%E8%8E%B7%E9%93%BE%E6%8E%A5.user.js
// @updateURL    https://update.greasyfork.org/scripts/582371/%E6%8D%95%E8%8E%B7%E9%93%BE%E6%8E%A5.meta.js
// ==/UserScript==

"use strict";

const _GM_addStyle = typeof GM_addStyle !== "undefined" ? GM_addStyle : void 0;
const _GM_registerMenuCommand = typeof GM_registerMenuCommand !== "undefined" ? GM_registerMenuCommand : void 0;
const _GM_setClipboard = typeof GM_setClipboard !== "undefined" ? GM_setClipboard : void 0;
const _GM_setValue = typeof GM_setValue !== "undefined" ? GM_setValue : void 0;
const _GM_getValue = typeof GM_getValue !== "undefined" ? GM_getValue : void 0;

const Storage = {
  get(key, defaultValue) {
    const stored = _GM_getValue(key, void 0);
    if (stored === void 0) return defaultValue;
    if (typeof stored === "object" && stored !== null) {
      return { ...defaultValue, ...stored };
    }
    return stored;
  },
  set(key, value) { _GM_setValue(key, value); },
};

const DEFAULTS = {
  settings: {
    showFloatButton: true,
    copyFormat: "url", // url | markdown | html
  },
};

function getSettings() {
  return Storage.get("settings", DEFAULTS.settings);
}

function decodeText(s) {
  if (!s) return s;
  return s.replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
}

function normalizeUrl(url) {
  return decodeText(url).trim();
}

function bestTitle(node, fallback) {
  if (!node) return fallback;
  const el = node.nodeType === 1 ? node : node.parentElement;
  if (!el) return fallback;
  const candidates = [
    el.closest("[title]"),
    el.closest("tr"),
    el.closest("li"),
    el.parentElement
  ];
  for (const c of candidates) {
    if (!c) continue;
    const t = c.getAttribute("title")?.trim();
    if (t && t.length > 0 && t.length < 200) return t;
  }
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  if (text && text.length > 0 && text.length < 200) return text;
  return fallback;
}

function scanLinks() {
  const map = new Map();
  const source = location.href;
  if (!document.body) return [];
  document.querySelectorAll("a[href]").forEach((a) => {
    const rawHref = a.getAttribute("href") || "";
    if (!rawHref.trim()) return;
    let url;
    try {
      url = new URL(rawHref, location.href).toString();
    } catch {
      url = normalizeUrl(a.href || rawHref);
    }
    url = normalizeUrl(url);
    if (!url || map.has(url)) return;
    map.set(url, { id: url, url, title: bestTitle(a, url), source });
  });
  return Array.from(map.values());
}

let overlay = null;
let toastEl = null;
let allItems = [];
let filteredItems = [];
let selectedIds = new Set();
let searchInput = null;
let listEl = null;
let statsEl = null;

function createEl(tag, attrs) {
  const el = document.createElement(tag);
  if (!attrs) return el;
  const { textContent, style, children, className, ...rest } = attrs;
  if (textContent) el.textContent = textContent;
  if (style) el.style.cssText = style;
  if (className) el.className = className;
  if (children) children.forEach((c) => el.appendChild(c));
  Object.assign(el, rest);
  return el;
}

function showToast(msg) {
  if (!toastEl) {
    toastEl = createEl("div", { className: "cl-toast" });
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl?.classList.remove("show"), 2000);
}

function updateStats() {
  if (!statsEl) return;
  const sel = filteredItems.filter((i) => selectedIds.has(i.id)).length;
  statsEl.textContent = `共 ${allItems.length} / 筛选 ${filteredItems.length} / 选中 ${sel}`;
}

function renderList() {
  if (!listEl) return;
  listEl.innerHTML = "";
  if (filteredItems.length === 0) {
    listEl.appendChild(createEl("div", { className: "cl-empty", textContent: "无匹配结果" }));
    updateStats();
    return;
  }
  filteredItems.forEach((item, idx) => {
    const row = createEl("div", { className: "cl-item" });
    const cb = createEl("input", { type: "checkbox" });
    cb.checked = selectedIds.has(item.id);
    cb.addEventListener("change", () => {
      if (cb.checked) selectedIds.add(item.id);
      else selectedIds.delete(item.id);
      updateStats();
    });
    const index = createEl("span", { className: "cl-index", textContent: String(idx + 1) });
    const info = createEl("div", { className: "cl-info" });
    const title = createEl("div", { className: "cl-title", textContent: item.title });
    const url = createEl("div", { className: "cl-url", textContent: item.url });
    info.appendChild(title);
    info.appendChild(url);
    row.appendChild(cb);
    row.appendChild(index);
    row.appendChild(info);
    row.addEventListener("click", (e) => {
      if (e.target === cb) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change"));
    });
    listEl.appendChild(row);
  });
  updateStats();
}

function doFilter(keyword) {
  const kw = keyword.trim().toLowerCase();
  const onlyMagnetCb = overlay?.querySelector(".cl-toggle input");
  const onlyMagnet = !!(onlyMagnetCb && onlyMagnetCb.checked);
  filteredItems = allItems.filter((i) => {
    if (onlyMagnet && !i.url.toLowerCase().startsWith("magnet:")) return false;
    if (!kw) return true;
    return i.title.toLowerCase().includes(kw) || i.url.toLowerCase().includes(kw);
  });
  renderList();
}

function openPanel() {
  if (overlay) return;
  allItems = scanLinks();
  filteredItems = allItems.slice();
  selectedIds = new Set();

  overlay = createEl("div", { className: "cl-overlay" });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePanel();
  });

  const panel = createEl("div", { className: "cl-panel" });

  // Header
  const header = createEl("div", { className: "cl-header" });
  header.appendChild(createEl("h2", { textContent: "捕获链接", style: "margin:0;font-size:18px;font-weight:600;line-height:20px;color:#0f172a;letter-spacing:-.025em;" }));
  const closeBtn = createEl("button", { className: "cl-close", textContent: "×" });
  closeBtn.addEventListener("click", closePanel);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Toolbar
  const toolbar = createEl("div", { className: "cl-toolbar" });
  searchInput = createEl("input", { className: "cl-search" });
  searchInput.placeholder = "输入关键词筛选，例如 magnet:、.torrent、ed2k";
  searchInput.addEventListener("input", () => doFilter(searchInput.value));

  const onlyMagnetLabel = createEl("label", { className: "cl-toggle" });
  const onlyMagnetCb = createEl("input", { type: "checkbox" });
  onlyMagnetCb.addEventListener("change", () => doFilter(searchInput.value));
  onlyMagnetLabel.appendChild(onlyMagnetCb);
  onlyMagnetLabel.appendChild(document.createTextNode("仅磁链"));

  statsEl = createEl("span", { className: "cl-stats" });
  toolbar.appendChild(searchInput);
  toolbar.appendChild(onlyMagnetLabel);
  toolbar.appendChild(statsEl);
  panel.appendChild(toolbar);

  // List
  listEl = createEl("div", { className: "cl-list" });
  panel.appendChild(listEl);

  // Footer
  const footer = createEl("div", { className: "cl-footer" });
  const btnAll = createEl("button", { className: "cl-btn", textContent: "全选" });
  const btnNone = createEl("button", { className: "cl-btn", textContent: "全不选" });
  const btnInvert = createEl("button", { className: "cl-btn", textContent: "反选" });
  const btnCopy = createEl("button", { className: "cl-btn primary", textContent: "复制选中" });

  btnAll.addEventListener("click", () => {
    filteredItems.forEach((i) => selectedIds.add(i.id));
    renderList();
  });
  btnNone.addEventListener("click", () => {
    filteredItems.forEach((i) => selectedIds.delete(i.id));
    renderList();
  });
  btnInvert.addEventListener("click", () => {
    filteredItems.forEach((i) => {
      if (selectedIds.has(i.id)) selectedIds.delete(i.id);
      else selectedIds.add(i.id);
    });
    renderList();
  });
  btnCopy.addEventListener("click", () => {
    const items = filteredItems.filter((i) => selectedIds.has(i.id));
    if (items.length === 0) {
      showToast("未选中任何链接");
      return;
    }
    const format = getSettings().copyFormat;
    let text;
    if (format === "markdown") {
      text = items.map((i) => `[${i.title}](${i.url})`).join("\n");
    } else if (format === "html") {
      text = items.map((i) => `<a href="${i.url}">${i.title}</a>`).join("\n");
    } else {
      text = items.map((i) => i.url).join("\n");
    }
    _GM_setClipboard(text, "text");
    showToast(`已复制 ${items.length} 条链接`);
  });

  footer.appendChild(btnAll);
  footer.appendChild(btnNone);
  footer.appendChild(btnInvert);
  footer.appendChild(btnCopy);
  panel.appendChild(footer);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  renderList();
  searchInput.focus();
}

function closePanel() {
  if (!overlay) return;
  overlay.remove();
  overlay = null;
  listEl = null;
  searchInput = null;
  statsEl = null;
}

function injectFloatButton() {
  if (document.getElementById("cl-float-btn")) return;
  const btn = createEl("button", {
    id: "cl-float-btn",
    textContent: "🔗",
    style: [
      "position:fixed;right:24px;bottom:24px;width:48px;height:48px;",
      "border-radius:50%;border:none;background:#0f172a;color:#fff;",
      "font-size:22px;cursor:pointer;z-index:99997;",
      "box-shadow:0 4px 12px rgba(0,0,0,0.15);",
      "display:flex;align-items:center;justify-content:center;",
      "transition:background .15s;",
    ].join(""),
  });
  btn.title = "打开链接面板";
  btn.addEventListener("mouseenter", () => { btn.style.background = "#1e293b"; });
  btn.addEventListener("mouseleave", () => { btn.style.background = "#0f172a"; });
  btn.addEventListener("click", openPanel);
  document.body.appendChild(btn);
}

function removeFloatButton() {
  const btn = document.getElementById("cl-float-btn");
  if (btn) btn.remove();
}

function updateFloatButton() {
  if (getSettings().showFloatButton) injectFloatButton();
  else removeFloatButton();
}

function registerCommands() {
  _GM_registerMenuCommand("面板", openPanel);
  _GM_registerMenuCommand("设置", createSettingsPanel);
}

// --- Settings Panel ---
function createSettingsPanel() {
  const settings = getSettings();

  const overlay = createEl("div", {
    className: "cl-settings-overlay",
    style: [
      "display:flex;position:fixed;inset:0;z-index:2147483646;",
      "background:rgba(0,0,0,.5);align-items:center;justify-content:center;",
      "padding:24px;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;",
      "font-size:16px;line-height:normal;-webkit-font-smoothing:antialiased;",
    ].join(""),
  });

  const panel = createEl("div", {
    style: [
      "box-sizing:border-box;background:#fff;border-radius:12px;border:1px solid #e2e8f0;",
      "box-shadow:0 1px 3px 0 rgba(0,0,0,.1),0 1px 2px -1px rgba(0,0,0,.1);",
      "width:100%;max-width:400px;overflow:hidden;font-size:16px;",
    ].join(""),
  });

  // Header
  const header = createEl("div", {
    style: "display:flex;flex-direction:column;gap:24px;padding:24px;border-bottom:1px solid #e2e8f0;",
  });
  header.appendChild(createEl("h2", {
    textContent: "捕获链接设置",
    style: "font-size:18px;font-weight:600;line-height:20px;color:#0f172a;margin:0;letter-spacing:-.025em;",
  }));
  panel.appendChild(header);

  // Content
  const content = createEl("div", { style: "padding:24px;display:flex;flex-direction:column;gap:24px;" });

  // Section: General
  const sectionGeneral = createEl("div", { style: "display:flex;flex-direction:column;gap:12px;" });
  sectionGeneral.appendChild(createEl("div", {
    style: "display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:#0f172a;",
    children: [
      createEl("span", { textContent: "⚙️", style: "font-size:16px;" }),
      document.createTextNode("常规"),
    ],
  }));

  // Float button toggle
  const floatRow = createEl("div", { style: "display:flex;align-items:center;justify-content:space-between;" });
  floatRow.appendChild(createEl("label", { textContent: "显示浮动按钮", style: "font-size:14px;font-weight:500;color:#64748b;" }));
  const floatToggle = createEl("input", { type: "checkbox" });
  floatToggle.checked = settings.showFloatButton;
  floatToggle.addEventListener("change", () => {
    settings.showFloatButton = floatToggle.checked;
    Storage.set("settings", settings);
    updateFloatButton();
  });
  floatRow.appendChild(floatToggle);
  sectionGeneral.appendChild(floatRow);
  content.appendChild(sectionGeneral);

  // Section: Copy Format
  const sectionCopy = createEl("div", { style: "display:flex;flex-direction:column;gap:12px;" });
  sectionCopy.appendChild(createEl("div", {
    style: "display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:#0f172a;",
    children: [
      createEl("span", { textContent: "📋", style: "font-size:16px;" }),
      document.createTextNode("复制格式"),
    ],
  }));

  const selectStyle = [
    "display:block;width:100%;height:40px;padding:8px 32px 8px 12px;font-size:14px;line-height:20px;",
    "color:#0f172a;background:#fff;border:1px solid #e2e8f0;border-radius:6px;outline:none;",
    "box-sizing:border-box;appearance:none;cursor:pointer;transition:border-color .15s,box-shadow .15s;",
    "background-image:url(data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E);",
    "background-repeat:no-repeat;background-position:right 12px center;",
  ].join("");

  const formatLabel = createEl("div", { style: "display:flex;flex-direction:column;gap:6px;" });
  formatLabel.appendChild(createEl("label", { textContent: "复制格式", style: "font-size:14px;font-weight:500;color:#64748b;" }));
  const selectFormat = createEl("select", { style: selectStyle });
  const formats = [
    { value: "url", label: "纯链接" },
    { value: "markdown", label: "Markdown" },
    { value: "html", label: "HTML" },
  ];
  formats.forEach((f) => {
    const opt = document.createElement("option");
    opt.value = f.value;
    opt.textContent = f.label;
    if (f.value === settings.copyFormat) opt.selected = true;
    selectFormat.appendChild(opt);
  });
  selectFormat.addEventListener("focus", () => { selectFormat.style.borderColor = "#0f172a"; selectFormat.style.boxShadow = "0 0 0 2px #f1f5f9"; });
  selectFormat.addEventListener("blur", () => { selectFormat.style.borderColor = "#e2e8f0"; selectFormat.style.boxShadow = "none"; });
  selectFormat.addEventListener("change", () => {
    settings.copyFormat = selectFormat.value;
    Storage.set("settings", settings);
  });
  formatLabel.appendChild(selectFormat);
  sectionCopy.appendChild(formatLabel);
  content.appendChild(sectionCopy);

  panel.appendChild(content);

  // Footer
  const footer = createEl("div", {
    style: "display:flex;justify-content:flex-end;gap:8px;padding:24px;border-top:1px solid #e2e8f0;background:#f8fafc;",
  });
  const btnClose = createEl("button", {
    textContent: "关闭",
    style: [
      "padding:8px 16px;font-size:14px;font-weight:500;color:#fff;background:#0f172a;",
      "border:1px solid #0f172a;border-radius:6px;box-sizing:border-box;",
      "cursor:pointer;transition:background .15s;",
    ].join(""),
  });
  btnClose.addEventListener("mouseenter", () => { btnClose.style.background = "#1e293b"; });
  btnClose.addEventListener("mouseleave", () => { btnClose.style.background = "#0f172a"; });
  btnClose.addEventListener("click", () => overlay.remove());
  footer.appendChild(btnClose);
  panel.appendChild(footer);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

// --- Styles ---
const STYLES = `
.cl-overlay{position:fixed;top:0;right:0;bottom:0;left:0;background:rgba(0,0,0,.5);z-index:99998;display:flex;align-items:center;justify-content:center;padding:24px;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:16px;line-height:normal;-webkit-font-smoothing:antialiased}
.cl-panel{box-sizing:border-box;background:#fff;border-radius:12px;border:1px solid #e2e8f0;box-shadow:0 1px 3px 0 rgba(0,0,0,.1),0 1px 2px -1px rgba(0,0,0,.1);width:100%;max-width:640px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden}
.cl-header{display:flex;align-items:center;justify-content:space-between;padding:24px;border-bottom:1px solid #e2e8f0}
.cl-close{background:transparent;border:none;color:#64748b;font-size:24px;cursor:pointer;line-height:1;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:6px;transition:background .15s,color .15s}
.cl-close:hover{background:#f1f5f9;color:#0f172a}
.cl-toolbar{display:flex;align-items:center;gap:10px;padding:16px 24px;border-bottom:1px solid #e2e8f0}
.cl-search{flex:1;height:40px;padding:8px 12px;font-size:14px;line-height:20px;color:#0f172a;background:#fff;border:1px solid #e2e8f0;border-radius:6px;outline:none;box-sizing:border-box;transition:border-color .15s,box-shadow .15s}
.cl-search::placeholder{color:#94a3b8}
.cl-search:focus{border-color:#0f172a;box-shadow:0 0 0 2px #f1f5f9}
.cl-stats{font-size:12px;color:#64748b;white-space:nowrap}
.cl-toggle{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#64748b;cursor:pointer;user-select:none;white-space:nowrap}
.cl-toggle input[type=checkbox]{width:16px;height:16px;accent-color:#0f172a;cursor:pointer}
.cl-list{flex:1;overflow-y:auto;padding:8px 0}
.cl-item{display:flex;align-items:center;gap:12px;padding:10px 24px;cursor:pointer;transition:background .15s}
.cl-item:hover{background:#f8fafc}
.cl-item input[type=checkbox]{width:16px;height:16px;accent-color:#0f172a;cursor:pointer;flex-shrink:0}
.cl-index{width:28px;text-align:right;font-size:12px;color:#94a3b8;flex-shrink:0}
.cl-info{min-width:0;flex:1}
.cl-title{font-size:14px;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}
.cl-url{font-size:12px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.cl-empty{text-align:center;padding:32px;color:#94a3b8;font-size:14px}
.cl-footer{display:flex;align-items:center;gap:8px;padding:16px 24px;border-top:1px solid #e2e8f0;background:#f8fafc}
.cl-btn{padding:8px 16px;font-size:14px;font-weight:500;color:#0f172a;background:#fff;border:1px solid #e2e8f0;border-radius:6px;box-sizing:border-box;cursor:pointer;transition:background .15s}
.cl-btn:hover{background:#f1f5f9}
.cl-btn.primary{color:#fff;background:#0f172a;border-color:#0f172a}
.cl-btn.primary:hover{background:#1e293b}
.cl-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.2);z-index:99999;opacity:0;transition:opacity .3s;pointer-events:none}
.cl-toast.show{opacity:1}
`;

function init() {
  _GM_addStyle(STYLES);
  updateFloatButton();
  registerCommands();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
