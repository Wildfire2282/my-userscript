import { extractFromPanelResponse } from './extract';
import type { Segment } from './types';

/**
 * 直接问 YouTube 要转写面板。
 *
 * 这条路不动页面，是复制时的主路径；前面的字幕轨与网络缓存都拿不到时才轮到它，
 * 它再拿不到才由调用方决定是否打开面板。
 *
 * 请求尽量贴近页面自己发的：客户端版本、访客信息与上下文都先读页面配置，读不到才用
 * 写死的兜底，这样 YouTube 升级后主路径不受影响。
 */

const API_ROOT = 'https://www.youtube.com/youtubei/v1/';
const FALLBACK_CLIENT_VERSION = '2.20260710.06.00';

/** 页面自带的配置对象；YouTube 改版挪位置也不怕，读不到就回退写死的版本。 */
interface YtConfig {
  get?: (key: string) => unknown;
}

type YtScope = { ytcfg?: YtConfig };

function readConfig(key: string, scope: YtScope): unknown {
  try {
    return scope.ytcfg?.get?.(key);
  } catch {
    return undefined;
  }
}

/** 读页面当前的客户端版本，读不到返回 null（调用方用写死的兜底）。 */
export function readPageClientVersion(scope: YtScope = globalThis as YtScope): string | null {
  const version = readConfig('CLIENT_VERSION', scope);
  return typeof version === 'string' && version !== '' ? version : null;
}

/** 页面的访客标识；没有时返回空串，不伪造。 */
export function readPageVisitorData(scope: YtScope = globalThis as YtScope): string {
  const visitor = readConfig('VISITOR_DATA', scope);
  return typeof visitor === 'string' ? visitor : '';
}

/**
 * 页面自己的请求上下文（客户端名、版本、语言、地区等）。
 *
 * 用它发出的请求与页面点“显示转写文稿”时的请求最接近，静默路径才不容易被拒。
 * 读不到或形状不对时返回 null，由调用方拼最小上下文。
 */
export function readPageContext(
  scope: YtScope = globalThis as YtScope,
): Record<string, unknown> | null {
  const context = readConfig('INNERTUBE_CONTEXT', scope);
  return typeof context === 'object' && context !== null && !Array.isArray(context)
    ? (context as Record<string, unknown>)
    : null;
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
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-youtube-client-name': '1',
      'x-youtube-client-version': clientVersion,
    };
    const visitorData = readPageVisitorData();
    if (visitorData !== '') headers['x-goog-visitor-id'] = visitorData;
    const context = readPageContext() ?? { client: { clientName: 'WEB', clientVersion } };
    const request = async (
      endpoint: string,
      payload: Record<string, unknown>,
      query = '',
    ): Promise<unknown> => {
      const suffix = query === '' ? '' : `&${query}`;
      const response = await fetchImpl(`${API_ROOT}${endpoint}?prettyPrint=false${suffix}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ context, ...payload }),
      });
      return response.json();
    };
    // params 是页面给当前视频的转写令牌。不读 `ytInitialData` 里可能还停在上一个视频的
    // 令牌：单页换台后它不会更新，用它就会取到上一篇文稿。用 videoId 现取才绑定当前视频。
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
