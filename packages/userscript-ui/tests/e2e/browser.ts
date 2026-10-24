import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';

// 这个目录已并入主仓库：路径一律从文件位置算，不依赖启动时的 cwd。
const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export { uiRoot };

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
  '/usr/bin/microsoft-edge-stable',
  '/opt/google/chrome/chrome',
  '/snap/bin/chromium',
].filter((value): value is string => Boolean(value));

export function findBrowser(): string {
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error('No Chrome or Edge executable found. Set CHROME_PATH to run browser tests.');
  }
  return found;
}

export function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    executablePath: findBrowser(),
    headless: true,
  });
}

/** Opens the showcase demo on a fresh page; each test gets its own state. */
export async function openShowcasePage(browser: Browser, fixture = 'stress.html'): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.goto(pathToFileURL(resolve(uiRoot, 'tests/e2e/fixtures', fixture)).href);
  await page.addScriptTag({ path: resolve(uiRoot, 'dist/showcase.user.js') });
  await page.waitForFunction(() =>
    Boolean((window as Window & { __dsDemoReady?: boolean }).__dsDemoReady),
  );
  return page;
}
