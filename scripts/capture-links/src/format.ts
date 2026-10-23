import type { LinkItem } from './links';
import type { CopyFormat } from './settings';

/**
 * 把选中的链接拼成剪贴板文本，每行一条。
 *
 * 输出目标是剪贴板而不是本页 DOM：标题里的括号、引号、尖括号要转义，
 * 否则粘到别处会得到坏掉的 Markdown / HTML。
 */
function escapeMarkdownTitle(title: string): string {
  return title.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatLinks(items: LinkItem[], format: CopyFormat): string {
  if (format === 'markdown')
    return items
      .map((item) =>
        // 地址里有括号时包一层 <>，否则 Markdown 会把地址提前截断。
        /[()]/.test(item.url)
          ? `[${escapeMarkdownTitle(item.title)}](<${item.url}>)`
          : `[${escapeMarkdownTitle(item.title)}](${item.url})`,
      )
      .join('\n');
  if (format === 'html')
    return items
      .map((item) => `<a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a>`)
      .join('\n');
  return items.map((item) => item.url).join('\n');
}
