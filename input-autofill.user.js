// ==UserScript==
// @name         输入框自动填充
// @namespace    https://github.com/Wildfire2282
// @version      1.0.0
// @description  在指定网页的输入框聚焦时，显示预置内容下拉菜单并自动填充
// @author       Wildfire2282
// @match        http://*/*
// @match        https://*/*
// @run-at       document-end
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.registerMenuCommand
// @license MIT
// @grant        GM.addStyle
// @downloadURL https://update.greasyfork.org/scripts/584534/%E8%BE%93%E5%85%A5%E6%A1%86%E8%87%AA%E5%8A%A8%E5%A1%AB%E5%85%85.user.js
// @updateURL https://update.greasyfork.org/scripts/584534/%E8%BE%93%E5%85%A5%E6%A1%86%E8%87%AA%E5%8A%A8%E5%A1%AB%E5%85%85.meta.js
// ==/UserScript==

"use strict";

(function () {
  const PRESETS_KEY = "input_autofill_presets";
  const SITERULES_KEY = "input_autofill_site_rules";
  const CSS_ID = "input-autofill-styles";
  const MODAL_ID = "input-autofill-modal";
  const DROPDOWN_ID = "input-autofill-dropdown";

  let cachedPresets = null;
  let cachedRules = null;
  let currentDropdown = null;
  let activeInput = null;
  let saveTimer = null;

  // ---------- 样式 ----------
  const STYLES = `
    #${DROPDOWN_ID}, #${MODAL_ID}, #${MODAL_ID} * {
      box-sizing: border-box !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
    }

    #${DROPDOWN_ID} {
      position: fixed !important;
      z-index: 2147483646 !important;
      min-width: 180px !important;
      max-height: 280px !important;
      overflow-y: auto !important;
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 8px !important;
      box-shadow: 0 10px 15px -3px rgba(15,23,42,0.1), 0 4px 6px -4px rgba(15,23,42,0.08) !important;
      padding: 6px !important;
      margin: 0 !important;
      list-style: none !important;
      color: #0f172a !important;
      font-size: 14px !important;
      display: none;
    }
    #${DROPDOWN_ID} .iaf-item {
      padding: 9px 12px !important;
      cursor: pointer !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      border-radius: 6px !important;
      transition: background-color 0.15s ease, color 0.15s ease !important;
    }
    #${DROPDOWN_ID} .iaf-item:hover,
    #${DROPDOWN_ID} .iaf-item.iaf-active {
      background: #eff6ff !important;
      color: #2563eb !important;
    }
    #${DROPDOWN_ID} .iaf-empty {
      padding: 9px 12px !important;
      color: #64748b !important;
    }

    #${MODAL_ID} {
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483647 !important;
      display: none;
      align-items: center !important;
      justify-content: center !important;
      background: rgba(15,23,42,0.45) !important;
      backdrop-filter: blur(2px) !important;
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    #${MODAL_ID}.iaf-show {
      display: flex !important;
      opacity: 1;
    }
    #${MODAL_ID}.iaf-show .iaf-panel {
      transform: translateY(0) scale(1);
      opacity: 1;
    }
    #${MODAL_ID} .iaf-panel {
      width: 620px !important;
      height: 520px !important;
      max-width: 94vw !important;
      max-height: 90vh !important;
      background: #ffffff !important;
      border-radius: 14px !important;
      box-shadow: 0 25px 50px -12px rgba(15,23,42,0.25) !important;
      display: flex !important;
      flex-direction: column !important;
      overflow: hidden !important;
      transform: translateY(-12px) scale(0.96);
      opacity: 0;
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
    }
    #${MODAL_ID} .iaf-header {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 18px 22px !important;
      border-bottom: 1px solid #e2e8f0 !important;
      background: #ffffff !important;
    }
    #${MODAL_ID} .iaf-title {
      font-size: 17px !important;
      font-weight: 600 !important;
      color: #0f172a !important;
      margin: 0 !important;
      letter-spacing: -0.01em !important;
    }
    #${MODAL_ID} .iaf-close {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 32px !important;
      height: 32px !important;
      background: #f1f5f9 !important;
      border: none !important;
      border-radius: 8px !important;
      font-size: 20px !important;
      line-height: 1 !important;
      color: #64748b !important;
      cursor: pointer !important;
      transition: background-color 0.15s ease, color 0.15s ease !important;
    }
    #${MODAL_ID} .iaf-close:hover {
      background: #e2e8f0 !important;
      color: #0f172a !important;
    }
    #${MODAL_ID} .iaf-tabs {
      display: flex !important;
      gap: 4px !important;
      border-bottom: 1px solid #e2e8f0 !important;
      padding: 0 22px !important;
      background: #ffffff !important;
    }
    #${MODAL_ID} .iaf-tab {
      padding: 12px 14px !important;
      cursor: pointer !important;
      color: #64748b !important;
      border: none !important;
      border-bottom: 2px solid transparent !important;
      margin-bottom: -1px !important;
      font-size: 14px !important;
      font-weight: 500 !important;
      background: transparent !important;
      transition: color 0.15s ease, border-color 0.15s ease !important;
    }
    #${MODAL_ID} .iaf-tab:hover {
      color: #334155 !important;
    }
    #${MODAL_ID} .iaf-tab.iaf-active {
      color: #2563eb !important;
      border-bottom-color: #2563eb !important;
    }
    #${MODAL_ID} .iaf-body {
      padding: 22px !important;
      overflow-y: auto !important;
      flex: 1 1 auto !important;
      min-height: 0 !important;
      background: #f8fafc !important;
    }
    #${MODAL_ID} .iaf-body::-webkit-scrollbar {
      width: 8px !important;
    }
    #${MODAL_ID} .iaf-body::-webkit-scrollbar-track {
      background: transparent !important;
    }
    #${MODAL_ID} .iaf-body::-webkit-scrollbar-thumb {
      background: #cbd5e1 !important;
      border-radius: 4px !important;
    }
    #${MODAL_ID} .iaf-tab-content:not(.iaf-hidden) {
      height: 100% !important;
    }
    #${MODAL_ID} .iaf-section-title {
      font-size: 12px !important;
      font-weight: 600 !important;
      color: #475569 !important;
      text-transform: uppercase !important;
      letter-spacing: 0.03em !important;
      margin: 0 0 10px 0 !important;
    }
    #${MODAL_ID} .iaf-row {
      display: flex !important;
      gap: 10px !important;
      align-items: center !important;
      margin-bottom: 12px !important;
    }
    #${MODAL_ID} .iaf-row-right {
      justify-content: flex-end !important;
    }
    #${MODAL_ID} .iaf-input,
    #${MODAL_ID} .iaf-select,
    #${MODAL_ID} .iaf-textarea {
      flex: 1 !important;
      padding: 8px 12px !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 8px !important;
      font-size: 14px !important;
      line-height: 1.45 !important;
      outline: none !important;
      background: #ffffff !important;
      color: #0f172a !important;
      min-width: 0 !important;
      transition: border-color 0.15s ease, box-shadow 0.15s ease !important;
    }
    #${MODAL_ID} .iaf-input::placeholder,
    #${MODAL_ID} .iaf-textarea::placeholder {
      color: #94a3b8 !important;
    }
    #${MODAL_ID} .iaf-input:focus,
    #${MODAL_ID} .iaf-select:focus,
    #${MODAL_ID} .iaf-textarea:focus {
      border-color: #2563eb !important;
      box-shadow: 0 0 0 3px rgba(37,99,235,0.12) !important;
    }
    #${MODAL_ID} .iaf-textarea {
      resize: vertical !important;
      min-height: 72px !important;
    }
    #${MODAL_ID} .iaf-select-auto {
      flex: 0 0 auto !important;
      width: auto !important;
      min-width: 200px !important;
    }
    #${MODAL_ID} .iaf-btn {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      height: 36px !important;
      padding: 0 14px !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 8px !important;
      background: #ffffff !important;
      color: #334155 !important;
      font-size: 13px !important;
      font-weight: 500 !important;
      cursor: pointer !important;
      white-space: nowrap !important;
      transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.1s ease !important;
    }
    #${MODAL_ID} .iaf-btn:active {
      transform: translateY(1px) !important;
    }
    #${MODAL_ID} .iaf-btn:hover {
      background: #f8fafc !important;
      border-color: #cbd5e1 !important;
    }
    #${MODAL_ID} .iaf-btn-primary {
      background: #2563eb !important;
      border-color: #2563eb !important;
      color: #ffffff !important;
    }
    #${MODAL_ID} .iaf-btn-primary:hover {
      background: #1d4ed8 !important;
      border-color: #1d4ed8 !important;
    }
    #${MODAL_ID} .iaf-btn-danger {
      color: #dc2626 !important;
      border-color: #fecaca !important;
      background: #fef2f2 !important;
    }
    #${MODAL_ID} .iaf-btn-danger:hover {
      background: #fee2e2 !important;
      border-color: #fca5a5 !important;
    }
    #${MODAL_ID} .iaf-btn:disabled {
      opacity: 0.55 !important;
      cursor: not-allowed !important;
    }
    #${MODAL_ID} .iaf-list {
      margin-bottom: 20px !important;
    }
    #${MODAL_ID} .iaf-list-item {
      display: flex !important;
      gap: 12px !important;
      align-items: stretch !important;
      padding: 12px !important;
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 10px !important;
      margin-bottom: 12px !important;
      box-shadow: 0 1px 2px rgba(15,23,42,0.04) !important;
      transition: box-shadow 0.15s ease, border-color 0.15s ease !important;
    }
    #${MODAL_ID} .iaf-list-item:hover {
      border-color: #cbd5e1 !important;
      box-shadow: 0 4px 6px -1px rgba(15,23,42,0.05) !important;
    }
    #${MODAL_ID} .iaf-list-item > .iaf-input,
    #${MODAL_ID} .iaf-list-item > .iaf-textarea {
      min-width: 0 !important;
    }
    #${MODAL_ID} .iaf-list-item > .iaf-input-name {
      flex: 0 0 150px !important;
    }
    #${MODAL_ID} .iaf-list-item > .iaf-input-value {
      flex: 1 1 auto !important;
      min-height: 72px !important;
    }
    #${MODAL_ID} .iaf-list-item > .iaf-input-pattern {
      flex: 1 1 auto !important;
    }
    #${MODAL_ID} .iaf-list-item > .iaf-btn {
      flex: 0 0 auto !important;
      align-self: center !important;
    }
    #${MODAL_ID} .iaf-hint {
      font-size: 12px !important;
      color: #64748b !important;
      margin: -4px 0 12px 0 !important;
      line-height: 1.5 !important;
    }
    #${MODAL_ID} .iaf-hidden {
      display: none !important;
    }
  `;

  function injectStyles() {
    if (document.getElementById(CSS_ID)) return;
    if (typeof GM_addStyle !== "undefined") {
      GM_addStyle(STYLES);
    } else if (typeof GM !== "undefined" && GM.addStyle) {
      GM.addStyle(STYLES);
    } else {
      const style = document.createElement("style");
      style.id = CSS_ID;
      style.textContent = STYLES;
      document.head.appendChild(style);
    }
  }

  // ---------- 通用工具 ----------
  function uuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function wildcardToRegExp(pattern) {
    const escaped = escapeRegExp(pattern).replace(/\\\*/g, ".*");
    return new RegExp("^" + escaped + "$");
  }

  function isUrlMatch(url, pattern) {
    try {
      return wildcardToRegExp(pattern).test(url);
    } catch (e) {
      return false;
    }
  }

  async function loadPresets() {
    if (cachedPresets) return cachedPresets;
    const data = await GM.getValue(PRESETS_KEY, "[]");
    try {
      cachedPresets = JSON.parse(data) || [];
    } catch (e) {
      cachedPresets = [];
    }
    return cachedPresets;
  }

  async function savePresets(presets) {
    cachedPresets = presets;
    await GM.setValue(PRESETS_KEY, JSON.stringify(presets));
  }

  async function loadSiteRules() {
    if (cachedRules) return cachedRules;
    const data = await GM.getValue(SITERULES_KEY, "[]");
    try {
      cachedRules = JSON.parse(data) || [];
    } catch (e) {
      cachedRules = [];
    }
    return cachedRules;
  }

  async function saveSiteRules(rules) {
    cachedRules = rules;
    await GM.setValue(SITERULES_KEY, JSON.stringify(rules));
  }

  async function isCurrentSiteEnabled() {
    const rules = await loadSiteRules();
    if (!rules.length) return false;
    const url = location.href;
    return rules.some((r) => isUrlMatch(url, r.pattern));
  }

  function debounceSave(callback, delay = 300) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(callback, delay);
  }

  // ---------- 设置面板 ----------
  function ensureModal() {
    if (document.getElementById(MODAL_ID)) {
      return document.getElementById(MODAL_ID);
    }

    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="iaf-panel">
        <div class="iaf-header">
          <h3 class="iaf-title">输入框自动填充 - 设置</h3>
          <button class="iaf-close" title="关闭">&times;</button>
        </div>
        <div class="iaf-tabs">
          <button class="iaf-tab iaf-active" data-tab="presets">预置内容</button>
          <button class="iaf-tab" data-tab="sites">生效网页</button>
        </div>
        <div class="iaf-body">
          <div class="iaf-tab-content" data-content="presets"></div>
          <div class="iaf-tab-content iaf-hidden" data-content="sites"></div>
        </div>
      </div>
    `;

    modal.querySelector(".iaf-close").addEventListener("click", closeSettings);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeSettings();
    });

    const tabs = modal.querySelectorAll(".iaf-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.remove("iaf-active"));
        tab.classList.add("iaf-active");
        const name = tab.dataset.tab;
        modal.querySelectorAll(".iaf-tab-content").forEach((c) => {
          c.classList.toggle("iaf-hidden", c.dataset.content !== name);
        });
      });
    });

    document.body.appendChild(modal);
    return modal;
  }

  async function openSettings() {
    injectStyles();
    const modal = ensureModal();
    modal.classList.add("iaf-show");
    await renderPresetsTab(modal);
    await renderSitesTab(modal);
  }

  function closeSettings() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    modal.classList.remove("iaf-show");
  }

  async function renderPresetsTab(modal) {
    const container = modal.querySelector('.iaf-tab-content[data-content="presets"]');
    const presets = await loadPresets();

    container.innerHTML = `
      <div class="iaf-section-title">预置输入内容</div>
      <div class="iaf-hint">填写「名称」后，下拉菜单将显示名称；留空则直接显示实际输入内容。</div>
      <div class="iaf-list" id="iaf-presets-list"></div>
      <div class="iaf-row iaf-row-right">
        <button class="iaf-btn iaf-btn-primary" id="iaf-add-preset">+ 添加预置内容</button>
      </div>
    `;

    const list = container.querySelector("#iaf-presets-list");

    function renderList() {
      list.innerHTML = "";
      if (!presets.length) {
        list.innerHTML = '<div class="iaf-hint">暂无预置内容，点击上方按钮添加。</div>';
        return;
      }
      presets.forEach((preset, index) => {
        const item = document.createElement("div");
        item.className = "iaf-list-item";
        item.innerHTML = `
          <input type="text" class="iaf-input iaf-input-name" placeholder="显示名称（可选）" value="${escapeHtml(preset.name)}">
          <textarea class="iaf-textarea iaf-input-value" placeholder="实际输入内容">${escapeHtml(preset.value)}</textarea>
          <button class="iaf-btn iaf-btn-danger" title="删除">删除</button>
        `;
        const nameInput = item.querySelector("input");
        const valueInput = item.querySelector("textarea");
        const delBtn = item.querySelector("button");

        const update = () => {
          presets[index].name = nameInput.value.trim();
          presets[index].value = valueInput.value;
          debounceSave(() => savePresets([...presets]));
        };

        nameInput.addEventListener("input", update);
        valueInput.addEventListener("input", update);

        delBtn.addEventListener("click", async () => {
          presets.splice(index, 1);
          await savePresets([...presets]);
          renderList();
        });

        list.appendChild(item);
      });
    }

    renderList();

    container.querySelector("#iaf-add-preset").addEventListener("click", async () => {
      presets.push({ id: uuid(), name: "", value: "" });
      await savePresets([...presets]);
      renderList();
      const inputs = list.querySelectorAll("input");
      if (inputs.length) inputs[inputs.length - 1].focus();
    });
  }

  async function renderSitesTab(modal) {
    const container = modal.querySelector('.iaf-tab-content[data-content="sites"]');
    const rules = await loadSiteRules();

    container.innerHTML = `
      <div class="iaf-section-title">生效网页规则</div>
      <div class="iaf-hint">使用 * 作为通配符，例如 <code>https://*.example.com/*</code>。当前页面：${escapeHtml(location.href)}</div>
      <div class="iaf-list" id="iaf-rules-list"></div>

      <div class="iaf-section-title">手动添加</div>
      <div class="iaf-row">
        <input type="text" class="iaf-input" id="iaf-manual-rule" placeholder="输入 URL 通配符规则">
        <button class="iaf-btn iaf-btn-primary" id="iaf-add-manual">添加</button>
      </div>
      <div class="iaf-row">
        <select class="iaf-select iaf-select-auto" id="iaf-current-mode">
          <option value="exact">精确 URL</option>
          <option value="domain">当前域名所有路径</option>
          <option value="subdomain">当前域名及子域名所有路径</option>
        </select>
        <button class="iaf-btn iaf-btn-primary" id="iaf-add-current">+ 添加当前页面</button>
      </div>
    `;

    const list = container.querySelector("#iaf-rules-list");

    function renderRules() {
      list.innerHTML = "";
      if (!rules.length) {
        list.innerHTML = '<div class="iaf-hint">暂无生效网页规则，脚本不会在任何页面启用下拉填充。</div>';
        return;
      }
      rules.forEach((rule, index) => {
        const item = document.createElement("div");
        item.className = "iaf-list-item";
        item.innerHTML = `
          <input type="text" class="iaf-input iaf-input-pattern" value="${escapeHtml(rule.pattern)}">
          <button class="iaf-btn iaf-btn-danger" title="删除">删除</button>
        `;
        const input = item.querySelector("input");
        const delBtn = item.querySelector("button");

        input.addEventListener("input", () => {
          rules[index].pattern = input.value.trim();
          debounceSave(() => saveSiteRules([...rules]));
        });

        delBtn.addEventListener("click", async () => {
          rules.splice(index, 1);
          await saveSiteRules([...rules]);
          renderRules();
        });

        list.appendChild(item);
      });
    }

    renderRules();

    const manualInput = container.querySelector("#iaf-manual-rule");
    const addManualBtn = container.querySelector("#iaf-add-manual");
    const addManualRule = async () => {
      const pattern = manualInput.value.trim();
      if (!pattern) return;
      rules.push({ id: uuid(), pattern });
      await saveSiteRules([...rules]);
      manualInput.value = "";
      renderRules();
    };
    addManualBtn.addEventListener("click", addManualRule);
    manualInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addManualRule();
      }
    });

    function buildCurrentPattern(mode) {
      try {
        const url = new URL(location.href);
        if (mode === "exact") return location.href;
        if (mode === "domain") return `${url.protocol}//${url.hostname}/*`;
        if (mode === "subdomain") {
          const parts = url.hostname.split(".");
          const root = parts.slice(-2).join(".");
          return `${url.protocol}//*.${root}/*`;
        }
      } catch (e) {
        return location.href;
      }
      return location.href;
    }

    container.querySelector("#iaf-add-current").addEventListener("click", async () => {
      const mode = container.querySelector("#iaf-current-mode").value;
      rules.push({ id: uuid(), pattern: buildCurrentPattern(mode) });
      await saveSiteRules([...rules]);
      renderRules();
    });
  }

  // ---------- 下拉填充 ----------
  function ensureDropdown() {
    if (document.getElementById(DROPDOWN_ID)) {
      return document.getElementById(DROPDOWN_ID);
    }
    const ul = document.createElement("ul");
    ul.id = DROPDOWN_ID;
    document.body.appendChild(ul);
    return ul;
  }

  function hideDropdown() {
    const dd = document.getElementById(DROPDOWN_ID);
    if (dd) {
      dd.style.display = "none";
      dd.innerHTML = "";
    }
    currentDropdown = null;
    activeInput = null;
  }

  function positionDropdown(input) {
    const dd = ensureDropdown();
    const rect = input.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    dd.style.left = `${rect.left + scrollX}px`;
    dd.style.top = `${rect.bottom + scrollY + 2}px`;
    dd.style.minWidth = `${rect.width}px`;
  }

  function isEditableElement(el) {
    if (!el || el.disabled || el.readOnly) return false;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
      const type = (el.type || "text").toLowerCase();
      const excluded = ["button", "submit", "reset", "image", "file", "hidden", "radio", "checkbox"];
      return !excluded.includes(type);
    }
    if (el.isContentEditable) return true;
    return false;
  }

  function setInputValue(el, value) {
    if (el.isContentEditable) {
      el.textContent = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    const isTextarea = el.tagName === "TEXTAREA";
    const proto = isTextarea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

    // 优先使用原生 setter，绕过部分框架对 value 属性的包装
    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }

    // 触发 input 事件，使用 InputEvent 提高与 React/Vue 等框架的兼容性
    el.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: value,
    }));

    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function showDropdown(input) {
    const presets = await loadPresets();
    if (!presets.length) return;

    activeInput = input;
    const dd = ensureDropdown();
    dd.innerHTML = "";

    presets.forEach((preset, index) => {
      const li = document.createElement("li");
      li.className = "iaf-item";
      li.textContent = preset.name ? preset.name : preset.value;
      li.title = preset.value;
      li.dataset.index = index;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setInputValue(input, preset.value);
        hideDropdown();
        input.focus();
      });
      dd.appendChild(li);
    });

    positionDropdown(input);
    dd.style.display = "block";
    currentDropdown = dd;
  }

  // ---------- 事件绑定 ----------
  function bindDropdownEvents() {
    document.addEventListener(
      "focusin",
      async (e) => {
        const target = e.target;
        if (!isEditableElement(target)) return;
        // 避免设置面板内的输入框触发自动填充下拉菜单
        if (target.closest && target.closest("#" + MODAL_ID)) return;
        if (!(await isCurrentSiteEnabled())) return;
        hideDropdown();
        showDropdown(target);
      },
      true
    );

    document.addEventListener(
      "focusout",
      () => {
        setTimeout(() => {
          if (!document.getElementById(DROPDOWN_ID)?.matches(":hover")) {
            hideDropdown();
          }
        }, 180);
      },
      true
    );

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const modal = document.getElementById(MODAL_ID);
        if (modal && modal.classList.contains("iaf-show")) {
          closeSettings();
        } else {
          hideDropdown();
        }
      }
    });

    window.addEventListener("scroll", hideDropdown, true);
    window.addEventListener("resize", hideDropdown);
  }

  // ---------- HTML 转义 ----------
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ---------- 初始化 ----------
  async function init() {
    injectStyles();

    // 仅在顶层窗口注册脚本菜单，避免 iframe 中重复出现
    if (window.top === window.self) {
      GM.registerMenuCommand("设置", openSettings);
    }

    bindDropdownEvents();
  }

  init().catch((err) => {
    console.error("[输入框自动填充] 初始化失败:", err);
  });
})();
