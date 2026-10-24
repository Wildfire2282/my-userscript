import type { UI } from './mount';

interface TopLayerState {
  dialogs: HTMLDialogElement[];
  listeners: Set<() => void>;
}

const states = new WeakMap<UI, TopLayerState>();

function stateOf(ui: UI): TopLayerState {
  let state = states.get(ui);
  if (!state) {
    state = { dialogs: [], listeners: new Set() };
    states.set(ui, state);
  }
  return state;
}

function notify(state: TopLayerState): void {
  for (const listener of [...state.listeners]) {
    try {
      listener();
    } catch {
      // One overlay must not prevent the others from moving.
    }
  }
}

export function pushTopLayer(ui: UI, dialog: HTMLDialogElement): void {
  const state = stateOf(ui);
  const index = state.dialogs.indexOf(dialog);
  if (index >= 0) state.dialogs.splice(index, 1);
  state.dialogs.push(dialog);
  notify(state);
}

export function popTopLayer(ui: UI, dialog: HTMLDialogElement): void {
  const state = states.get(ui);
  if (!state) return;
  const index = state.dialogs.indexOf(dialog);
  if (index < 0) return;
  state.dialogs.splice(index, 1);
  notify(state);
}

export function topLayerHost(ui: UI): HTMLElement | null {
  const dialogs = states.get(ui)?.dialogs;
  if (!dialogs?.length) return null;
  return dialogs[dialogs.length - 1] ?? null;
}

export function onTopLayerChange(ui: UI, listener: () => void): () => void {
  const state = stateOf(ui);
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

/**
 * Host for UI that must stay visible above a modal: the most recently opened
 * dialog of this UI, otherwise the given layer. The top layer is the only
 * place a shadow-tree element can paint above `::backdrop`.
 */
export function overlayHost(ui: UI, fallback: HTMLElement): HTMLElement {
  return topLayerHost(ui) ?? fallback;
}

/**
 * Host for a tooltip anchored at `anchor`. Returns `null` when the anchor is
 * unreachable: while a modal is open everything outside it is inert, so a
 * tooltip attached to outside content would describe something the user
 * cannot interact with.
 */
export function anchorOverlayHost(
  ui: UI,
  anchor: Element,
  fallback: HTMLElement,
): HTMLElement | null {
  const dialog = anchor.closest<HTMLDialogElement>('dialog[open]');
  if (dialog && ui.root.contains(dialog)) return dialog;
  return topLayerHost(ui) ? null : fallback;
}
