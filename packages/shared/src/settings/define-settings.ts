import { createGmApi, type GmApi } from '../host/gm';
import { createSettingsStore, type SettingsStore } from '../host/settings-store';

/**
 * 设置定义：三个脚本的 `createSettingsStore(api = createGmApi())` 工厂逐字同形。
 *
 * 收敛形状仍由脚本提供（`normalize` 里做 `mergeDefaults + 逐字段回退`，单测直接覆盖）；
 * 这里只收掉重复的工厂接线，并补齐两块缺口：`reset()`（面板“恢复默认”用）与
 * `onChange()`（同页多处订阅设置变化用，第 5 步表单用）。
 */

export interface SettingsDefinition<T> {
  /** 存储键；沿用各脚本旧键，见 AGENTS.md 6.4。 */
  key: string;
  /** 没有存量设置时使用的值；`reset()` 写回它（经 `normalize` 收敛）。 */
  defaults: T;
  /** 把存储里读到的任意值收敛成可用设置；也要能处理“没存过”（null）。 */
  normalize: (stored: unknown) => T;
}

export interface DefinedSettings<T> extends SettingsStore<T> {
  /** 回到默认值并写回存储。 */
  reset: () => T;
  /** 订阅本页的设置变化；返回取消订阅。`update`/`reset` 后同步通知。 */
  onChange: (listener: (next: T) => void) => () => void;
}

export interface DefineSettingsOptions<T> extends SettingsDefinition<T> {
  /** GM 适配层；测试里可以传入假实现。 */
  api?: GmApi;
}

/**
 * 定义一份设置：读写存储、恢复默认、订阅变化。
 *
 * @param options 存储键、默认值、收敛函数
 */
export function defineSettings<T>(options: DefineSettingsOptions<T>): DefinedSettings<T> {
  const { key, defaults, normalize } = options;
  const api = options.api ?? createGmApi();
  const store = createSettingsStore({ api, key, normalize });
  const listeners = new Set<(next: T) => void>();

  const emit = (next: T): void => {
    for (const listener of [...listeners]) {
      try {
        listener(next);
      } catch {
        // 一个订阅者抛错不能打断其它订阅者与保存流程。
      }
    }
  };

  return {
    get: store.get,
    update(patch) {
      const next = store.update(patch);
      emit(next);
      return next;
    },
    reset() {
      // 经 normalize 收敛后写回：坏默认值不会污染存储。
      const next = normalize(structuredClone(defaults));
      api.setValue(key, next);
      emit(store.get());
      return store.get();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
