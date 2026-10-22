import {
  createButton,
  createCheckbox,
  createInput,
  createPanel,
  type PanelHandle,
  type UI,
} from '@ui';
import listCss from './link-list.css?inline';
import { scanLinks } from '../features/scan-page';
import { formatLinks } from '../format';
import { filterLinks, type LinkItem } from '../links';
import { invertSelection, pickedItems, selectAll, selectNone } from '../selection';
import type { CopyFormat } from '../settings';

/**
 * 链接面板：列出本页全部链接，支持关键词筛选、仅磁链、勾选与批量复制。
 *
 * 面板只创建一次，每次打开重新扫描页面并清空上一条链接的勾选状态。
 */

export interface LinkPanelOptions {
  ui: UI;
  getCopyFormat: () => CopyFormat;
  copy: (text: string) => Promise<boolean>;
  notify: (message: string, variant: 'success' | 'warning' | 'error') => void;
}

export interface LinkPanelHandle {
  panel: PanelHandle;
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
}

export function createLinkPanel(options: LinkPanelOptions): LinkPanelHandle {
  const { ui } = options;
  ui.useStyles(listCss);

  const panel = createPanel(ui, {
    title: '捕获链接',
    open: false,
    position: 'center',
    closeLabel: '关闭链接面板',
  });

  const toolbar = document.createElement('div');
  toolbar.className = 'cl-toolbar';

  const search = createInput(ui, {
    type: 'search',
    placeholder: '输入关键词筛选，例如 magnet:、.torrent、ed2k',
    ariaLabel: '按关键词筛选链接',
    onInput: () => applyFilter(),
  });
  search.el.classList.add('cl-search');

  const magnet = createCheckbox(ui, {
    ariaLabel: '仅显示磁力链接',
    onChange: () => applyFilter(),
  });
  const magnetLabel = document.createElement('label');
  magnetLabel.className = 'cl-toggle';
  magnetLabel.append(magnet.el, document.createTextNode('仅磁链'));

  const stats = document.createElement('span');
  stats.className = 'cl-stats';

  toolbar.append(search.el, magnetLabel, stats);

  const list = document.createElement('div');
  list.className = 'cl-list';

  panel.body.append(toolbar, list);

  let allItems: LinkItem[] = [];
  let filteredItems: LinkItem[] = [];
  let selectedIds = new Set<string>();

  /** 勾选状态按事件委托记在列表上：行会被反复重建，逐行挂监听无法可靠清理。 */
  list.addEventListener(
    'change',
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
      const id = target.dataset.id;
      if (id === undefined) return;
      if (target.checked) selectedIds.add(id);
      else selectedIds.delete(id);
      updateStats();
    },
    { signal: ui.signal },
  );

  function updateStats(): void {
    const chosen = filteredItems.filter((item) => selectedIds.has(item.id)).length;
    stats.textContent = `共 ${allItems.length} / 筛选 ${filteredItems.length} / 选中 ${chosen}`;
  }

  function createRow(item: LinkItem, index: number): HTMLElement {
    const row = document.createElement('label');
    row.className = 'cl-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'cl-check';
    checkbox.dataset.id = item.id;
    checkbox.checked = selectedIds.has(item.id);
    checkbox.setAttribute('aria-label', `选择 ${item.title}`);

    const number = document.createElement('span');
    number.className = 'cl-index';
    number.textContent = String(index + 1);

    const info = document.createElement('span');
    info.className = 'cl-info';

    const title = document.createElement('span');
    title.className = 'cl-title';
    title.textContent = item.title;

    const url = document.createElement('span');
    url.className = 'cl-url';
    url.textContent = item.url;

    info.append(title, url);
    row.append(checkbox, number, info);
    return row;
  }

  function render(): void {
    list.replaceChildren();
    if (filteredItems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cl-empty';
      empty.textContent = '无匹配结果';
      list.appendChild(empty);
    } else {
      filteredItems.forEach((item, index) => list.appendChild(createRow(item, index)));
    }
    updateStats();
  }

  function applyFilter(): void {
    filteredItems = filterLinks(allItems, search.getValue(), magnet.isChecked());
    render();
  }

  async function copySelected(): Promise<void> {
    const items = pickedItems(selectedIds, filteredItems);
    if (items.length === 0) {
      options.notify('未选中任何链接', 'warning');
      return;
    }
    const written = await options.copy(formatLinks(items, options.getCopyFormat()));
    // 写入失败时明确说没复制成功，不能让用户以为已经进了剪贴板。
    options.notify(
      written ? `已复制 ${items.length} 条链接` : '复制失败，请检查剪贴板权限',
      written ? 'success' : 'error',
    );
  }

  const selectAllButton = createButton(ui, {
    label: '全选',
    variant: 'secondary',
    onClick: () => {
      selectedIds = selectAll(selectedIds, filteredItems);
      render();
    },
  });
  const selectNoneButton = createButton(ui, {
    label: '全不选',
    variant: 'secondary',
    onClick: () => {
      selectedIds = selectNone(selectedIds, filteredItems);
      render();
    },
  });
  const invertButton = createButton(ui, {
    label: '反选',
    variant: 'secondary',
    onClick: () => {
      selectedIds = invertSelection(selectedIds, filteredItems);
      render();
    },
  });
  const copyButton = createButton(ui, {
    label: '复制选中',
    variant: 'primary',
    onClick: () => void copySelected(),
  });

  panel.setFooter([selectAllButton.el, selectNoneButton.el, invertButton.el, copyButton.el]);

  return {
    panel,
    open() {
      allItems = scanLinks();
      selectedIds = new Set();
      search.setValue('');
      magnet.setChecked(false);
      applyFilter();
      panel.open();
    },
    close: () => panel.close(),
    isOpen: () => panel.isOpen(),
  };
}
