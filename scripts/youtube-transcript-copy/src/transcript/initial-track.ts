import { extractFromJson3 } from './extract';
import type { Segment } from './types';

/**
 * `ytInitialPlayerResponse` 里的第一条字幕轨。
 *
 * 这是最快的一条路：不用打开面板、不用点按钮，直接按字幕地址取 json3。
 * 但页面在 `document-start` 时还没有这个对象，所以调用方要等 DOMContentLoaded 再读。
 */

export interface CaptionTrack {
  baseUrl: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 从播放器响应里取第一条字幕轨。
 *
 * @param response 通常是 `window.ytInitialPlayerResponse`
 * @returns 有 `baseUrl` 的字幕轨；没有字幕时返回 null
 */
export function readInitialTrack(response: unknown): CaptionTrack | null {
  const root = asRecord(response);
  const tracklist = asRecord(asRecord(root?.captions)?.playerCaptionsTracklistRenderer);
  const tracks = Array.isArray(tracklist?.captionTracks) ? tracklist.captionTracks : [];
  const first = asRecord(tracks[0]);
  const baseUrl = typeof first?.baseUrl === 'string' ? first.baseUrl : '';
  return baseUrl === '' ? null : { baseUrl };
}

/**
 * 下载并解析字幕轨。
 *
 * @param track 字幕轨
 * @param fetchImpl 便于测试替换的 fetch
 * @returns 转写片段；失败或没有内容时返回 null，由调用方继续下一个策略
 */
export async function fetchInitialTrack(
  track: CaptionTrack,
  fetchImpl: typeof fetch = fetch,
): Promise<Segment[] | null> {
  const url = `${track.baseUrl}${track.baseUrl.includes('?') ? '&' : '?'}fmt=json3`;
  try {
    const response = await fetchImpl(url, { credentials: 'include' });
    const data: unknown = await response.json();
    return extractFromJson3(data);
  } catch {
    // 字幕地址过期、跨域或格式变了：交给下一个策略。
    return null;
  }
}
