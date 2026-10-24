import { describe, expect, it } from 'vitest';
import { INDICATOR } from '../src/config';
import { indicatorPosition } from '../src/ui/indicator-position';

const VIEWPORT = { width: 1000, height: 800 };
const SUCCESS_WIDTH = INDICATOR.widthPx.success;
const FAILURE_WIDTH = INDICATOR.widthPx.failure;

describe('indicatorPosition', () => {
  it('有鼠标坐标时贴在光标正上方并水平居中', () => {
    const point = indicatorPosition(
      { x: 240, y: 300 },
      { left: 200, right: 240, top: 300, bottom: 320, width: 0, height: 20 },
      VIEWPORT,
    );
    expect(point).toEqual({
      left: 240 - SUCCESS_WIDTH / 2,
      top: 300 - INDICATOR.heightPx - INDICATOR.gapPx,
    });
  });

  it('失败标签更宽，居中位置随宽度变化', () => {
    const point = indicatorPosition(
      { x: 240, y: 300 },
      { left: 200, right: 240, top: 300, bottom: 320, width: 0, height: 20 },
      VIEWPORT,
      'failure',
    );
    expect(point.left).toBe(240 - FAILURE_WIDTH / 2);
    expect(point.top).toBe(300 - INDICATOR.heightPx - INDICATOR.gapPx);
  });

  it('选区贴右边时被限制在视口内', () => {
    const point = indicatorPosition(
      { x: 1000, y: 300 },
      { left: 990, right: 1000, top: 300, bottom: 320, width: 0, height: 20 },
      VIEWPORT,
      'failure',
    );
    expect(point.left).toBe(VIEWPORT.width - FAILURE_WIDTH - INDICATOR.marginPx);
  });

  it('光标贴顶时翻到下一行，不挡住选中的文字', () => {
    const point = indicatorPosition(
      { x: 240, y: 10 },
      { left: 200, right: 240, top: 10, bottom: 30, width: 0, height: 20 },
      VIEWPORT,
    );
    expect(point.top).toBe(30 + INDICATOR.gapPx);
  });

  it('上下都放不下时仍留在视口内', () => {
    const point = indicatorPosition(
      { x: 240, y: -4 },
      { left: 200, right: 240, top: -4, bottom: 2, width: 0, height: 6 },
      VIEWPORT,
    );
    expect(point.top).toBeGreaterThanOrEqual(INDICATOR.marginPx);
  });

  it('鼠标坐标优先于选区焦点', () => {
    const point = indicatorPosition(
      { x: 500, y: 300 },
      { left: 200, right: 240, top: 300, bottom: 320, width: 0, height: 20 },
      VIEWPORT,
    );
    expect(point).toEqual({
      left: 500 - SUCCESS_WIDTH / 2,
      top: 300 - INDICATOR.heightPx - INDICATOR.gapPx,
    });
  });

  it('键盘选区贴在焦点正上方', () => {
    const point = indicatorPosition(
      null,
      { left: 200, right: 240, top: 300, bottom: 320, width: 0, height: 20 },
      VIEWPORT,
    );
    expect(point).toEqual({
      left: 240 - SUCCESS_WIDTH / 2,
      top: 300 - INDICATOR.heightPx - INDICATOR.gapPx,
    });
  });

  it('键盘选区已滚出视口时落在视口中央', () => {
    const point = indicatorPosition(
      null,
      { left: 200, right: 240, top: -50, bottom: -30, width: 0, height: 20 },
      VIEWPORT,
    );
    expect(point).toEqual({
      left: (VIEWPORT.width - SUCCESS_WIDTH) / 2,
      top: (VIEWPORT.height - INDICATOR.heightPx) / 2,
    });
  });

  it('插入点在最左边也算可用位置，不跳到视口中央', () => {
    const point = indicatorPosition(
      null,
      { left: 0, right: 0, top: 300, bottom: 320, width: 0, height: 20 },
      VIEWPORT,
    );
    expect(point.left).toBe(INDICATOR.marginPx);
  });

  it('没有可用矩形时落在视口中央', () => {
    expect(indicatorPosition(null, null, VIEWPORT)).toEqual({
      left: (VIEWPORT.width - SUCCESS_WIDTH) / 2,
      top: (VIEWPORT.height - INDICATOR.heightPx) / 2,
    });
  });

  it('小视口也不会把标记推到负坐标', () => {
    const point = indicatorPosition(null, null, { width: 10, height: 10 });
    expect(point.left).toBeGreaterThanOrEqual(INDICATOR.marginPx);
    expect(point.top).toBeGreaterThanOrEqual(INDICATOR.marginPx);
  });
});
