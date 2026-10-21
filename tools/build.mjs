#!/usr/bin/env node
/**
 * 统一构建入口。
 *
 * 约定：每个脚本包位于 scripts/<slug>/，包含：
 *   - userscript.meta.js   元数据块，构建时作为 banner 放在产物最顶部
 *   - src/main.ts          源码入口（也可以是 main.js / index.ts / index.js）
 *   - package.json         包信息；版本号与 userscript.meta.js 的 @version 保持一致
 *
 * 产物输出到 scripts/<slug>/dist/<slug>.user.js，可直接安装或上传 GreasyFork。
 * 尚未迁移的脚本没有 src/ 入口，会被跳过而不是报错。
 *
 * 用法：
 *   node tools/build.mjs                 # 构建所有已迁移的脚本
 *   node tools/build.mjs capture-links   # 只构建指定包（可传多个）
 *   node tools/build.mjs --minify        # 压缩产物
 */

import { access, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');
const UI_SRC = path.join(ROOT, 'packages', 'userscript-ui', 'src');

const ENTRY_CANDIDATES = ['src/main.ts', 'src/main.js', 'src/index.ts', 'src/index.js'];

const args = process.argv.slice(2);
const minify = args.includes('--minify');
const only = args.filter((arg) => !arg.startsWith('-'));

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function loadPackages() {
  const directories = await readdir(SCRIPTS_DIR, { withFileTypes: true });
  const packages = [];
  for (const entry of directories) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(SCRIPTS_DIR, entry.name);
    const packageFile = path.join(dir, 'package.json');
    if (!(await exists(packageFile))) continue;
    packages.push({
      slug: entry.name,
      dir,
      manifest: JSON.parse(await readFile(packageFile, 'utf8')),
    });
  }
  return packages.sort((a, b) => a.slug.localeCompare(b.slug));
}

async function findEntry(dir) {
  for (const candidate of ENTRY_CANDIDATES) {
    const file = path.join(dir, candidate);
    if (await exists(file)) return file;
  }
  return null;
}

function iifeName(slug) {
  const pascal = slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return `${pascal}Userscript`;
}

async function buildPackage(pkg) {
  const metaFile = path.join(pkg.dir, 'userscript.meta.js');
  if (!(await exists(metaFile))) {
    throw new Error('缺少 userscript.meta.js');
  }
  const banner = await readFile(metaFile, 'utf8');
  if (!banner.includes('==UserScript==') || !banner.includes('==/UserScript==')) {
    throw new Error('userscript.meta.js 不是完整的 ==UserScript== 元数据块');
  }

  const entry = await findEntry(pkg.dir);
  if (!entry) return { status: 'skipped' };

  const { build } = await import('vite');
  await build({
    configFile: false,
    root: pkg.dir,
    logLevel: 'warn',
    resolve: {
      alias: [
        { find: /^@ui$/, replacement: path.join(UI_SRC, 'index.ts') },
        { find: /^@ui\//, replacement: `${UI_SRC}/` },
      ],
    },
    build: {
      target: 'chrome111',
      cssTarget: 'chrome111',
      outDir: 'dist',
      emptyOutDir: true,
      minify: minify ? 'esbuild' : false,
      sourcemap: false,
      lib: {
        entry,
        formats: ['iife'],
        name: iifeName(pkg.slug),
        fileName: () => `${pkg.slug}.user.js`,
      },
      rollupOptions: {
        output: { banner: banner.endsWith('\n') ? banner : `${banner}\n` },
      },
    },
  });

  const output = path.join(pkg.dir, 'dist', `${pkg.slug}.user.js`);
  const { size } = await stat(output);
  return { status: 'built', output, size };
}

const all = await loadPackages();
const selected = all.filter((pkg) => only.length === 0 || only.includes(pkg.slug));

if (selected.length === 0) {
  console.error(`没有找到要构建的包：${only.join(', ') || '(全部)'}`);
  process.exit(1);
}

const built = [];
const skipped = [];
const failed = [];

for (const pkg of selected) {
  try {
    const result = await buildPackage(pkg);
    if (result.status === 'skipped') {
      skipped.push(pkg.slug);
      console.log(`跳过 ${pkg.slug}：尚未迁移（没有 src/main.* 入口）`);
      continue;
    }
    built.push({ slug: pkg.slug, ...result });
    console.log(
      `构建 ${pkg.slug} -> scripts/${pkg.slug}/dist/${pkg.slug}.user.js ` +
        `(${(result.size / 1024).toFixed(1)} KB)`,
    );
  } catch (error) {
    failed.push({ slug: pkg.slug, error });
    console.error(`构建失败 ${pkg.slug}: ${error.message}`);
  }
}

console.log(
  `\n完成：${built.length} 个构建，${skipped.length} 个跳过，${failed.length} 个失败。`,
);
if (skipped.length > 0) {
  console.log('跳过的脚本仍是 legacy 原版，迁移方法见 docs/migration-guide.md。');
}
process.exitCode = failed.length > 0 ? 1 : 0;
