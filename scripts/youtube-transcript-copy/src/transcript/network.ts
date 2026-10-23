import { extractFromPanelResponse } from './extract';
import type { Segment } from './types';

/**
 * 网络层：钩住 `fetch` 与 `XMLHttpRequest`，在 YouTube 自己请求转写面板时顺手把
 * 结果留下来。用户点“显示转写文稿”产生的响应一定能被这里捕获，不用重新请求。
 *
 * 只观察，不改写请求与响应；解析失败静默跳过，不影响页面。
 */

const PANEL_PATTERN = /youtubei\/v1\/get_panel/i;

interface HookGlobals {
  __ytTxNetHooked?: boolean;
  // 捕获到的片段存在 window 上：同一窗口装两次时第二个实例也能读到同一份。
  __ytTxNetSegments?: Segment[] | null;
}

/** `Window` 接口本身不含 XMLHttpRequest，`window` 的类型是它与全局对象的交叉。 */
type WindowScope = Window & typeof globalThis;

export interface NetworkCapture {
  /** 已捕获的片段；没有捕获返回 null。 */
  get: () => Segment[] | null;
  /** 清空捕获：SPA 换视频后旧的转写不能给新视频用。 */
  clear: () => void;
  /** 还原被替换的 fetch / open（测试与重复注入时用）。 */
  restore: () => void;
}

export function installNetworkCapture(win: WindowScope = window): NetworkCapture {
  const globals = win as unknown as HookGlobals;
  if (globals.__ytTxNetHooked) {
    // 同一窗口已经钩过一次：共用 window 上的缓存，避免包装两层，也避免新闭包拿不到旧数据。
    return {
      get: () => globals.__ytTxNetSegments ?? null,
      clear: () => {
        globals.__ytTxNetSegments = null;
      },
      restore: () => undefined,
    };
  }
  globals.__ytTxNetHooked = true;
  globals.__ytTxNetSegments = null;

  // bind 到 window：原生 fetch 依赖 this，直接引用会被 lint 视为“unbound method”。
  const originalFetch = win.fetch.bind(win);
  const wrappedFetch = (...args: Parameters<typeof fetch>): ReturnType<typeof fetch> => {
    const input = args[0];
    const url =
      typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.href
            : '';
    const request = originalFetch(...args);
    if (PANEL_PATTERN.test(url)) {
      void request
        .then(async (response) => {
          try {
            const data: unknown = await response.clone().json();
            globals.__ytTxNetSegments =
              extractFromPanelResponse(data) ?? globals.__ytTxNetSegments ?? null;
          } catch {
            // 响应不是 JSON 或已被消费：不影响页面。
          }
        })
        .catch(() => undefined);
    }
    return request;
  };
  win.fetch = wrappedFetch;

  const proto = win.XMLHttpRequest.prototype;
  // 必须保留原始方法的 this（XHR 实例），所以不能 bind 到原型；这一处规则需要逐行放行。
  // eslint-disable-next-line @typescript-eslint/unbound-method -- open 依赖调用时的 XHR 实例
  const originalOpen = proto.open;
  const wrappedOpen = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ): void {
    const target = typeof url === 'string' ? url : url.href;
    if (PANEL_PATTERN.test(target)) {
      this.addEventListener('load', () => {
        try {
          const data: unknown = JSON.parse(this.responseText);
          globals.__ytTxNetSegments =
            extractFromPanelResponse(data) ?? globals.__ytTxNetSegments ?? null;
        } catch {
          // 响应不是 JSON：忽略。
        }
      });
    }
    Reflect.apply(originalOpen, this, [method, url, ...rest]);
  };
  proto.open = wrappedOpen;

  return {
    get: () => globals.__ytTxNetSegments ?? null,
    clear() {
      globals.__ytTxNetSegments = null;
    },
    restore() {
      win.fetch = originalFetch;
      proto.open = originalOpen;
      globals.__ytTxNetHooked = false;
    },
  };
}
