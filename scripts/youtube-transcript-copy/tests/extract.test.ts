// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  extractFromJson3,
  extractFromPanelDump,
  extractFromPanelResponse,
  extractFromViewModel,
} from '../src/transcript/extract';

const PANEL_RESPONSE = {
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
                        {
                          transcriptCueRenderer: {
                            startOffsetMs: 0,
                            simpleText: '  第一句   台词 ',
                          },
                        },
                        {
                          transcriptCueRenderer: {
                            startOffsetMs: 2_500,
                            cue: { simpleText: '第二句台词' },
                          },
                        },
                        { transcriptCueRenderer: { startOffsetMs: 9_000 } },
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

describe('extractFromPanelResponse', () => {
  it('从 get_panel 响应里取片段，清洗文字并分开两种文字字段', () => {
    expect(extractFromPanelResponse(PANEL_RESPONSE)).toEqual([
      { start: 0, text: '第一句 台词' },
      { start: 2_500, text: '第二句台词' },
    ]);
  });

  it('没有标识但内容里有 cueGroup 也认', () => {
    const response = {
      engagementPanels: [
        {
          engagementPanelSectionListRenderer: {
            content: PANEL_RESPONSE.engagementPanels[0]?.engagementPanelSectionListRenderer.content,
          },
        },
      ],
    };
    expect(extractFromPanelResponse(response)).toHaveLength(2);
  });

  it('不是转写面板或没有片段时返回 null', () => {
    expect(
      extractFromPanelResponse({ engagementPanels: [{ panelIdentifier: 'comments' }] }),
    ).toBeNull();
    expect(extractFromPanelResponse(null)).toBeNull();
  });
});

describe('extractFromJson3', () => {
  it('按事件拼接 segs 并保留起始时间', () => {
    expect(
      extractFromJson3({
        events: [
          { tStartMs: 0, segs: [{ utf8: 'Hello' }, { utf8: ' world' }] },
          { tStartMs: 1_200, segs: [{ utf8: '  ' }] },
          { tStartMs: 2_400, segs: [{ utf8: '再' }, { utf8: '见' }] },
        ],
      }),
    ).toEqual([
      { start: 0, text: 'Hello world' },
      { start: 2_400, text: '再见' },
    ]);
  });

  it('空数据返回 null', () => {
    expect(extractFromJson3({ events: [] })).toBeNull();
    expect(extractFromJson3('nope')).toBeNull();
  });

  it('runs[] 结构不丢字，中日文不插空格', () => {
    expect(
      extractFromPanelResponse({
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
                              {
                                transcriptCueRenderer: {
                                  startOffsetMs: 0,
                                  cue: { runs: [{ text: '你' }, { text: '好' }] },
                                },
                              },
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
      }),
    ).toEqual([{ start: 0, text: '你好' }]);
  });
});

describe('extractFromViewModel', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('从 transcript-segment-view-model 里取时间戳与文字', () => {
    const host = document.createElement('transcript-segment-view-model');
    const timestamp = document.createElement('span');
    timestamp.className = 'ytwTranscriptSegmentViewModelTimestamp';
    timestamp.textContent = '1:05';
    const text = document.createElement('span');
    text.setAttribute('role', 'text');
    text.textContent = ' 一段  台词 ';
    host.append(timestamp, text);
    document.body.appendChild(host);

    expect(extractFromViewModel(document.body)).toEqual([{ start: 65_000, text: '一段 台词' }]);
  });

  it('同一片段带一份隐藏副本时只保留一条', () => {
    for (let copy = 0; copy < 2; copy += 1) {
      const host = document.createElement('transcript-segment-view-model');
      const timestamp = document.createElement('span');
      timestamp.className = 'ytwTranscriptSegmentViewModelTimestamp';
      timestamp.textContent = '1:05';
      const text = document.createElement('span');
      text.setAttribute('role', 'text');
      text.textContent = '重复台词';
      host.append(timestamp, text);
      document.body.appendChild(host);
    }

    expect(extractFromViewModel(document.body)).toEqual([{ start: 65_000, text: '重复台词' }]);
  });

  it('同一句话出现在不同时间点时都保留', () => {
    for (const stamp of ['0:05', '0:09']) {
      const host = document.createElement('transcript-segment-view-model');
      const timestamp = document.createElement('span');
      timestamp.className = 'ytwTranscriptSegmentViewModelTimestamp';
      timestamp.textContent = stamp;
      const text = document.createElement('span');
      text.setAttribute('role', 'text');
      text.textContent = '重复台词';
      host.append(timestamp, text);
      document.body.appendChild(host);
    }

    expect(extractFromViewModel(document.body)).toEqual([
      { start: 5_000, text: '重复台词' },
      { start: 9_000, text: '重复台词' },
    ]);
  });

  it('没有片段容器时按“时间戳 + 同块文字”兜底', () => {
    const block = document.createElement('div');
    block.setAttribute('role', 'button');
    const timestamp = document.createElement('span');
    timestamp.textContent = '0:05';
    const text = document.createElement('span');
    text.textContent = 'Hello there';
    block.append(timestamp, text);
    document.body.appendChild(block);

    expect(extractFromViewModel(document.body)).toEqual([{ start: 5_000, text: 'Hello there' }]);
  });

  it('纯中文兜底行也会收进来', () => {
    const block = document.createElement('div');
    block.setAttribute('role', 'button');
    const timestamp = document.createElement('span');
    timestamp.textContent = '0:05';
    const text = document.createElement('span');
    text.textContent = '你好世界';
    block.append(timestamp, text);
    document.body.appendChild(block);

    expect(extractFromViewModel(document.body)).toEqual([{ start: 5_000, text: '你好世界' }]);
  });

  it('兜底不认通用面板：转写在面板外也能扫到', () => {
    const pair = (timestamp: string, text: string): HTMLElement => {
      const block = document.createElement('div');
      block.setAttribute('role', 'button');
      const time = document.createElement('span');
      time.textContent = timestamp;
      const line = document.createElement('span');
      line.textContent = text;
      block.append(time, line);
      return block;
    };
    // 通用面板（评论区也长这样）：不能因为它存在，兜底就只扫它。
    const panel = document.createElement('ytd-engagement-panel-section-list-renderer');
    panel.appendChild(pair('0:05', '评论区的话'));
    document.body.append(panel, pair('0:10', '真正的台词'));

    expect(extractFromViewModel(document.body)).toEqual([
      { start: 5_000, text: '评论区的话' },
      { start: 10_000, text: '真正的台词' },
    ]);
  });

  it('没有可识别的结构时返回 null', () => {
    document.body.appendChild(document.createElement('p')).textContent = '没有转写';
    expect(extractFromViewModel(document.body)).toBeNull();
  });
});

describe('extractFromPanelDump', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('解析“时间戳 空格 文字”的行', () => {
    for (const line of ['0:05 第一句', '1:02:03 第三句', '没有时间戳']) {
      const node = document.createElement('div');
      node.textContent = line;
      document.body.appendChild(node);
    }
    expect(extractFromPanelDump(document.body)).toEqual([
      { start: 5_000, text: '第一句' },
      { start: 3_723_000, text: '第三句' },
    ]);
  });

  it('没有匹配行时返回 null', () => {
    expect(extractFromPanelDump(document.body)).toBeNull();
  });
});
