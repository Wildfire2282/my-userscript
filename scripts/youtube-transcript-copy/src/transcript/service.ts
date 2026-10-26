import { prioritize } from './strategy';
import type { Segment, StrategyKind, StrategyMemory } from './types';

/**
 * 取转写文稿的策略编排。
 *
 * 顺序：静默层（初始字幕轨 → 页面请求留下的缓存 → 直接请求 API）→ 打开面板 → DOM 层
 * （view-model → 纯文本行）。静默层不动页面，只有全部失败才打开面板。
 * 每层成功就记住下标，下次优先。所有依赖都通过参数注入，单测可以完整走一遍降级顺序
 * 而不碰真实页面。
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
      if (videoId === '') return [];
      if (cache !== null && cache.videoId === videoId) return cache.segments;

      const fromSilent = await runStrategies('net', [
        deps.fromInitialTrack,
        () => deps.fromNetworkCache(),
        () => deps.fromApi(videoId),
      ]);
      // 取数是异步的，中途换了视频就不能再用这次的结果：调包比报错更伤人。
      if (deps.videoId() !== videoId) return [];
      if (fromSilent) {
        cache = { videoId, segments: fromSilent };
        return fromSilent;
      }

      // 静默层全失败才动页面：打开面板既不保证成功，也不是拿文稿的唯一手段。
      const panelOpen = await deps.ensurePanelOpen();
      if (deps.videoId() !== videoId) return [];

      // 打开面板本身会触发网络请求，完整响应优先于此刻只渲染了一部分的 DOM。
      const captured = deps.fromNetworkCache();
      if (captured && captured.length > 0) {
        cache = { videoId, segments: captured };
        return captured;
      }

      if (panelOpen) {
        const fromDom = await runStrategies('dom', [
          () => deps.fromViewModel(),
          () => deps.fromPanelDump(),
        ]);
        if (deps.videoId() !== videoId) return [];
        if (fromDom) {
          // DOM 可能只包含当前渲染部分，不永久缓存，下一次仍允许网络结果补全。
          return fromDom;
        }
      }

      return [];
    },
  };
}
