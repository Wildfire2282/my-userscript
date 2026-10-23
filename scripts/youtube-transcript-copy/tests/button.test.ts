// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountUI, type UI } from '@ui';
import { createTranscriptButton, type TranscriptButtonHandle } from '../src/ui/button';

/**
 * 按钮只测行为：状态文字与加载态、拖动结果、拖动不触发复制、销毁后不响应。
 * 真实浏览器场景里另有像素级位置与外观检查。
 */

function mount(overrides: { onClick?: () => void; onMoveEnd?: () => void } = {}) {
  const ui: UI = mountUI({ theme: 'light' });
  const handle: TranscriptButtonHandle = createTranscriptButton({
    ui,
    label: '复制当前转写文稿',
    onClick: overrides.onClick ?? (() => {}),
    onMoveEnd: overrides.onMoveEnd ?? (() => {}),
  });
  return { ui, handle, button: handle.el.querySelector('button') as HTMLButtonElement };
}

function pointer(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
}

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.replaceChildren();
});

function setup(overrides: { onClick?: () => void; onMoveEnd?: () => void } = {}) {
  const mounted = mount(overrides);
  cleanup = () => mounted.ui.destroy();
  return mounted;
}

describe('createTranscriptButton', () => {
  it('就绪时显示 T，用 @ui 的按钮组件', () => {
    const { button, handle } = setup();
    expect(button.textContent).toBe('T');
    expect(button.classList.contains('ds-button')).toBe(true);
    expect(handle.el.dataset.state).toBe('normal');
  });

  it('加载中给按钮加 aria-busy，结束回到 T', () => {
    vi.useFakeTimers();
    const { button, handle } = setup();
    handle.setState('loading');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.disabled).toBe(true);
    handle.setState('success');
    expect(button.textContent).toBe('\u2713');
    expect(button.getAttribute('aria-busy')).toBeNull();
    vi.advanceTimersByTime(1500);
    expect(button.textContent).toBe('T');
    vi.useRealTimers();
  });

  it('点击触发复制', () => {
    const onClick = vi.fn();
    const { button } = setup({ onClick });
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('单击不移动 → 不保存位置，照常复制', () => {
    const onClick = vi.fn();
    const onMoveEnd = vi.fn();
    const { button, handle } = setup({ onClick, onMoveEnd });

    handle.el.dispatchEvent(pointer('pointerdown', 500, 100));
    document.dispatchEvent(pointer('pointerup', 500, 100));
    button.click();

    expect(onMoveEnd).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('拖动后保存新位置，且不触发复制', () => {
    const onClick = vi.fn();
    const onMoveEnd = vi.fn();
    const { button, handle } = setup({ onClick, onMoveEnd });
    vi.spyOn(handle.el, 'getBoundingClientRect').mockReturnValue({
      right: 900,
      top: 50,
    } as DOMRect);

    handle.el.dispatchEvent(pointer('pointerdown', 500, 100));
    document.dispatchEvent(pointer('pointermove', 400, 160));
    document.dispatchEvent(pointer('pointerup', 400, 160));
    button.click();

    // 右距随鼠标向左移动而增加，上距随鼠标向下移动而增加。
    expect(onMoveEnd).toHaveBeenCalledWith({ right: 224, top: 110 });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('销毁后移除按钮，拖动监听不再存在', () => {
    const onMoveEnd = vi.fn();
    const { handle } = setup({ onMoveEnd });
    handle.el.dispatchEvent(pointer('pointerdown', 500, 100));
    handle.destroy();
    expect(handle.el.isConnected).toBe(false);
    document.dispatchEvent(pointer('pointerup', 400, 160));
    expect(onMoveEnd).not.toHaveBeenCalled();
  });
});
