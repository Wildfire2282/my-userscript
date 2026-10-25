#!/usr/bin/env node
/**
 * 把可发布的脚本汇总到一个目录，供 CI 推送到 release 分支。
 *
 * 发布物优先级：
 *   1. scripts/<slug>/dist/<slug>.user.js（已迁移，构建产物）；
 *   2. scripts/<slug>/legacy/*.user.js（未迁移，线上原版快照）。
 *
 * 版本规则（Greasy Fork 只接受更高的 @version）：
 *   - 内容相同：跳过；
 *   - 版本更高：覆盖；
 *   - 版本相同但内容不同：报错，提醒先提升版本；
 *   - 版本更低：报错，拒绝回退。
 *
 * 发布目录里已经不存在对应脚本包的文件会被清理，避免下线脚本继续被 webhook 命中。
 *
 * 用法：
 *   bun tools/release.mjs <发布目录>
 */

import { access, mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactPath, newestArtifactInput, newestSourceTime } from './artifact-freshness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');

const outArg = process.argv[2];
if (!outArg) {
  console.error('用法：bun tools/release.mjs <发布目录>');
  process.exit(1);
}
const OUT_DIR = path.resolve(ROOT, outArg);

/** 判断路径是否存在。 */
async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/** 从元数据块里取 @version；只在 banner 内找，避免匹配到正文里的同名注释。 */
function parseVersion(text) {
  const end = text.indexOf('// ==/UserScript==');
  const banner = end === -1 ? text : text.slice(0, end);
  const match = /^\/\/\s*@version\s+(\S+)/m.exec(banner);
  return match?.[1] ?? null;
}

/** 解析 ==UserScript== 里的字段，保留出现顺序与重复项。 */
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

/** 把元数据字段序列化成与顺序、缩进无关的签名。 */
function metaSignature(fields) {
  return [...fields.keys()]
    .sort()
    .map(
      (key) =>
        `${key}=${fields
          .get(key)
          .map((value) => value.trim())
          .sort()
          .join('|')}`,
    )
    .join('\n');
}

/** 拆分元数据块与代码正文；用于比较语义内容。 */
function splitArtifact(text) {
  const endMarker = '// ==/UserScript==';
  const end = text.indexOf(endMarker);
  if (end < 0) return null;
  return {
    fields: parseMeta(text.slice(0, end)),
    body: text.slice(end + endMarker.length),
  };
}

/**
 * 判断两份发布物是否只是元数据格式不同。
 *
 * Greasy Fork 会把手写的 `@downloadURL` / `@updateURL` 对齐空格改成单个空格，
 * 反向同步后本地快照与 release 分支就会“字节不同、语义相同”。这类差异不应要求升版本。
 */
function sameArtifact(left, right) {
  if (left === right) return true;
  const normalize = (text) => text.replace(/\r\n?/g, '\n');
  const a = splitArtifact(normalize(left));
  const b = splitArtifact(normalize(right));
  if (!a || !b) return false;
  return metaSignature(a.fields) === metaSignature(b.fields) && a.body === b.body;
}

/** 会影响安装权限或匹配范围的字段；变化时必须人工确认。 */
const STABLE_FIELDS = ['@name', '@match', '@include', '@grant'];

/** 把稳定字段序列化成可比较的字符串。 */
function stableFields(text) {
  const fields = parseMeta(text);
  return STABLE_FIELDS.map((key) => {
    const values = [...(fields.get(key) ?? [])].sort();
    return `${key}=${values.join('|')}`;
  }).join('\n');
}

/**
 * 比较两个版本号。
 * 仓库里的版本都是 x.y.z，按数字逐段比较；遇到非数字段时退回自然排序。
 */
function compareVersions(left, right) {
  const a = left.split('.');
  const b = right.split('.');
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const x = Number(a[index] ?? 0);
    const y = Number(b[index] ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return left.localeCompare(right, 'en', { numeric: true });
    }
    if (x !== y) return x - y;
  }
  return 0;
}

/** 找到一个脚本当前可发布的文件：构建产物优先，其次线上原版。 */
async function findArtifact(dir, slug) {
  const dist = artifactPath(dir, slug);
  if (await exists(dist)) {
    // 直接跑发布会拿到上次构建的旧文件：产物必须比全部输入新，否则先构建再发布。
    // `package.json`（版本）与元数据块也算输入——只改版本号时产物同样是旧的。
    const [distStat, newestInput] = await Promise.all([stat(dist), newestArtifactInput(dir)]);
    if (newestInput !== null && distStat.mtimeMs < newestInput) {
      return { file: dist, kind: '构建产物', stale: true };
    }
    return { file: dist, kind: '构建产物' };
  }

  const legacyDir = path.join(dir, 'legacy');
  let entries;
  try {
    entries = await readdir(legacyDir);
  } catch {
    return null;
  }
  const legacy = entries.filter((entry) => entry.endsWith('.user.js')).sort()[0];
  if (!legacy) return null;
  return { file: path.join(legacyDir, legacy), kind: 'legacy 原版' };
}

/** 读取所有带 package.json 的脚本包。 */
async function loadPackages() {
  const entries = await readdir(SCRIPTS_DIR, { withFileTypes: true });
  const packages = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(SCRIPTS_DIR, entry.name);
    if (await exists(path.join(dir, 'package.json'))) {
      packages.push({ slug: entry.name, dir });
    }
  }
  return packages.sort((a, b) => a.slug.localeCompare(b.slug));
}

