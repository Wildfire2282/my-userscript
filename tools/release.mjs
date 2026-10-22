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
 * 用法：
 *   node tools/release.mjs <发布目录>
 */

import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');

const outArg = process.argv[2];
if (!outArg) {
  console.error('用法：node tools/release.mjs <发布目录>');
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

/** 从元数据块里取 @version。 */
function parseVersion(text) {
  const match = /^\/\/\s*@version\s+(\S+)/m.exec(text);
  return match?.[1] ?? null;
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
  const dist = path.join(dir, 'dist', `${slug}.user.js`);
  if (await exists(dist)) return { file: dist, kind: '构建产物' };

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
const problems = [];

for (const pkg of await loadPackages()) {
  const artifact = await findArtifact(pkg.dir, pkg.slug);
  if (!artifact) {
    skipped.push(`${pkg.slug}（没有构建产物，也没有 legacy 原版）`);
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
    if (current === content) {
      unchanged.push(`${pkg.slug}@${version}`);
      continue;
    }

    const currentVersion = parseVersion(current);
    if (!currentVersion) {
      problems.push(`${pkg.slug}：发布目录里的旧文件缺少 @version`);
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

  await writeFile(target, content, 'utf8');
  changed.push(`${pkg.slug}@${version}（${artifact.kind}）`);
}

if (changed.length > 0) {
  console.log(`待发布 ${changed.length} 个：`);
  for (const item of changed) console.log(`  + ${item}`);
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
} else if (changed.length === 0) {
  console.log('没有需要发布的变更。');
}
