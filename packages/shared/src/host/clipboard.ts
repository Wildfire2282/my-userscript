/**
 * 剪贴板写入。
 *
 * 三个通道按可靠性排序：
 *
 * 1. `GM_setClipboard`：不受安全上下文、iframe 权限策略与焦点限制，脚本管理器直接写入；
 * 2. `navigator.clipboard`：没有管理器时用浏览器 API，需要安全上下文与用户手势；
 * 3. 隐藏 textarea + `execCommand('copy')`：老浏览器与受限 iframe 的最后兜底。
 *
 * 全部失败返回 `false`，提示文案由调用方决定；这里不抛错，避免一次复制失败打断页面。
 */

import { deepActiveElement } from '../dom/editable';

/** 页面里可能存在的管理器剪贴板函数；缺失时跳过该通道。 */
interface ClipboardGlobals {
  GM_setClipboard?: (text: string, info?: string) => unknown;
}

/** 剪贴板通道与陈旧兜底需要的浏览器对象；测试里可以整体替换。 */
interface ClipboardScope extends ClipboardGlobals {
  clipboard?: { writeText?: (text: string) => Promise<void> };
  document?: Document;
}

export interface Clipboard {
  copy: (text: string) => Promise<boolean>;
}

function defaultScope(): ClipboardScope {
  const globals = globalThis as unknown as ClipboardGlobals;
  const browser = globalThis as unknown as {
    navigator?: { clipboard?: { writeText?: (text: string) => Promise<void> } };
    document?: Document;
  };
  // 用 getter 而不是固定值：浏览器通道可能被页面或测试在脚本启动后替换，
  // 每次写入都读当前状态，降级顺序才与调用时刻的真实能力一致。
  return {
    get GM_setClipboard() {
      return typeof globals.GM_setClipboard === 'function'
        ? globals.GM_setClipboard.bind(globals)
        : undefined;
    },
    get clipboard() {
      return browser.navigator?.clipboard;
    },
    get document() {
      return browser.document;
    },
  };
}

/** textarea 兜底：必须在用户手势的同一个任务里同步执行，跨 await 会失去写权限。 */
function copyWithTextarea(document: Document | undefined, text: string): boolean {
  if (!document?.body) return false;
  const active = deepActiveElement(document) as HTMLElement | null;
  const control =
    active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA'
      ? (active as HTMLInputElement | HTMLTextAreaElement)
      : null;
  const controlStart = control?.selectionStart;
  const controlEnd = control?.selectionEnd;
  const controlDirection = control?.selectionDirection;
  const selection = document.getSelection();
  const anchor = selection?.anchorNode;
  const focus = selection?.focusNode;
  const anchorOffset = selection?.anchorOffset ?? 0;
  const focusOffset = selection?.focusOffset ?? 0;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(area);
  try {
    // select() 不保证移动焦点；焦点若留在原控件，execCommand 复制的会是那里。
    area.focus();
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    // 恢复步骤互不连坐：任何一步失败都不能把已经写入的复制结果改报成失败。
    try {
      // 兜底输入框会抢走焦点，复制完把焦点还给用户原来所在的位置。
      active?.focus?.();
    } catch {
      // 原控件已脱离文档：无法恢复焦点。
    }
    try {
      // select() 同时清空网页选区；连同选区方向恢复，避免后续 Shift 扩选反向。
      if (anchor?.isConnected && focus?.isConnected)
        selection?.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
    } catch {
      // 选区节点在写入期间被页面改掉：无法恢复网页选区。
    }
    try {
      if (controlStart != null && controlEnd != null)
        control?.setSelectionRange(controlStart, controlEnd, controlDirection ?? undefined);
    } catch {
      // 控件已脱离文档或不再支持选区：无法恢复控件选区。
    }
  }
}

/**
 * 创建剪贴板写入器。
 *
 * @param scope 通常是 `globalThis`；测试里传假对象即可验证各通道的降级顺序
 */
export function createClipboard(scope: ClipboardScope = defaultScope()): Clipboard {
  return {
    async copy(text: string): Promise<boolean> {
      if (text === '') return true;

      try {
        if (typeof scope.GM_setClipboard === 'function') {
          await scope.GM_setClipboard(text, 'text');
          return true;
        }
      } catch {
        // 管理器拒绝时继续试浏览器通道。
      }

      try {
        if (typeof scope.clipboard?.writeText === 'function') {
          await scope.clipboard.writeText(text);
          return true;
        }
      } catch {
        // 没有安全上下文或用户手势时继续试兜底。
      }

      return copyWithTextarea(scope.document, text);
    },
  };
}
