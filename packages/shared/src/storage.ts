import type { GmApi } from './gm';

/**
 * 设置读写：默认值合并 + 异常兜底。
 *
 * 合并规则刻意与线上脚本 `{ ...DEFAULT, ...stored }` 的行为保持一致：
 * 只合并普通对象，数组和标量整体覆盖，`null`/`undefined` 视为“没存过”。
 * 存储里多出来的键会保留，避免旧版本回退时丢掉新版本写入的字段。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  // 目标平台（Chrome 111+ / Node 20+）一定有 structuredClone，不再做 JSON 兜底。
  return structuredClone(value);
}

function mergeValue(defaultValue: unknown, storedValue: unknown): unknown {
  if (storedValue == null)
    return isRecord(defaultValue) ? mergeRecords(defaultValue, {}) : clone(defaultValue);
  if (isRecord(defaultValue) && isRecord(storedValue))
    return mergeRecords(defaultValue, storedValue);
  return storedValue;
}

function mergeRecords(
  defaults: Record<string, unknown>,
  stored: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(defaults)) {
    merged[key] = Object.hasOwn(stored, key)
      ? mergeValue(value, stored[key])
      : mergeValue(value, undefined);
  }
  for (const [key, value] of Object.entries(stored)) {
    // 存储里多出来的键按引用挂上后，调用方改合并结果会污染读缓存：深拷贝一份。
    if (!Object.hasOwn(merged, key)) merged[key] = clone(value);
  }
  return merged;
}

/**
 * 把存储里读到的任意值合并到默认值上。
 *
 * @param defaults 默认设置（不会被修改）
 * @param stored 存储里读到的原始值，可能是 null、字符串或残缺对象
 * @returns 新对象；调用方可以安全修改
 */
export function mergeDefaults<T>(defaults: T, stored: unknown): T {
  if (!isRecord(defaults)) throw new TypeError('mergeDefaults 需要一个对象作为默认值');
  if (!isRecord(stored)) return mergeRecords(defaults, {}) as T;
  return mergeRecords(defaults, stored) as T;
}

/**
 * 写入设置；失败时返回 false，由调用方决定是否保留内存副本。
 */
export function saveStoredSettings(api: GmApi, key: string, value: unknown): boolean {
  return api.setValue(key, value);
}
