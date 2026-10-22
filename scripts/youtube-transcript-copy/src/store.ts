import { createGmApi, type GmApi } from '@shared';
import type { ButtonPosition } from './features/position';
import type { StrategyKind, StrategyMemory } from './transcript/types';

/**
 * 持久化：按钮位置与提取策略记忆。
 *
 * 两个键都沿用线上旧名（`pos` / `strategy`），改名会让老用户丢设置，见 AGENTS.md 6.4。
 * 读取结果缓存到内存，拖动与复制热路径不重复访问 GM。
 */

export const POSITION_KEY = 'pos';
export const STRATEGY_KEY = 'strategy';

export interface Store {
  getPosition: () => ButtonPosition | null;
  savePosition: (position: ButtonPosition) => void;
  clearPosition: () => void;
  getStrategy: () => StrategyMemory;
  rememberStrategy: (kind: StrategyKind, index: number) => void;
  clearStrategy: () => void;
}

interface DeleteGlobals {
  GM_deleteValue?: (key: string) => void;
}

/**
 * 删除存储值。
 *
 * 只有本脚本需要“恢复默认 / 清空记忆”，所以不放进 `@shared`：共享代码会进入每个
 * 脚本的产物，那样三个脚本都会凭空多出一个 GM 调用、并要求新增授权。
 */
function deleteStoredValue(key: string): boolean {
  const globals = globalThis as unknown as DeleteGlobals;
  if (typeof globals.GM_deleteValue !== 'function') return false;
  try {
    globals.GM_deleteValue(key);
    return true;
  } catch {
    return false;
  }
}

function normalizePosition(value: unknown): ButtonPosition | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const { right, top } = record;
  if (typeof right !== 'number' || typeof top !== 'number') return null;
  if (!Number.isFinite(right) || !Number.isFinite(top) || right < 0 || top < 0) return null;
  return { right, top };
}

function normalizeStrategy(value: unknown): StrategyMemory {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const memory: StrategyMemory = {};
  for (const [kind, choice] of Object.entries(value)) {
    if (typeof choice !== 'object' || choice === null) continue;
    const record = choice as Record<string, unknown>;
    if (typeof record.idx !== 'number' || !Number.isInteger(record.idx) || record.idx < 0) {
      continue;
    }
    memory[kind] = { idx: record.idx, at: typeof record.at === 'number' ? record.at : 0 };
  }
  return memory;
}

export function createStore(
  api: GmApi = createGmApi(),
  remove: (key: string) => boolean = deleteStoredValue,
): Store {
  let positionLoaded = false;
  let position: ButtonPosition | null = null;
  let memory: StrategyMemory | null = null;

  const getStrategy = (): StrategyMemory => {
    if (!memory) memory = normalizeStrategy(api.getValue(STRATEGY_KEY, null));
    return memory;
  };

  return {
    getPosition() {
      if (!positionLoaded) {
        position = normalizePosition(api.getValue(POSITION_KEY, null));
        positionLoaded = true;
      }
      return position;
    },
    savePosition(next) {
      position = next;
      positionLoaded = true;
      // 写入失败保留内存副本：这次浏览仍然按新位置显示，不打断用户。
      api.setValue(POSITION_KEY, next);
    },
    clearPosition() {
      position = null;
      positionLoaded = true;
      remove(POSITION_KEY);
    },
    getStrategy,
    rememberStrategy(kind, index) {
      const next: StrategyMemory = { ...getStrategy(), [kind]: { idx: index, at: Date.now() } };
      memory = next;
      api.setValue(STRATEGY_KEY, next);
    },
    clearStrategy() {
      memory = {};
      remove(STRATEGY_KEY);
    },
  };
}
