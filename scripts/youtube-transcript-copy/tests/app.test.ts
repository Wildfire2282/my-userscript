// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createTranscriptButtonApp, type CopyOutcome } from '../src/ui/app';

/**
 * 菜单面板与悬浮按钮共用一个“正在抓取”标记：
 * 抓取没结束时再点面板里的复制，不能谎报失败，也不能产生任何提示。
 */

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.replaceChildren();
});

function shadow(): ShadowRoot {
  const root = document.querySelector('userscript-ui-root')?.shadowRoot;
  if (!root) throw new Error('UI 没有挂上');
  return root;
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...shadow().querySelectorAll('button')].find(
    (button) => button.textContent.trim() === text,
  );
  if (!found) throw new Error(`没有按钮「${text}」`);
  return found;
}

function toasts(): number {
  return shadow().querySelectorAll('.ds-toast').length;
}

function setup() {
  let resolveCopy: ((outcome: CopyOutcome) => void) | null = null;
  let calls = 0;
  const app = createTranscriptButtonApp({
    getSavedPosition: () => null,
    savePosition: () => {},
    getDefaultPosition: () => ({ right: 30, top: 30 }),
    isVisible: () => true,
    activate: () => {
      calls += 1;
      return new Promise<CopyOutcome>((resolve) => {
        resolveCopy = resolve;
      });
    },
    clearSavedPosition: () => {},
    clearStrategy: () => {},
  });
  cleanup = () => app.destroy();
  app.sync();
  return {
    app,
    calls: () => calls,
    finish: (outcome: CopyOutcome) => resolveCopy?.(outcome),
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('转录按钮应用外壳', () => {
  it('抓取进行中再点面板里的复制 → 静默跳过，不弹失败提示', async () => {
    const { app, calls, finish } = setup();

    // 先让悬浮按钮开始抓取；面板里的复制此时应该什么都不做。
    const floating = shadow().querySelector<HTMLButtonElement>('.yt-transcript-wrap button');
    if (!floating) throw new Error('悬浮按钮没建出来');
    floating.click();
    app.openActions();
    buttonByText('复制当前转写文稿').click();
    await flush();

    expect(calls()).toBe(1);
    expect(toasts()).toBe(0);

    // 第一次结束后再点，才是真正的一次新复制，这时才该有成功提示。
    finish('success');
    await flush();
    expect(toasts()).toBe(0);

    buttonByText('复制当前转写文稿').click();
    await flush();
    expect(calls()).toBe(2);
    finish('success');
    await flush();
    expect(toasts()).toBe(1);
  });
});
