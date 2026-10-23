import { describe, expect, it } from 'vitest';
import { nextCapture, parseCapturedResponse } from '../src/transcript/network';

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
