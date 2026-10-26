// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { idFromManifest, scriptIdProblems } from './meta-id.mjs';

function fields(download, update = download) {
  return new Map([
    ['@downloadURL', [download]],
    ['@updateURL', [update]],
  ]);
}

describe('scriptIdProblems', () => {
  it('安装地址指向本脚本 ID 时不报错', () => {
    expect(
      scriptIdProblems(
        fields(
          'https://update.greasyfork.org/scripts/579560/a.user.js',
          'https://update.greasyfork.org/scripts/579560/a.meta.js',
        ),
        '579560',
        'meta',
      ),
    ).toEqual([]);
  });

  it('复制旧脚本的地址时同时指出两个字段', () => {
    const problems = scriptIdProblems(
      fields(
        'https://update.greasyfork.org/scripts/580630/a.user.js',
        'https://update.greasyfork.org/scripts/580630/a.meta.js',
      ),
      '579560',
      'meta',
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('580630');
    expect(problems[1]).toContain('579560');
  });

  it('没有可对照的 ID 或地址格式不认识时跳过', () => {
    expect(scriptIdProblems(fields('https://example.com/a.user.js'), null, 'meta')).toEqual([]);
    expect(scriptIdProblems(fields('https://example.com/a.user.js'), '579560', 'meta')).toEqual([]);
  });
});

describe('idFromManifest', () => {
  it('按包名取 ID，忽略无关条目', () => {
    const manifest = {
      scripts: [
        { package: 'scripts/other', id: 1 },
        { package: 'scripts/example', id: 579560 },
      ],
    };
    expect(idFromManifest(manifest, 'example')).toBe('579560');
    expect(idFromManifest(manifest, 'missing')).toBeNull();
  });

  it('清单形状不对时返回 null', () => {
    expect(idFromManifest(null, 'example')).toBeNull();
    expect(idFromManifest({ scripts: [null, 'x'] }, 'example')).toBeNull();
    expect(
      idFromManifest({ scripts: [{ package: 'scripts/example', id: '' }] }, 'example'),
    ).toBeNull();
  });
});
