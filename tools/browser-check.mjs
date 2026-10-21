#!/usr/bin/env node
/**
 * 真实浏览器场景检查。
 *
 * 用系统里的 Chrome / Edge（headless）打开本地夹具页，注入 GM 打桩与构建好的产物，
 * 由脚本自己的 scenarios 模块驱动交互并断言结果。不依赖 Playwright：
 * 只用 Chrome DevTools Protocol，Node 内置 WebSocket 即可，所以离线也能跑。
 *
 * 用法：
 *   node tools/browser-check.mjs            # 默认检查 super-drag
 *   node tools/browser-check.mjs <slug>     # 检查指定脚本
 *   CHROME_PATH=... node tools/browser-check.mjs
 *
 * 约定：scripts/<slug>/tests/browser-scenarios.mjs 导出 `run(ctx)`，返回
 * `{ scenario, expected, actual, pass }[]`；ctx 提供 evaluate / navigate / log。
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const slug = args[0] ?? 'super-drag';
const keepBrowser = process.argv.includes('--keep-browser');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

function findBrowser() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('找不到 Chrome 或 Edge；请用 CHROME_PATH 指定浏览器可执行文件。');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, { timeout = 15000, interval = 100, what = '条件' } = {}) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(interval);
  }
  throw new Error(`等待${what}超时${lastError ? `：${lastError.message}` : ''}`);
}

/** 极简 CDP 客户端：按 id 配对请求与响应，事件单独回调。 */
class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id != null) {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        if (message.error) entry.reject(new Error(message.error.message));
        else entry.resolve(message.result);
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error(`无法连接 CDP：${url}`)), {
        once: true,
      });
    });
    return new CdpClient(socket);
  }
}

const browserPath = findBrowser();
const workDir = path.join(ROOT, '.tmp', 'browser-check', `${slug}-${process.pid}`);
const profileDir = path.join(workDir, 'profile');
await mkdir(profileDir, { recursive: true });

const districtUrl = pathToFileURL(
  path.join(ROOT, 'scripts', slug, 'tests', 'fixtures', 'drag.html'),
).href;
const distPath = path.join(ROOT, 'scripts', slug, 'dist', `${slug}.user.js`);
const scenarioPath = path.join(ROOT, 'scripts', slug, 'tests', 'browser-scenarios.mjs');

if (!existsSync(distPath)) {
  console.error(`缺少产物 ${path.relative(ROOT, distPath)}，先运行 npm run build ${slug}。`);
  process.exit(1);
}

