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
  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    // ?? 防不住 NaN（'ab:cd' 会算出 NaN）：非数字一律按认不出处理。
    if (
      minutes === undefined ||
      seconds === undefined ||
      !Number.isFinite(minutes) ||
      !Number.isFinite(seconds)
    ) {
      return 0;
    }
    return minutes * 60 + seconds;
  }
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    if (
      hours === undefined ||
      minutes === undefined ||
      seconds === undefined ||
      !Number.isFinite(hours) ||
      !Number.isFinite(minutes) ||
      !Number.isFinite(seconds)
    ) {
      return 0;
    }
    return hours * 3600 + minutes * 60 + seconds;
  }
  return 0;
}

/** 毫秒 → 复制到剪贴板里的 `分:秒`；未知时间戳返回空串。 */
export function fmtTs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '';
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
