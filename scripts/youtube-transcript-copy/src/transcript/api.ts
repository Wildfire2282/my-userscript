import { extractFromPanelResponse } from './extract';
import type { Segment } from './types';

/**
 * 直接问 YouTube 要转写面板。
 *
 * 这是最后一条路：前面的网络缓存与 DOM 都拿不到时才发请求。客户端版本优先读
 * 页面自己的配置，读不到才用写死的兜底，这样 YouTube 升级后主路径不受影响。
 */

const PANEL_URL = 'https://www.youtube.com/youtubei/v1/get_panel?prettyPrint=false';
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
    const response = await fetchImpl(PANEL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion } },
        panelIdentifier: 'engagement-panel-searchable-transcript',
      }),
    });
    const data: unknown = await response.json();
    return extractFromPanelResponse(data);
  } catch {
    return null;
  }
}
