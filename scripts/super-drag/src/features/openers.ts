/**
 * 打开新标签页：链接直接打开；图片包一层深色查看器；后台打开时把焦点还给当前页。
 *
 * GM_openInTab 优先（脚本管理器能正确处理后台标签页），没有时退回 window.open。
 * 查看器 blob 只在 5 分钟后回收：提前回收会让刚打开、还没加载完的标签页变成空白页。
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
    open: window.open.bind(window),
    focus: () => window.focus(),
  };
}

export function createOpeners(scope: OpenScope = defaultScope()): Openers {
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
    let url: string;
    try {
      url = URL.createObjectURL(new Blob([buildImageViewerHtml(imageUrl)], { type: 'text/html' }));
    } catch {
      // 环境不允许建 blob（部分管理器的隔离环境）：退回直接打开原图。
      openUrl(imageUrl, active);
      return;
    }
    setTimeout(() => URL.revokeObjectURL(url), BLOB_REVOKE_DELAY_MS);
    openUrl(url, active);
  };

  return { openUrl, openImage };
}
