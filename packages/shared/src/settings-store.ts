import type { GmApi } from './gm';
import { saveStoredSettings } from './storage';

/**
 * 设置的读取与保存。
 *
 * 每次 `get()` 都读一次存储，而不是长期缓存在内存里：多个标签页与同页 iframe 共用
 * 同一份存储，别处改完设置后，这边的下一次拖拽、复制、开面板就要按新值工作。
 *
 * 写失败时保留内存副本（这次浏览仍按新设置工作），并且不回读存储：否则存储里的
 * 旧值会把用户刚改的设置盖回去。
 */

export interface SettingsStore<T> {
  /** 当前设置；每次都反映存储里的最新值。 */
  get: () => T;
  /** 合并并写入；写入失败时新值只在内存里生效。 */
  update: (patch: Partial<T>) => T;
}

export interface SettingsStoreOptions<T> {
  api: GmApi;
  /** 存储键；沿用各脚本自己的旧键，见 AGENTS.md 6.4。 */
  key: string;
  /** 把存储里读到的任意值收敛成可用设置；也要能处理“没存过”（null）。 */
  normalize: (stored: unknown) => T;
}

/**
 * 创建设置仓库。
 *
 * @param options GM 适配层、存储键与收敛函数；测试里传假实现即可
 */
/** 写失败时的基线比较：存储值变了就说明别处写过，本页副本作废。 */
function shallowEqualValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) return false;
  const leftEntries = Object.entries(left);
  const rightRecord = right as Record<string, unknown>;
  return (
    leftEntries.length === Object.keys(rightRecord).length &&
    leftEntries.every(
      ([key, value]) => Object.hasOwn(rightRecord, key) && rightRecord[key] === value,
    )
  );
}

export function createSettingsStore<T>(options: SettingsStoreOptions<T>): SettingsStore<T> {
  // 上次写入失败的新值：只要存储还是“写之前读到的旧值”，就用它顶住，
  // 别处改了存储就跟存储走；本页的首次读不重试写，避免每次 get 都写存储。
  let pending: { value: T; base: unknown } | null = null;

  const get = (): T => {
    const raw = options.api.getValue(options.key, null);
    if (pending && !shallowEqualValue(raw, pending.base)) pending = null;
    return pending?.value ?? options.normalize(raw);
  };

  return {
    get,
    update(patch) {
      const raw = options.api.getValue(options.key, null);
      const next = options.normalize({ ...get(), ...patch });
      pending = saveStoredSettings(options.api, options.key, next)
        ? null
        : { value: next, base: raw };
      return next;
    },
  };
}
