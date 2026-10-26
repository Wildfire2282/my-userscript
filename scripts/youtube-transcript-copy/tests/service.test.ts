import { describe, expect, it, vi } from 'vitest';
import { createTranscriptService, type TranscriptServiceDeps } from '../src/transcript/service';
import type { Segment, StrategyKind, StrategyMemory } from '../src/transcript/types';

const A: Segment[] = [{ start: 0, text: '来自初始字幕轨' }];
const B: Segment[] = [{ start: 0, text: '来自网络缓存' }];
const C: Segment[] = [{ start: 0, text: '来自 view-model' }];
const D: Segment[] = [{ start: 0, text: '来自纯文本行' }];
const E: Segment[] = [{ start: 0, text: '来自 API' }];

function setup(overrides: Partial<TranscriptServiceDeps> = {}) {
  const memory: StrategyMemory = {};
  const remembered: Array<[StrategyKind, number]> = [];
  const deps: TranscriptServiceDeps = {
    videoId: () => 'video-one',
    fromInitialTrack: vi.fn(() => Promise.resolve(null)),
    fromNetworkCache: vi.fn(() => null),
    ensurePanelOpen: vi.fn(() => Promise.resolve(true)),
    fromViewModel: vi.fn(() => null),
    fromPanelDump: vi.fn(() => null),
    fromApi: vi.fn(() => Promise.resolve(null)),
    memory: {
      get: () => memory,
      remember: (kind, index) => {
        remembered.push([kind, index]);
        memory[kind] = { idx: index, at: 0 };
      },
    },
    ...overrides,
  };
  return { deps, memory, remembered, service: createTranscriptService(deps) };
}

