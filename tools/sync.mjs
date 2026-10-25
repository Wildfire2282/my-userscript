#!/usr/bin/env bun
/**
 * 从 Greasy Fork 同步 Wildfire2282 发布的全部用户脚本到 monorepo。
 *
 * 每个脚本对应 scripts/<slug>/ 包，本工具负责：
 *   1. 遍历用户页（含分页）发现全部脚本；
 *   2. 从脚本详情页解析真实安装地址并下载最新 .user.js；
 *   3. 写入该包的 legacy/ 目录（线上版本快照），必要时补齐 package.json 与
 *      元数据块（userscript.meta.ts / .js，已迁移的包不重复创建）；
 *   4. 重新生成 scripts.json 清单，并刷新 README.md 里的脚本表格。
 *
 * 用法：
 *   bun tools/sync.mjs            # 下载/更新有变化的脚本
 *   bun tools/sync.mjs --check    # 只检查，不写文件；有更新时退出码为 1
 *   bun tools/sync.mjs --force    # 忽略内容比对，强制重写全部脚本
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BASE_URL = 'https://greasyfork.org';
const USER_ID = 852134;
const USER_NAME = 'Wildfire2282';
const USER_URL = `${BASE_URL}/zh-CN/users/${USER_ID}-wildfire2282`;

/** 包目录名（英文别名）：Greasy Fork ID -> slug。新脚本同步后把目录改成更友好的名字。 */
export const SLUGS = {
  579560: 'youtube-transcript-copy',
  580630: 'super-drag',
  582371: 'capture-links',
  582576: 'selection-copy',
};

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 my-userscript-sync/1.0';

const README_START = '<!-- scripts:start -->';
const README_END = '<!-- scripts:end -->';
const MAX_PAGES = 30;

/** 下载失败且重试无效；`status` 是最后一次 HTTP 状态码（网络错误时为 null）。 */
export class FetchError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchBytes(url, { fetchFn = fetch, retries = 3, sleepFn = sleep } = {}) {
  let last = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchFn(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      if (response.status === 404 || response.status === 410) {
        throw new FetchError(`${url} 返回 ${response.status}`, response.status);
      }
      last = new FetchError(`收到 HTTP ${response.status}`, response.status);
    } catch (error) {
      // 404 / 410 是确定结论，重试也不会变。
      if (error instanceof FetchError) throw error;
      last = error;
    }
    if (attempt < retries) await sleepFn(1_500 * attempt);
  }
  const status = last instanceof FetchError ? last.status : null;
  throw new FetchError(`无法下载 ${url}：${last?.message ?? last}`, status);
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

function decodeEntities(text) {
  return text.replace(/&(?:#(x[0-9a-f]+|\d+)|([a-z]+));/gi, (whole, numeric, named) => {
    if (numeric) {
      const code =
        numeric[0] === 'x' || numeric[0] === 'X'
          ? Number.parseInt(numeric.slice(1), 16)
          : Number.parseInt(numeric, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[named.toLowerCase()] ?? whole;
  });
}

/**
 * 从用户页里收集 `<a class="script-link" href="/scripts/<ID>-<slug>">名称</a>`。
 *
 * 只做这一种结构，不引入 HTML 解析依赖；Greasy Fork 的用户页由服务端渲染。
 *
 * @param {string} html 用户页 HTML
 * @returns {Map<number, { name: string, slug: string }>} 按出现顺序，重复 ID 保留第一个
 */
export function parseScriptLinks(html) {
  const links = new Map();
  for (const anchor of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attributes = anchor[1];
    const classes = /\bclass\s*=\s*"([^"]*)"/i.exec(attributes)?.[1] ?? '';
    if (!classes.split(/\s+/).includes('script-link')) continue;
    const href = /\bhref\s*=\s*"([^"]*)"/i.exec(attributes)?.[1] ?? '';
    const target = /\/scripts\/(\d+)(?:-([^/?#]+))?/.exec(href);
    if (!target) continue;
    const id = Number(target[1]);
    if (links.has(id)) continue;
    const name = decodeEntities(anchor[2].replace(/<[^>]*>/g, ''))
      .split(/\s+/)
      .filter(Boolean)
      .join(' ');
    links.set(id, { name, slug: target[2] ?? '' });
  }
  return links;
}

/** 遍历用户页（含分页），返回 {ID: {名称, 页面 slug}}。 */
export async function discoverScripts({ fetchFn = fetch, sleepFn = sleep } = {}) {
  const found = new Map();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = page === 1 ? USER_URL : `${USER_URL}?page=${page}`;
    let body;
    try {
      body = (await fetchBytes(url, { fetchFn, sleepFn })).toString('utf8');
    } catch (error) {
      // 脚本不足一页时 Greasy Fork 对 page=2 返回 403，才算“没有下一页”。
      // 其它错误（超时、5xx）不能当成末尾：那会把清单悄悄截断。
      if (page === 1 || !(error instanceof FetchError) || error.status !== 403) throw error;
      break;
    }
    const links = parseScriptLinks(body);
    const fresh = [...links.keys()].filter((id) => !found.has(id));
    for (const id of fresh) found.set(id, links.get(id));
    if (fresh.length === 0) break;
    await sleepFn(300);
  }
  return found;
}

