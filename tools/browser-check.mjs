#!/usr/bin/env node
/**
 * 真实浏览器场景检查。
 *
 * 用系统里的 Chrome / Edge（headless）打开本地夹具页，注入 GM 打桩与构建好的产物，
 * 由各 suite 的场景模块驱动交互并断言结果，无额外浏览器测试框架：
 * 只用 Chrome DevTools Protocol，Node 内置 WebSocket 即可，所以离线也能跑。
 *
 * 场景模块契约（scripts/<slug>/tests/browser-scenarios.mjs）：
 *
 *   export const fixture = 'drag.html';         // scripts/<slug>/tests/fixtures/ 下的页面，可带查询串
 *   export const setup = () => { ... };         // 可选：在产物注入前准备页面（播放器响应、fetch 桩）
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
 * ctx 提供 `evaluate` / `log` / `wait`，以及 `input`：用 CDP 派发真实（isTrusted）的
 * 鼠标与键盘事件，`drag` / `click` / `doubleClick` / `press`。脚本里要求 `event.isTrusted`
 * 的行为只能这样验证，页面内合成事件不算数。
 *
 * GM 打桩形状：window.__gm = { store, opened, menus, menu, menuLabel, clipboard }，其中
 * store 是 GM_getValue / GM_setValue / GM_deleteValue 的存储，opened 记录 GM_openInTab
 * 的地址与选项，menus 记录全部 GM_registerMenuCommand 回调与菜单名（menu / menuLabel
 * 指向最后一次注册），clipboard 记录 GM_setClipboard 写入的文字。
 *
 * 用法：
 *   bun tools/browser-check.mjs                      # 跑所有脚本场景与 UI suite
 *   bun tools/browser-check.mjs userscript-ui        # 只跑 UI 消费者场景
 *   bun tools/browser-check.mjs super-drag           # 只跑指定脚本（可传多个）
 *   bun tools/browser-check.mjs --keep-browser       # 保留浏览器与配置目录，便于排查
 *   CHROME_PATH=... bun tools/browser-check.mjs      # 指定浏览器可执行文件
 */

import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { artifactPath, newestArtifactInput } from './artifact-freshness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');
const UI_DIR = path.join(ROOT, 'packages', 'userscript-ui');

