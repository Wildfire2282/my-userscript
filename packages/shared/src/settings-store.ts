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
export function createSettingsStore<T>(options: SettingsStoreOptions<T>): SettingsStore<T> {
  /** 写入失败后的内存副本；非 null 时不再相信存储里的旧值。 */
  let pending: T | null = null;

  const get = (): T => pending ?? options.normalize(options.api.getValue(options.key, null));

  return {
    get,
    update(patch) {
      const next = options.normalize({ ...get(), ...patch });
      pending = saveStoredSettings(options.api, options.key, next) ? null : next;
      return next;
    },
  };
}