/** 从脚本详情页里取出 update.greasyfork.org 的安装地址。 */
export async function resolveInstallUrl(scriptId, { fetchFn = fetch, sleepFn = sleep } = {}) {
  const page = (
    await fetchBytes(`${BASE_URL}/zh-CN/scripts/${scriptId}`, { fetchFn, sleepFn })
  ).toString('utf8');
  const match =
    new RegExp(
      `https://update\\.greasyfork\\.org/scripts/${scriptId}/[^"'<>\\s]+\\.user\\.js`,
    ).exec(page) ??
    // 兜底同样锚定本脚本 ID：详情页里可能挂着“作者的其他脚本”，
    // 不限定 ID 会把别人的安装地址下载进本包。
    new RegExp(`https://update\\.greasyfork\\.org/scripts/${scriptId}/[^"'<>\\s]*`).exec(page);
  if (!match) throw new FetchError(`无法从脚本页解析安装地址：scripts/${scriptId}`);
  return decodeEntities(match[0]);
}

/** 解析 ==UserScript== 元数据块，保留重复键（如 @match）。 */
export function parseMetadata(text) {
  const metadata = new Map();
  let inside = false;
  for (const line of text.split(/\r?\n/)) {
    const stripped = line.trim();
    if (/^\/\/\s*==UserScript==$/.test(stripped)) {
      inside = true;
      continue;
    }
    if (/^\/\/\s*==\/UserScript==$/.test(stripped)) break;
    if (!inside) continue;
    // 值可以为空：`// @noframes` 也是合法字段，缺了它清单里就永远看不到这个标记。
    const match = /^\/\/\s*@([\w:.-]+)(?:\s+(.*))?$/.exec(stripped);
    if (!match) continue;
    const key = match[1];
    const values = metadata.get(key) ?? [];
    values.push((match[2] ?? '').trim());
    metadata.set(key, values);
  }
  return metadata;
}

/**
 * 取出文件顶部的 ==UserScript== 元数据块，用于生成 userscript.meta.js。
 *
 * 找不到结束标记时返回空串：把整份脚本体当 banner 写进 userscript.meta.js，
 * 下次构建会把它当作元数据块，出来的产物直接是坏的。
 */
export function extractBanner(text) {
  const lines = [];
  for (const line of text.split(/\r?\n/)) {
    lines.push(line);
    if (/^\/\/\s*==\/UserScript==$/.test(line.trim())) return `${lines.join('\n')}\n`;
  }
  return '';
}

/**
 * 下载到的是不是一份完整的用户脚本。
 *
 * Greasy Fork 会返回 200 的 HTML（维护页、验证页、代理错误页）：直接写进
 * legacy/ 会覆盖掉好的快照，而那份快照只能从 git 历史里找回。
 */
export function looksLikeUserscript(text, metadata) {
  if (!text.includes('==UserScript==') || !text.includes('==/UserScript==')) return false;
  return Boolean(first(metadata, 'version'));
}

function first(metadata, key) {
  return metadata.get(key)?.[0];
}

