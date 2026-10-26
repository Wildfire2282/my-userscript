// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeTranscriptPanel,
  collapseDescription,
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

describe('collapseDescription', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('点击“收起”按钮并把描述折回去', () => {
    const expander = document.createElement('ytd-text-inline-expander');
    const less = document.createElement('button');
    less.setAttribute('aria-label', 'Show less');
    const onClick = vi.fn();
    less.addEventListener('click', onClick);
    expander.appendChild(less);
    document.body.appendChild(expander);

    expect(collapseDescription(document)).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('只有展开入口、没有收起入口时不动', () => {
    const expander = document.createElement('ytd-text-inline-expander');
    const more = document.createElement('button');
    more.textContent = '...more';
    expander.appendChild(more);
    document.body.appendChild(expander);

    expect(collapseDescription(document)).toBe(false);
  });
});

describe('closeTranscriptPanel', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  function panelWithClose(targetId: string): {
    panel: Element;
    close: HTMLElement;
    clicks: () => number;
  } {
    const panel = document.createElement('ytd-engagement-panel-section-list-renderer');
    panel.setAttribute('target-id', targetId);
    const close = document.createElement('button');
    close.setAttribute('aria-label', 'Close transcript');
    let clicks = 0;
    close.addEventListener('click', () => {
      clicks += 1;
      panel.remove();
    });
    panel.appendChild(close);
    document.body.appendChild(panel);
    return { panel, close, clicks: () => clicks };
  }

  it('只关转写面板，不碰评论面板', () => {
    const comments = panelWithClose('engagement-panel-comments-section');
    const transcript = panelWithClose('engagement-panel-searchable-transcript');

    expect(closeTranscriptPanel(document)).toBe(true);
    expect(transcript.clicks()).toBe(1);
    expect(comments.clicks()).toBe(0);
    expect(transcript.panel.isConnected).toBe(false);
  });

  it('靠组件 id 也能找到关闭按钮，不依赖界面语言', () => {
    const panel = document.createElement('ytd-engagement-panel-section-list-renderer');
    panel.setAttribute('target-id', 'engagement-panel-searchable-transcript');
    const header = document.createElement('div');
    header.id = 'visibility-button';
    const close = document.createElement('button');
    close.setAttribute('aria-label', 'Schließen');
    const onClick = vi.fn();
    close.addEventListener('click', onClick);
    header.appendChild(close);
    panel.appendChild(header);
    document.body.appendChild(panel);

    expect(closeTranscriptPanel(document)).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('没有关闭入口时返回 false', () => {
    expect(closeTranscriptPanel(document)).toBe(false);
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
    await expect(openTranscriptPanel({ sleep, attempts: 1 })).resolves.toMatchObject({
      opened: true,
    });
  });

  it('找不到按钮时在重试结束后返回失败', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    await expect(openTranscriptPanel({ sleep, attempts: 2 })).resolves.toMatchObject({
      opened: false,
    });
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
    ).resolves.toMatchObject({ opened: true });
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('收尾只关掉自己打开的面板、收起自己展开的描述', async () => {
    const expander = document.createElement('ytd-text-inline-expander');
    const more = document.createElement('button');
    more.id = 'expand';
    more.textContent = '...more';
    const less = document.createElement('button');
    less.setAttribute('aria-label', 'Show less');
    let lessClicks = 0;
    less.addEventListener('click', () => {
      lessClicks += 1;
    });
    more.addEventListener('click', () => {
      expander.appendChild(less);
    });
    const trigger = document.createElement('button');
    trigger.setAttribute('aria-label', 'Show transcript');
    expander.append(more, trigger);
    document.body.appendChild(expander);

    let closeClicks = 0;
    trigger.addEventListener('click', () => {
      const panel = document.createElement('ytd-engagement-panel-section-list-renderer');
      panel.setAttribute('target-id', 'engagement-panel-searchable-transcript');
      const close = document.createElement('button');
      close.setAttribute('aria-label', 'Close transcript');
      close.addEventListener('click', () => {
        closeClicks += 1;
        panel.remove();
      });
      const host = document.createElement('transcript-segment-view-model');
      stubRect(host, 300);
      panel.append(close, host);
      document.body.appendChild(panel);
    });

    const result = await openTranscriptPanel({
      sleep: () => Promise.resolve(),
      attempts: 1,
    });
    expect(result.opened).toBe(true);
    expect(lessClicks).toBe(0);

    result.restore();
    expect(closeClicks).toBe(1);
    expect(lessClicks).toBe(1);
    expect(document.querySelector('ytd-engagement-panel-section-list-renderer')).toBeNull();

    // 重复调用不再重复点按钮。
    result.restore();
    expect(closeClicks).toBe(1);
    expect(lessClicks).toBe(1);
  });

  it('复制前就已经打开的面板不会被收尾关掉', async () => {
    const panel = document.createElement('ytd-engagement-panel-section-list-renderer');
    panel.setAttribute('target-id', 'engagement-panel-searchable-transcript');
    const close = document.createElement('button');
    close.setAttribute('aria-label', 'Close transcript');
    const onClick = vi.fn();
    close.addEventListener('click', onClick);
    const host = document.createElement('transcript-segment-view-model');
    stubRect(host, 300);
    panel.append(close, host);
    document.body.appendChild(panel);

    const result = await openTranscriptPanel({
      sleep: () => Promise.resolve(),
      attempts: 1,
    });
    expect(result.opened).toBe(true);
    result.restore();
    expect(onClick).not.toHaveBeenCalled();
  });
});
