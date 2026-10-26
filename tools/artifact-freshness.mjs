/**
 * 构建产物新鲜度的事实来源：哪些输入算数、怎么求最新。
 *
 * `browser-check.mjs` 与 `release.mjs` 共用这里的输入集合与时间扫描，
 * 但失败策略各自保留：前者在场景前判失败，后者标记陈旧产物再统一判失败。
 * 新的构建输入（或新的共享源码目录）只改这里，不用两处同步。
 */

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 包根下进产物的文件：版本号与元数据也进 banner，只改它们同样是旧产物。 */
export const PACKAGE_INPUT_FILES = ['package.json', 'userscript.meta.ts', 'userscript.meta.js'];

/** 共享源码目录：共享运行时改动必须重新构建。 */
export const SHARED_INPUT_DIRS = ['packages/shared/src', 'packages/userscript-ui/src'];

/** 构建工具本身也决定产物内容：改了构建逻辑同样要重新构建。 */
export const TOOL_INPUT_FILES = ['build.mjs'];

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 同一次进程里共享目录会被每个包重复扫描：按目录缓存，避免 verify 里扫 12 遍。 */
const sourceTimeCache = new Map();

export function clearSourceTimeCache() {
  sourceTimeCache.clear();
}

/**
 * 目录树里最新的修改时间；没有匹配文件时返回 null。
 * 传 `only` 时只统计这些文件名；坏链接或正好被删除的文件按缺失处理。
 */
export async function newestSourceTime(dir, only = null) {
  const cacheKey = `${dir}\0${only === null ? '' : [...only].sort().join(',')}`;
  const cached = sourceTimeCache.get(cacheKey);
  if (cached !== undefined) return cached;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    sourceTimeCache.set(cacheKey, null);
    return null;
  }
  // 串行 stat 是 verify 里重复扫描共享目录时的主要耗时：子目录与文件并行取时间。
  const pending = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (only !== null) continue;
      pending.push(newestSourceTime(full));
    } else if (entry.isFile() && (only === null || only.includes(entry.name))) {
      pending.push(
        stat(full).then(
          (st) => st.mtimeMs,
          () => null,
        ),
      );
    }
  }
  if (pending.length === 0) {
    sourceTimeCache.set(cacheKey, null);
    return null;
  }
  let newest = null;
  for (const time of await Promise.all(pending)) {
    if (time !== null && (newest === null || time > newest)) newest = time;
  }
  sourceTimeCache.set(cacheKey, newest);
  return newest;
}

/**
 * 产物输入里最新的修改时间。
 *
 * 输入集合：自身 `src/`、包根的版本与元数据文件、两个共享源码目录、构建工具。
 * 缺失的输入按不存在算；全部缺失返回 null。`root` 只给测试用。
 */
export async function newestArtifactInput(packageDir, root = MODULE_ROOT) {
  const [source, meta, tool, ...shared] = await Promise.all([
    newestSourceTime(path.join(packageDir, 'src')),
    newestSourceTime(packageDir, PACKAGE_INPUT_FILES),
    newestSourceTime(path.join(root, 'tools'), TOOL_INPUT_FILES),
    ...SHARED_INPUT_DIRS.map((name) => newestSourceTime(path.join(root, name))),
  ]);
  const newest = Math.max(source ?? 0, meta ?? 0, tool ?? 0, ...shared.map((time) => time ?? 0));
  return newest === 0 ? null : newest;
}

/** 构建产物路径：`scripts/<slug>/dist/<slug>.user.js`。 */
export function artifactPath(packageDir, slug) {
  return path.join(packageDir, 'dist', `${slug}.user.js`);
}
