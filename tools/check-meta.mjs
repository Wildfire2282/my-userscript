#!/usr/bin/env node
/**
 * 脚本元数据检查。
 *
 * 对所有脚本核对 docs/metadata.md：
 *   - 元数据块位于文件第一行（产物），字段齐全、顺序正确、固定值一致；
 *   - 已迁移脚本的源码不写 @version，产物版本等于 package.json；
 *   - 未迁移脚本的 userscript.meta.js 与 legacy/ 元数据块逐字段一致；
 *   - 代码里实际出现的 GM_* / GM.* 能力都有对应 @grant（多余授权只提示）；
 *   - 已迁移脚本的 @name / @match / @include / @grant 与 legacy/ 一致。
 *
 * 用法：
 *   bun tools/check-meta.mjs            # 检查所有脚本
 *   bun tools/check-meta.mjs super-drag # 只检查指定包
 *   bun tools/check-meta.mjs --allow-meta-change super-drag  # 明确接受元数据变化
 *   ALLOW_META_CHANGE=1 bun run verify    # CI 手动放行同一件事
 */

import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gmUsages } from './gm-usages.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');
const args = process.argv.slice(2);
const allowMetaChange =
  args.includes('--allow-meta-change') || process.env.ALLOW_META_CHANGE === '1';
const only = args.filter((arg) => !arg.startsWith('-'));

/** 与线上行为无关、可以变化的字段之外，以下字段必须与 legacy 一致。 */
const STABLE_FIELDS = ['@name', '@match', '@include', '@grant'];

/** docs/metadata.md 第 2 节：所有脚本都必须出现的字段。 */
const REQUIRED_FIELDS = [
  '@name',
  '@name:en',
  '@namespace',
  '@description',
  '@description:en',
  '@author',
  '@license',
  '@homepageURL',
  '@supportURL',
  '@source',
  '@run-at',
  '@downloadURL',
  '@updateURL',
];

/** 只能出现一次的单值字段。 */
const SINGLE_FIELDS = [...REQUIRED_FIELDS, '@version'];

/** docs/metadata.md 第 2 节：固定值。 */
const EXACT_FIELDS = new Map([
  ['@namespace', 'https://github.com/Wildfire2282'],
  ['@author', 'Wildfire2282 (https://github.com/Wildfire2282)'],
  ['@license', 'MIT'],
  ['@homepageURL', 'https://github.com/Wildfire2282/my-userscript'],
  ['@supportURL', 'https://github.com/Wildfire2282/my-userscript/issues'],
  ['@source', 'https://github.com/Wildfire2282/my-userscript'],
]);

/** docs/metadata.md 第 5 节：字段顺序。 */
const CANONICAL_ORDER = [
  '@name',
  '@name:en',
  '@namespace',
  '@version',
  '@description',
  '@description:en',
  '@author',
  '@license',
  '@homepageURL',
  '@supportURL',
  '@source',
  '@match',
  '@include',
  '@exclude',
  '@grant',
  '@run-at',
  '@noframes',
  '@downloadURL',
  '@updateURL',
];

const ORDER_INDEX = new Map(CANONICAL_ORDER.map((key, index) => [key, index]));

