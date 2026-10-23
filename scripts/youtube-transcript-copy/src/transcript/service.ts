import { prioritize } from './strategy';
import type { Segment, StrategyKind, StrategyMemory } from './types';

/**
 * 取转写文稿的策略编排。
 *
 * 顺序：网络层（初始字幕轨 → 页面请求留下的缓存）→ 打开面板 → DOM 层
 * （view-model → 纯文本行）→ 直接请求 API。每层成功就记住下标，下次优先。
 * 所有依赖都通过参数注入，单测可以完整走一遍降级顺序而不碰真实页面。
 */

export interface TranscriptMemory {
  get: () => StrategyMemory;
  remember: (kind: StrategyKind, index: number) => void;
}

export interface TranscriptServiceDeps {
  videoId: () => string;
  fromInitialTrack: () => Promise<Segment[] | null>;
  fromNetworkCache: () => Segment[] | null;
  ensurePanelOpen: () => Promise<boolean>;
  fromViewModel: () => Segment[] | null;
  fromPanelDump: () => Segment[] | null;
  fromApi: (videoId: string) => Promise<Segment[] | null>;
  memory: TranscriptMemory;
}

export interface TranscriptService {
  /** 取当前视频的转写；所有策略都失败时返回空数组。 */
  fetchTranscript: () => Promise<Segment[]>;
}

type Strategy = () => Segment[] | null | Promise<Segment[] | null>;

export function createTranscriptService(deps: TranscriptServiceDeps): TranscriptService {
  /** 只缓存一个视频：YouTube 是 SPA，同一标签页里换视频后旧缓存必须失效。 */
  let cache: { videoId: string; segments: Segment[] } | null = null;

  const runStrategies = async (
    kind: StrategyKind,
    strategies: Strategy[],
  ): Promise<Segment[] | null> => {
    const saved = deps.memory.get()[kind]?.idx;
    for (const index of prioritize(strategies.length, saved)) {
      const strategy = strategies[index];
      if (!strategy) continue;
      try {
        const result = await strategy();
        if (result !== null && result.length > 0) {
          deps.memory.remember(kind, index);
          return result;
        }
      } catch {
        // 单个策略抛错时继续下一个：改版通常只弄坏其中一种。
      }
    }
    return null;
  };

  return {
    async fetchTranscript() {
      const videoId = deps.videoId();
      if (cache !== null && cache.videoId === videoId) return cache.segments;

      const fromNetwork = await runStrategies('net', [
        deps.fromInitialTrack,
        () => deps.fromNetworkCache(),
      ]);
      // 取数是异步的，中途换了视频就不能再用这次的结果：调包比报错更伤人。
      if (deps.videoId() !== videoId) return [];
      if (fromNetwork) {
        cache = { videoId, segments: fromNetwork };
        return fromNetwork;
      }

      if (!(await deps.ensurePanelOpen())) return [];
      if (deps.videoId() !== videoId) return [];

      const fromDom = await runStrategies('dom', [
        () => deps.fromViewModel(),
        () => deps.fromPanelDump(),
      ]);
      if (deps.videoId() !== videoId) return [];
      if (fromDom) {
        cache = { videoId, segments: fromDom };
        return fromDom;
      }

      try {
        const fromApi = await deps.fromApi(videoId);
        if (fromApi && fromApi.length > 0) {
          cache = { videoId, segments: fromApi };
          return fromApi;
        }
      } catch {
        // API 只是兜底，失败就返回空数组。
      }

      return [];
    },
  };
}
