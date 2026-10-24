import { mountUI, type UI } from '@ui';
import { createDragCursor, type DragCursorHandle } from './drag-cursor';
import type { Point } from './cursor-position';

/**
 * 页面级界面宿主：拖拽图标与设置面板共用一个 `@ui` Shadow Root。
 *
 * 第一次真的需要界面时才挂载：不拖拽、不开设置时页面里没有任何节点和样式。
 * 挂载发生在第一次拖拽的 dragstart 里，之后整个页面复用同一个宿主。
 */

const LABELS = {
  close: '关闭',
  settings: '设置',
  notifications: '通知',
  dismissNotification: '关闭通知',
  closeSettings: '关闭设置',
  scrollHint: '向下滚动查看更多内容',
  cancel: '取消',
  confirm: '确定',
};

export interface DragFeedback {
  /** 拖拽中指针移动；没有界面时按需挂载，并让图标显形。 */
  move: (point: Point) => void;
  /** 拖拽结束或取消；不创建界面。 */
  hide: () => void;
}

export interface DragUiHost extends DragFeedback {
  /** 取（必要时创建）共享的 UI；设置面板与拖拽图标都挂在这里。 */
  ensure: () => UI;
}

export function createDragUiHost(): DragUiHost {
  let ui: UI | null = null;
  let cursor: DragCursorHandle | null = null;

  const ensure = (): UI => {
    if (!ui) ui = mountUI({ theme: 'system', labels: LABELS });
    return ui;
  };

  return {
    ensure,
    move(point) {
      try {
        if (!cursor) cursor = createDragCursor(ensure());
        cursor.move(point);
      } catch (error) {
        // 图标挂不上只影响反馈，拖拽本身照常完成，不能把异常抛回页面。
        console.error('[super-drag] 拖拽图标显示失败', error);
      }
    },
    hide() {
      cursor?.hide();
    },
  };
}