await mkdir(OUT_DIR, { recursive: true });

const changed = [];
const unchanged = [];
const skipped = [];
const removed = [];
const problems = [];
// 先全部校验、最后才写：任何一个包出问题时，发布目录保持原样，不留半批产物。
const pendingWrites = [];

const packages = await loadPackages();
if (packages.length === 0) {
  problems.push('scripts/ 下没有脚本包，拒绝把发布目录清空');
}
// package.json 被误删时，包会从 packages 里消失；随后清理阶段会把线上文件当成
// “已下线”删除。发现源码 / 快照 / 产物却没有 manifest 时整轮失败。
for (const entry of await readdir(SCRIPTS_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = path.join(SCRIPTS_DIR, entry.name);
  if (await exists(path.join(dir, 'package.json'))) continue;
  const hasArtifact =
    (await exists(path.join(dir, 'src'))) ||
    (await exists(path.join(dir, 'legacy'))) ||
    (await exists(path.join(dir, 'dist')));
  if (hasArtifact) problems.push(`${entry.name}：缺少 package.json，不能当作已下线处理`);
}
const expected = new Set(packages.map((pkg) => `${pkg.slug}.user.js`));

for (const pkg of packages) {
  const artifact = await findArtifact(pkg.dir, pkg.slug);
  if (!artifact) {
    if (await newestSourceTime(path.join(pkg.dir, 'src'))) {
      problems.push(
        `${pkg.slug}：有 src 源码却没有构建产物，先运行 bun run build ${pkg.slug} 再发布`,
      );
    } else {
      skipped.push(`${pkg.slug}（没有构建产物，也没有 legacy 原版）`);
    }
    continue;
  }

  // 已迁移脚本（有 src）绝不能用 legacy 原版发布：那是线上快照，不是本次源码。
  if (artifact.kind === 'legacy 原版' && (await newestSourceTime(path.join(pkg.dir, 'src')))) {
    problems.push(
      `${pkg.slug}：有 src 源码却没有构建产物，先运行 bun run build ${pkg.slug} 再发布`,
    );
    continue;
  }
  if (artifact.stale) {
    problems.push(`${pkg.slug}：构建产物比源码旧，先运行 bun run build ${pkg.slug} 再发布`);
    continue;
  }

  const content = await readFile(artifact.file, 'utf8');
  const version = parseVersion(content);
  if (!version) {
    problems.push(`${pkg.slug}：${artifact.kind}缺少 @version`);
    continue;
  }

  const target = path.join(OUT_DIR, `${pkg.slug}.user.js`);
  if (await exists(target)) {
    const current = await readFile(target, 'utf8');
    if (sameArtifact(current, content)) {
      unchanged.push(`${pkg.slug}@${version}`);
      continue;
    }

    const currentVersion = parseVersion(current);
    if (!currentVersion) {
      problems.push(`${pkg.slug}：发布目录里的旧文件缺少 @version`);
      continue;
    }

    // 名称、匹配站点、权限变化会影响安装提示，必须由人确认后手动触发。
    if (stableFields(current) !== stableFields(content) && process.env.ALLOW_META_CHANGE !== '1') {
      problems.push(
        `${pkg.slug}：@name / @match / @include / @grant 有变化，维护者确认后在推送的提交信息里写 [allow-meta]（已经 push 过的用 gh workflow run release.yml -f allow_meta_change=true 补发；本地复验设 ALLOW_META_CHANGE=1）`,
      );
      continue;
    }

    const order = compareVersions(version, currentVersion);
    if (order < 0) {
      problems.push(
        `${pkg.slug}：版本从 ${currentVersion} 退到 ${version}，请先同步线上版本并提升版本号`,
      );
      continue;
    }
    if (order === 0) {
      problems.push(`${pkg.slug}：内容有改动但版本仍是 ${version}，请先提升 package.json 的版本`);
      continue;
    }
  }

  pendingWrites.push({ target, content });
  changed.push(`${pkg.slug}@${version}（${artifact.kind}）`);
}

if (problems.length === 0) {
  for (const item of pendingWrites) await writeFile(item.target, item.content, 'utf8');
}

// 脚本包已从仓库删除时，清掉发布目录里的旧文件；有任何问题时不动，避免半成品。
if (problems.length === 0) {
  for (const entry of await readdir(OUT_DIR)) {
    if (!entry.endsWith('.user.js') || expected.has(entry)) continue;
    await unlink(path.join(OUT_DIR, entry));
    removed.push(entry);
  }
}

if (changed.length > 0 && problems.length === 0) {
  console.log(`待发布 ${changed.length} 个：`);
  for (const item of changed) console.log(`  + ${item}`);
}
if (removed.length > 0) {
  console.log(`清理已下线 ${removed.length} 个：${removed.join('、')}`);
}
if (unchanged.length > 0) {
  console.log(`未变化 ${unchanged.length} 个：${unchanged.join('、')}`);
}
if (skipped.length > 0) {
  console.log(`跳过 ${skipped.length} 个：${skipped.join('、')}`);
}
if (problems.length > 0) {
  console.error(`\n发现 ${problems.length} 个问题：`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exitCode = 1;
} else if (changed.length === 0 && removed.length === 0) {
  console.log('没有需要发布的变更。');
}
