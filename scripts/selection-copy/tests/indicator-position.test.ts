import { describe, expect, it } from 'vitest';
import { INDICATOR } from '../src/config';
import { indicatorPosition } from '../src/ui/indicator-position';

const VIEWPORT = { width: 1000, height: 800 };

describe('indicatorPosition', () => {
  it('贴在选区终点的右上角', () => {
    const point = indicatorPosition(
      { left: 200, right: 240, top: 300, bottom: 320, width: 0, height: 20 },
      VIEWPORT,
    );
    expect(point).toEqual({
      left: 240 - INDICATOR.sizePx / 2,
      top: 300 - INDICATOR.sizePx - INDICATOR.gapPx,
    });
  });

  it('选区贴右边时被限制在视口内', () => {
    const point = indicatorPosition(
      { left: 990, right: 1000, top: 300, bottom: 320, width: 0, height: 20 },
      VIEWPORT,
    );
    expect(point.left).toBe(VIEWPORT.width - INDICATOR.sizePx - INDICATOR.marginPx);
  });

  it('选区已滚出视口时落在视口中央', () => {
    const point = indicatorPosition(
      { left: 200, right: 240, top: -50, bottom: -30, width: 0, height: 20 },
      VIEWPORT,
    );
    expect(point).toEqual({
      left: VIEWPORT.width / 2 - INDICATOR.sizePx / 2,
      top: VIEWPORT.height / 2 - INDICATOR.sizePx / 2,
    });
  });

  it('没有可用矩形时落在视口中央', () => {
    expect(indicatorPosition(null, VIEWPORT)).toEqual({
      left: VIEWPORT.width / 2 - INDICATOR.sizePx / 2,
      top: VIEWPORT.height / 2 - INDICATOR.sizePx / 2,
    });
  });

  it('小视口也不会把标记推到负坐标', () => {
    const point = indicatorPosition(null, { width: 10, height: 10 });
    expect(point.left).toBeGreaterThanOrEqual(INDICATOR.marginPx);
    expect(point.top).toBeGreaterThanOrEqual(INDICATOR.marginPx);
  });
});
