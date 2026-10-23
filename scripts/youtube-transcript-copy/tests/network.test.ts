import { describe, expect, it } from 'vitest';
import { parseCapturedResponse } from '../src/transcript/network';

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
