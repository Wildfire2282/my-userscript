// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  expandDescription,
  findTranscriptTrigger,
  isPanelOpen,
  openTranscriptPanel,
} from '../src/transcript/open-panel';

function stubRect(element: Element, width: number): void {
  element.getBoundingClientRect = () =>
    ({ width, height: width > 0 ? 20 : 0, left: 0, top: 0, right: width, bottom: 20 }) as DOMRect;
}

describe('findTranscriptTrigger', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('优先取描述区里 aria-label 为 Show transcript 的按钮', () => {
    const expander = document.createElement('ytd-text-inline-expander');
    const first = document.createElement('button');
    first.setAttribute('aria-label', 'Show more');
    const second = document.createElement('button');
    second.setAttribute('aria-label', 'Show transcript');
    expander.append(first, second);
    document.body.appendChild(expander);

    expect(findTranscriptTrigger(document)).toBe(second);
  });

  it('没有 Show transcript 时退到任何带 transcript 的按钮', () => {
    const expander = document.createElement('ytd-text-inline-expander');
    const button = document.createElement('button');
    button.setAttribute('aria-label', '打开 Transcript');
    expander.appendChild(button);
    document.body.appendChild(expander);

    expect(findTranscriptTrigger(document)).toBe(button);
  });

  it('中文界面：识别描述区里的转写组件，不依赖英文按钮文字', () => {
    const section = document.createElement('ytd-video-description-transcript-section-renderer');
    const button = document.createElement('button');
    button.textContent = '内容转文字';
    section.appendChild(button);
    document.body.appendChild(section);
    stubRect(section, 300);

    expect(findTranscriptTrigger(document)).toBe(button);
  });

  it('描述区还在折叠时不选组件里的隐藏按钮', () => {
    const section = document.createElement('ytd-video-description-transcript-section-renderer');
    const button = document.createElement('button');
    button.textContent = '内容转文字';
    section.appendChild(button);
    document.body.appendChild(section);
    stubRect(section, 0);

    expect(findTranscriptTrigger(document)).toBeNull();
  });

  it('中文按钮在描述区内也能按文字找到', () => {
    const expander = document.createElement('ytd-text-inline-expander');
    const button = document.createElement('button');
    button.setAttribute('aria-label', '内容转文字');
    expander.appendChild(button);
    document.body.appendChild(expander);

    expect(findTranscriptTrigger(document)).toBe(button);
  });

  it('没有可识别的按钮时返回 null', () => {
    document.body.appendChild(document.createElement('div')).textContent = '没有按钮';
    expect(findTranscriptTrigger(document)).toBeNull();
  });
});

describe('expandDescription', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('点击“展开更多”并返回 true', () => {
    const expander = document.createElement('ytd-text-inline-expander');
    const more = document.createElement('button');
    more.textContent = '...more';
    const onClick = vi.fn();
    more.addEventListener('click', onClick);
    expander.appendChild(more);
    document.body.appendChild(expander);

    expect(expandDescription(document)).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('没有可展开的描述时不动作', () => {
    expect(expandDescription(document)).toBe(false);
  });
});

describe('isPanelOpen', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('片段节点有宽度才算打开', () => {
    const host = document.createElement('transcript-segment-view-model');
    document.body.appendChild(host);
    stubRect(host, 0);
    expect(isPanelOpen(document)).toBe(false);
    stubRect(host, 300);
    expect(isPanelOpen(document)).toBe(true);
  });
});

describe('openTranscriptPanel', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('点开按钮后等待片段出现即返回成功', async () => {
    // happy-dom 没有布局，描述区之外的分支靠 offsetParent 过滤按钮会永远落空；
    // 这里把按钮放进测试关心的描述区分支。
    const expander = document.createElement('ytd-text-inline-expander');
    const trigger = document.createElement('button');
    trigger.setAttribute('aria-label', 'Show transcript');
    expander.appendChild(trigger);
    document.body.appendChild(expander);

    const host = document.createElement('transcript-segment-view-model');
    stubRect(host, 0);
    trigger.addEventListener('click', () => {
      document.body.appendChild(host);
      stubRect(host, 300);
    });

    const sleep = vi.fn(() => Promise.resolve());
    await expect(openTranscriptPanel({ sleep, attempts: 1 })).resolves.toBe(true);
  });

  it('找不到按钮时在重试结束后返回失败', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    await expect(openTranscriptPanel({ sleep, attempts: 2 })).resolves.toBe(false);
  });

  it('匹配到自定义包装元素时点击内部按钮且只点击一次', async () => {
    const expander = document.createElement('ytd-text-inline-expander');
    const wrapper = document.createElement('yt-button-shape');
    wrapper.setAttribute('aria-label', 'Show transcript');
    const button = document.createElement('button');
    wrapper.appendChild(button);
    expander.appendChild(wrapper);
    document.body.appendChild(expander);
    const host = document.createElement('transcript-segment-view-model');
    const clicked = vi.fn(() => {
      document.body.appendChild(host);
      stubRect(host, 300);
    });
    button.addEventListener('click', clicked);

    await expect(
      openTranscriptPanel({ sleep: () => Promise.resolve(), attempts: 1 }),
    ).resolves.toBe(true);
    expect(clicked).toHaveBeenCalledTimes(1);
  });
});
