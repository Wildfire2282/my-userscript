/**
 * 悬浮按钮的位置。
 *
 * 位置用“距视口右边 / 上边多少像素”表示，和线上旧键 `pos` 的存储格式一致：
 * 换分辨率或改窗口大小时只需要重新夹紧，不需要知道页面布局。
 */

export interface ButtonPosition {
  right: number;
  top: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

/** 按钮用的是 `@ui` 的 `size: 'lg'` 图标按钮，等于 `--ds-control-h-lg`；夹紧时按它留边。 */
export const BUTTON_SIZE = 36;

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/** 把位置收回视口内；视口比按钮还小时贴住左上角。 */
export function clampPosition(
  position: ButtonPosition,
  viewport: ViewportSize,
  size: number = BUTTON_SIZE,
): ButtonPosition {
  return {
    right: clamp(position.right, 0, viewport.width - size),
    top: clamp(position.top, 0, viewport.height - size),
  };
}

/**
 * 播放器右上角偏移 30px 的默认位置。
 *
 * @param playerRect 播放器矩形；没有播放器或不可见时返回 null
 * @param viewport 视口尺寸
 */
export function defaultButtonPosition(
  playerRect: { right: number; top: number } | null,
  viewport: ViewportSize,
): ButtonPosition | null {
  if (!playerRect) return null;
  return clampPosition(
    { right: viewport.width - playerRect.right + 30, top: playerRect.top + 30 },
    viewport,
  );
}

/** 找到播放器并返回它的矩形；播放器不可见时返回 null。 */
export function readPlayerRect(doc: Document = document): DOMRect | null {
  const player = doc.querySelector('#movie_player, #player');
  if (!player) return null;
  const rect = player.getBoundingClientRect();
  return rect.width > 0 ? rect : null;
}
