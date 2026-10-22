import type { LinkItem } from './links';
import type { CopyFormat } from './settings';

/**
 * 把选中的链接拼成剪贴板文本，每行一条。
 *
 * 输出目标是剪贴板而不是本页 DOM，所以这里不做 HTML 转义：Markdown / HTML 格式
 * 要还原用户选中的标题与地址原文，与线上旧版逐字一致。
 */
export function formatLinks(items: LinkItem[], format: CopyFormat): string {
  if (format === 'markdown') return items.map((item) => `[${item.title}](${item.url})`).join('\n');
  if (format === 'html')
    return items.map((item) => `<a href="${item.url}">${item.title}</a>`).join('\n');
  return items.map((item) => item.url).join('\n');
}
