/**
 * Element ids are global to the page, not to a shadow root. A per-module random
 * token keeps them unique when two copies of the library (two userscripts, or
 * an upgrade window with both versions loaded) run in the same document.
 */
const PAGE_TOKEN = Math.random().toString(36).slice(2, 8);

let counter = 0;

export function uid(prefix = 'ds'): string {
  counter += 1;
  return `${prefix}-${PAGE_TOKEN}-${counter}`;
}
