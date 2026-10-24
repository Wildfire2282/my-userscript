// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { readVideoState, shouldShowButton, findVideo } from '../src/features/visibility';

describe('shouldShowButton', () => {
  it('有播放器就显示，暂停 / 播完不影响', () => {
    expect(shouldShowButton({ exists: true, fullscreen: false })).toBe(true);
  });

  it('全屏时隐藏', () => {
    expect(shouldShowButton({ exists: true, fullscreen: true })).toBe(false);
  });

  it('没有视频时不显示', () => {
    expect(shouldShowButton({ exists: false, fullscreen: false })).toBe(false);
  });
});

describe('readVideoState', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('没有视频时按“不存在”处理', () => {
    expect(readVideoState(document, null)).toEqual({ exists: false, fullscreen: false });
  });

  it('没有 Fullscreen API（属性为 undefined）时不算全屏', () => {
    const bare = {
      querySelector: () => null,
      fullscreenElement: undefined,
    } as unknown as Document;
    expect(readVideoState(bare)).toEqual({ exists: false, fullscreen: false });
  });

  it('读到视频并识别全屏', () => {
    const player = document.createElement('div');
    player.id = 'movie_player';
    const video = document.createElement('video');
    video.className = 'html5-main-video';
    Object.defineProperty(video, 'paused', { value: true, configurable: true });
    player.appendChild(video);
    document.body.appendChild(player);

    expect(findVideo(document)).toBe(video);
    expect(readVideoState(document, null)).toEqual({ exists: true, fullscreen: false });
    expect(readVideoState(document, player).fullscreen).toBe(true);
  });
});
