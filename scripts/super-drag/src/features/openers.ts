/**
 * 打开新标签页：链接直接打开；图片包一层深色查看器；后台打开时把焦点还给当前页。
 *
 * GM_openInTab 优先（脚本管理器能正确处理后台标签页），没有时退回 window.open。
 */

const BLOB_REVOKE_DELAY_MS = 5 * 60 * 1000;

const VIEWER_CSS =
  '*{margin:0;padding:0}' +
  'body{display:flex;align-items:center;justify-content:center;min-height:100vh;background:#000}' +
  'img{max-width:100%;max-height:100vh;object-fit:contain}';

interface OpenScope {
  GM_openInTab?: (url: string, options: { active: boolean; insert: boolean }) => unknown;
  open?: (url?: string, target?: string, features?: string) => Window | null;
  focus?: () => void;
}

export interface Openers {
  openUrl: (url: string, active: boolean) => void;
  openImage: (url: string, active: boolean) => void;
  /** 清掉还没触发的回收定时器，并立即释放查看器 blob。 */
  release: () => void;
}

/**
 * 生成图片查看器页面。
 *
 * 用 `createHTMLDocument` 建 DOM 再序列化，而不是拼 HTML 字符串：图片地址里的引号、
 * `&`、`<` 由浏览器负责转义，不会把地址拼成标签。
 */
export function buildImageViewerHtml(imageUrl: string): string {
  const doc = document.implementation.createHTMLDocument('Image');

  const meta = doc.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  doc.head.prepend(meta);

  const style = doc.createElement('style');
  style.textContent = VIEWER_CSS;
  doc.head.appendChild(style);

  const img = doc.createElement('img');
  img.setAttribute('src', imageUrl);
  img.setAttribute('alt', 'image');
  doc.body.appendChild(img);

  return `<!DOCTYPE html>${new XMLSerializer().serializeToString(doc.documentElement)}`;
}

function defaultScope(): OpenScope {
  const globals = globalThis as unknown as OpenScope;
  return {
    GM_openInTab:
      typeof globals.GM_openInTab === 'function' ? globals.GM_openInTab.bind(globals) : undefined,
    open: typeof window !== 'undefined' ? window.open.bind(window) : undefined,
    focus: typeof window !== 'undefined' ? () => window.focus() : undefined,
  };
}

export function createOpeners(scope: OpenScope = defaultScope()): Openers {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const blobUrls = new Set<string>();

  const revoke = (url: string) => {
    blobUrls.delete(url);
    URL.revokeObjectURL(url);
  };

  // 后台标签页可能几秒后才真正加载 blob，所以延后回收。
  const scheduleRevoke = (url: string) => {
    blobUrls.add(url);
    const timer = setTimeout(() => {
      timers.delete(timer);
      revoke(url);
    }, BLOB_REVOKE_DELAY_MS);
    timers.add(timer);
  };

  const openUrl = (url: string, active: boolean) => {
    if (typeof scope.GM_openInTab === 'function') {
      try {
        scope.GM_openInTab(url, { active, insert: true });
        return;
      } catch {
        // 管理器拒绝时退回 window.open
      }
    }
    const win = scope.open?.(url, '_blank', 'noopener') ?? null;
    if (win && !active) {
      try {
        win.blur();
      } catch {
        // 忽略：某些浏览器禁止脚本移焦
      }
      scope.focus?.();
    }
  };

  const openImage = (imageUrl: string, active: boolean) => {
    // 页面自己生成的 blob:/data: 图片重新包一层会失效，直接打开原地址。
    if (/^(blob:|data:)/i.test(imageUrl)) {
      openUrl(imageUrl, active);
      return;
    }
    const html = buildImageViewerHtml(imageUrl);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    scheduleRevoke(url);
    openUrl(url, active);
  };

  return {
    openUrl,
    openImage,
    release() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const url of [...blobUrls]) revoke(url);
    },
  };
}
