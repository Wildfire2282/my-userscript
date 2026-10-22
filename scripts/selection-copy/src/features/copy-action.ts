import type { Clipboard } from '@shared';
import { getActiveTextControl, isDisabledTarget, readSelectionText } from '../selection';
import { getAnchorRect, type AnchorBox } from './geometry';

/**
 * 复制动作：读选区 → 过门控 → 写剪贴板 → 点亮标记。
 *
 * 写入是异步的，完成顺序可能与发起顺序相反；只让最新一次请求点亮标记，
 * 否则更旧的那次会把提示挪到旧位置，看起来像同时出现了多个提示。
 */

export interface CopyActionOptions {
  clipboard: Clipboard;
  showIndicator: (rect: AnchorBox | null) => void;
  doc?: Document;
}

export function createCopyAction(
  options: CopyActionOptions,
): (target?: EventTarget | null) => Promise<void> {
  const doc = options.doc ?? document;
  let requestId = 0;

  return async (target = null) => {
    const selection = doc.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const text = readSelectionText(selection);
    if (text === '' || isDisabledTarget(selection, target, getActiveTextControl())) return;

    // 与写入无关的几何信息先取，await 期间页面可能改动选区。
    const anchorRect = getAnchorRect(selection);
    const current = ++requestId;
    const written = await options.clipboard.copy(text);
    if (written && current === requestId) options.showIndicator(anchorRect);
  };
}
