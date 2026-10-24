import { describe, expect, it } from 'vitest';
import { readInitialTrack } from '../src/transcript/initial-track';

function response(baseUrl: string, videoId?: string) {
  return {
    videoDetails: { videoId },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl }] } },
  };
}

describe('readInitialTrack', () => {
  it('使用响应自身的视频 ID，不用字幕 URL 覆盖它', () => {
    expect(
      readInitialTrack(response('https://www.youtube.com/api/timedtext?v=other', 'first')),
    ).toEqual({ baseUrl: 'https://www.youtube.com/api/timedtext?v=other', videoId: 'first' });
  });

  it('缺少 videoDetails 时可从字幕 URL 确认视频归属', () => {
    expect(
      readInitialTrack(response('https://www.youtube.com/api/timedtext?v=first'))?.videoId,
    ).toBe('first');
  });

  it('无法确认归属或没有字幕时不提供轨道', () => {
    expect(readInitialTrack(response('https://www.youtube.com/api/timedtext'))).toBeNull();
    expect(readInitialTrack(response('not a URL'))).toBeNull();
    expect(readInitialTrack({ videoDetails: { videoId: 'first' } })).toBeNull();
  });
});
