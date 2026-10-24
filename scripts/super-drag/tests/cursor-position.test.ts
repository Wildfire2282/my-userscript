import { describe, expect, it } from 'vitest';
import { DRAG_MARK, cursorMarkPosition } from '../src/ui/cursor-position';

const VIEWPORT = { width: 1000, height: 800 };

describe('cursorMarkPosition', () => {
  it('图标整体落在指针左上方', () => {
    expect(cursorMarkPosition({ x: 500, y: 400 }, VIEWPORT)).toEqual({
      x: 500 - DRAG_MARK.sizePx - DRAG_MARK.offsetPx,
      y: 400 - DRAG_MARK.sizePx - DRAG_MARK.offsetPx,
    });
  });

  it('指针贴着视口左上角时图标收进视口', () => {
    expect(cursorMarkPosition({ x: 2, y: 2 }, VIEWPORT)).toEqual({
      x: DRAG_MARK.marginPx,
      y: DRAG_MARK.marginPx,
    });
  });

  it('指针贴着视口右下角时图标不越界', () => {
    const point = cursorMarkPosition({ x: 1000, y: 800 }, VIEWPORT);
    expect(point.x).toBe(VIEWPORT.width - DRAG_MARK.sizePx - DRAG_MARK.marginPx);
    expect(point.y).toBe(VIEWPORT.height - DRAG_MARK.sizePx - DRAG_MARK.marginPx);
  });

  it('视口比图标还小时不会出现负坐标', () => {
    const point = cursorMarkPosition({ x: 5, y: 5 }, { width: 10, height: 10 });
    expect(point.x).toBe(DRAG_MARK.marginPx);
    expect(point.y).toBe(DRAG_MARK.marginPx);
  });
});
