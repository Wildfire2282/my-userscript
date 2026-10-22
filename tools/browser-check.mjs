#!/usr/bin/env node
/**
 * 真实浏览器场景检查。
 *
 * 用系统里的 Chrome / Edge（headless）打开本地夹具页，注入 GM 打桩与构建好的产物，
 * 由脚本自己的场景模块驱动交互并断言结果。不依赖 Playwright：
 * 只用 Chrome DevTools Protocol，Node 内置 WebSocket 即可，所以离线也能跑。
 *
 * 场景模块契约（scripts/<slug>/tests/browser-scenarios.mjs）：
 *
 *   export const fixture = 'drag.html';         // scripts/<slug>/tests/fixtures/ 下的页面
 *   export const helpers = () => { ... };       // 可选：页面侧助手（挂到 window 上）
 *   export const scenarios = [
 *     {
 *       name: '选中文字拖动 → 搜索',
 *       async run(ctx) { ... return { expected, actual }; },
 *     },
 *   ];
 *
 * 每个场景都在新页面里跑：重新加载夹具、重新注入 GM 打桩与产物，所以场景之间不共享
 * 设置、拖拽状态或 DOM。场景只写自己关心的前置条件，不需要「收尾复位」，任何一个
 * 场景也能单独删除或单独调试。
 *
 * GM 打桩形状：window.__gm = { store, opened, menus, menu, menuLabel, clipboard }，其中
 * store 是 GM_getValue / GM_setValue / GM_deleteValue 的存储，opened 记录 GM_openInTab
 * 的地址与选项，menus 记录全部 GM_registerMenuCommand 回调与菜单名（menu / menuLabel
 * 指向最后一次注册），clipboard 记录 GM_setClipboard 写入的文字。
 *
 * 用法：
 *   node tools/browser-check.mjs                      # 跑所有带场景的脚本
 *   node tools/browser-check.mjs super-drag           # 只跑指定脚本（可传多个）
 *   node tools/browser-check.mjs --keep-browser       # 保留浏览器与配置目录，便于排查
 *   CHROME_PATH=... node tools/browser-check.mjs      # 指定浏览器可执行文件
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');

const args = process.argv.slice(2);
const keepBrowser = args.includes('--keep-browser');
const only = args.filter((arg) => !arg.startsWith('-'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function scenarioPath(slug) {
  return path.join(SCRIPTS_DIR, slug, 'tests', 'browser-scenarios.mjs');
}

function fixturePath(slug, fixture) {
  return path.join(SCRIPTS_DIR, slug, 'tests', 'fixtures', fixture);
}

/**
 * 找到可用的 Chrome / Edge。
 *
 * 覆盖 Windows、macOS 与 Linux（CI 的 ubuntu-latest 自带 google-chrome）；
 * 也都接受 CHROME_PATH 覆盖。
 */
function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error('找不到 Chrome 或 Edge；请用 CHROME_PATH 指定浏览器可执行文件。');
  }
  return found;
}

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

/** 场景列表来自脚本自己的 tests/browser-scenarios.mjs，工具本身不认识任何脚本。 */
async function discoverSlugs() {
  const entries = await readdir(SCRIPTS_DIR, { withFileTypes: true });
  const slugs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((slug) => existsSync(scenarioPath(slug)))
    .filter((slug) => only.length === 0 || only.includes(slug))
    .sort();
  const unknown = only.filter((slug) => !slugs.includes(slug));
  for (const slug of unknown) {
    if (!existsSync(path.join(SCRIPTS_DIR, slug))) {
      throw new Error(`没有这个脚本：${slug}`);
    }
    console.warn(`跳过 ${slug}：没有 tests/browser-scenarios.mjs`);
  }
  return slugs;
}

function clip(text) {
  const value = String(text);
  return value.length > 180 ? `${value.slice(0, 180)}…` : value;
}

/** 每页注入的 GM 打桩；场景只需要读 window.__gm。 */
const GM_STUB = `(() => {
  window.__gm = { store: {}, opened: [], menus: [], menu: null, menuLabel: '', clipboard: [] };
  window.GM_getValue = (key, fallback) =>
    Object.hasOwn(window.__gm.store, key) ? window.__gm.store[key] : fallback;
  window.GM_setValue = (key, value) => {
    window.__gm.store[key] = value;
  };
  window.GM_deleteValue = (key) => {
    delete window.__gm.store[key];
  };
  window.GM_registerMenuCommand = (label, run) => {
    window.__gm.menus.push({ label, run });
    window.__gm.menuLabel = label;
    window.__gm.menu = run;
  };
  window.GM_setClipboard = (text, type) => {
    if (window.__gm.clipboardThrows) throw new Error('clipboard denied by stub');
    window.__gm.clipboard.push({ text, type });
  };
  window.GM_openInTab = (url, options) => {
    window.__gm.opened.push({ url, options });
  };
})()`;

const slugs = await discoverSlugs().catch((error) => {
  console.error(`浏览器检查失败：${error.message}`);
  process.exit(1);
});
if (slugs.length === 0) {
  console.log('没有找到浏览器场景（scripts/<slug>/tests/browser-scenarios.mjs）。');
  process.exit(0);
}

