// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountUI, type UI } from '@ui';
import { createLinkPanel } from '../src/ui/link-panel';

/**
 * 链接面板的分页行为："显示更多"只在这一行按钮上生效，
 * 列表重画后旧按钮必须彻底失效（否则监听会随着每次输入不断累积）。
 */

const LINK_COUNT = 250;

function addLinks(count: number): void {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < count; index += 1) {
    const anchor = document.createElement('a');
    anchor.href = `https://example.com/page/${index}`;
    anchor.textContent = `link ${index}`;
    fragment.appendChild(anchor);
  }
  document.body.appendChild(fragment);
}

function rows(list: HTMLElement): number {
  return list.querySelectorAll('.cl-row').length;
}

function moreButton(list: HTMLElement): HTMLElement | null {
  return list.querySelector<HTMLElement>('.cl-more');
}

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.replaceChildren();
});

function setup() {
  const ui: UI = mountUI({ theme: 'light' });
  const panel = createLinkPanel({
    ui,
    getCopyFormat: () => 'url',
    copy: async () => true,
    notify: vi.fn(),
  });
  cleanup = () => ui.destroy();
  addLinks(LINK_COUNT);
  panel.open();
  const list = ui.root.querySelector<HTMLElement>('.cl-list');
  const search = ui.root.querySelector<HTMLInputElement>('input[type="search"]');
  if (!list || !search) throw new Error('面板结构不对');
  return { panel, list, search };
}

describe('链接面板分页', () => {
  it('首屏只建 200 行，点「显示更多」再加', () => {
    const { list } = setup();
    expect(rows(list)).toBe(200);
    moreButton(list)?.click();
    expect(rows(list)).toBe(LINK_COUNT);
    expect(moreButton(list)).toBeNull();
  });

  it('列表重画后，旧的「显示更多」按钮不再生效', () => {
    const { list, search } = setup();
    const stale = moreButton(list);
    expect(stale).not.toBeNull();

    // 重新筛选一次：列表被重建，旧按钮离开文档。
    search.value = 'example';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(rows(list)).toBe(200);

    stale?.click();
    expect(rows(list)).toBe(200);
    expect(moreButton(list)).not.toBeNull();
  });
});
