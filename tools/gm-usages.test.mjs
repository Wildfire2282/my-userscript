// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { gmUsages } from './gm-usages.mjs';

describe('GM grant usage scanning', () => {
  it.each([
    'GM.setClipboard("x")',
    'globalThis.GM.setClipboard("x")',
    'scope.GM?.setClipboard("x")',
    'GM["setClipboard"]("x")',
    'globalThis["GM"]["setClipboard"]("x")',
    'scope["GM"].setClipboard("x")',
  ])('reports the exact missing namespace grant: %s', (code) => {
    const used = gmUsages(code);
    expect([...used]).toEqual(['GM.setClipboard']);
    const grants = new Set(['GM_setClipboard']);
    expect([...used].filter((name) => !grants.has(name))).toEqual(['GM.setClipboard']);
    grants.add('GM.setClipboard');
    expect([...used].filter((name) => !grants.has(name))).toEqual([]);
  });

  it.each([
    'GM_setValue("x", 1)',
    'globalThis.GM_setValue("x", 1)',
    'scope["GM_setValue"]("x", 1)',
  ])('preserves legacy grants: %s', (code) => expect([...gmUsages(code)]).toEqual(['GM_setValue']));

  it('ignores comments, strings and info without hiding real usage', () => {
    expect([
      ...gmUsages(`
      // GM.setClipboard('comment'); GM_setValue('comment', 1);
      const text = "GM.setValue('string', 1); GM_getValue('string')";
      GM_info; GM.info; globalThis['GM']['info'];
      GM.setValue('real', 1);
    `),
    ]).toEqual(['GM.setValue']);
  });
});