const browserPath = findBrowser();
const workDir = path.join(ROOT, '.tmp', 'browser-check', `${process.pid}`);
const profileDir = path.join(workDir, 'profile');
await mkdir(profileDir, { recursive: true });

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
    ...(process.env.CI || process.getuid?.() === 0
      ? ['--no-sandbox', '--disable-dev-shm-usage']
      : []),
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let failed = 0;
let total = 0;
const pageErrors = [];
const consoleErrors = [];

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

  cdp.onEvent((message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      const text =
        details.exception?.description ?? details.exception?.value ?? details.text ?? '未知异常';
      pageErrors.push(text);
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(
        message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '),
      );
    }
  });

  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  async function evaluateRaw(expression) {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
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

  /** 页面里可用的入口：只暴露与脚本无关的原语，页面助手由场景模块自己注入。 */
  function createContext(slug) {
    return {
      slug,
      log(message) {
        console.log(`  ${message}`);
      },
      async evaluate(fn, ...fnArgs) {
        if (typeof fn === 'string') return evaluateRaw(fn);
        // 参数逐个展开传入：把整个数组当参数会让页面收到一个数组。
        return evaluateRaw(`(${fn.toString()})(...${JSON.stringify(fnArgs)})`);
      },
    };
  }

  async function openFreshPage(fixtureUrl, bundle, helpersCall) {
    // 每场景重新加载：新文档、新监听、空存储，场景之间互不影响。
    pageErrors.length = 0;
    consoleErrors.length = 0;
    // 导航令牌：Page.navigate 只表示“开始导航”，旧文档此刻仍是 complete。
    // 等到旧文档上的令牌消失且新文档解析完，才确定注入发生在目标页面上。
    const token = `${Date.now()}-${Math.random()}`;
    await evaluateRaw(`window.__navToken = ${JSON.stringify(token)}`).catch(() => undefined);
    await cdp.send('Page.navigate', { url: fixtureUrl });
    await waitFor(
      async () => {
        const state = await evaluateRaw(
          '({ token: window.__navToken, ready: document.readyState })',
        );
        return state != null && state.token !== token && state.ready !== 'loading';
      },
      // 夹具里的外部图片与本脚本无关：等 complete 会让每个场景都卡在网络上。
      { interval: 20, what: '夹具页解析' },
    );
    await evaluateRaw(GM_STUB);
    await evaluateRaw(bundle);
    if (helpersCall) await evaluateRaw(helpersCall);
  }

  for (const slug of slugs) {
    const scenarioModule = await import(pathToFileURL(scenarioPath(slug)).href);
    const { fixture } = scenarioModule;
    if (typeof fixture !== 'string' || fixture === '') {
      throw new Error(`${slug} 的 browser-scenarios.mjs 没有导出 fixture`);
    }
    if (!Array.isArray(scenarioModule.scenarios) || scenarioModule.scenarios.length === 0) {
      throw new Error(`${slug} 的 browser-scenarios.mjs 没有导出 scenarios`);
    }
    // helpers 在页面里执行，必须自包含：不能引用 Node 侧变量。
    const helpersCall =
      typeof scenarioModule.helpers === 'function'
        ? `(${scenarioModule.helpers.toString()})()`
        : '';

    const fixtureFile = fixturePath(slug, fixture);
    if (!existsSync(fixtureFile)) {
      throw new Error(`${slug} 的夹具页不存在：${fixture}`);
    }
    const fixtureUrl = pathToFileURL(fixtureFile).href;
    const distFile = path.join(SCRIPTS_DIR, slug, 'dist', `${slug}.user.js`);
    if (!existsSync(distFile)) {
      throw new Error(`缺少产物 ${path.relative(ROOT, distFile)}，先运行 npm run build ${slug}。`);
    }
    const bundle = await readFile(distFile, 'utf8');
    const ctx = createContext(slug);
    const startedAt = Date.now();

    console.log(`\n场景结果（${slug}）：`);
    for (const scenario of scenarioModule.scenarios) {
      total += 1;
      const caseStarted = Date.now();
      let expected = '';
      let actual = '';
      try {
        await openFreshPage(fixtureUrl, bundle, helpersCall);
        const result = await scenario.run(ctx);
        if (result == null || typeof result !== 'object' || !('expected' in result)) {
          throw new Error('场景必须返回 { expected, actual }');
        }
        expected = String(result.expected);
        actual = String(result.actual);
      } catch (error) {
        expected = '场景正常执行';
        actual = `执行失败：${error.message}`;
      }

      const passed = expected === actual && pageErrors.length === 0;
      if (!passed) failed += 1;
      const errorSuffix = pageErrors.length > 0 ? ` | 页面异常：${clip(pageErrors[0])}` : '';
      console.log(
        `${passed ? '通过' : '失败'} | ${scenario.name} | 期望：${clip(expected)} | 实际：${clip(actual)}${errorSuffix}`,
      );
      for (const message of consoleErrors) console.log(`  · 控制台错误：${clip(message)}`);
      const caseCost = Date.now() - caseStarted;
      if (caseCost > 1500) console.log(`  · 本场景耗时 ${(caseCost / 1000).toFixed(1)}s`);
    }
    console.log(
      `小计：${scenarioModule.scenarios.length} 个场景（${((Date.now() - startedAt) / 1000).toFixed(1)}s）。`,
    );
  }

  console.log(`\n合计：${total} 个场景，${failed} 个失败。`);
} catch (error) {
  console.error(`浏览器检查失败：${error.message}`);
  failed = Math.max(failed, 1);
} finally {
  if (keepBrowser) {
    console.log(
      `浏览器与配置目录保留在 ${path.relative(ROOT, workDir)}（端口见 DevToolsActivePort）。`,
    );
  } else {
    chrome.kill();
    await sleep(300);
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

process.exitCode = failed > 0 ? 1 : 0;
