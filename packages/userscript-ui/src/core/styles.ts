const seenByRoot = new WeakMap<ShadowRoot, Set<string>>();
const sheetCache = new Map<string, CSSStyleSheet>();

export function useStyles(root: ShadowRoot, css: string): void {
  let seen = seenByRoot.get(root);
  if (!seen) {
    seen = new Set();
    seenByRoot.set(root, seen);
  }
  if (seen.has(css)) return;
  seen.add(css);

  if (canAdopt(root)) {
    try {
      let sheet = sheetCache.get(css);
      if (!sheet) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        sheetCache.set(css, sheet);
      }
      if (!root.adoptedStyleSheets.includes(sheet)) {
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      }
      return;
    } catch {
      // Fall through to a style element on engines with partial support.
    }
  }

  const style = document.createElement('style');
  style.setAttribute('data-ds-style', '');
  style.textContent = css;
  root.appendChild(style);
}

function canAdopt(root: ShadowRoot): boolean {
  return (
    typeof CSSStyleSheet !== 'undefined' &&
    'replaceSync' in CSSStyleSheet.prototype &&
    'adoptedStyleSheets' in root
  );
}
