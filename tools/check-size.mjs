#!/usr/bin/env node
/**
 * 产物体积检查。
 *
 * 预算来自 docs/refactoring-plan.md 第 9 节：单脚本 ≤ 200 KB raw / 60 KB gzip。
 * 2026-10-22 按维护者要求从 80 KB / 25 KB 放宽，给面向用户的设置项留出空间。
 * 默认只警告（观察项）；加 --strict 时超预算即失败，用于发布前把关。
 *
 * 用法：
 *   node tools/check-size.mjs
 *   node tools/check-size.mjs --strict
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');

const RAW_BUDGET = 200 * 1024;
const GZIP_BUDGET = 60 * 1024;
const strict = process.argv.includes('--strict');

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

const rows = [];
for (const entry of await readdir(SCRIPTS_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const file = path.join(SCRIPTS_DIR, entry.name, 'dist', `${entry.name}.user.js`);
  let contents;
  try {
    contents = await readFile(file);
  } catch {
    continue;
  }
  rows.push({
    slug: entry.name,
    raw: (await stat(file)).size,
    gzip: gzipSync(contents).length,
    brotli: brotliCompressSync(contents).length,
  });
}

if (rows.length === 0) {
  console.log('没有可检查的产物（先运行 npm run build）。');
  process.exit(0);
}

const nameWidth = Math.max(...rows.map((row) => row.slug.length), 4);
console.log(
  `${'脚本'.padEnd(nameWidth)}  ${'raw'.padStart(10)}  ${'gzip'.padStart(10)}  ${'brotli'.padStart(10)}`,
);
let overBudget = 0;
for (const row of rows) {
  const over = row.raw > RAW_BUDGET || row.gzip > GZIP_BUDGET;
  if (over) overBudget += 1;
  const flag = over ? '  超预算' : '';
  console.log(
    `${row.slug.padEnd(nameWidth)}  ${kb(row.raw).padStart(10)}  ${kb(row.gzip).padStart(10)}  ${kb(row.brotli).padStart(10)}${flag}`,
  );
}
console.log(`\n预算：raw ≤ ${kb(RAW_BUDGET)}，gzip ≤ ${kb(GZIP_BUDGET)}。`);

if (overBudget > 0) {
  const message = `${overBudget} 个产物超出体积预算，需在交付说明里写明原因。`;
  if (strict) {
    console.error(message);
    process.exitCode = 1;
  } else {
    console.warn(message);
  }
}