describe('createTranscriptService', () => {
  it('初始字幕轨优先，成功后记住网络策略并缓存结果', async () => {
    const { deps, service, remembered } = setup({
      fromInitialTrack: vi.fn(() => Promise.resolve(A)),
      fromNetworkCache: vi.fn(() => B),
    });
    await expect(service.fetchTranscript()).resolves.toEqual(A);
    expect(remembered).toEqual([['net', 0]]);
    expect(deps.ensurePanelOpen).not.toHaveBeenCalled();

    await expect(service.fetchTranscript()).resolves.toEqual(A);
    expect(deps.fromInitialTrack).toHaveBeenCalledTimes(1);
  });

  it('初始字幕轨失败时用网络缓存，记住第二个下标', async () => {
    const { service, remembered } = setup({ fromNetworkCache: vi.fn(() => B) });
    await expect(service.fetchTranscript()).resolves.toEqual(B);
    expect(remembered).toEqual([['net', 1]]);
  });

  it('记住的下标会把对应策略提到最前面', async () => {
    const { deps, service } = setup({
      fromInitialTrack: vi.fn(() => Promise.resolve(A)),
      fromNetworkCache: vi.fn(() => B),
    });
    deps.memory.get().net = { idx: 1, at: 0 };
    await expect(service.fetchTranscript()).resolves.toEqual(B);
    expect(deps.fromInitialTrack).not.toHaveBeenCalled();
  });

  it('静默层都没有结果时才打开面板，再按 DOM 策略取', async () => {
    const { deps, service, remembered } = setup({ fromViewModel: vi.fn(() => C) });
    await expect(service.fetchTranscript()).resolves.toEqual(C);
    expect(deps.fromApi).toHaveBeenCalledTimes(1);
    expect(deps.ensurePanelOpen).toHaveBeenCalledTimes(1);
    expect(deps.fromPanelDump).not.toHaveBeenCalled();
    expect(remembered).toEqual([['dom', 0]]);
  });

  it('静默层的尝试顺序：字幕轨 → 缓存 → 直接请求 → 打开面板', async () => {
    const calls: string[] = [];
    const { service } = setup({
      fromInitialTrack: vi.fn(() => {
        calls.push('track');
        return Promise.resolve(null);
      }),
      fromNetworkCache: vi.fn(() => {
        calls.push('cache');
        return null;
      }),
      fromApi: vi.fn(() => {
        calls.push('api');
        return Promise.resolve(null);
      }),
      ensurePanelOpen: vi.fn(() => {
        calls.push('panel');
        return Promise.resolve(true);
      }),
      fromViewModel: vi.fn(() => {
        calls.push('dom');
        return null;
      }),
      fromPanelDump: vi.fn(() => {
        calls.push('dump');
        return null;
      }),
    });
    await expect(service.fetchTranscript()).resolves.toEqual([]);
    // 打开面板后会再读一次缓存：页面自己的请求此时才可能留下完整响应。
    expect(calls).toEqual(['track', 'cache', 'api', 'panel', 'cache', 'dom', 'dump']);
  });

  it('直接请求成功时不动页面，并把静默层的下标记到最后一位', async () => {
    const { deps, service, remembered } = setup({
      fromApi: vi.fn(() => Promise.resolve(E)),
      fromViewModel: vi.fn(() => C),
    });
    await expect(service.fetchTranscript()).resolves.toEqual(E);
    expect(deps.ensurePanelOpen).not.toHaveBeenCalled();
    expect(deps.fromViewModel).not.toHaveBeenCalled();
    expect(remembered).toEqual([['net', 2]]);
  });

  it('view-model 失败时改用纯文本行', async () => {
    const { service, remembered } = setup({ fromPanelDump: vi.fn(() => D) });
    await expect(service.fetchTranscript()).resolves.toEqual(D);
    expect(remembered).toEqual([['dom', 1]]);
  });

  it('静默层的记忆把上次成功的直接请求提到最前面', async () => {
    const { deps, service } = setup({
      fromInitialTrack: vi.fn(() => Promise.resolve(A)),
      fromApi: vi.fn(() => Promise.resolve(E)),
    });
    deps.memory.get().net = { idx: 2, at: 0 };
    await expect(service.fetchTranscript()).resolves.toEqual(E);
    expect(deps.fromInitialTrack).not.toHaveBeenCalled();
    expect(deps.ensurePanelOpen).not.toHaveBeenCalled();
  });

  it('单个策略抛错时继续下一个', async () => {
    const { service } = setup({
      fromInitialTrack: vi.fn(() => Promise.reject(new Error('boom'))),
      fromNetworkCache: vi.fn(() => B),
    });
    await expect(service.fetchTranscript()).resolves.toEqual(B);
  });

  it('所有策略都失败时返回空数组', async () => {
    const { service } = setup();
    await expect(service.fetchTranscript()).resolves.toEqual([]);
  });

  it('换视频后旧缓存失效，重新抓取', async () => {
    let videoId = 'video-one';
    const { deps, service } = setup({
      videoId: () => videoId,
      fromNetworkCache: vi.fn(() => B),
    });
    await expect(service.fetchTranscript()).resolves.toEqual(B);

    videoId = 'video-two';
    (deps.fromNetworkCache as ReturnType<typeof vi.fn>).mockReturnValue(C);
    await expect(service.fetchTranscript()).resolves.toEqual(C);
    expect(deps.fromNetworkCache).toHaveBeenCalledTimes(2);
  });

  it('打开面板期间抓到完整响应时优先于局部 DOM', async () => {
    let captured: Segment[] | null = null;
    const { service } = setup({
      fromNetworkCache: () => captured,
      ensurePanelOpen: () => {
        captured = B;
        return Promise.resolve(true);
      },
      fromViewModel: () => C,
    });
    await expect(service.fetchTranscript()).resolves.toEqual(B);
  });

  it('面板打不开且静默层也没结果时返回空数组', async () => {
    const { deps, service } = setup({
      ensurePanelOpen: vi.fn(() => Promise.resolve(false)),
    });
    await expect(service.fetchTranscript()).resolves.toEqual([]);
    expect(deps.fromViewModel).not.toHaveBeenCalled();
    expect(deps.fromPanelDump).not.toHaveBeenCalled();
  });

  it('面板打开但 DOM 也读不到时不再发第二次请求', async () => {
    const { deps, service } = setup({ fromApi: vi.fn(() => Promise.resolve(null)) });
    await expect(service.fetchTranscript()).resolves.toEqual([]);
    expect(deps.fromApi).toHaveBeenCalledTimes(1);
    expect(deps.ensurePanelOpen).toHaveBeenCalledTimes(1);
  });

  it('局部 DOM 不阻止下一次取得完整网络文稿', async () => {
    let captured: Segment[] | null = null;
    const { service } = setup({ fromNetworkCache: () => captured, fromViewModel: () => C });
    await expect(service.fetchTranscript()).resolves.toEqual(C);
    captured = B;
    await expect(service.fetchTranscript()).resolves.toEqual(B);
  });

  it('取数中途换视频时丢弃旧结果，不写入缓存', async () => {
    let videoId = 'video-one';
    let resolveTrack!: (value: Segment[] | null) => void;
    const pending = new Promise<Segment[] | null>((resolve) => {
      resolveTrack = resolve;
    });
    const { deps, service } = setup({
      videoId: () => videoId,
      fromInitialTrack: vi.fn(() => pending),
    });
    const fetching = service.fetchTranscript();
    videoId = 'video-two';
    resolveTrack(A);
    await expect(fetching).resolves.toEqual([]);
    // 旧结果没进缓存：切回来重新取会再次请求，而不是命中脏缓存。
    videoId = 'video-one';
    await expect(service.fetchTranscript()).resolves.toEqual(A);
    expect(deps.fromInitialTrack).toHaveBeenCalledTimes(2);
  });
});
