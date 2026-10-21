// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildImageViewerHtml, createOpeners } from '../src/features/openers';

interface OpenedTab {
  url: string;
  options: { active: boolean; insert: boolean };
}

/**
 * 打开标签页的副作用全部经过注入的 scope，blob 地址则换成可控替身：
 * 这样能验证“打开了什么”，不用真的去建标签页。
 */

let blobs: Blob[];
let revoked: string[];
let nextBlob: number;

beforeEach(() => {
  vi.useFakeTimers();
  blobs = [];
  revoked = [];
  nextBlob = 0;
  const url = URL as unknown as {
    createObjectURL: (blob: Blob) => string;
    revokeObjectURL: (url: string) => void;
  };
  url.createObjectURL = (blob) => {
    blobs.push(blob);
    nextBlob += 1;
    return `blob:fake/${nextBlob}`;
  };
  url.revokeObjectURL = (value) => {
    revoked.push(value);
  };
});

afterEach(() => {
  vi.useRealTimers();
});

function createScope(options: { gmFails?: boolean; noGm?: boolean } = {}) {
  const opened: OpenedTab[] = [];
  const focus = vi.fn();
  const windowOpen = vi.fn(() => null as Window | null);
  const GM_openInTab = options.noGm
    ? undefined
    : (value: string, tabOptions: { active: boolean; insert: boolean }) => {
        if (options.gmFails) throw new Error('denied');
        opened.push({ url: value, options: tabOptions });
      };
  return { scope: { GM_openInTab, open: windowOpen, focus }, opened, focus, windowOpen };
}

describe('buildImageViewerHtml', () => {
  it('图片地址按属性转义，不会被拼成标签', () => {
    const html = buildImageViewerHtml('https://e.test/i.png?a=1&b="><script>alert(1)</script>');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const image = doc.querySelector('img');
    expect(doc.querySelector('script')).toBeNull();
    expect(image?.getAttribute('src')).toBe(
      'https://e.test/i.png?a=1&b="><script>alert(1)</script>',
    );
  });

  it('带 utf-8 声明与深色居中样式', () => {
    const html = buildImageViewerHtml('https://e.test/i.png');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('meta[charset="utf-8"]')).not.toBeNull();
    expect(doc.querySelector('img')?.getAttribute('alt')).toBe('image');
    expect(html).toContain('background:#000');
  });
});

describe('createOpeners.openImage', () => {
  it('普通图片包进查看器 blob，并在 5 分钟后回收', async () => {
    const { scope, opened } = createScope();
    createOpeners(scope).openImage('https://e.test/i.png', false);

    expect(opened).toEqual([{ url: 'blob:fake/1', options: { active: false, insert: true } }]);
    expect(blobs).toHaveLength(1);
    expect(await blobs[0]?.text()).toContain('https://e.test/i.png');

    vi.advanceTimersByTime(5 * 60 * 1000 - 1);
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(revoked).toEqual(['blob:fake/1']);
  });

  it('页面自己的 blob:/data: 图片直接打开原地址', () => {
    const { scope, opened } = createScope();
    const openers = createOpeners(scope);
    openers.openImage('data:image/png;base64,AAAA', false);
    openers.openImage('blob:https://e.test/abc', true);
    expect(opened.map((tab) => tab.url)).toEqual([
      'data:image/png;base64,AAAA',
      'blob:https://e.test/abc',
    ]);
    expect(blobs).toHaveLength(0);
  });

  it('建不了 blob 时退回直接打开原图', () => {
    const url = URL as unknown as { createObjectURL: () => string };
    url.createObjectURL = () => {
      throw new Error('blocked');
    };
    const { scope, opened } = createScope();
    createOpeners(scope).openImage('https://e.test/i.png', false);
    expect(opened.map((tab) => tab.url)).toEqual(['https://e.test/i.png']);
  });
});

describe('createOpeners.openUrl', () => {
  it('脚本管理器拒绝时退回 window.open，且不抢焦点', () => {
    const { scope, opened, windowOpen } = createScope({ gmFails: true });
    createOpeners(scope).openUrl('https://e.test/x', true);

    expect(opened).toEqual([]);
    expect(windowOpen).toHaveBeenCalledWith('https://e.test/x', '_blank', 'noopener');
  });

  it('没有 GM_openInTab 时同样退回 window.open', () => {
    const { scope, windowOpen } = createScope({ noGm: true });
    createOpeners(scope).openUrl('https://e.test/x', false);
    expect(windowOpen).toHaveBeenCalledTimes(1);
  });
});