/** 优先用配置里的别名，其次用页面 slug（若为纯 ASCII）。 */
function slugFor(scriptId, pageSlug, slugs) {
  if (slugs[scriptId]) return slugs[scriptId];
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pageSlug ?? '')) return pageSlug;
  console.error(
    `  提示：脚本 ${scriptId} 没有配置英文别名，暂用 script-${scriptId} 作为包名；` +
      '可在 tools/sync.mjs 的 SLUGS 中补充。',
  );
  return `script-${scriptId}`;
}

function legacyPathFor(scriptsDir, slug, scriptId) {
  return path.join(scriptsDir, slug, 'legacy', `${scriptId}-${slug}.user.js`);
}

async function readIfExists(file) {
  try {
    return await readFile(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** 补齐包骨架（package.json / userscript.meta.js），已存在时不覆盖。 */
async function ensurePackage(scriptsDir, slug, text, metadata) {
  const directory = path.join(scriptsDir, slug);
  await mkdir(path.join(directory, 'legacy'), { recursive: true });

  const packageFile = path.join(directory, 'package.json');
  if ((await readIfExists(packageFile)) === null) {
    const version = first(metadata, 'version') ?? '0.0.0';
    const description = first(metadata, 'description') ?? '';
    const packageJson = {
      name: `@my-userscript/${slug}`,
      version,
      private: true,
      description,
      type: 'module',
      scripts: { build: `bun ../../tools/build.mjs ${slug}` },
    };
    await writeFile(packageFile, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
    console.log(`  已创建 scripts/${slug}/package.json`);
  }

  // 已迁移的包用 .ts 保存元数据（版本由构建注入），两种后缀都算已存在，
  // 否则每次 sync 都会多出一个过期、不参与构建的 .js 副本。
  const hasMeta = await Promise.all(
    ['userscript.meta.ts', 'userscript.meta.js'].map(
      async (name) => (await readIfExists(path.join(directory, name))) !== null,
    ),
  );
  if (hasMeta.some(Boolean)) return;

  const banner = extractBanner(text);
  if (banner) {
    await writeFile(path.join(directory, 'userscript.meta.js'), banner, 'utf8');
    console.log(`  已创建 scripts/${slug}/userscript.meta.js`);
  } else {
    console.error(`  警告：scripts/${slug}/ 的下载内容没有完整元数据块，未创建 userscript.meta.js`);
  }
}

/** 深比较用：键排序，值格式无关。 */
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])]),
    );
  }
  return value;
}

function manifestPayload(entries) {
  return JSON.stringify(sortValue(entries), null, 2);
}

