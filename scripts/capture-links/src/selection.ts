import type { LinkItem } from './links';

/**
 * 批量勾选只影响当前筛选结果：用户看不到的链接不应该被“全选”带上，
 * 否则复制结果里会混进被筛掉的地址。
 */

export function selectAll(selected: ReadonlySet<string>, items: LinkItem[]): Set<string> {
  const next = new Set(selected);
  for (const item of items) next.add(item.id);
  return next;
}

export function selectNone(selected: ReadonlySet<string>, items: LinkItem[]): Set<string> {
  const next = new Set(selected);
  for (const item of items) next.delete(item.id);
  return next;
}

export function invertSelection(selected: ReadonlySet<string>, items: LinkItem[]): Set<string> {
  const next = new Set(selected);
  for (const item of items) {
    if (next.has(item.id)) next.delete(item.id);
    else next.add(item.id);
  }
  return next;
}

/** 当前筛选结果里被选中的条目，保持列表顺序。 */
export function pickedItems(selected: ReadonlySet<string>, items: LinkItem[]): LinkItem[] {
  return items.filter((item) => selected.has(item.id));
}
