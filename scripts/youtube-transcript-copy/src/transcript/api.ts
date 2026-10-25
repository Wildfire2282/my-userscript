import { extractFromPanelResponse } from './extract';
import type { Segment } from './types';

/**
 * 直接问 YouTube 要转写面板。
 *
 * 这是最后一条路：前面的网络缓存与 DOM 都拿不到时才发请求。客户端版本优先读
 * 页面自己的配置，读不到才用写死的兜底，这样 YouTube 升级后主路径不受影响。
 */

const API_ROOT = 'https://www.youtube.com/youtubei/v1/';
const FALLBACK_CLIENT_VERSION = '2.20260710.06.00';

/** 页面自带的配置对象；YouTube 改版挪位置也不怕，读不到就回退写死的版本。 */
interface YtConfig {
  get?: (key: string) => unknown;
}

/** 读页面当前的客户端版本，读不到返回 null（调用方用写死的兜底）。 */
export function readPageClientVersion(
  scope: { ytcfg?: YtConfig } = globalThis as { ytcfg?: YtConfig },
): string | null {
  try {
    const version = scope.ytcfg?.get?.('CLIENT_VERSION');
    return typeof version === 'string' && version !== '' ? version : null;
  } catch {
    return null;
  }
}

/**
 * 请求当前视频的转写面板。
 *
 * @param videoId 视频 ID；为空时不发请求
 * @param fetchImpl 便于测试替换的 fetch
 * @param clientVersion 客户端版本；不传时读页面配置，读不到用写死的兜底
 */
export async function requestPanel(
  videoId: string,
  fetchImpl: typeof fetch = fetch,
  clientVersion: string = readPageClientVersion() ?? FALLBACK_CLIENT_VERSION,
): Promise<Segment[] | null> {
  if (videoId === '') return null;
  try {
    const context = { client: { clientName: 'WEB', clientVersion } };
    const request = async (
      endpoint: string,
      payload: Record<string, unknown>,
      query = '',
    ): Promise<unknown> => {
      const suffix = query === '' ? '' : `&${query}`;
      const response = await fetchImpl(`${API_ROOT}${endpoint}?prettyPrint=false${suffix}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context, ...payload }),
      });
      return response.json();
    };
    // params 是页面给当前视频的转写令牌，不能靠面板名定位视频，也不能复用旧页面令牌。
    const next = (await request('next', { videoId })) as {
      engagementPanels?: Array<{
        engagementPanelSectionListRenderer?: {
          panelIdentifier?: string;
          content?: {
            continuationItemRenderer?: {
              continuationEndpoint?: { getTranscriptEndpoint?: { params?: unknown } };
            };
          };
        };
      }>;
    } | null;
    const panels = next?.engagementPanels;
    if (!Array.isArray(panels)) return null;
    const panel = panels.find(
      (entry) =>
        entry?.engagementPanelSectionListRenderer?.panelIdentifier ===
        'engagement-panel-searchable-transcript',
    )?.engagementPanelSectionListRenderer;
    const params =
      panel?.content?.continuationItemRenderer?.continuationEndpoint?.getTranscriptEndpoint?.params;
    if (typeof params !== 'string' || params === '') return null;
    // 令牌请求没有视频 ID；不显式带上，网络钩子会把迟到的 A 文稿归到当前 B。
    const data = await request('get_transcript', { params }, `v=${encodeURIComponent(videoId)}`);
    return extractFromPanelResponse(data);
  } catch {
    return null;
  }
}
