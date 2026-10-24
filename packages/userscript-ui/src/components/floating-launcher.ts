import { uid } from '../core/id';
import { assertAlive, createScope } from '../core/lifecycle';
import type { UI } from '../core/mount';
import { slidersIcon } from '../icons';
import type { PanelHandle, PanelPosition } from './panel';
import launcherCss from './floating-launcher.css?inline';

export type LauncherPosition = PanelPosition;

export interface LauncherOptions {
  label: string;
  closeLabel?: string;
  panel?: PanelHandle;
  position?: LauncherPosition;
  icon?: Element;
  onClick?: () => void;
}

export interface LauncherHandle {
  el: HTMLButtonElement;
  setExpanded(expanded: boolean): void;
  destroy(): void;
}

export function createLauncher(ui: UI, options: LauncherOptions): LauncherHandle {
  assertAlive(ui, 'launcher');
  ui.useStyles(launcherCss);

  const scope = createScope(ui);
  const position = options.position ?? 'bottom-right';

  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'ds-launcher';
  el.setAttribute('data-ds-launcher', '');
  el.dataset.position = position;
  el.setAttribute('aria-label', options.label);

  const icon = options.icon ?? slidersIcon();
  el.appendChild(icon);

  const syncExpanded = (open: boolean) => {
    el.setAttribute('aria-expanded', String(open));
    el.setAttribute(
      'aria-label',
      open ? (options.closeLabel ?? ui.labels.closeSettings) : options.label,
    );
  };

  let unsubscribe: (() => void) | undefined;

  if (options.panel) {
    options.panel.setPosition(position);
    if (!options.panel.el.id) options.panel.el.id = uid('ds-panel');
    el.setAttribute('aria-controls', options.panel.el.id);
    syncExpanded(options.panel.isOpen());
    unsubscribe = options.panel.onOpenChange(syncExpanded);
    scope.onDestroy(() => unsubscribe?.());
  }

  el.addEventListener('pointerdown', (event) => event.stopPropagation(), { signal: scope.signal });

  el.addEventListener(
    'click',
    (event) => {
      event.stopPropagation();

      if (options.panel) {
        if (options.panel.isOpen()) options.panel.close();
        else options.panel.open();
      }

      options.onClick?.();
    },
    { signal: scope.signal },
  );

  ui.layers.base.appendChild(el);

  const handle: LauncherHandle = {
    el,
    setExpanded(expanded) {
      if (!scope.destroyed) syncExpanded(expanded);
    },
    destroy() {
      scope.destroy();
      el.remove();
    },
  };

  return handle;
}
