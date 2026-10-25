// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newestArtifactInput, newestSourceTime } from './artifact-freshness.mjs';

const roots = [];
let clock = 1_700_000_000;

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'userscript-freshness-'));
  roots.push(root);
  return root;
}

function put(root, name) {
  const file = path.join(root, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '// input');
  clock += 10;
  utimesSync(file, clock, clock);
  // utimesSync 按秒设置，stat 读回毫秒：断言用毫秒比较。
  return clock * 1000;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('newestSourceTime', () => {
  it('递归取最新，缺目录返回 null', async () => {
    const root = fixture();
    put(root, 'src/a.ts');
    const latest = put(root, 'src/nested/b.ts');

    expect(await newestSourceTime(path.join(root, 'src'))).toBe(latest);
    expect(await newestSourceTime(path.join(root, 'missing'))).toBe(null);
  });

  it('only 过滤只看包根文件，不进子目录', async () => {
    const root = fixture();
    const manifest = put(root, 'package.json');
    put(root, 'src/newer.ts');

    expect(await newestSourceTime(root, ['package.json', 'userscript.meta.ts'])).toBe(manifest);
  });
});

describe('newestArtifactInput', () => {
  it('合并自身源码、包根与共享源码，全部缺失返回 null', async () => {
    const root = fixture();
    put(root, 'scripts/example/src/main.ts');
    put(root, 'scripts/example/package.json');
    const latest = put(root, 'packages/shared/src/index.ts');

    expect(await newestArtifactInput(path.join(root, 'scripts/example'), root)).toBe(latest);
    // 包目录缺失时仍应看到共享源码：只有全部输入缺失才返回 null。
    expect(await newestArtifactInput(path.join(root, 'scripts/missing'), root)).toBe(latest);
    const empty = fixture();
    expect(await newestArtifactInput(path.join(empty, 'scripts/missing'), empty)).toBe(null);
  });

  it('构建工具变化也算产物输入', async () => {
    const root = fixture();
    put(root, 'scripts/example/src/main.ts');
    const latest = put(root, 'tools/build.mjs');

    expect(await newestArtifactInput(path.join(root, 'scripts/example'), root)).toBe(latest);
  });
});
