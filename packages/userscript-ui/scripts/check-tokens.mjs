import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const componentsDir = join(projectRoot, 'src/components');
const stylesDir = join(projectRoot, 'src/styles');

/**
 * AGENTS.md requires every colour and every value on the design scale to come
 * from a `--ds-*` token. A rule that nobody executes rots, so the checks below
 * run in `npm run check` next to the safety scan.
 *
 * Glyph geometry (checkmark strokes, tooltip arrow, spinner ring) is allowed to
 * stay literal: it draws a shape, it is not part of the spacing scale.
 */
const SCALE_PROPERTIES = [
  'font-size',
  'line-height',
  'gap',
  'row-gap',
  'column-gap',
  'padding',
  'padding-block',
  'padding-block-start',
  'padding-block-end',
  'padding-inline',
  'padding-inline-start',
  'padding-inline-end',
  'margin',
  'margin-block',
  'margin-block-start',
  'margin-block-end',
  'margin-inline',
  'margin-inline-start',
  'margin-inline-end',
  'border-radius',
  'width',
  'height',
  'min-height',
  'max-height',
  'min-width',
  'max-width',
  'inset-block-start',
  'inset-block-end',
  'inset-inline-start',
  'inset-inline-end',
];

const KEYWORDS = new Set([
  '0',
  'auto',
  'none',
  'normal',
  'inherit',
  'initial',
  'unset',
  '100%',
  'transparent',
  'currentcolor',
]);

const files = [...readdirSync(componentsDir).filter((name) => name.endsWith('.css'))].map((name) =>
  join(componentsDir, name),
);
for (const name of readdirSync(stylesDir).filter((entry) => entry.endsWith('.css'))) {
  files.push(join(stylesDir, name));
}

const failures = [];

for (const file of files) {
  let source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const label = relative(projectRoot, file);

  for (const match of source.matchAll(/(#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\()/gi)) {
    failures.push(`${label}: literal colour ${match[1]} — put it in tokens/themes.css`);
  }

  if (label.includes('checkbox.css')) {
    // The checkmark and the dash are drawn with fixed geometry on ::after.
    // Only those blocks are exempt: a stray `padding: 7px` elsewhere in the file
    // must still fail, so do not skip the whole file.
    source = source.replace(/::after\s*\{[^}]*\}/g, '');
  }

  for (const match of source.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)) {
    const property = match[1] ?? '';
    const value = match[2]?.trim() ?? '';
    if (!SCALE_PROPERTIES.includes(property)) continue;
    if (!/\d+px/.test(value)) continue;
    if (/var\(--ds-|calc\(|min\(|max\(|clamp\(|env\(/.test(value)) continue;
    if (KEYWORDS.has(value.toLowerCase())) continue;
    failures.push(`${label}: ${property}: ${value} — use a --ds-* token`);
  }
}

if (failures.length) {
  console.error('Token check failed:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Token check passed: ${files.length} stylesheets, colours and scale come from tokens.`);
