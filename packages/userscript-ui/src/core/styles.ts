interface RootStyles {
  seen: Set<string>;
  sheets: Map<string, CSSStyleSheet>;
}

// 每个 ShadowRoot 一份：页面级 Map 会让动态 CSS 在页面生命周期内一直驻留。
const stylesByRoot = new WeakMap<ShadowRoot, RootStyles>();

export function useStyles(root: ShadowRoot, css: string): void {
  let entry = stylesByRoot.get(root);
  if (!entry) {
    entry = { seen: new Set(), sheets: new Map() };
    stylesByRoot.set(root, entry);
  }
  if (entry.seen.has(css)) return;
  entry.seen.add(css);

  if (canAdopt(root)) {
    try {
      let sheet = entry.sheets.get(css);
      if (!sheet) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        entry.sheets.set(css, sheet);
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
