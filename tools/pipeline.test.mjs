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

const tools = path.dirname(fileURLToPath(import.meta.url));
const roots = [];
const banner = '// ==UserScript==\n// @name example\n// @version 1.0.0\n// ==/UserScript==\n';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'userscript-pipeline-'));
  roots.push(root);
  mkdirSync(path.join(root, 'tools'));
  mkdirSync(path.join(root, 'scripts'));
  for (const name of ['build.mjs', 'release.mjs', 'browser-check.mjs', 'sync.py']) {
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

  it('does not silently omit a migrated package whose browser scenarios are missing', () => {
    const root = fixture();
    put(root, 'scripts/example/src/main.ts');
    const result = run(root, 'browser-check.mjs');
    expect(result.status).toBe(1);
    expect(output(result)).toContain('example 没有 tests/browser-scenarios.mjs');
  });
});

const syncCases = String.raw`
import importlib.util
import sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('sync_tool', sys.argv[1])
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)
root = Path(sys.argv[2])
tool.SCRIPTS_DIR = root / 'scripts'
tool.MANIFEST_PATH = root / 'scripts.json'
tool.README_PATH = root / 'README.md'
tool.SLUGS = {1: 'first', 2: 'second'}
tool.discover_scripts = lambda: {1: ('First', 'first'), 2: ('Second', 'second')}
tool.resolve_install_url = lambda script_id: str(script_id)
tool.time.sleep = lambda _: None
body = b'// ==UserScript==\n// @name Example\n// @version 2.0.0\n// ==/UserScript==\n'
if sys.argv[3] == 'check':
    tool.fetch = lambda _: body
    assert tool.sync(check_only=True, force=False) == 1
    assert not tool.SCRIPTS_DIR.exists(), '--check created scripts directory'
else:
    legacy = tool.legacy_path('first', 1)
    legacy.parent.mkdir(parents=True)
    legacy.write_text('old snapshot', encoding='utf-8')
    tool.MANIFEST_PATH.write_text('{"scripts": []}', encoding='utf-8')
    tool.README_PATH.write_text('unchanged readme', encoding='utf-8')
    def fetch(url):
        if url == '2':
            if sys.argv[3] == 'invalid':
                return b'<html>temporarily unavailable</html>'
            raise tool.FetchError('second download failed')
        return body
    tool.fetch = fetch
    try:
        result = tool.sync(check_only=False, force=False)
    except tool.FetchError:
        assert sys.argv[3] == 'network'
    else:
        assert sys.argv[3] == 'invalid' and result == 2
    assert legacy.read_text(encoding='utf-8') == 'old snapshot', 'partial snapshot overwrite'
    assert tool.MANIFEST_PATH.read_text(encoding='utf-8') == '{"scripts": []}'
    assert tool.README_PATH.read_text(encoding='utf-8') == 'unchanged readme'
`;

describe('sync write boundaries', () => {
  it.each(['check', 'network', 'invalid'])('preserves local files for %s', (scenario) => {
    const root = fixture();
    // Python 本就是 sync 的运行前提；子进程只用模拟网络，不访问 Greasy Fork。
    const result = spawnSync(
      'python',
      ['-c', syncCases, path.join(root, 'tools/sync.py'), path.join(root, 'data'), scenario],
      {
        encoding: 'utf8',
        timeout: 10_000,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, output(result)).toBe(0);
  });
});
