// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { readVideoState, shouldShowButton, findVideo } from '../src/features/visibility';

describe('shouldShowButton', () => {
  const playing = { exists: true, paused: false, ended: false, readyState: 4, fullscreen: false };

  it('播放中显示', () => {
    expect(shouldShowButton(playing)).toBe(true);
  });

  it('暂停、播完、未缓冲好、全屏时隐藏', () => {
    expect(shouldShowButton({ ...playing, paused: true })).toBe(false);
    expect(shouldShowButton({ ...playing, ended: true })).toBe(false);
    expect(shouldShowButton({ ...playing, readyState: 2 })).toBe(false);
    expect(shouldShowButton({ ...playing, fullscreen: true })).toBe(false);
  });

  it('没有视频时不显示', () => {
    expect(shouldShowButton({ ...playing, exists: false })).toBe(false);
  });
});

describe('readVideoState', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('没有视频时按“不存在 + 暂停”处理', () => {
    expect(readVideoState(document, null)).toEqual({
      exists: false,
      paused: true,
      ended: false,
      readyState: 0,
      fullscreen: false,
    });
  });

  it('读到视频的播放状态，并识别全屏', () => {
    const player = document.createElement('div');
    player.id = 'movie_player';
    const video = document.createElement('video');
    video.className = 'html5-main-video';
    Object.defineProperty(video, 'paused', { value: false, configurable: true });
    Object.defineProperty(video, 'ended', { value: false, configurable: true });
    Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
    player.appendChild(video);
    document.body.appendChild(player);

    expect(findVideo(document)).toBe(video);
    expect(readVideoState(document, null)).toEqual({
      exists: true,
      paused: false,
      ended: false,
      readyState: 4,
      fullscreen: false,
    });
    expect(readVideoState(document, player).fullscreen).toBe(true);
  });
});
