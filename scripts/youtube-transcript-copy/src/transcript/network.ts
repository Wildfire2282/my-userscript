import { extractFromJson3, extractFromPanelResponse } from './extract';
import type { Segment } from './types';

/**
 * 网络层：钩住 `fetch` 与 `XMLHttpRequest`，在 YouTube 自己请求转写面板时顺手把
 * 结果留下来。用户点“显示转写文稿”产生的响应一定能被这里捕获，不用重新请求。
 *
 * 只观察，不改写请求与响应；解析失败静默跳过，不影响页面。
 */

/**
 * 需要旁听的地址：
 *
 * - `get_panel` / `get_transcript`：转写面板的接口，不同年代的名字；
 * - `/api/timedtext`：播放器自己拉字幕的地址。2026 起不带 `pot` 的裸字幕地址
 *   会返回空响应，只有播放器请求里的完整地址（含 `pot`）能拿到内容，所以顺带缓存它。
 */
const CAPTURE_PATTERN = /(?:youtubei\/v1\/(?:get_panel|get_transcript)|\/api\/timedtext)/i;
const TIMEDTEXT_PATTERN = /\/api\/timedtext/i;

/** 按地址选择解析方式；解析不出来返回 null。 */
export function parseCapturedResponse(url: string, data: unknown): Segment[] | null {
  return TIMEDTEXT_PATTERN.test(url) ? extractFromJson3(data) : extractFromPanelResponse(data);
}

/** 抓到的内容连同它的来源，用于判断能不能给当前视频用。 */
export interface NetworkCaptureState {
  videoId: string;
  /** 来自转写面板接口：比播放器自己拉的字幕更完整，不该被后者覆盖。 */
  fromPanel: boolean;
  segments: Segment[];
}

/** 地址里能读到的信息：`v=` 是视频 ID，`tlang` 表示这是翻译字幕。 */
function readCapturedUrl(url: string): { videoId: string; translated: boolean } {
  try {
    const parsed = new URL(url, 'https://www.youtube.com');
    return {
      videoId: parsed.searchParams.get('v') ?? '',
      translated: parsed.searchParams.get('tlang') !== null,
    };
  } catch {
    return { videoId: '', translated: false };
  }
}

/**
 * 当前视频 ID：先读 `?v=`，再认 `/shorts/…`、`/embed/…`、`/live/…` 的路径。
 *
 * 只读 `?v=` 时这三种页面得到空串，网络捕获与 API 兜底会全部失效。
 *
 * @param search 地址栏查询串，如 `location.search`
 * @param pathname 地址栏路径，如 `location.pathname`
 */
export function readVideoId(search: string, pathname: string): string {
  const fromQuery = (new URLSearchParams(search).get('v') ?? '').trim();
  if (fromQuery !== '') return fromQuery;
  return (/^\/(?:shorts|embed|live)\/([^/?#]+)/.exec(pathname)?.[1] ?? '').trim();
}

/**
 * 决定这次抓到的内容要不要留下。
 *
 * 页面同一时刻只留一份：播放器会为别的视频（下一个视频、迷你播放器）和翻译字幕
 * 也发同样的请求，谁的响应后到就覆盖谁的做法会让人复制到别的内容。
 *
 * @param state 已缓存的内容
 * @param currentVideoId 当前地址栏里的视频
 * @param url 这次响应的地址
 * @param segments 这次解析出的片段；null 表示这份响应没有文稿
 * @returns 新的缓存内容；`null` 表示丢掉这次响应
 */
export function nextCapture(
  state: NetworkCaptureState | null,
  currentVideoId: string,
  url: string,
  segments: Segment[] | null,
): NetworkCaptureState | null {
  if (!segments || segments.length === 0 || currentVideoId === '') return null;
  const { videoId, translated } = readCapturedUrl(url);
  const fromPanel = !TIMEDTEXT_PATTERN.test(url);
  // 别的视频的响应：未来的自己不会想要，现在的自己也不能用。
  if (videoId !== '' && videoId !== currentVideoId) return null;
  // 翻译字幕只是同一篇文稿的另一种语言，不是视频原本的文稿。
  if (!fromPanel && translated) return null;
  // 面板数据更完整，别让播放器的字幕把它换成半份。
  if (state?.fromPanel && !fromPanel) return null;
  return { videoId: currentVideoId, fromPanel, segments };
}

interface HookGlobals {
  __ytTxNetHooked?: boolean;
  // 捕获到的内容存在 window 上：同一窗口装两次时第二个实例也能读到同一份。
  __ytTxNetSegments?: NetworkCaptureState | null;
}

/** `Window` 接口本身不含 XMLHttpRequest，`window` 的类型是它与全局对象的交叉。 */
type WindowScope = Window & typeof globalThis;

export interface NetworkCaptureOptions {
  /** 当前视频 ID；用来丢掉其它视频的响应。默认读地址栏的 `v=`。 */
  currentVideoId?: () => string;
}

export interface NetworkCapture {
  /** 当前视频已捕获的片段；没有捕获或是别的视频的响应时返回 null。 */
  get: () => Segment[] | null;
  /** 清空捕获：SPA 换视频后旧的转写不能给新视频用。 */
  clear: () => void;
  /** 还原被替换的 fetch / open（测试与重复注入时用）。 */
  restore: () => void;
}

export function installNetworkCapture(
  win: WindowScope = window,
  options: NetworkCaptureOptions = {},
): NetworkCapture {
  const globals = win as unknown as HookGlobals;
  const currentVideoId =
    options.currentVideoId ?? (() => readVideoId(win.location.search, win.location.pathname));

  const read = (): Segment[] | null => {
    const state = globals.__ytTxNetSegments ?? null;
    return state !== null && state.videoId === currentVideoId() ? state.segments : null;
  };

  const accept = (url: string, data: unknown): void => {
    const next = nextCapture(
      globals.__ytTxNetSegments ?? null,
      currentVideoId(),
      url,
      parseCapturedResponse(url, data),
    );
    if (next) globals.__ytTxNetSegments = next;
  };

  if (globals.__ytTxNetHooked) {
    // 同一窗口已经钩过一次：共用 window 上的缓存，避免包装两层，也避免新闭包拿不到旧数据。
    return {
      get: read,
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
    if (CAPTURE_PATTERN.test(url)) {
      void request
        .then(async (response) => {
          try {
            accept(url, await response.clone().json());
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
    if (CAPTURE_PATTERN.test(target)) {
      this.addEventListener('load', () => {
        try {
          const data: unknown =
            this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
          accept(target, data);
        } catch {
          // 响应不是 JSON：忽略。
        }
      });
    }
    Reflect.apply(originalOpen, this, [method, url, ...rest]);
  };
  proto.open = wrappedOpen;

  return {
    get: read,
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
