#!/usr/bin/env node
/**
 * 产物元数据检查。
 *
 * 对每个已迁移（有 dist 产物）的脚本核对：
 *   - 元数据块位于文件第一行，且 @version 等于 package.json 的版本；
 *   - @name / @description / @namespace 非空，@match 或 @include 至少有一条；
 *   - 代码里实际出现的 GM_* 能力都有对应 @grant（多余授权只提示）；
 *   - @name / @match / @include / @grant 与 legacy/ 里的线上原版一致，避免顺手改掉权限。
 *
 * 用法：
 *   node tools/check-meta.mjs            # 检查所有已构建的脚本
 *   node tools/check-meta.mjs super-drag # 只检查指定包
 *   node tools/check-meta.mjs --allow-meta-change super-drag  # 明确接受元数据变化
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');
const args = process.argv.slice(2);
const allowMetaChange = args.includes('--allow-meta-change');
const only = args.filter((arg) => !arg.startsWith('-'));

/** 与线上行为无关、可以变化的字段之外，以下字段必须与 legacy 一致。 */
const STABLE_FIELDS = ['@name', '@match', '@include', '@grant'];

function parseMeta(text) {
  const fields = new Map();
  for (const line of text.split('\n')) {
    const match = /^\/\/\s*(@[\w:]+)\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    const value = match[2].trim();
    if (!fields.has(key)) fields.set(key, []);
    fields.get(key).push(value);
  }
  return fields;
}

function metaBlock(text) {
  const start = text.indexOf('// ==UserScript==');
  const end = text.indexOf('// ==/UserScript==');
  if (start < 0 || end < 0 || end < start) return null;
  return text.slice(start, end);
}

function sortedValues(fields, key) {
  return [...(fields.get(key) ?? [])].sort();
}

async function findLegacyMeta(dir) {
  const legacyDir = path.join(dir, 'legacy');
  let entries;
  try {
    entries = await readdir(legacyDir);
  } catch {
    return null;
  }
  const file = entries.find((entry) => entry.endsWith('.user.js'));
  if (!file) return null;
  const text = await readFile(path.join(legacyDir, file), 'utf8');
  const block = metaBlock(text);
  return { file, fields: block ? parseMeta(block) : null };
}

async function checkPackage(slug) {
  const dir = path.join(SCRIPTS_DIR, slug);
  const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  const distFile = path.join(dir, 'dist', `${slug}.user.js`);

  let code;
  try {
    code = await readFile(distFile, 'utf8');
  } catch {
    return { slug, skipped: '没有 dist 产物（先运行 npm run build）', problems: [] };
  }

  const problems = [];
  const notes = [];
  const block = metaBlock(code);
  if (!block) {
    problems.push('产物里找不到 ==UserScript== 元数据块');
    return { slug, version: manifest.version, problems, notes };
  }
  if (!code.startsWith('// ==UserScript==')) {
    problems.push('元数据块不在文件第一行');
  }

  const fields = parseMeta(block);
  const versions = fields.get('@version') ?? [];
  if (versions.length !== 1) {
    problems.push(`@version 应恰好出现一次，实际 ${versions.length} 次`);
  } else if (versions[0] !== manifest.version) {
    problems.push(`@version ${versions[0]} 与 package.json 的 ${manifest.version} 不一致`);
  }

  for (const key of ['@name', '@description', '@namespace']) {
    if (!(fields.get(key) ?? []).some((value) => value !== '')) problems.push(`${key} 为空`);
  }
  if (sortedValues(fields, '@match').length + sortedValues(fields, '@include').length === 0) {
    problems.push('@match / @include 都是空的');
  }

  // 只扫描元数据块之后的代码，避免把 banner 里的 @grant 当成调用点。
  const body = code.slice(code.indexOf('// ==/UserScript=='));
  const used = new Set((body.match(/\bGM_[A-Za-z]+/g) ?? []).filter((name) => name !== 'GM_info'));
  const granted = new Set(sortedValues(fields, '@grant'));
  for (const name of used) {
    if (!granted.has(name)) problems.push(`代码用了 ${name}，但没有对应的 @grant`);
  }
  for (const name of granted) {
    if (!used.has(name)) notes.push(`@grant ${name} 没有被代码直接引用`);
  }

  const legacy = await findLegacyMeta(dir);
  if (legacy?.fields) {
    for (const key of STABLE_FIELDS) {
      const before = sortedValues(legacy.fields, key);
      const after = sortedValues(fields, key);
      if (before.join('\n') !== after.join('\n')) {
        const message = `${key} 与 legacy 不一致：${JSON.stringify(before)} → ${JSON.stringify(after)}`;
        if (allowMetaChange) notes.push(`${message}（已用 --allow-meta-change 接受）`);
        else problems.push(`${message}（确认要改时加 --allow-meta-change）`);
      }
    }
  } else if (legacy) {
    notes.push(`legacy/${legacy.file} 里没有元数据块，跳过对照`);
  }

  return { slug, version: manifest.version, problems, notes };
}

const slugs = (
  await Promise.all(
    (await readdir(SCRIPTS_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const packageFile = path.join(SCRIPTS_DIR, entry.name, 'package.json');
        try {
          await readFile(packageFile, 'utf8');
          return entry.name;
        } catch {
          return null;
        }
      }),
  )
)
  .filter(Boolean)
  .filter((slug) => only.length === 0 || only.includes(slug))
  .sort();

let failed = 0;
for (const slug of slugs) {
  const result = await checkPackage(slug);
  if (result.skipped) {
    console.log(`跳过 ${slug}：${result.skipped}`);
    continue;
  }
  if (result.problems.length > 0) failed += 1;
  console.log(`${result.problems.length > 0 ? '失败' : '通过'} ${slug} @${result.version}`);
  for (const problem of result.problems) console.log(`  ✗ ${problem}`);
  for (const note of result.notes) console.log(`  · ${note}`);
}

if (failed > 0) {
  console.error(`\n元数据检查失败：${failed} 个脚本。`);
  process.exitCode = 1;
} else {
  console.log('\n元数据检查通过。');
}
