import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

const roots = ['../src', '../demo'].map((path) => fileURLToPath(new URL(path, import.meta.url)));

/**
 * The rules check capabilities, not text: a URL in a placeholder string is
 * harmless, `fetch(` is not. Comments are stripped first so prose such as
 * "never call fetch(" does not fail the build.
 */
const rules = [
  {
    name: 'HTML string injection',
    pattern:
      /\.innerHTML\b|insertAdjacentHTML|outerHTML|document\.write(?:ln)?\s*\(|\.setHTML(?:Unsafe)?\s*\(|\bsrcdoc\b/,
  },
  {
    name: 'dynamic code execution',
    pattern: /\beval\s*\(|new\s+Function\s*\(|\bimport\s*\(\s*['"`][^'"`]+['"`]\s*\)/,
  },
  {
    name: 'runtime network request',
    pattern:
      /\bfetch\s*\(|XMLHttpRequest|\bWebSocket\b|\bEventSource\b|navigator\.sendBeacon|importScripts/,
  },
  {
    name: 'remote resource',
    pattern: /@import\s+url\(\s*['"]?https?:|url\(\s*['"]?https?:\/\/(?!www\.w3\.org)/,
  },
];

/**
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

/** @type {string[]} */
const files = [];

/**
 * @param {string} directory
 * @returns {void}
 */
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(ts|css)$/.test(entry.name)) files.push(path);
  }
}

for (const root of roots) walk(root);

const failures = [];

for (const file of files) {
  const source = stripComments(readFileSync(file, 'utf8'));
  for (const rule of rules) {
    if (rule.pattern.test(source)) {
      failures.push(`${relative(projectRoot, file)}: ${rule.name}`);
    }
  }
}

if (failures.length) {
  console.error('Safety check failed:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Safety check passed: ${files.length} source files, no unsafe HTML, dynamic code, or network use.`,
);
