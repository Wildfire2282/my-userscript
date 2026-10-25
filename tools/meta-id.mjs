/**
 * 元数据里的安装地址必须指向本脚本自己的 Greasy Fork ID。
 *
 * 复制旧脚本的元数据再改字段时，`@downloadURL` / `@updateURL` 很容易留在旧 ID；
 * 管理器更新时会拉到别人的脚本，用户侧无法恢复。
 */
export function scriptIdProblems(fields, expectedId, label) {
  if (!expectedId) return [];
  const problems = [];
  for (const key of ['@downloadURL', '@updateURL']) {
    const values = fields.get(key) ?? [];
    const value = values.length === 1 ? values[0] : null;
    if (!value) continue;
    const actual = /\/scripts\/(\d+)\//.exec(value)?.[1];
    if (actual && actual !== expectedId) {
      problems.push(`${label} ${key} 指向脚本 ${actual}，应为 ${expectedId}`);
    }
  }
  return problems;
}

/** 从 scripts.json 里取包对应的 Greasy Fork ID；清单缺失或形状不对时返回 null。 */
export function idFromManifest(manifest, slug) {
  const entries =
    manifest && typeof manifest === 'object' && Array.isArray(manifest.scripts)
      ? manifest.scripts
      : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.package !== `scripts/${slug}`) continue;
    if (entry.id === null || entry.id === undefined || String(entry.id).trim() === '') continue;
    return String(entry.id);
  }
  return null;
}
