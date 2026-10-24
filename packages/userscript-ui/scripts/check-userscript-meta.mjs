import { readFileSync } from 'node:fs';

const cases = [
  { file: 'dist/showcase.user.js', name: 'Userscript UI Showcase' },
  { file: 'dist/minimal.user.js', name: 'Userscript UI Minimal Demo' },
];

for (const entry of cases) {
  const source = readFileSync(entry.file, 'utf8');

  if (!source.startsWith('// ==UserScript==\n')) {
    throw new Error(`${entry.file} does not start with userscript metadata.`);
  }
  if (!source.includes(`// @name         ${entry.name}\n`)) {
    throw new Error(`${entry.file} has an unexpected @name.`);
  }
  if (!source.includes('// @namespace    https://github.com/Wildfire2282/userscript-ui\n')) {
    throw new Error(`${entry.file} has an unexpected @namespace.`);
  }
  if (!source.includes('// @grant        none\n')) {
    throw new Error(`${entry.file} must use @grant none.`);
  }
  if (!source.includes('// @noframes\n')) {
    throw new Error(`${entry.file} must disable frames.`);
  }
  if (source.includes('userscript-ds')) {
    throw new Error(`${entry.file} still contains the old project name.`);
  }
}

console.log('Userscript metadata check passed: names, namespace, and banner are current.');
