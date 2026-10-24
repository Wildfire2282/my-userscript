import baseCss from '../styles/base.css?inline';
import themesCss from '../tokens/themes.css?inline';
import tokensCss from '../tokens/tokens.css?inline';
import { resolveLabels, type UILabels } from './labels';
import { resolveTheme, type ResolvedTheme, type Theme } from './theme';
import { useStyles } from './styles';

export interface UILayers {
  readonly base: HTMLElement;
  readonly toast: HTMLElement;
  readonly tooltip: HTMLElement;
}

export interface UIOptions {
  theme?: Theme;
  target?: HTMLElement;
  zIndex?: number;
  tokens?: Record<string, string>;
  labels?: Partial<UILabels>;
}

export interface UI {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  readonly container: HTMLElement;
  readonly layers: UILayers;
  readonly signal: AbortSignal;
  readonly theme: ResolvedTheme;
  readonly labels: UILabels;
  readonly destroyed: boolean;
  setTheme(theme: Theme): void;
  useStyles(css: string): void;
  mount(node: Node): void;
  onDestroy(callback: () => void): () => void;
  destroy(): void;
}

const HOST_TAG = 'userscript-ui-root';
const DEFAULT_Z_INDEX = 2_147_483_000;

export function mountUI(options: UIOptions = {}): UI {
  const host = document.createElement(HOST_TAG);
  host.setAttribute('data-ds-root', '');

  // Inline important rules keep the host's own box stable even when the page
  // uses aggressive global selectors such as `* { ... !important }`.
  setImportant(host, 'all', 'initial');
  setImportant(host, 'position', 'fixed');
  setImportant(host, 'inset', '0');
  setImportant(host, 'z-index', String(options.zIndex ?? DEFAULT_Z_INDEX));
  setImportant(host, 'display', 'block');
  setImportant(host, 'pointer-events', 'none');
  setImportant(host, 'visibility', 'visible');
  setImportant(host, 'opacity', '1');
  setImportant(host, 'transform', 'none');
  setImportant(host, 'filter', 'none');

  const root = host.attachShadow({ mode: 'open' });
  const container = document.createElement('div');
  container.className = 'ds-root';

  const base = layer('ds-layer-base');
  const toast = layer('ds-layer-toast');
  const tooltip = layer('ds-layer-tooltip');
  container.append(base, toast, tooltip);
  root.append(container);

  for (const [name, value] of Object.entries(options.tokens ?? {})) {
    if (!name.startsWith('--')) {
      throw new Error(`Token name must start with "--": ${name}`);
    }
    host.style.setProperty(name, value);
  }

  const controller = new AbortController();
  const destroyCallbacks = new Set<() => void>();
  const media =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  let requestedTheme: Theme = options.theme ?? 'light';
  let resolvedTheme: ResolvedTheme = resolveTheme(requestedTheme, media?.matches ?? false);

  const applyTheme = () => {
    resolvedTheme = resolveTheme(requestedTheme, media?.matches ?? false);
    host.setAttribute('data-ds-theme', resolvedTheme);
    setImportant(host, 'color-scheme', resolvedTheme);
  };
  applyTheme();

  media?.addEventListener(
    'change',
    () => {
      if (requestedTheme === 'system') applyTheme();
    },
    { signal: controller.signal },
  );

  useStyles(root, tokensCss);
  useStyles(root, baseCss);
  useStyles(root, themesCss);

  const target = options.target ?? document.documentElement;
  target.appendChild(host);

  let destroyed = false;

  const ensureAlive = (action: string) => {
    if (destroyed) throw new Error(`Cannot ${action} after ui.destroy().`);
  };

  const labels = resolveLabels(options.labels);

  const ui: UI = {
    host,
    root,
    container,
    layers: { base, toast, tooltip },
    signal: controller.signal,
    labels,
    get theme() {
      return resolvedTheme;
    },
    get destroyed() {
      return destroyed;
    },
    setTheme(theme) {
      ensureAlive('change the theme');
      const previous = resolvedTheme;
      requestedTheme = theme;
      host.setAttribute('data-ds-theme-switching', '');
      applyTheme();
      if (previous !== resolvedTheme) {
        const clear = () => host.removeAttribute('data-ds-theme-switching');
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => requestAnimationFrame(clear));
        } else {
          window.setTimeout(clear, 0);
        }
      } else {
        host.removeAttribute('data-ds-theme-switching');
      }
    },
    useStyles(css) {
      ensureAlive('add styles');
      useStyles(root, css);
    },
    mount(node) {
      ensureAlive('mount content');
      base.appendChild(node);
    },
    onDestroy(callback) {
      if (destroyed) {
        callback();
        return () => {};
      }
      destroyCallbacks.add(callback);
      return () => destroyCallbacks.delete(callback);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const callback of [...destroyCallbacks].reverse()) {
        try {
          callback();
        } catch {
          // A failing cleanup must not prevent the rest of the teardown.
        }
      }
      destroyCallbacks.clear();
      controller.abort();
      host.remove();
    },
  };

  return ui;
}

function layer(className: string): HTMLElement {
  const node = document.createElement('div');
  node.className = `ds-layer ${className}`;
  return node;
}

function setImportant(node: HTMLElement, property: string, value: string): void {
  node.style.setProperty(property, value, 'important');
}
