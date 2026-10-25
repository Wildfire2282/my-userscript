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

/** 首屏最多建这么多行，剩下的点“显示更多”再加。 */
const PAGE_SIZE = 200;

export function createLinkPanel(options: LinkPanelOptions): LinkPanelHandle {
  const { ui } = options;
  ui.useStyles(listCss);

  const panel = createPanel(ui, {
    title: '操作面板',
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
  // 首屏只建这么多行：上千条链接一次全建会卡住，点“显示更多”再往后加。
  let shownCount = PAGE_SIZE;

  /** 勾选状态与“显示更多”都用事件委托：行会被反复重建，逐行挂监听会随重画次数累积。 */
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

  list.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('.cl-more')) return;
      shownCount += PAGE_SIZE;
      render();
      // 重画后旧按钮已被移除；还有下一批时把焦点交给新按钮，键盘用户才能继续展开。
      list.querySelector<HTMLButtonElement>('.cl-more')?.focus();
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
    // 行可能上百条：先拼进游离片段，最后一次插入，避免每次 append 都触发布局。
    const fragment = document.createDocumentFragment();
    if (filteredItems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cl-empty';
      empty.textContent = '无匹配结果';
      fragment.appendChild(empty);
    } else {
      filteredItems
        .slice(0, shownCount)
        .forEach((item, index) => fragment.appendChild(createRow(item, index)));
      if (filteredItems.length > shownCount) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'cl-more';
        more.textContent = `显示更多（剩余 ${filteredItems.length - shownCount} 条）`;
        fragment.appendChild(more);
      }
    }
    list.replaceChildren(fragment);
    updateStats();
  }

  /**
   * 批量勾选只同步已渲染行的勾选状态：重画整张列表会为一次点击重建上千个节点，
   * 而行的内容并没有变。
   */
  function syncChecks(): void {
    for (const input of list.querySelectorAll<HTMLInputElement>('input.cl-check')) {
      input.checked = selectedIds.has(input.dataset.id ?? '');
    }
    updateStats();
  }

  function applyFilter(): void {
    filteredItems = filterLinks(allItems, search.getValue(), magnet.isChecked());
    shownCount = PAGE_SIZE;
    render();
  }

  /**
   * 面板关闭后列表不可见：不把几万条链接与已渲染的行留在内存里，下次打开会重新扫描。
   * 关掉的路径不止“关闭”按钮（Esc、悬浮按钮切换都会关闭），所以挂在状态变化上。
   */
  function release(): void {
    allItems = [];
    filteredItems = [];
    selectedIds = new Set();
    shownCount = PAGE_SIZE;
    list.replaceChildren();
  }

  panel.onOpenChange((open) => {
    if (!open) release();
  });

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
      // 只受当前筛选影响，不受“首屏只渲染 200 行”限制：统计里的“共 N 条”与复制结果要对得上。
      selectedIds = selectAll(selectedIds, filteredItems);
      syncChecks();
    },
  });
  const selectNoneButton = createButton(ui, {
    label: '全不选',
    variant: 'secondary',
    onClick: () => {
      selectedIds = selectNone(selectedIds, filteredItems);
      syncChecks();
    },
  });
  const invertButton = createButton(ui, {
    label: '反选',
    variant: 'secondary',
    onClick: () => {
      selectedIds = invertSelection(selectedIds, filteredItems);
      syncChecks();
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
      shownCount = PAGE_SIZE;
      search.setValue('');
      magnet.setChecked(false);
      applyFilter();
      panel.open();
    },
    close: () => panel.close(),
    isOpen: () => panel.isOpen(),
  };
}
