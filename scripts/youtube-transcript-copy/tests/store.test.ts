import { describe, expect, it, vi } from 'vitest';
import type { GmApi } from '@shared';
import { POSITION_KEY, STRATEGY_KEY, createStore } from '../src/store';

function fakeGm(initial: Record<string, unknown> = {}): GmApi & { data: Map<string, unknown> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getValue: vi.fn((key: string, fallback: unknown) => (data.has(key) ? data.get(key) : fallback)),
    setValue: vi.fn((key: string, value: unknown) => {
      data.set(key, value);
      return true;
    }),
    registerMenuCommand: vi.fn(() => true),
  };
}

/** 删除通道由调用方注入；运行时才去调 GM_deleteValue，测试里换成 Map 操作。 */
function storeWithRemoval(gm: GmApi & { data: Map<string, unknown> }) {
  return createStore(gm, (key) => {
    gm.data.delete(key);
    return true;
  });
}

describe('按钮位置', () => {
  it('没有存量时返回 null，并把坏值当成没存过', () => {
    expect(createStore(fakeGm()).getPosition()).toBeNull();
    expect(createStore(fakeGm({ pos: { right: -1, top: 10 } })).getPosition()).toBeNull();
    expect(createStore(fakeGm({ pos: { right: '10', top: 10 } })).getPosition()).toBeNull();
    expect(createStore(fakeGm({ pos: null })).getPosition()).toBeNull();
  });

  it('读到合法位置并只在首次访问时走 GM', () => {
    const gm = fakeGm({ pos: { right: 24, top: 36 } });
    const store = createStore(gm);
    expect(store.getPosition()).toEqual({ right: 24, top: 36 });
    store.getPosition();
    expect(gm.getValue).toHaveBeenCalledTimes(1);
    expect(gm.getValue).toHaveBeenCalledWith(POSITION_KEY, null);
  });

  it('保存后立即生效并写回旧键', () => {
    const gm = fakeGm();
    const store = createStore(gm);
    store.savePosition({ right: 12, top: 16 });
    expect(store.getPosition()).toEqual({ right: 12, top: 16 });
    expect(gm.setValue).toHaveBeenCalledWith(POSITION_KEY, { right: 12, top: 16 });
  });

  it('重置位置时删掉存储键', () => {
    const gm = fakeGm({ pos: { right: 12, top: 16 } });
    const store = storeWithRemoval(gm);
    expect(store.getPosition()).toEqual({ right: 12, top: 16 });
    store.clearPosition();
    expect(store.getPosition()).toBeNull();
    expect(gm.data.has(POSITION_KEY)).toBe(false);
  });
});

describe('策略记忆', () => {
  it('坏值被忽略，只保留合法的下标', () => {
    const store = createStore(
      fakeGm({
        strategy: {
          net: { idx: 1, at: 123 },
          dom: { idx: -2, at: 1 },
          bad: 'nope',
        },
      }),
    );
    expect(store.getStrategy()).toEqual({ net: { idx: 1, at: 123 } });
  });

  it('记住策略时写入完整记忆并带上时间', () => {
    const gm = fakeGm({ strategy: { net: { idx: 0, at: 1 } } });
    const store = createStore(gm);
    store.rememberStrategy('dom', 1);
    expect(store.getStrategy()).toEqual({
      net: { idx: 0, at: 1 },
      dom: { idx: 1, at: expect.any(Number) },
    });
    expect(gm.setValue).toHaveBeenCalledWith(
      STRATEGY_KEY,
      expect.objectContaining({ dom: expect.objectContaining({ idx: 1 }) }),
    );
  });

  it('清空记忆时删掉存储键', () => {
    const gm = fakeGm({ strategy: { net: { idx: 1, at: 1 } } });
    const store = storeWithRemoval(gm);
    store.clearStrategy();
    expect(store.getStrategy()).toEqual({});
    expect(gm.data.has(STRATEGY_KEY)).toBe(false);
  });
});
