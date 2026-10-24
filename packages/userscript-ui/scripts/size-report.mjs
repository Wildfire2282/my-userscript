import { readFileSync } from 'node:fs';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const files = [
  'dist/lib/userscript-ui.js',
  'dist/lib/userscript-ui.iife.js',
  'dist/showcase.user.js',
  'dist/minimal.user.js',
];
const rows = [];

for (const file of files) {
  const source = readFileSync(file);
  rows.push({
    file,
    raw: source.byteLength,
    gzip: gzipSync(source, { level: 9 }).byteLength,
    brotli: brotliCompressSync(source).byteLength,
  });
}

/** @param {number} bytes */
const format = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;
const width = Math.max(...rows.map((row) => row.file.length), 4);

console.log(
  `${'file'.padEnd(width)}  ${'raw'.padStart(9)}  ${'gzip'.padStart(9)}  ${'brotli'.padStart(9)}`,
);
for (const row of rows) {
  console.log(
    `${row.file.padEnd(width)}  ${format(row.raw).padStart(9)}  ${format(row.gzip).padStart(9)}  ${format(row.brotli).padStart(9)}`,
  );
}

console.log('');
// Component class names and `data-ds-*` hooks live in CSS strings that Rollup
// cannot minify, so string matching is stable across bundle changes.
const minimal = readFileSync('dist/minimal.user.js', 'utf8');
if (!minimal.includes('.ds-panel') || !minimal.includes('.ds-switch')) {
  throw new Error('Minimal build is missing components it imports.');
}
if (
  [
    '.ds-checkbox',
    '.ds-select',
    '.ds-alert',
    '.ds-dialog',
    '.ds-toast',
    '.ds-launcher',
    '.ds-tooltip',
  ].some((selector) => minimal.includes(selector))
) {
  throw new Error('Minimal build contains components it does not import.');
}
if (minimal.includes('demo-status')) {
  throw new Error('Minimal build contains showcase-only code.');
}

console.log('\nOn-demand check passed: minimal build excludes unused components.');
