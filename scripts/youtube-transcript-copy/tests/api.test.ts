import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPageClientVersion, requestPanel } from '../src/transcript/api';

type FetchLike = (url: string, init?: RequestInit) => Promise<{ json: () => Promise<unknown> }>;

function fetchOk() {
  return vi.fn<FetchLike>(() =>
    Promise.resolve({ json: () => Promise.resolve({ engagementPanels: [] }) }),
  );
}

describe('readPageClientVersion', () => {
  it('没有页面配置时返回 null', () => {
    expect(readPageClientVersion({})).toBeNull();
  });

  it('读到页面版本就用页面的', () => {
    expect(readPageClientVersion({ ytcfg: { get: () => '9.9.9' } })).toBe('9.9.9');
  });

  it('页面配置异常时返回 null', () => {
    expect(
      readPageClientVersion({
        ytcfg: {
          get: () => {
            throw new Error('boom');
          },
        },
      }),
    ).toBeNull();
  });
});

describe('requestPanel', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>)['ytcfg'];
  });

  it('空视频 ID 不发请求', async () => {
    const fetchImpl = fetchOk();
    await expect(requestPanel('', fetchImpl as unknown as typeof fetch)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('从目标视频取得令牌后请求文稿，不发送无法定位视频的面板请求', async () => {
    const fetchImpl = vi.fn<FetchLike>((url, init) => {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      if (url.includes('/next?') && body.videoId === 'vid') {
        return Promise.resolve({
          json: () =>
            Promise.resolve({
              engagementPanels: [
                {
                  engagementPanelSectionListRenderer: {
                    panelIdentifier: 'engagement-panel-searchable-transcript',
                    content: {
                      continuationItemRenderer: {
                        continuationEndpoint: {
                          getTranscriptEndpoint: { params: 'token-for-vid' },
                        },
                      },
                    },
                  },
                },
              ],
            }),
        });
      }
      if (url.includes('/get_transcript?') && body.params === 'token-for-vid') {
        return Promise.resolve({
          json: () =>
            Promise.resolve({
              actions: [
                {
                  updateEngagementPanelAction: {
                    content: {
                      transcriptRenderer: {
                        content: {
                          transcriptSearchPanelRenderer: {
                            body: {
                              transcriptSegmentListRenderer: {
                                initialSegments: [
                                  {
                                    transcriptSegmentRenderer: {
                                      startMs: '1000',
                                      snippet: { runs: [{ text: '目标视频文稿' }] },
                                    },
                                  },
                                ],
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              ],
            }),
        });
      }
      return Promise.reject(new Error('请求未绑定目标视频'));
    });
    await expect(requestPanel('vid', fetchImpl as unknown as typeof fetch)).resolves.toEqual([
      { start: 1000, text: '目标视频文稿' },
    ]);
    const transcriptCall = fetchImpl.mock.calls.find(([url]) => url.includes('/get_transcript?'));
    expect(transcriptCall?.[0]).toContain('v=vid');
  });

  it('视频没有转写令牌时不请求转写接口', async () => {
    const fetchImpl = fetchOk();
    await expect(
      requestPanel('no-transcript', fetchImpl as unknown as typeof fetch),
    ).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
