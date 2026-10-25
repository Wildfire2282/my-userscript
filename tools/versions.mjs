/**
 * 版本比较：发布与同步共用同一套规则。
 *
 * 仓库版本都是 x.y.z，按数字逐段比较；遇到非数字段时退回自然排序。
 */
export function compareVersions(left, right) {
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
