import type { Clipboard } from '@shared';
import type { CopyFeedback } from '../feedback';
import { isEnabledOn, type Settings } from '../settings';
import {
  getActiveTextControl,
  isDisabledTarget,
  readSelectionText,
  readTextControlText,
  selectedTextControl,
} from '../selection';
import { getAnchorRect, getControlAnchorRect, type AnchorBox } from './geometry';

/**
 * 复制动作：找来源 → 过门控 → 写剪贴板 → 点亮标记。
 *
 * 写入是异步的，完成顺序可能与发起顺序相反；只让最新一次请求显示反馈并
 * 拦住旧写入的结果，旧写入后完成时不再上报成功——此时剪贴板里若还有旧文字，
 * 那也是写入器自己的行为，而不是脚本又写了一次。
 */

/** 复制动作需要的设置子集；测试里不必构造完整设置。 */
export type CopyBehavior = Pick<Settings, 'copyInInputs' | 'copyInEditors' | 'trimWhitespace'>;

/** 一次复制的内容与反馈位置。 */
export interface CopySource {
  text: string;
  rect: AnchorBox | null;
}

/**
 * 决定这次手势复制什么。
 *
 * @param target 手势目标；键盘触发时为 null
 * @param settings 复制范围与首尾空白设置
 * @param doc 目标文档
 * @returns 要写入的文字与反馈锚点；这次不该复制时返回 null
 */
export function resolveCopySource(
  target: EventTarget | null,
  settings: CopyBehavior,
  doc: Document,
): CopySource | null {
  const control = selectedTextControl(target);
  if (control) {
    // 文本框里的选区不在 Document 选区里，必须从控件自身读取。
    if (!settings.copyInInputs) return null;
    const text = readTextControlText(control, settings.trimWhitespace);
    if (text === '') return null;
    return { text, rect: getControlAnchorRect(control) };
  }

  const selection = doc.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  if (isDisabledTarget(selection, target, getActiveTextControl(), settings)) return null;

  const text = readSelectionText(selection, settings.trimWhitespace);
  if (text === '') return null;
  return { text, rect: getAnchorRect(selection) };
}

export interface CopyActionOptions {
  clipboard: Clipboard;
  getSettings: () => Settings;
  /** 当前 frame 所属的顶层站点，用于总开关与“本站暂停”。 */
  site: string;
  showFeedback: (feedback: CopyFeedback) => void;
  doc?: Document;
}

/** 一次手势的处理结果；`skipped` 表示门控主动放弃，不产生任何界面变化。 */
export type CopyOutcome = 'copied' | 'failed' | 'skipped';

export function createCopyAction(
  options: CopyActionOptions,
): (target?: EventTarget | null) => Promise<CopyOutcome> {
  const doc = options.doc ?? document;
  let requestId = 0;

  return async (target = null) => {
    const settings = options.getSettings();
    // 开关检查放在读选区之前：关掉后连文字都不碰，也不会创建提示界面。
    if (!isEnabledOn(settings, options.site)) return 'skipped';

    const source = resolveCopySource(target, settings, doc);
    if (!source) return 'skipped';

    const current = ++requestId;
    let written = false;
    try {
      // 先判“还是不是最新一次”：旧写入即使后完成，也不再覆盖反馈，
      // 返回值同样按过期处理，调用方不会把旧文字当成这次的结果。
      const latest = await options.clipboard.copy(source.text);
      if (current !== requestId) return 'skipped';
      written = latest;
    } catch {
      // 写入器按约定不抛错；自定义实现抛错时仍要给用户一个明确结果。
      if (current !== requestId) return 'skipped';
    }
    options.showFeedback({ variant: written ? 'success' : 'failure', rect: source.rect });
    return written ? 'copied' : 'failed';
  };
}