/** 写 scripts.json；内容未变时保留旧的 generatedAt，避免无意义 diff。 */
async function writeManifest(manifestPath, entries, previous) {
  if (previous) {
    // 除了脚本数组，source 与 scriptCount 也要对得上：手改过的清单同样要修回来。
    const sameScripts = manifestPayload(previous.scripts ?? []) === manifestPayload(entries);
    const sameMeta =
      previous.source === USER_URL &&
      previous.scriptCount === entries.length &&
      typeof previous.generatedAt === 'string';
    if (sameScripts && sameMeta) return false;
  }

  const payload = {
    source: USER_URL,
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    scriptCount: entries.length,
    scripts: entries,
  };
  await writeFile(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return true;
}

function escapeCell(value) {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

/** 生成人类可读的脚本表：只保留「叫什么、干什么、怎么装」。 */
export function renderTable(entries) {
  const lines = ['| 脚本 | 作用 | 安装 |', '| --- | --- | --- |'];
  for (const entry of entries) {
    const name = escapeCell(entry.name || entry.slug);
    const description = escapeCell(entry.description ?? '');
    lines.push(`| ${name} | ${description} | [点此安装](${entry.downloadUrl}) |`);
  }
  return lines.join('\n');
}

/** 替换 README 中标记块之间的脚本表格；没有标记时原样返回。 */
async function updateReadme(readmePath, entries) {
  const raw = await readIfExists(readmePath);
  if (raw === null) {
    console.error('警告：找不到 README.md，脚本表格未更新。');
    return false;
  }
  const text = raw.toString('utf8');
  const start = text.indexOf(README_START);
  const end = text.indexOf(README_END);
  if (start === -1 || end === -1 || end < start) {
    // 标记被删掉后表格会悄悄停止维护：必须说出来，否则没人知道它已经不再更新。
    console.error(`警告：README.md 里缺少 ${README_START} / ${README_END} 标记，脚本表格未更新。`);
    return false;
  }

  const headerEnd = text.indexOf('\n', start);
  if (headerEnd === -1) {
    console.error('警告：README.md 的标记行不完整，脚本表格未更新。');
    return false;
  }
  const next = `${text.slice(0, headerEnd + 1)}${renderTable(entries)}\n${text.slice(end)}`;
  if (next === text) return false;
  await writeFile(readmePath, next, 'utf8');
  return true;
}

/** 本地 legacy/ 里已不在远端列表中的文件（只提示，不自动删除）。 */
async function orphanSnapshots(scriptsDir, entries) {
  const known = new Set(entries.map((entry) => path.basename(entry.file)));
  let packages;
  try {
    packages = await readdir(scriptsDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const orphans = [];
  for (const pkg of packages) {
    if (!pkg.isDirectory()) continue;
    let files;
    try {
      files = await readdir(path.join(scriptsDir, pkg.name, 'legacy'));
    } catch {
      continue;
    }
    for (const file of files) {
      if (file.endsWith('.user.js') && !known.has(file)) {
        orphans.push(`${pkg.name}/legacy/${file}`);
      }
    }
  }
  return orphans.sort();
}

/**
 * 同步入口。
 *
 * @param {object} [options]
 * @param {boolean} [options.checkOnly] 只检查，不写文件
 * @param {boolean} [options.force] 忽略内容比对，强制重写
 * @param {string} [options.root] 仓库根目录；测试用临时目录
 * @param {object} [options.slugs] ID -> slug 映射
 * @param {Function} [options.fetchFn] 替换网络实现
 * @param {Function} [options.discover] 替换脚本发现
 * @param {Function} [options.resolveInstallUrl] 替换安装地址解析
 * @param {Function} [options.sleepFn] 替换退避等待
 * @returns {Promise<number>} 0 成功，1 有更新（--check），2 内容不完整
 */
export async function sync(options = {}) {
  const {
    checkOnly = false,
    force = false,
    root = ROOT,
    slugs = SLUGS,
    fetchFn = fetch,
    discover = discoverScripts,
    resolveInstallUrl: resolve = resolveInstallUrl,
    sleepFn = sleep,
  } = options;
  const scriptsDir = path.join(root, 'scripts');
  const manifestPath = path.join(root, 'scripts.json');
  const readmePath = path.join(root, 'README.md');

  console.log(`发现脚本来源：${USER_URL}`);
  const discovered = await discover({ fetchFn, sleepFn });
  if (discovered.size === 0) {
    console.error('错误：没有在用户页上找到任何脚本。');
    return 2;
  }
  // 分页请求失败时 discover 会把“网络错误”当成“没有下一页”。清单一旦被截断，
  // scripts.json 与 README 表格会跟着少脚本，所以按已知脚本表做一次完整性校验：
  // 少一个就整轮失败，不写入半份清单。
  const missing = Object.entries(slugs)
    .filter(([id]) => !discovered.has(Number(id)))
    .map(([id, slug]) => `${id}（${slug}）`);
  if (missing.length > 0) {
    console.error(
      `错误：用户页上缺少已知脚本：${missing.join('、')}。` +
        '可能是分页请求失败，稍后重试；确认已下线时先从 SLUGS 里删除。',
    );
    return 2;
  }
  console.log(`共发现 ${discovered.size} 个脚本。\n`);

  let previous = null;
  const previousRaw = await readIfExists(manifestPath);
  if (previousRaw !== null) {
    try {
      previous = JSON.parse(previousRaw.toString('utf8'));
    } catch {
      previous = null;
    }
  }

  const entries = [];
  const changes = [];
  const pendingWrites = [];
  const ids = [...discovered.keys()].sort((left, right) => left - right);

  for (const [index, scriptId] of ids.entries()) {
    const listing = discovered.get(scriptId);
    const slug = slugFor(scriptId, listing.slug, slugs);
    const file = legacyPathFor(scriptsDir, slug, scriptId);

    const installUrl = await resolve(scriptId, { fetchFn, sleepFn });
    const raw = await fetchBytes(installUrl, { fetchFn, sleepFn });
    let text = raw
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
    if (!text.endsWith('\n')) text += '\n';

    const metadata = parseMetadata(text);
    const version = first(metadata, 'version');
    if (!looksLikeUserscript(text, metadata)) {
      // 半页 HTML 或截断的响应：不覆盖快照、不写清单，等下次重跑。
      console.error(
        `错误：scripts/${slug}/ 下载到的内容不是完整的用户脚本（缺元数据块或 @version），已中止。`,
      );
      return 2;
    }
    const oldRaw = await readIfExists(file);
    const oldText = oldRaw === null ? null : oldRaw.toString('utf8');
    const oldVersion = oldText === null ? null : first(parseMetadata(oldText), 'version');
    const changed = force || oldText !== text;

    if (changed) {
      changes.push(
        `${slug}/legacy/${path.basename(file)}: ${oldVersion ?? '(新增)'} -> ${version ?? '(未知版本)'}`,
      );
      if (!checkOnly) pendingWrites.push({ slug, scriptId, text, metadata });
    }

    entries.push({
      id: scriptId,
      name: first(metadata, 'name') || listing.name || slug,
      slug,
      package: `scripts/${slug}`,
      file: `scripts/${slug}/legacy/${path.basename(file)}`,
      version,
      description: first(metadata, 'description'),
      author: first(metadata, 'author') || USER_NAME,
      namespace: first(metadata, 'namespace'),
      license: first(metadata, 'license'),
      match: metadata.get('match') ?? [],
      downloadUrl: installUrl,
      scriptUrl: `${BASE_URL}/zh-CN/scripts/${scriptId}`,
      sha256: createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase(),
      size: Buffer.byteLength(text, 'utf8'),
    });
    console.log(`[${index + 1}/${ids.length}] scripts/${slug}/  v${version ?? '?'}`);
    await sleepFn(400);
  }

  if (checkOnly) {
    if (changes.length === 0) {
      console.log('\n所有脚本均为最新版本。');
      return 0;
    }
    console.log('\n检测到更新：');
    for (const line of changes) console.log(`  ${line}`);
    return 1;
  }

  // 全部下载与内容校验成功后再覆盖快照，避免后一个脚本下载失败留下半批更新。
  for (const item of pendingWrites) {
    await ensurePackage(scriptsDir, item.slug, item.text, item.metadata);
    await writeFile(legacyPathFor(scriptsDir, item.slug, item.scriptId), item.text, 'utf8');
  }

  const manifestChanged = await writeManifest(manifestPath, entries, previous);
  const readmeChanged = await updateReadme(readmePath, entries);

  console.log('');
  if (changes.length > 0) {
    console.log(`已写入 ${changes.length} 个脚本：`);
    for (const line of changes) console.log(`  ${line}`);
  } else {
    console.log('脚本内容无变化。');
  }
  console.log(`清单：${manifestChanged ? '已更新' : '无变化'}（scripts.json）`);
  if (readmeChanged) console.log('README 脚本表格已刷新。');

  const orphans = await orphanSnapshots(scriptsDir, entries);
  if (orphans.length > 0) {
    console.log('\n提示：以下本地文件已不在远端列表中，请确认后手动删除：');
    for (const name of orphans) console.log(`  ${name}`);
  }

  return 0;
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== '--check' && arg !== '--force');
  if (unknown.length > 0) {
    console.error(`错误：不认识的参数 ${unknown.join(' ')}`);
    console.error('用法：bun tools/sync.mjs [--check] [--force]');
    process.exitCode = 2;
  } else {
    try {
      process.exitCode = await sync({
        checkOnly: args.includes('--check'),
        force: args.includes('--force'),
      });
    } catch (error) {
      console.error(`错误：${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    }
  }
}
