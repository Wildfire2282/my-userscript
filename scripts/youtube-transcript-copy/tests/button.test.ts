// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UI } from '@ui';
import { createTranscriptButton } from '../src/ui/button';

function setup() {
  const base = document.createElement('div');
  document.body.appendChild(base);
  const ui = {
    useStyles: () => undefined,
    layers: { base },
    onDestroy: () => undefined,
  } as unknown as UI;
  const onClick = vi.fn();
  const onMoveEnd = vi.fn();
  const handle = createTranscriptButton({ ui, label: '复制当前转写文稿', onClick, onMoveEnd });
  return { handle, onClick, onMoveEnd };
}

function press(wrap: Element, x = 100, y = 100): void {
  wrap.dispatchEvent(
    new PointerEvent('pointerdown', { button: 0, clientX: x, clientY: y, bubbles: true }),
  );
}

function move(x: number, y: number): void {
  document.dispatchEvent(
    new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }),
  );
}

function release(): void {
  document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
}

function clickButton(wrap: Element): void {
  wrap
    .querySelector('button')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('createTranscriptButton', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('pointercancel 也会收尾，不留下拖动标记', () => {
    const { handle, onMoveEnd } = setup();
    press(handle.el);
    expect(handle.el.dataset.dragging).toBe('true');
    move(120, 120);
    document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    expect(handle.el.dataset.dragging).toBe('false');
    expect(onMoveEnd).toHaveBeenCalledTimes(1);
    handle.destroy();
  });

  it('取消后再拖能正常工作，监听没有越积越多', () => {
    const { handle, onMoveEnd } = setup();
    press(handle.el);
    document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    press(handle.el);
    move(130, 130);
    release();
    expect(handle.el.dataset.dragging).toBe('false');
    expect(onMoveEnd).toHaveBeenCalledTimes(2);
    handle.destroy();
  });

  it('拖动后 200ms 內的点击仍被吞掉，过期后恢复', async () => {
    const { handle, onClick } = setup();
    press(handle.el);
    move(120, 120);
    release();
    clickButton(handle.el);
    expect(onClick).not.toHaveBeenCalled();
    // 触屏上补发的点击到得晚：200ms 后还在抑制窗内，不能误复制。
    await new Promise((resolve) => setTimeout(resolve, 200));
    clickButton(handle.el);
    expect(onClick).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 200));
    clickButton(handle.el);
    expect(onClick).toHaveBeenCalledTimes(1);
    handle.destroy();
  });
});