const args = process.argv.slice(2);
const keepBrowser = args.includes('--keep-browser');
const only = args.filter((arg) => !arg.startsWith('-'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 单条 CDP 请求的等待上限：导航或渲染进程卡死时按超时失败，而不是静静挂住。 */
const REQUEST_TIMEOUT_MS = 30_000;

function scenarioPath(slug) {
  return path.join(
    slug === 'userscript-ui' ? UI_DIR : path.join(SCRIPTS_DIR, slug),
    'tests',
    'browser-scenarios.mjs',
  );
}

function fixturePath(slug, fixture) {
  return path.join(
    slug === 'userscript-ui' ? UI_DIR : path.join(SCRIPTS_DIR, slug),
    'tests',
    'fixtures',
    fixture,
  );
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
      // 渲染进程崩溃 / 浏览器被杀时回包永远不来：没有超时就会一直挂到 CI 作业超时。
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 请求超时：${method}`));
      }, REQUEST_TIMEOUT_MS);
      const settle = (fn) => (value) => {
        clearTimeout(timer);
        fn(value);
      };
      this.pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 关闭 CDP 连接：不调的话这个 socket 会一直占着事件循环，进程退不出。 */
  close() {
    for (const { reject } of this.pending.values()) reject(new Error('CDP 连接已关闭'));
    this.pending.clear();
    try {
      this.socket.close();
    } catch {
      // 连接已经断了：本来就是要关，不用管。
    }
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

/** 脚本自行声明场景，UI 包作为固定 suite 使用同一驱动。 */
async function discoverSlugs() {
  const entries = await readdir(SCRIPTS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || (only.length > 0 && !only.includes(entry.name))) continue;
    const dir = path.join(SCRIPTS_DIR, entry.name);
    const migrated = ['src/main.ts', 'src/main.js', 'src/index.ts', 'src/index.js'].some((name) =>
      existsSync(path.join(dir, name)),
    );
    if (migrated && !existsSync(scenarioPath(entry.name))) {
      throw new Error(`${entry.name} 没有 tests/browser-scenarios.mjs，无法验证`);
    }
  }
  const slugs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .concat('userscript-ui')
    .filter((slug) => existsSync(scenarioPath(slug)))
    .filter((slug) => only.length === 0 || only.includes(slug))
    .sort();
  const unknown = only.filter((slug) => !slugs.includes(slug));
  for (const slug of unknown) {
    if (slug !== 'userscript-ui' && !existsSync(path.join(SCRIPTS_DIR, slug))) {
      throw new Error(`没有这个脚本：${slug}`);
    }
    // 点名要跑的脚本没有场景，说明场景文件被改名或删了：不能静默通过。
    throw new Error(`${slug} 没有 tests/browser-scenarios.mjs，无法验证`);
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
    // 提权终端下禁止 Chrome 脱离父进程降权重启，否则调试端口与清理句柄丢失。
    ...(process.platform === 'win32' ? ['--noerrdialogs', '--do-not-de-elevate'] : []),
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
let cdp = null;

try {
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  const port = await waitFor(
    async () => {
      const text = await readFile(portFile, 'utf8').catch(() => '');
      const first = text.split('\n')[0]?.trim();
      return first ? Number(first) : 0;
    },
    // CI 的冷启动偶尔超过 15 秒；放宽等待，避免把环境慢当成脚本回归。
    { timeout: 30000, what: '浏览器调试端口' },
  );

  const targets = await waitFor(
    async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await response.json();
      const page = list.find((target) => target.type === 'page');
      return page ? [page] : null;
    },
    { timeout: 30000, what: '页面调试目标' },
  );

  cdp = await CdpClient.connect(targets[0].webSocketDebuggerUrl);

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
  // 无头窗口默认可能拿不到焦点，键盘与选区相关场景需要浏览器按“窗口已激活”处理。
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined);

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

  /**
   * 真实输入。CDP 派发的事件带 `isTrusted`，与用户亲手操作等价；页面里
   * `dispatchEvent` 出来的是不可信事件，依赖 `isTrusted` 的脚本会直接忽略。
   */
  const INPUT_MODIFIERS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
  const VIRTUAL_KEY_CODES = {
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Home: 36,
    End: 35,
    PageUp: 33,
    PageDown: 34,
    Backspace: 8,
    Enter: 13,
    Tab: 9,
    Escape: 27,
  };
  const modifierValue = (names = []) =>
    names.reduce((sum, name) => sum | (INPUT_MODIFIERS[name] ?? 0), 0);

  const input = {
    async setViewport(width, height) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
    },
    async mouseMove(point, buttons = 0) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: point.x,
        y: point.y,
        button: buttons === 0 ? 'none' : 'left',
        buttons,
      });
    },
    async mouseDown(point, modifiers = [], clickCount = 1) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: point.x,
        y: point.y,
        button: 'left',
        buttons: 1,
        clickCount,
        modifiers: modifierValue(modifiers),
      });
    },
    async mouseUp(point, modifiers = [], clickCount = 1) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: point.x,
        y: point.y,
        button: 'left',
        buttons: 0,
        clickCount,
        modifiers: modifierValue(modifiers),
      });
    },
    async click(point, { clickCount = 1, modifiers = [] } = {}) {
      await input.mouseMove(point);
      await input.mouseDown(point, modifiers, clickCount);
      await input.mouseUp(point, modifiers, clickCount);
    },
    async doubleClick(point) {
      await input.click(point);
      await input.click(point, { clickCount: 2 });
    },
    /** 按下并拖动到目标点后松开；中间分步移动，浏览器才会实时更新选区。 */
    async drag(from, to, { steps = 10 } = {}) {
      await input.mouseMove(from);
      await input.mouseDown(from);
      for (let step = 1; step <= steps; step += 1) {
        await input.mouseMove(
          {
            x: from.x + ((to.x - from.x) * step) / steps,
            y: from.y + ((to.y - from.y) * step) / steps,
          },
          1,
        );
      }
      await input.mouseUp(to);
    },
    async keyDown(key, { code = key, keyCode = VIRTUAL_KEY_CODES[key] ?? 0, modifiers = [] } = {}) {
      // 单字符键要带 text 才会真正插入字符；rawKeyDown 只触发 keydown，输入框不会收到内容。
      const text = key.length === 1 ? key : undefined;
      if (text !== undefined && keyCode === 0) {
        // 场景里的字母/数字键没有预置 keyCode：按 A-Z、0-9 的物理码补上。
        const upper = key.toUpperCase();
        if (upper >= 'A' && upper <= 'Z') keyCode = upper.charCodeAt(0);
        else if (key >= '0' && key <= '9') keyCode = key.charCodeAt(0);
      }
      await cdp.send('Input.dispatchKeyEvent', {
        type: text === undefined ? 'rawKeyDown' : 'keyDown',
        key,
        code,
        text,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
        modifiers: modifierValue(modifiers),
      });
    },
    async keyUp(key, { code = key, keyCode = VIRTUAL_KEY_CODES[key] ?? 0, modifiers = [] } = {}) {
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
        modifiers: modifierValue(modifiers),
      });
    },
    async press(key, options = {}) {
      await input.keyDown(key, options);
      await input.keyUp(key, options);
    },
  };

  /** 页面里可用的入口：只暴露与脚本无关的原语，页面助手由场景模块自己注入。 */
  function createContext(slug) {
    return {
      slug,
      input,
      log(message) {
        console.log(`  ${message}`);
      },
      wait(ms) {
        return sleep(ms);
      },
      async evaluate(fn, ...fnArgs) {
        if (typeof fn === 'string') return evaluateRaw(fn);
        // 参数逐个展开传入：把整个数组当参数会让页面收到一个数组。
        return evaluateRaw(`(${fn.toString()})(...${JSON.stringify(fnArgs)})`);
      },
    };
  }

  async function openFreshPage(fixtureUrl, bundle, setupCall, helpersCall) {
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
    // 每个场景都从空存储开始：同 profile、同 target 下 localStorage 与 GM 打桩
    // 都会带到下一个场景，不清就会出现“前一个场景搭好、后一个场景白捡”的假通过。
    await evaluateRaw(`(() => {
      try {
        window.__gm.store = {};
        window.__gm.opened = [];
        window.__gm.menus = [];
        window.__gm.menu = null;
        window.__gm.menuLabel = '';
        window.__gm.clipboard = [];
        localStorage.clear();
        sessionStorage.clear();
      } catch { /* file:// 夹具禁用存储时不影响场景 */ }
    })()`);
    // setup 在产物之前执行：模拟脚本运行前就已存在的页面状态（播放器响应、网络响应）。
    if (setupCall) await evaluateRaw(setupCall);
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
    const setupCall =
      typeof scenarioModule.setup === 'function' ? `(${scenarioModule.setup.toString()})()` : '';

    function resolveFixture(fixture) {
      // fixture 可以带查询串（例如 `watch.html?v=abc`）：脚本靠地址判断视频时要用到。
      // 只按第一个 `?` 切：查询串里再出现 `?` 时（`?next=/a?b`）不能被截断。
      const queryStart = fixture.indexOf('?');
      const fixtureName = queryStart === -1 ? fixture : fixture.slice(0, queryStart);
      const query = queryStart === -1 ? '' : fixture.slice(queryStart + 1);
      const fixtureFile = fixturePath(slug, fixtureName);
      if (!existsSync(fixtureFile)) {
        throw new Error(`${slug} 的夹具页不存在：${fixture}`);
      }
      return `${pathToFileURL(fixtureFile).href}${query === '' ? '' : `?${query}`}`;
    }
    let bundle;
    if (slug === 'userscript-ui') {
      const { build } = await import('vite');
      const result = await build({
        configFile: false,
        root: UI_DIR,
        logLevel: 'warn',
        build: {
          write: false,
          emptyOutDir: false,
          target: 'chrome111',
          cssTarget: 'chrome111',
          lib: {
            entry: path.join(UI_DIR, 'tests', 'browser-entry.ts'),
            formats: ['iife'],
            name: 'UserscriptUITest',
          },
        },
      });
      const outputs = Array.isArray(result) ? result : [result];
      bundle = outputs
        .flatMap((output) => output.output)
        .find((output) => output.type === 'chunk')?.code;
      if (!bundle) throw new Error('userscript-ui 内存构建未生成 JavaScript');
    } else {
      const distFile = artifactPath(path.join(SCRIPTS_DIR, slug), slug);
      if (!existsSync(distFile)) {
        throw new Error(
          `缺少产物 ${path.relative(ROOT, distFile)}，先运行 bun run build ${slug}。`,
        );
      }
      // 产物比源码旧时场景测的是旧代码，结果没有意义：直接判失败，别让它看起来“通过”。
      const distTime = statSync(distFile).mtimeMs;
      const inputTime = await newestArtifactInput(path.join(SCRIPTS_DIR, slug));
      if (inputTime !== null && inputTime > distTime) {
        throw new Error(
          `${path.relative(ROOT, distFile)} 比 src 旧，先运行 bun run build ${slug}。`,
        );
      }
      bundle = await readFile(distFile, 'utf8');
    }
    const ctx = createContext(slug);
    const startedAt = Date.now();

    console.log(`\n场景结果（${slug}）：`);
    for (const scenario of scenarioModule.scenarios) {
      total += 1;
      const caseStarted = Date.now();
      let expected = '';
      let actual = '';
      try {
        if (slug === 'userscript-ui') await input.setViewport(1000, 800);
        await openFreshPage(
          resolveFixture(scenario.fixture ?? fixture),
          bundle,
          setupCall,
          helpersCall,
        );
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
    // 放开 CDP 连接与子进程句柄：任何一样留着，进程跑完也退不出去。
    try {
      cdp?.close();
    } catch {
      // 收尾阶段的异常不覆盖场景结果。
    }
    chrome.unref();
    console.log(
      `浏览器与配置目录保留在 ${path.relative(ROOT, workDir)}（端口见 DevToolsActivePort）。`,
    );
  } else {
    // 先关 CDP 连接再杀浏览器：连接不断，进程退不出。
    try {
      cdp?.close();
    } catch {
      // 收尾阶段的异常不覆盖场景结果。
    }
    chrome.kill();
    await sleep(300);
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

process.exitCode = failed > 0 ? 1 : 0;
