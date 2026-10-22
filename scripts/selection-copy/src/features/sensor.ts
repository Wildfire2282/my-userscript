import { shouldCopyOnKeyUp, shouldCopyOnMouseUp, type Gesture } from '../gesture';
import { snapshotSelection } from '../selection';

/**
 * 选中动作的传感器：只收事件、记录手势快照、交给纯函数判断。
 *
 * 判断规则（拖动 / 双击 / Shift 扩选 / Ctrl+A）在 `gesture.ts`；这里只负责监听与清理，
 * 所以浏览器场景能验证真实输入是否被正确识别。
 */

export interface CopySensorOptions {
  /** 判定为一次“新的选择”后调用；参数是按下鼠标时的目标。 */
  onCopy: (target: EventTarget | null) => void;
  doc?: Document;
  win?: Window;
}

export function installCopySensor(options: CopySensorOptions): () => void {
  const doc = options.doc ?? document;
  const win = options.win ?? window;
  let gesture: Gesture | null = null;

  const onMouseDown = (event: MouseEvent): void => {
    // 只跟踪主键的、用户真实产生的按下；右键 / 中键和页面合成的 mousedown 一律忽略。
    if (!event.isTrusted || event.button !== 0) return;
    gesture = {
      startX: event.clientX,
      startY: event.clientY,
      target: event.target,
      selection: snapshotSelection(doc.getSelection()),
    };
  };

  const onMouseUp = (event: MouseEvent): void => {
    if (!event.isTrusted || event.button !== 0) return;
    // 没有配对的 mousedown（例如从 iframe 内拖出后在本帧释放）时不做判断。
    if (gesture === null) return;
    const current = gesture;
    gesture = null;
    if (!shouldCopyOnMouseUp(current, event, snapshotSelection(doc.getSelection()))) return;
    options.onCopy(current.target);
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (!shouldCopyOnKeyUp(event)) return;
    options.onCopy(null);
  };

  // capture 阶段会收到子树上任意元素的 mouseleave（mouseleave 不冒泡，但必然经过捕获），
  // 只有 target 是根节点时才真的离开了文档；否则拖动选区跨元素时会被提前清掉。
  const onMouseLeave = (event: MouseEvent): void => {
    if (event.target === doc || event.target === doc.documentElement || event.target === doc.body) {
      gesture = null;
    }
  };

  const reset = (): void => {
    gesture = null;
  };

  doc.addEventListener('mousedown', onMouseDown, true);
  doc.addEventListener('mouseup', onMouseUp, true);
  doc.addEventListener('keyup', onKeyUp, true);
  doc.addEventListener('mouseleave', onMouseLeave, true);
  // 指针离开窗口或窗口失焦后，按下的配对状态不再可信。
  win.addEventListener('blur', reset);

  return () => {
    doc.removeEventListener('mousedown', onMouseDown, true);
    doc.removeEventListener('mouseup', onMouseUp, true);
    doc.removeEventListener('keyup', onKeyUp, true);
    doc.removeEventListener('mouseleave', onMouseLeave, true);
    win.removeEventListener('blur', reset);
  };
}
