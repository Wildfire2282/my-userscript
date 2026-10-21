import type { Settings } from '../settings';
import {
  decideDrag,
  resolveDropAction,
  shouldOpenInForeground,
  type DragKind,
} from './drop-action';
import { isInputElement, realTarget } from './editable';
import { hitTest } from './hit-test';
import { getSelectionText, isPointInSelection } from './selection';

/**
 * 原生拖拽监听：一条 window 捕获监听覆盖整页。
 *
 * 浏览器自带的 dragstart/dragover/drop/dragend 都会冒泡，所以不需要像参考扩展那样给每个元素挂
 * 监听 + MutationObserver；没被脚本认领的拖拽一律不 preventDefault，交还给页面。
 */

export interface DragSensorDeps {
  getSettings: () => Settings;
  openUrl: (url: string, active: boolean) => void;
  openImage: (url: string, active: boolean) => void;
}

export interface DragSensor {
  destroy(): void;
}

type Phase = 'idle' | 'dragging';

// 拖拽结束后浏览器可能补发一次 click；只在这段时间内吞掉它，
// 否则用户事后点开关、按钮也会被误吞（原生补发的 click 紧跟在 dragend 后面）。
const CLICK_SWALLOW_MS = 400;

// 1×1 透明 GIF：用空图片顶掉浏览器自带的拖拽残影。
const GHOST_PIXEL_SRC =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export function installDragSensor(deps: DragSensorDeps): DragSensor {
  const controller = new AbortController();
  const { signal } = controller;
  const listenerOptions = { capture: true, signal } as const;

  let phase: Phase = 'idle';
  let kind: DragKind = 'text';
  let data = '';
  // 截止时间而不是布尔值：原生补发的 click 紧跟 dragend，拖拽很久之后的一次正常点击不该被吞。
  let swallowClickUntil = 0;
  let ghost: HTMLImageElement | null = null;

  const reset = () => {
    phase = 'idle';
    kind = 'text';
    data = '';
  };

  const ghostPixel = (): HTMLImageElement => {
    if (!ghost) {
      ghost = document.createElement('img');
      ghost.src = GHOST_PIXEL_SRC;
    }
    return ghost;
  };

  const claim = (transfer: DataTransfer, text: string): boolean => {
    try {
      // 不 setData 的话 Firefox 不会启动拖拽。
      transfer.setData('text/plain', text);
      return true;
    } catch {
      // 选区过大等情况：放弃接管，让原生拖拽继续
      return false;
    }
  };

  const handleDragStart = (event: DragEvent) => {
    if (phase !== 'idle' || deps.getSettings().enabled === false) return;
    // 多选、系统级手势留给浏览器；Shift 不拦，它表示“这一次前台打开”。
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // 输入框保留原生“移动文字”拖拽。
    if (isInputElement(event)) return;
    const transfer = event.dataTransfer;
    if (!transfer) return;

    // 先做廉价的选区存在性判断：sel.toString() 会复制整段文本，只在真有选区时才付这个代价。
    const selection = window.getSelection();
    const selected = selection && !selection.isCollapsed ? getSelectionText() : '';

    let payload: { kind: DragKind; data: string } | null;
    if (selected !== '' && isPointInSelection(event.clientX, event.clientY)) {
      // 按在选区里（即使压在链接上）也按文字处理，跳过命中测试，避免强制布局。
      payload = { kind: 'text', data: selected };
    } else {
      const target = realTarget(event);
      const hit = hitTest(event.clientX, event.clientY, target instanceof Element ? target : null);
      payload = decideDrag({
        link: hit.link,
        image: hit.image,
        selection: selected,
        selectionHit: false,
      });
    }

    if (!payload || !claim(transfer, payload.data)) return;

    try {
      transfer.effectAllowed = 'copy';
      transfer.setDragImage(ghostPixel(), 0, 0);
    } catch {
      // setDragImage 不支持时保留原生残影
    }
    phase = 'dragging';
    kind = payload.kind;
    data = payload.data;
  };

  const handleDragOver = (event: DragEvent) => {
    if (phase !== 'dragging') return; // 不是脚本发起的拖拽（例如拖入文件）
    event.preventDefault();
    event.stopPropagation();
    try {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    } catch {
      // 某些引擎的 dataTransfer 只读，忽略
    }
  };

  const handleDrop = (event: DragEvent) => {
    if (phase !== 'dragging') return;
    // 拖进输入框是页面的原生粘贴，不接管。
    if (isInputElement(event)) {
      reset();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    swallowClickUntil = performance.now() + CLICK_SWALLOW_MS;

    const settings = deps.getSettings();
    const foreground = shouldOpenInForeground(kind, event.shiftKey === true, settings.linkOpenMode);
    const action = resolveDropAction(kind, data, settings);
    try {
      if (action?.kind === 'image') deps.openImage(action.url, foreground);
      else if (action) deps.openUrl(action.url, foreground);
    } finally {
      // 打开失败也必须复位，否则这一页后续拖拽全部失效。
      reset();
    }
  };

  const handleDragEnd = () => {
    // drop 之后和取消（Esc / 拖到窗口外）都会触发；前者已复位，这里只处理取消。
    if (phase !== 'idle') reset();
  };

  const handleClickCapture = (event: MouseEvent) => {
    if (swallowClickUntil !== 0 && performance.now() <= swallowClickUntil) {
      swallowClickUntil = 0;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    // 过期标记只清掉，不影响这次点击。
    swallowClickUntil = 0;
    // 兜底：任何情况下都不留下过期的拖拽状态。
    if (phase !== 'idle') reset();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && phase !== 'idle') reset();
  };

  // 新的按下动作说明是另一次交互：浏览器补发的 click 不可能再出现了，清掉标记。
  const handlePressStart = () => {
    swallowClickUntil = 0;
  };

  window.addEventListener('dragstart', handleDragStart, listenerOptions);
  window.addEventListener('dragover', handleDragOver, listenerOptions);
  window.addEventListener('drop', handleDrop, listenerOptions);
  window.addEventListener('dragend', handleDragEnd, listenerOptions);
  window.addEventListener('blur', reset, { signal });
  document.addEventListener('click', handleClickCapture, listenerOptions);
  document.addEventListener('keydown', handleKeyDown, listenerOptions);
  document.addEventListener('mousedown', handlePressStart, listenerOptions);

  return {
    destroy() {
      controller.abort();
      ghost = null;
      reset();
      swallowClickUntil = 0;
    },
  };
}
