import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// safety 网是 oxlint 盖不住的硬规则兜底（no-restricted-syntax 类 AST 选择器）：
// 全仓源码 + 工具脚本，只豁免带 `safety-allow:` 行注的已知意图。
// 脚本在 packages/userscript-ui/scripts/，仓库根是上三级。
const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));

// 只扫进产物的源码：工具脚本跑在本地、测试不进产物，扫它们只会误杀
//（CDP 的 WebSocket、动态 import(vite)、夹具页的 fetch）。
const roots = ['packages/userscript-ui', 'packages/shared', 'scripts'].map((path) =>
  join(projectRoot, path),
);

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
    if (entry.isDirectory()) {
      // 进产物的只有各包的 src：legacy 是线上对照，tests/fixtures/dist 不进产物。
      // packages 下的 scripts/ 是检查工具自身，不进产物。
      if (
        entry.name === 'legacy' ||
        entry.name === 'dist' ||
        entry.name === 'tests' ||
        entry.name === 'scripts'
      )
        continue;
      walk(path);
    } else if (/\.(ts|mjs|css)$/.test(entry.name)) files.push(path);
  }
}

for (const root of roots) walk(root);

const failures = [];

for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  // 文件头 `safety-allow-file:` 豁免整个文件（如转写网络钩子：只旁听不新发请求）；
  // 行注 `safety-allow:` 豁免整行。
  if (/safety-allow-file:/.test(raw)) continue;
  const source = stripComments(
    raw
      .split('\n')
      .filter((line) => !line.includes('safety-allow:'))
      .join('\n'),
  );
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
