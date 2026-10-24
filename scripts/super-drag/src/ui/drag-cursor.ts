import type { UI } from '@ui';
import { cursorMarkPosition, type Point } from './cursor-position';
import dragCursorCss from './drag-cursor.css?inline';

/**
 * 拖拽反馈图标：指针左上方的一个链接标记，随拖拽移动。
 *
 * 位置用 transform 写入而不是 left/top：拖拽期间每帧都要更新，
 * transform 只走合成，不会触发布局。
 */

const ICON = '\u{1F517}';

export interface DragCursorHandle {
  move: (point: Point) => void;
  hide: () => void;
}

export function createDragCursor(ui: UI): DragCursorHandle {
  ui.useStyles(dragCursorCss);

  const mark = document.createElement('div');
  mark.className = 'drag-cursor-mark';
  // 拖拽反馈是纯视觉信息，读屏用户靠拖拽结果（打开页面 / 搜索）感知。
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = ICON;
  ui.layers.base.appendChild(mark);

  return {
    move(point) {
      const at = cursorMarkPosition(point, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      mark.style.transform = `translate(${at.x}px, ${at.y}px)`;
      mark.dataset.visible = 'true';
    },
    hide() {
      mark.dataset.visible = 'false';
    },
  };
}
