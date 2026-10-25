// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { FetchError, parseScriptLinks, renderTable, sync } from './sync.mjs';

const tools = path.dirname(fileURLToPath(import.meta.url));
const roots = [];
const banner = '// ==UserScript==\n// @name example\n// @version 1.0.0\n// ==/UserScript==\n';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'userscript-pipeline-'));
  roots.push(root);
  mkdirSync(path.join(root, 'tools'));
  mkdirSync(path.join(root, 'scripts'));
  for (const name of [
    'artifact-freshness.mjs',
    'build.mjs',
    'release.mjs',
    'browser-check.mjs',
    'versions.mjs',
  ]) {
    cpSync(path.join(tools, name), path.join(root, 'tools', name));
  }
  return root;
}

function put(root, name, text = '') {
  const file = path.join(root, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

function run(root, name, ...args) {
  return spawnSync(process.execPath, [path.join(root, 'tools', name), ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function output(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('pipeline failure boundaries', () => {
  it('rejects a mixed known/unknown build request before building anything', () => {
    const root = fixture();
    put(root, 'scripts/example/package.json', '{"version":"1.0.0"}');
    const result = run(root, 'build.mjs', 'example', 'typo');
    expect(result.status).toBe(1);
    expect(output(result)).toContain('没有找到这些脚本包：typo');
    expect(output(result)).not.toContain('跳过 example');
  });

  it('rejects a migrated package with neither dist nor legacy', () => {
    const root = fixture();
    put(root, 'scripts/example/package.json', '{"version":"1.0.0"}');
    put(root, 'scripts/example/src/main.ts');
    const result = run(root, 'release.mjs', 'release');
    expect(result.status).toBe(1);
    expect(output(result)).toContain('有 src 源码却没有构建产物');
    expect(existsSync(path.join(root, 'release/example.user.js'))).toBe(false);
  });

  it('rejects a script directory without package.json instead of removing its release file', () => {
    const root = fixture();
    put(root, 'scripts/example/src/main.ts');
    const released = put(root, 'release/example.user.js', banner);
    const result = run(root, 'release.mjs', 'release');
    expect(result.status).toBe(1);
    expect(output(result)).toContain('缺少 package.json');
    expect(readFileSync(released, 'utf8')).toBe(banner);
  });

  it.each(['shared', 'userscript-ui'])(
    'rejects dist older than %s without writing release',
    (name) => {
      const root = fixture();
      const source = put(root, 'scripts/example/src/main.ts');
      const manifest = put(root, 'scripts/example/package.json', '{"version":"1.0.0"}');
      const dist = put(root, 'scripts/example/dist/example.user.js', banner);
      const shared = put(root, `packages/${name}/src/index.ts`);
      const now = Date.now() / 1000;
      for (const file of [source, manifest]) utimesSync(file, now - 30, now - 30);
      utimesSync(dist, now - 20, now - 20);
      utimesSync(shared, now - 10, now - 10);
      const result = run(root, 'release.mjs', 'release');
      expect(result.status).toBe(1);
      expect(output(result)).toContain('构建产物比源码旧');
      expect(existsSync(path.join(root, 'release/example.user.js'))).toBe(false);
    },
  );

  it('allows a fresh dist after shared input updates', () => {
    const root = fixture();
    const source = put(root, 'scripts/example/src/main.ts');
    const manifest = put(root, 'scripts/example/package.json', '{"version":"1.0.0"}');
    const shared = put(root, 'packages/shared/src/index.ts');
    const dist = put(root, 'scripts/example/dist/example.user.js', banner);
    const now = Date.now() / 1000;
    for (const file of [source, manifest, shared]) utimesSync(file, now - 20, now - 20);
    utimesSync(dist, now - 10, now - 10);
    const result = run(root, 'release.mjs', 'release');
    expect(result.status).toBe(0);
    expect(readFileSync(path.join(root, 'release/example.user.js'), 'utf8')).toBe(banner);
  });

  it('refuses to clean a source directory passed as the release target', () => {
    const root = fixture();
    const legacy = put(root, 'scripts/example/legacy/1-example.user.js', banner);
    const result = run(root, 'release.mjs', 'scripts/example/legacy');
    expect(result.status).toBe(1);
    expect(output(result)).toContain('发布目录不能是仓库根目录或 scripts/ 下的源码目录');
    expect(readFileSync(legacy, 'utf8')).toBe(banner);
  });

  it('does not silently omit a migrated package whose browser scenarios are missing', () => {
    const root = fixture();
    put(root, 'scripts/example/src/main.ts');
    const result = run(root, 'browser-check.mjs');
    expect(result.status).toBe(1);
    expect(output(result)).toContain('example 没有 tests/browser-scenarios.mjs');
  });
});

const syncBody = '// ==UserScript==\n// @name Example\n// @version 2.0.0\n// ==/UserScript==\n';

function syncOptions(root, scenario) {
  return {
    root,
    slugs: { 1: 'first', 2: 'second' },
    discover: async () =>
      new Map([
        [1, { name: 'First', slug: 'first' }],
        [2, { name: 'Second', slug: 'second' }],
      ]),
    resolveInstallUrl: async (scriptId) => String(scriptId),
    sleepFn: async () => {},
    fetchFn: async (url) => {
      if (url !== '2' || scenario === 'check') return new Response(syncBody, { status: 200 });
      if (scenario === 'invalid') {
        return new Response('<html>temporarily unavailable</html>', { status: 200 });
      }
      throw new Error('second download failed');
    },
  };
}

describe('sync', () => {
  it('parses script links without matching unrelated anchors', () => {
    const html = [
      '<a class="script-link" href="/zh-CN/scripts/1-first">First &amp; One</a>',
      '<a class="script-link" href="/zh-CN/scripts/2-second">Second</a>',
      '<a class="other" href="/zh-CN/scripts/3-third">Third</a>',
    ].join('\n');
    expect([...parseScriptLinks(html)]).toEqual([
      [1, { name: 'First & One', slug: 'first' }],
      [2, { name: 'Second', slug: 'second' }],
    ]);
  });

  it('escapes table cells', () => {
    expect(
      renderTable([{ name: 'A|B', description: 'x\ny', downloadUrl: 'https://example.com/a' }]),
    ).toContain('| A\\|B | x y | [点此安装](https://example.com/a) |');
  });

  it('check mode reports updates without creating files', async () => {
    const root = fixture();
    const data = path.join(root, 'data');
    expect(await sync({ ...syncOptions(data, 'check'), checkOnly: true })).toBe(1);
    expect(existsSync(data)).toBe(false);
  });

  it('writes snapshots, manifest and README table', async () => {
    const root = fixture();
    const manifest = put(root, 'scripts.json', '{"scripts": []}');
    const readme = put(
      root,
      'README.md',
      '# 标题\n\n<!-- scripts:start -->\n旧表格\n<!-- scripts:end -->\n',
    );

    expect(await sync(syncOptions(root, 'check'))).toBe(0);

    expect(readFileSync(path.join(root, 'scripts/first/legacy/1-first.user.js'), 'utf8')).toBe(
      syncBody,
    );
    const data = JSON.parse(readFileSync(manifest, 'utf8'));
    expect(data.scriptCount).toBe(2);
    expect(data.scripts.map((script) => [script.id, script.slug, script.version])).toEqual([
      [1, 'first', '2.0.0'],
      [2, 'second', '2.0.0'],
    ]);
    expect(readFileSync(readme, 'utf8')).toBe(
      '# 标题\n\n<!-- scripts:start -->\n' +
        '| 脚本 | 作用 | 安装 |\n' +
        '| --- | --- | --- |\n' +
        '| Example |  | [点此安装](1) |\n' +
        '| Example |  | [点此安装](2) |\n' +
        '<!-- scripts:end -->\n',
    );
  });

  it.each(['network', 'invalid'])(
    'preserves local files when the %s download fails',
    async (scenario) => {
      const root = fixture();
      const legacy = put(root, 'scripts/first/legacy/1-first.user.js', 'old snapshot');
      const manifest = put(root, 'scripts.json', '{"scripts": []}');
      const readme = put(root, 'README.md', 'unchanged readme');

      let result = null;
      try {
        result = await sync(syncOptions(root, scenario));
      } catch (error) {
        expect(error).toBeInstanceOf(FetchError);
      }
      if (scenario === 'invalid') expect(result).toBe(2);

      expect(readFileSync(legacy, 'utf8')).toBe('old snapshot');
      expect(readFileSync(manifest, 'utf8')).toBe('{"scripts": []}');
      expect(readFileSync(readme, 'utf8')).toBe('unchanged readme');
    },
  );

  it('线上版本低于本地快照时中止，不覆盖快照与清单', async () => {
    const root = fixture();
    const newer = '// ==UserScript==\n// @name First\n// @version 3.0.0\n// ==/UserScript==\n';
    const legacy = put(root, 'scripts/first/legacy/1-first.user.js', newer);
    const manifest = put(root, 'scripts.json', '{"scripts": []}');

    expect(await sync(syncOptions(root, 'check'))).toBe(2);
    expect(readFileSync(legacy, 'utf8')).toBe(newer);
    expect(readFileSync(manifest, 'utf8')).toBe('{"scripts": []}');
  });
});