function parseMeta(text) {
  const fields = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\/\/\s*(@[\w:-]+)\s*(.*)$/.exec(line);
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

function singleValue(fields, key) {
  const values = fields.get(key) ?? [];
  return values.length === 1 ? values[0] : null;
}

function compareMaps(left, right, label) {
  const problems = [];
  const keys = new Set([...left.keys(), ...right.keys()]);
  for (const key of [...keys].sort()) {
    const before = sortedValues(left, key);
    const after = sortedValues(right, key);
    if (before.join('\n') !== after.join('\n')) {
      problems.push(`${label} ${key} 不一致：${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    }
  }
  return problems;
}

/** 按 docs/metadata.md 校验一个元数据块。 */
function validateFields(fields, { label, requireVersion, expectedVersion }) {
  const problems = [];

  for (const key of REQUIRED_FIELDS) {
    if (!(fields.get(key) ?? []).some((value) => value !== '')) {
      problems.push(`${label} 缺少 ${key}`);
    }
  }

  for (const key of SINGLE_FIELDS) {
    const count = (fields.get(key) ?? []).length;
    if (key === '@version') {
      if (requireVersion && count !== 1)
        problems.push(`${label} @version 应恰好出现一次，实际 ${count} 次`);
      if (!requireVersion && count !== 0)
        problems.push(`${label} 源码不应写 @version（构建时注入）`);
    } else if (count > 1) {
      problems.push(`${label} ${key} 出现了 ${count} 次，应只出现一次`);
    }
  }

  for (const [key, expected] of EXACT_FIELDS) {
    const actual = singleValue(fields, key);
    if (actual !== null && actual !== expected) {
      problems.push(`${label} ${key} 应为 ${expected}，实际 ${actual}`);
    }
  }

  // `@grant none` 表示“不申请任何权限”，与其它 grant 并存时管理器行为未定义：
  // 该用的 API 可能直接不存在，而脚本还以为自己拿到了权限。
  const grants = fields.get('@grant') ?? [];
  if (grants.includes('none') && grants.length > 1) {
    problems.push(`${label} @grant none 不能与其它 @grant 同时出现`);
  }

  for (const key of ['@description', '@description:en']) {
    const value = singleValue(fields, key);
    if (!value) continue;
    if (value.length > 60) problems.push(`${label} ${key} 超过 60 字`);
    if (/[。.]$/.test(value)) problems.push(`${label} ${key} 末尾不应加句号`);
  }

  const englishName = singleValue(fields, '@name:en');
  if (englishName === '') problems.push(`${label} @name:en 为空`);

  const runAt = singleValue(fields, '@run-at');
  if (
    runAt &&
    !['document-start', 'document-end', 'document-idle', 'document-body'].includes(runAt)
  ) {
    problems.push(`${label} @run-at 值无效：${runAt}`);
  }

  for (const key of ['@downloadURL', '@updateURL']) {
    const value = singleValue(fields, key);
    if (!value) continue;
    if (!value.startsWith('https://update.greasyfork.org/scripts/')) {
      problems.push(`${label} ${key} 不是 Greasy Fork 地址`);
    }
    const suffix = key === '@downloadURL' ? '.user.js' : '.meta.js';
    if (!value.endsWith(suffix)) problems.push(`${label} ${key} 应以 ${suffix} 结尾`);
  }

  if ((fields.get('@match') ?? []).length + (fields.get('@include') ?? []).length === 0) {
    problems.push(`${label} @match / @include 都是空的`);
  }

  if (fields.has('@noframes') && singleValue(fields, '@noframes') !== '') {
    problems.push(`${label} @noframes 不应带值`);
  }

  let lastIndex = -1;
  for (const key of fields.keys()) {
    const index = ORDER_INDEX.get(key);
    if (index === undefined) {
      problems.push(`${label} 出现未约定的字段 ${key}`);
      continue;
    }
    if (index < lastIndex) problems.push(`${label} 字段顺序错误：${key} 位置不对`);
    lastIndex = Math.max(lastIndex, index);
  }

  if (requireVersion && expectedVersion) {
    const version = singleValue(fields, '@version');
    if (version !== null && version !== expectedVersion) {
      problems.push(`${label} @version ${version} 与 package.json 的 ${expectedVersion} 不一致`);
    }
  }

  return problems;
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function findSourceMeta(dir) {
  for (const name of ['userscript.meta.ts', 'userscript.meta.js']) {
    const file = path.join(dir, name);
    if (await exists(file)) return { name, text: await readFile(file, 'utf8') };
  }
  return null;
}

async function hasEntry(dir) {
  for (const name of ['src/main.ts', 'src/main.js', 'src/index.ts', 'src/index.js']) {
    if (await exists(path.join(dir, name))) return true;
  }
  return false;
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
  return { file, text, fields: block ? parseMeta(block) : null };
}

async function checkPackage(slug) {
  const dir = path.join(SCRIPTS_DIR, slug);
  const problems = [];
  const notes = [];
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  } catch (error) {
    // 一个包写坏了不该让其它包不检查，也不能抛栈退出。
    return { slug, version: '?', problems: [`package.json 无法解析：${error.message}`], notes };
  }

  const migrated = await hasEntry(dir);
  const source = await findSourceMeta(dir);
  const legacy = await findLegacyMeta(dir);

  if (!source) {
    problems.push('找不到 userscript.meta.ts / userscript.meta.js');
  } else {
    const block = metaBlock(source.text);
    if (!block) {
      problems.push(`${source.name} 里找不到 ==UserScript== 元数据块`);
    } else {
      const fields = parseMeta(block);
      problems.push(
        ...validateFields(fields, {
          label: source.name,
          requireVersion: !migrated,
          expectedVersion: manifest.version,
        }),
      );

      if (!migrated) {
        if (!legacy?.fields) {
          problems.push('未迁移脚本没有可对照的 legacy/ 元数据');
        } else {
          problems.push(
            ...compareMaps(fields, legacy.fields, `${source.name} 与 legacy/${legacy.file}`),
          );
        }
      }
    }
  }

  if (!migrated && legacy?.fields) {
    problems.push(
      ...validateFields(legacy.fields, {
        label: `legacy/${legacy.file}`,
        requireVersion: true,
        expectedVersion: manifest.version,
      }),
    );
  }

  const distFile = path.join(dir, 'dist', `${slug}.user.js`);
  let code = null;
  try {
    code = await readFile(distFile, 'utf8');
  } catch {
    // 未迁移脚本没有构建产物是正常情况；已迁移脚本在 build 之后应有。
  }

  if (code === null) {
    // 已迁移脚本的 grant 只能从产物判断：没有产物就什么都没验证，不能算通过。
    if (migrated) problems.push('没有 dist 产物（先运行 bun run build）');
  } else {
    if (!code.startsWith('// ==UserScript==')) problems.push('产物元数据块不在文件第一行');
    const block = metaBlock(code);
    if (!block) {
      problems.push('产物里找不到 ==UserScript== 元数据块');
    } else {
      const fields = parseMeta(block);
      problems.push(
        ...validateFields(fields, {
          label: 'dist 产物',
          requireVersion: true,
          expectedVersion: manifest.version,
        }),
      );

      // 只扫描元数据块之后的代码，避免把 banner 里的 @grant 当成调用点。
      const body = code.slice(code.indexOf('// ==/UserScript=='));
      const used = gmUsages(body);
      const granted = new Set(sortedValues(fields, '@grant'));
      for (const name of used) {
        if (!granted.has(name)) problems.push(`代码用了 ${name}，但没有对应的 @grant`);
      }
      for (const name of granted) {
        if (!used.has(name)) notes.push(`@grant ${name} 没有被代码直接引用`);
      }

      if (legacy?.fields) {
        for (const key of STABLE_FIELDS) {
          const before = sortedValues(legacy.fields, key);
          const after = sortedValues(fields, key);
          if (before.join('\n') !== after.join('\n')) {
            const message = `${key} 与 legacy 不一致：${JSON.stringify(before)} → ${JSON.stringify(after)}`;
            if (allowMetaChange) notes.push(`${message}（已放行元数据变化）`);
            else
              problems.push(
                `${message}（维护者确认后，在该次推送最后一个提交的信息里写 [allow-meta]；已经 push 过的用 gh workflow run release.yml -f allow_meta_change=true 补发。本地复验加 --allow-meta-change）`,
              );
          }
        }
      } else if (legacy) {
        notes.push(`legacy/${legacy.file} 里没有元数据块，跳过对照`);
      }
    }
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

// 指定了不存在的包名时不能静默通过：拼错一个字母就等于什么都没检查。
const unknown = only.filter((slug) => !slugs.includes(slug));
if (unknown.length > 0) {
  console.error(`没有找到这些脚本包：${unknown.join('、')}`);
  process.exit(1);
}

let failed = 0;
for (const slug of slugs) {
  const result = await checkPackage(slug);
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
