import { describe, expect, it, vi } from 'vitest';
import {
  installNetworkCapture,
  nextCapture,
  parseCapturedResponse,
  readVideoId,
} from '../src/transcript/network';

const TIMEDTEXT = {
  events: [
    { tStartMs: 0, segs: [{ utf8: ' hello' }] },
    { tStartMs: 2_000, segs: [{ utf8: 'world' }] },
    { tStartMs: 4_000, segs: [{ utf8: ' ' }] },
  ],
};

const PANEL = {
  engagementPanels: [
    {
      engagementPanelSectionListRenderer: {
        panelIdentifier: 'engagement-panel-searchable-transcript',
        content: {
          transcriptRenderer: {
            body: {
              transcriptBodyRenderer: {
                cueGroups: [
                  {
                    transcriptCueGroupRenderer: {
                      cues: [
                        { transcriptCueRenderer: { startOffsetMs: 1_000, simpleText: '台词' } },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  ],
};

function captureHarness() {
  class FakeXHR extends EventTarget {
    responseType = 'json';
    response: unknown = TIMEDTEXT;
    responseText = '';
    open(method: string, url: string | URL) {
      void method;
      void url;
    }
    abort() {
      this.dispatchEvent(new Event('abort'));
    }
    load(data: unknown = TIMEDTEXT) {
      this.response = data;
      this.dispatchEvent(new Event('load'));
    }
  }
  const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(TIMEDTEXT))));
  const scope = {
    fetch,
    XMLHttpRequest: FakeXHR,
    location: { search: '?v=abc', pathname: '/watch' },
  };
  const win = scope as unknown as Window & typeof globalThis;
  return { win, scope, FakeXHR, fetch };
}

describe('installNetworkCapture consumption', () => {
  it('fetch 捕获结果由两次安装的消费者共享，响应仍可正常消费', async () => {
    const { win } = captureHarness();
    const first = installNetworkCapture(win);
    const second = installNetworkCapture(win);
    try {
      const response = await win.fetch('/api/timedtext?v=abc');
      expect(await response.json()).toEqual(TIMEDTEXT);
      await vi.waitFor(() => expect(second.get()?.[0]?.text).toBe('hello'));
      expect(first.get()).toEqual(second.get());
    } finally {
      first.restore();
    }
  });

  it('两次安装共用缓存，clear 与 restore 后重装都有效且不写宿主全局', () => {
    const { win, scope, FakeXHR, fetch } = captureHarness();
    const originalOpen = FakeXHR.prototype.open;
    const keys = Object.keys(scope);
    const first = installNetworkCapture(win);
    const wrappedFetch = win.fetch;
    const second = installNetworkCapture(win);
    expect(win.fetch).toBe(wrappedFetch);
    const xhr = new FakeXHR();
    xhr.open('GET', '/api/timedtext?v=abc');
    xhr.load();
    expect(first.get()).toEqual([
      { start: 0, text: 'hello' },
      { start: 2000, text: 'world' },
    ]);
    expect(second.get()).toEqual(first.get());
    second.clear();
    expect(first.get()).toBeNull();
    expect(Object.keys(scope)).toEqual(keys);
    second.restore();
    expect(win.fetch).toBe(fetch);
    expect(FakeXHR.prototype.open).toBe(originalOpen);
    const third = installNetworkCapture(win);
    first.restore();
    xhr.open('GET', '/api/timedtext?v=abc');
    xhr.load();
    expect(third.get()).not.toBeNull();
    expect(first.get()).toBeNull();
    third.restore();
  });

  it('restore 不拆掉之后别人装的包装', () => {
    const { win, FakeXHR } = captureHarness();
    const capture = installNetworkCapture(win);
    const laterFetch = vi.fn(() => Promise.resolve(new Response('{}')));
    const laterOpen = vi.fn();
    win.fetch = laterFetch;
    // 模拟另一段代码在捕获之后重包 XHR。
    FakeXHR.prototype.open = laterOpen;
    capture.restore();
    expect(win.fetch).toBe(laterFetch);
    expect(FakeXHR.prototype.open).toBe(laterOpen);
  });

  it('clear(videoId) 只清别的视频，保留同视频已捕获内容', async () => {
    const { win } = captureHarness();
    const capture = installNetworkCapture(win);
    try {
      await win.fetch('/api/timedtext?v=abc');
      await vi.waitFor(() => expect(capture.get()?.[0]?.text).toBe('hello'));
      capture.clear('abc');
      expect(capture.get()).not.toBeNull();
      capture.clear('xyz');
      expect(capture.get()).toBeNull();
    } finally {
      capture.restore();
    }
  });

  it('换台后迟到的旧视频字幕不覆盖新视频的完整面板', () => {
    const { win, scope, FakeXHR } = captureHarness();
    const capture = installNetworkCapture(win);
    try {
      const old = new FakeXHR();
      old.open('GET', '/api/timedtext?v=abc');
      scope.location.search = '?v=xyz';
      const current = new FakeXHR();
      current.open('POST', '/youtubei/v1/get_panel');
      current.load(PANEL);
      expect(capture.get()).toEqual([{ start: 1000, text: '台词' }]);

      old.load(TIMEDTEXT);
      expect(capture.get()).toEqual([{ start: 1000, text: '台词' }]);
    } finally {
      capture.restore();
    }
  });

  it('abort 后 open 非捕获 URL 不让旧 listener 接收新响应', () => {
    const { win, FakeXHR } = captureHarness();
    const capture = installNetworkCapture(win);
    try {
      const xhr = new FakeXHR();
      xhr.open('GET', '/api/timedtext?v=abc');
      xhr.abort();
      xhr.open('GET', '/unrelated');
      xhr.load();
      expect(capture.get()).toBeNull();
      xhr.open('GET', '/youtubei/v1/get_transcript');
      xhr.abort();
      xhr.open('GET', '/api/timedtext?v=abc&tlang=zh');
      xhr.load(PANEL);
      expect(capture.get()).toBeNull();
    } finally {
      capture.restore();
    }
  });

  it('切视频后不消费旧响应，也不让旧视频面板阻止新视频字幕', () => {
    const { win, scope, FakeXHR } = captureHarness();
    const capture = installNetworkCapture(win);
    try {
      const old = new FakeXHR();
      old.open('POST', '/youtubei/v1/get_transcript');
      old.load(PANEL);
      expect(capture.get()).toEqual([{ start: 1000, text: '台词' }]);
      const pending = new FakeXHR();
      pending.open('POST', '/youtubei/v1/get_transcript');
      scope.location.search = '?v=xyz';
      expect(capture.get()).toBeNull();
      pending.load(PANEL);
      expect(capture.get()).toBeNull();
      const current = new FakeXHR();
      current.open('GET', '/api/timedtext?v=xyz');
      current.load();
      expect(capture.get()?.[0]?.text).toBe('hello');
    } finally {
      capture.restore();
    }
  });
});

describe('parseCapturedResponse', () => {
  it('播放器的 timedtext 响应按 json3 解析', () => {
    expect(
      parseCapturedResponse('https://www.youtube.com/api/timedtext?v=x&fmt=json3', TIMEDTEXT),
    ).toEqual([
      { start: 0, text: 'hello' },
      { start: 2_000, text: 'world' },
    ]);
  });

  it('面板接口仍按 cueGroups 解析', () => {
    expect(
      parseCapturedResponse(
        'https://www.youtube.com/youtubei/v1/get_panel?prettyPrint=false',
        PANEL,
      ),
    ).toEqual([{ start: 1_000, text: '台词' }]);
  });

  it('没有可识别内容时返回 null，不覆盖已有缓存', () => {
    expect(parseCapturedResponse('https://www.youtube.com/api/timedtext?v=x', {})).toBeNull();
    expect(
      parseCapturedResponse('https://www.youtube.com/youtubei/v1/get_transcript', { actions: [] }),
    ).toBeNull();
  });
});

describe('readVideoId', () => {
  it('watch、shorts、embed、live 都能读到视频 ID', () => {
    expect(readVideoId('?v=abc', '/watch')).toBe('abc');
    expect(readVideoId('', '/shorts/xyz')).toBe('xyz');
    expect(readVideoId('', '/embed/xyz')).toBe('xyz');
    expect(readVideoId('', '/live/xyz')).toBe('xyz');
    expect(readVideoId('', '/watch')).toBe('');
  });
});

describe('nextCapture', () => {
  const other = [{ start: 0, text: '别的视频' }];
  const mine = [{ start: 0, text: '这个视频' }];

  it('当前视频的字幕留下', () => {
    expect(
      nextCapture(null, 'abc', 'https://www.youtube.com/api/timedtext?v=abc&fmt=json3', mine),
    ).toEqual({ videoId: 'abc', fromPanel: false, segments: mine });
  });

  it('别的视频的响应丢掉', () => {
    expect(
      nextCapture(null, 'abc', 'https://www.youtube.com/api/timedtext?v=xyz&fmt=json3', other),
    ).toBeNull();
  });

  it('翻译字幕丢掉，不冒充原文稿', () => {
    expect(
      nextCapture(
        null,
        'abc',
        'https://www.youtube.com/api/timedtext?v=abc&tlang=zh-Hans&fmt=json3',
        mine,
      ),
    ).toBeNull();
  });

  it('面板数据不被播放器字幕覆盖', () => {
    const state = { videoId: 'abc', fromPanel: true, segments: mine };
    expect(
      nextCapture(state, 'abc', 'https://www.youtube.com/api/timedtext?v=abc&fmt=json3', mine),
    ).toBeNull();
  });

  it('没有视频 ID 时不缓存', () => {
    expect(
      nextCapture(null, '', 'https://www.youtube.com/api/timedtext?v=abc&fmt=json3', mine),
    ).toBeNull();
  });

  it('解析不出内容时不覆盖已有缓存', () => {
    const state = { videoId: 'abc', fromPanel: true, segments: mine };
    expect(
      nextCapture(state, 'abc', 'https://www.youtube.com/api/timedtext?v=abc', null),
    ).toBeNull();
  });
});
