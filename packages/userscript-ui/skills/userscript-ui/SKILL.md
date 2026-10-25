---
name: userscript-ui
description: Build Tampermonkey/Greasemonkey UI with Userscript UI, this repository's Shadow DOM design system. Use when creating or changing settings panels, floating launchers, forms, dialogs, toasts, alerts, tooltips, or when adding a new UI component to a userscript.
---

# Userscript UI

Use this skill for any UI work in this repository or in a userscript that depends on it.

## First

Read `AGENTS.md` at the repository root. For deeper detail read:

- `docs/design-guidelines.md`
- `docs/component-usage.md`
- `docs/integration.md`

## Non-negotiables

- Runtime dependencies: none. Do not add React, Vue, Tailwind, icon packs, or remote fonts.
- Render inside `mountUI()`'s Shadow Root. Never modify host page global CSS.
- Use only `--ds-*` tokens for color, spacing, radius, shadow, and motion.
- Never use `innerHTML`, `insertAdjacentHTML`, `outerHTML`, `document.write`, `eval`, or `new Function`.
- Attach listeners with `ui.signal` or a local `AbortController`; expose `destroy()`.
- Mount once per page. Reuse `ui` when opening/closing UI; call `ui.destroy()` on teardown.
- Reuse existing components before adding new ones.

## Workflow

1. Inspect the existing UI code and the component list in `AGENTS.md`.
2. Choose the smallest composition that fits: Panel > Section > Field > native control.
3. Create one `ui`, one `toast` controller, and one launcher per script.
4. Implement the interaction; use `confirmDialog` for destructive actions.
5. Add unit tests for behavior and a real-browser test if layout/focus/overlay behavior changed.
6. Run `bun run verify` and keep it green.

## Typical setup

```ts
const ui = mountUI({ theme: 'light' });
const toast = createToast(ui);
const panel = createPanel(ui, { title: '设置', open: false });
// build sections/fields...
createLauncher(ui, { panel, label: '打开设置', closeLabel: '关闭设置' });
```

- Keep configuration in the default `settings` panel (360px). Use `createPanel(ui, { size: 'operation' })` for the script's actual functions: 560px wide, tall enough for a two-column working area.
- Only one panel should be open in a corner; close the other panel in the entry handler before opening a different one.

## When adding a component

Only if at least two scripts need it and composition cannot solve it:

- Add `src/components/<name>.css` and `<name>.ts`.
- Import CSS with `?inline`; register through `ui.useStyles()`.
- Return `{ el, ... }`; form controls follow `FormControl`.
- Add tokens for any new visual value; support light and dark.
- Clean up listeners/timers; register with `ui.onDestroy()` when auto-mounted.
- Export from `src/index.ts`; update docs and `AGENTS.md`.
- Add unit + E2E coverage.

## Verification

```bash
bun run verify
```

This runs safety scanning, TypeScript, unit tests, build, real Chrome/Edge E2E, and the size report. Do not commit if it fails.
