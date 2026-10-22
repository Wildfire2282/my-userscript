import { extractFromPanelResponse } from './extract';
import type { Segment } from './types';

/**
 * 直接问 YouTube 要转写面板。
 *
 * 这是最后一条路：前面的网络缓存与 DOM 都拿不到时才发请求。客户端版本写死会随
 * YouTube 升级失效，但它在失败队列的最后，失效只影响兜底，不影响主路径。
 */

const PANEL_URL = 'https://www.youtube.com/youtubei/v1/get_panel?prettyPrint=false';
const CLIENT_VERSION = '2.20260710.06.00';

/**
 * 请求当前视频的转写面板。
 *
 * @param videoId 视频 ID；为空时不发请求
 * @param fetchImpl 便于测试替换的 fetch
 */
export async function requestPanel(
  videoId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Segment[] | null> {
  if (videoId === '') return null;
  try {
    const response = await fetchImpl(PANEL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: CLIENT_VERSION } },
        panelIdentifier: 'engagement-panel-searchable-transcript',
      }),
    });
    const data: unknown = await response.json();
    return extractFromPanelResponse(data);
  } catch {
    return null;
  }
}
