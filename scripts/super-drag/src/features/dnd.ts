import type { Settings } from '../settings';
import {
  decideDrag,
  resolveDropAction,
  shouldOpenInForeground,
  type DragKind,
} from './drop-action';
import { isDraggableHost, isInputElement, realTarget } from './editable';
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
  /** 拖拽图标；不传时不显示任何反馈（单测只关心接管判断）。 */
  feedback?: DragFeedback;
}

export interface DragSensor {
  destroy(): void;
}

/** 拖拽期间的指针反馈；坐标是视口坐标。 */
export interface DragFeedback {
  move: (point: { x: number; y: number }) => void;
  hide: () => void;
}

// 拖拽结束后浏览器可能补发一次 click；只在这段时间内吞掉它，
// 否则用户事后点开关、按钮也会被误吞（原生补发的 click 紧跟在 dragend 后面）。
const CLICK_SWALLOW_MS = 400;

/** 事件发生处最里层的元素；Shadow DOM 内的拖拽要拿到内部节点而不是宿主。 */
function targetOf(event: Event): Element | null {
  const target = realTarget(event);
  return target instanceof Element ? target : null;
}

export function installDragSensor(deps: DragSensorDeps): DragSensor {
  const controller = new AbortController();
  const { signal } = controller;
  const listenerOptions = { capture: true, signal } as const;

  // 页面可在后续传播中取消 dragstart，且浏览器不会再发 dragend。
  let dragStart: DragEvent | null = null;
  let kind: DragKind = 'text';
  let data = '';
  // 截止时间而不是布尔值：原生补发的 click 紧跟 dragend，拖拽很久之后的一次正常点击不该被吞。
  let swallowClickUntil = 0;
  // 浏览器补发的 click 落在拖拽起点上；只有这一次该吞，用户点别处是真实操作。
  let dragSource: Element | null = null;
  // 顶掉浏览器自带的拖拽残影（文字 / 元素的低分辨率缩略图）。
  // Chromium 只对“已渲染”的元素做快照：游离的图片或未布局的节点会被忽略，
  // 于是回退到原生缩略图，鼠标旁边就一直是那张模糊的图。
  const ghost = document.createElement('div');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;margin:0;padding:0;border:0;' +
    'opacity:0;pointer-events:none;contain:strict;';

  const reset = () => {
    dragStart = null;
    kind = 'text';
    data = '';
    // 快照只在拖拽期间需要：结束后不再给页面留任何节点。
    if (ghost.isConnected) ghost.remove();
    deps.feedback?.hide();
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

  /** 事件发生处的链接 / 图片。 */
  const hitTestAt = (event: DragEvent) => {
    const target = realTarget(event);
    return hitTest(event.clientX, event.clientY, target instanceof Element ? target : null);
  };

  const handleDragStart = (event: DragEvent) => {
    reset();
    if (event.defaultPrevented) return;
    // 多选、系统级手势留给浏览器；Shift 不拦，它表示“这一次前台打开”。
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // 输入框保留原生“移动文字”拖拽。
    if (isInputElement(event)) return;
    const transfer = event.dataTransfer;
    if (!transfer) return;

    const settings = deps.getSettings();

    // isCollapsed 在 Shadow DOM 的人手选区里恒为 true。
    const selected = getSelectionText();

    // 按在选区里就按文字处理（即使压在链接上），并跳过命中测试：省一次强制布局。
    // “选区优先”只在 decideDrag 里判断一次，这里只提供结果。
    const selectionHit =
      selected !== '' && isPointInSelection(event.clientX, event.clientY, event.composedPath());

    // 页面用 draggable="true" 自己实现的拖拽（卡片排序、上传区）留给页面：
    // 页面上任意一段文字选区都会让后文的文字兜底抢走它。按在选区里时例外，
    // 那是用户明确要拖的文字。
    if (!selectionHit && isDraggableHost(targetOf(event))) return;

    const hit = selectionHit ? { link: '', image: '' } : hitTestAt(event);
    const payload = decideDrag(
      {
        link: hit.link,
        image: hit.image,
        selection: selected,
        selectionHit,
      },
      settings.dragKinds,
    );

    if (!payload || !claim(transfer, payload.data)) return;

    try {
      transfer.effectAllowed = 'copy';
      // 必须先挂进文档并触发一次布局，浏览器才会把它当成可快照的元素。
      if (!ghost.isConnected) document.documentElement.appendChild(ghost);
      ghost.getBoundingClientRect();
      transfer.setDragImage(ghost, 0, 0);
    } catch {
      // setDragImage 不支持时保留原生残影
    }
    dragStart = event;
    kind = payload.kind;
    data = payload.data;
    dragSource = targetOf(event);
    deps.feedback?.move({ x: event.clientX, y: event.clientY });
  };

  const isActiveDrag = (event: DragEvent): boolean => {
    if (!dragStart) return false;
    // 外来文件拖入没有本页的 dragstart，不能沿用尚未收到 dragend 的旧载荷。
    if (dragStart.defaultPrevented || event.dataTransfer?.types.includes('Files')) {
      reset();
      return false;
    }
    return true;
  };

  const handleDragOver = (event: DragEvent) => {
    if (!isActiveDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    // 拖拽期间没有 mousemove，dragover 是唯一能拿到指针位置的事件。
    deps.feedback?.move({ x: event.clientX, y: event.clientY });
    try {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    } catch {
      // 某些引擎的 dataTransfer 只读，忽略
    }
  };

  const handleDrop = (event: DragEvent) => {
    if (!isActiveDrag(event)) return;
    // 拖进输入框是页面的原生粘贴，不接管。保持脚本写入的载荷与原生拖拽一致：
    // 拖链接/图片时原生粘贴的也是地址，拖文字时就是选中的文字。
    if (isInputElement(event)) {
      reset();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    swallowClickUntil = performance.now() + CLICK_SWALLOW_MS;

    const settings = deps.getSettings();
    const foreground = shouldOpenInForeground(event.shiftKey === true, settings.linkOpenMode);
    const action = resolveDropAction(kind, data, settings);
    try {
      if (action?.kind === 'image') {
        if (settings.imageAction === 'original') deps.openUrl(action.url, foreground);
        else deps.openImage(action.url, foreground);
      } else if (action) {
        deps.openUrl(action.url, foreground);
      }
    } finally {
      // 打开失败也必须复位，否则这一页后续拖拽全部失效。
      reset();
    }
  };

  const handleDragEnd = () => {
    // drop 之后和取消（Esc / 拖到窗口外）都会触发；前者已复位，这里只处理取消。
    reset();
  };

  const handleClickCapture = (event: MouseEvent) => {
    if (swallowClickUntil !== 0 && performance.now() <= swallowClickUntil) {
      const fromDragSource = dragSource !== null && event.composedPath().includes(dragSource);
      if (fromDragSource) {
        swallowClickUntil = 0;
        dragSource = null;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
    }
    // 过期标记与不属于拖拽起点的点击都只清标记，不影响这次点击。
    swallowClickUntil = 0;
    dragSource = null;
    // 兜底：任何情况下都不留下过期的拖拽状态。
    reset();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') reset();
  };

  // 新的按下动作说明是另一次交互：浏览器补发的 click 不可能再出现了，清掉标记。
  // 同时清掉可能残留的「正在拖拽」：拖到外部应用或 DevTools 时浏览器不发 dragend，
  // 状态卡在 dragging 会让之后任何原生拖放都被拦截、并按旧数据打开页面。
  const handlePressStart = () => {
    swallowClickUntil = 0;
    dragSource = null;
    reset();
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
      reset();
      swallowClickUntil = 0;
    },
  };
}
