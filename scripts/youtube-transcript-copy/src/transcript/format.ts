import type { Segment } from './types';

/**
 * 转写文稿的文本处理：清洗、时间戳互转、输出格式。
 *
 * 输出格式与线上旧版逐字一致：每条一行，有时间戳时加 `[分:秒] ` 前缀。
 * 时间戳只到分钟（`90:00` 表示 90 分钟），旧版没有小时位，这里保持不改。
 */

export function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * 把页面上的时间戳文字换算成毫秒。
 *
 * @param text `m:ss` 或 `h:mm:ss`
 * @returns 毫秒；格式不认识时按 0 处理
 */
export function tsToSec(text: string): number {
  const parts = text.split(':').map(Number);
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  if (parts.length === 3) return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  return 0;
}

/** 毫秒 → 复制到剪贴板里的 `分:秒`；未知时间戳返回空串。 */
export function fmtTs(ms: number | null): string {
  if (ms === null) return '';
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** 每条一行；没有时间戳的片段只输出文字。 */
export function formatLines(segments: Segment[]): string {
  return segments
    .map((segment) => {
      const timestamp = fmtTs(segment.start);
      return timestamp ? `[${timestamp}] ${segment.text}` : segment.text;
    })
    .join('\n');
}
