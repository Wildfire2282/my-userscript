import type { UI } from './mount';

/**
 * Per-component cleanup. Every listener of a component attaches to
 * `scope.signal`, so the component can be torn down on its own instead of
 * waiting for `ui.destroy()`.
 *
 * The scope registers itself with the owning UI, which means a component is
 * always released when the UI goes away, and `destroy()` stays idempotent.
 */
export interface Scope {
  readonly signal: AbortSignal;
  readonly destroyed: boolean;
  onDestroy(callback: () => void): () => void;
  destroy(): void;
}

export function createScope(ui: UI): Scope {
  const controller = new AbortController();
  const callbacks = new Set<() => void>();
  let destroyed = false;
  let unregister: () => void = () => {};

  const scope: Scope = {
    signal: controller.signal,
    get destroyed() {
      return destroyed;
    },
    onDestroy(callback) {
      if (destroyed) {
        callback();
        return () => {};
      }
      callbacks.add(callback);
      return () => {
        callbacks.delete(callback);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unregister();
      for (const callback of [...callbacks].reverse()) {
        try {
          callback();
        } catch {
          // A failing cleanup must not prevent the rest of the teardown.
        }
      }
      callbacks.clear();
      controller.abort();
    },
  };

  unregister = ui.onDestroy(() => scope.destroy());
  return scope;
}

/**
 * Components are unusable once the UI is destroyed: listeners on an aborted
 * signal never fire and the host is detached. Fail loudly instead of returning
 * a dead component.
 */
export function assertAlive(ui: UI, component: string): void {
  if (ui.destroyed) {
    throw new Error(`Cannot create a ${component} after ui.destroy().`);
  }
}