// stdio 必须 ignore：受限环境下捕获子进程输出会因命名管道被拒。
const chrome = spawn(
  browserPath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--window-size=1280,900',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let failed = 0;
try {
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  const port = await waitFor(
    async () => {
      const text = await readFile(portFile, 'utf8').catch(() => '');
      const first = text.split('\n')[0]?.trim();
      return first ? Number(first) : 0;
    },
    { what: '浏览器调试端口' },
  );

  const targets = await waitFor(
    async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await response.json();
      const page = list.find((target) => target.type === 'page');
      return page ? [page] : null;
    },
    { what: '页面调试目标' },
  );

  const cdp = await CdpClient.connect(targets[0].webSocketDebuggerUrl);
  const pageErrors = [];
  cdp.onEvent((message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      pageErrors.push(message.params.exceptionDetails.exception?.description ?? '未知异常');
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      const text = message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ');
      pageErrors.push(text);
    }
  });

  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: districtUrl });
  await waitFor(async () => (await evaluateRaw(cdp, 'document.readyState')) === 'complete', {
    what: '夹具页加载',
  });

  async function evaluateRaw(client, expression) {
    const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (exceptionDetails) {
      throw new Error(
        exceptionDetails.exception?.description ?? exceptionDetails.text ?? '页面内执行失败',
      );
    }
    return result.value;
  }

  const ctx = {
    slug,
    log(message) {
      console.log(`  ${message}`);
    },
    async evaluate(fn, ...fnArgs) {
      if (typeof fn === 'string') return evaluateRaw(cdp, fn);
      // 参数逐个展开传入：把整个数组当参数会让页面收到一个数组。
      return evaluateRaw(cdp, `(${fn.toString()})(...${JSON.stringify(fnArgs)})`);
    },
  };

  // GM 打桩：记录打开的标签页与菜单回调，设置存到页面内的对象。
  await ctx.evaluate(() => {
    window.__gm = {
      store: {},
      opened: [],
      menu: null,
      menuLabel: '',
    };
    window.GM_getValue = (key, fallback) =>
      Object.hasOwn(window.__gm.store, key) ? window.__gm.store[key] : fallback;
    window.GM_setValue = (key, value) => {
      window.__gm.store[key] = value;
    };
    window.GM_registerMenuCommand = (label, run) => {
      window.__gm.menuLabel = label;
      window.__gm.menu = run;
    };
    window.GM_openInTab = (url, options) => {
      window.__gm.opened.push({ url, options });
    };
  });

  // 面板与拖拽用的页面侧助手。
  await ctx.evaluate(() => {
    const panel = () => {
      const root = document.querySelector('userscript-ui-root')?.shadowRoot;
      return root?.querySelector('[data-ds-panel]') ?? null;
    };
    window.__page = {
      panel,
      shadow: () => document.querySelector('userscript-ui-root')?.shadowRoot ?? null,
      point: (el) => {
        const rect = el.getBoundingClientRect();
        return {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        };
      },
      select: (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        const rect = range.getBoundingClientRect();
        return {
          text: selection.toString(),
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        };
      },
      clearSelection: () => window.getSelection()?.removeAllRanges(),
      drag: (target, dropTarget, options = {}) => {
        const dataTransfer = new DataTransfer();
        const point = options.point ?? window.__page.point(target);
        const init = {
          bubbles: true,
          cancelable: true,
          // 真实拖拽事件是 composed 的；不加这一条，Shadow DOM 内的合成事件到不了 window。
          composed: true,
          dataTransfer,
          clientX: point.x,
          clientY: point.y,
          shiftKey: options.shiftKey === true,
        };
        target.dispatchEvent(new DragEvent('dragstart', init));
        const claimed = dataTransfer.getData('text/plain');
        (dropTarget ?? target).dispatchEvent(new DragEvent('drop', init));
        (dropTarget ?? target).dispatchEvent(new DragEvent('dragend', init));
        return claimed;
      },
      lastOpened: () => window.__gm.opened.at(-1) ?? null,
      openedCount: () => window.__gm.opened.length,
      /** 模拟一次真实点击：先按下再松开，最后才是 click（页面会据此判断新交互）。 */
      press: (el) => {
        const init = { bubbles: true, cancelable: true, composed: true };
        el.dispatchEvent(new MouseEvent('mousedown', init));
        el.dispatchEvent(new MouseEvent('mouseup', init));
        el.click();
      },
      clickButton: (label) => {
        const button = [...(panel()?.querySelectorAll('button') ?? [])].find(
          (node) => node.textContent.trim() === label,
        );
        if (!button) return false;
        window.__page.press(button);
        return true;
      },
      fieldError: () =>
        [...(panel()?.querySelectorAll('.ds-field-error') ?? [])]
          .map((node) => node.textContent.trim())
          .find(Boolean) ?? '',
    };
  });

  const bundle = await readFile(distPath, 'utf8');
  await ctx.evaluate(bundle);

  const { run } = await import(pathToFileURL(scenarioPath).href);
  const results = await run(ctx);

  console.log(`\n场景结果（${slug}）：`);
  for (const result of results) {
    if (!result.pass) failed += 1;
    console.log(
      `${result.pass ? '通过' : '失败'} | ${result.scenario} | 期望：${result.expected} | 实际：${result.actual}`,
    );
  }
  if (pageErrors.length > 0) {
    console.log('\n页面错误：');
    for (const error of pageErrors) console.log(`  ${error}`);
  }
  console.log(`\n合计：${results.length} 个场景，${failed} 个失败。`);
} catch (error) {
  console.error(`浏览器检查失败：${error.message}`);
  failed = Math.max(failed, 1);
} finally {
  if (!keepBrowser) {
    chrome.kill();
    await sleep(300);
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

process.exitCode = failed > 0 ? 1 : 0;
