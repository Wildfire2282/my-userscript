import { describe, expect, it } from 'vitest';
import { BUTTON_SIZE, clampPosition, defaultButtonPosition } from '../src/features/position';

const VIEWPORT = { width: 1000, height: 800 };

describe('clampPosition', () => {
  it('视口内的位置原样返回', () => {
    expect(clampPosition({ right: 100, top: 50 }, VIEWPORT)).toEqual({ right: 100, top: 50 });
  });

  it('超出右下边界时贴边', () => {
    expect(clampPosition({ right: 2000, top: 2000 }, VIEWPORT)).toEqual({
      right: VIEWPORT.width - BUTTON_SIZE,
      top: VIEWPORT.height - BUTTON_SIZE,
    });
  });

  it('负坐标收回左上角', () => {
    expect(clampPosition({ right: -10, top: -10 }, VIEWPORT)).toEqual({ right: 0, top: 0 });
  });

  it('视口比按钮还小时贴住左上角', () => {
    expect(clampPosition({ right: 0, top: 0 }, { width: 10, height: 10 })).toEqual({
      right: 0,
      top: 0,
    });
  });
});

describe('defaultButtonPosition', () => {
  it('放在播放器右上角偏移 30px 的位置', () => {
    expect(defaultButtonPosition({ right: 680, top: 40 }, VIEWPORT)).toEqual({
      right: 1000 - 680 + 30,
      top: 70,
    });
  });

  it('没有播放器时返回 null', () => {
    expect(defaultButtonPosition(null, VIEWPORT)).toBeNull();
  });

  it('播放器贴边时结果仍被夹紧在视口内', () => {
    expect(defaultButtonPosition({ right: 1000, top: 790 }, VIEWPORT)).toEqual({
      right: 30,
      top: VIEWPORT.height - BUTTON_SIZE,
    });
  });
});
