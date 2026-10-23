/**
 * capture-links 的真实浏览器验收场景。
 *
 * 每条场景对应脚本 README「行为」表里的一行，自己准备前置条件（需要非默认设置时先写
 * window.__gm.store.settings），自己断言结果。场景之间不共享页面与设置：
 * 每个场景都由 `node tools/browser-check.mjs capture-links` 在新页面里跑。
 */

export const fixture = 'links.html';

/** 页面侧助手：只做操作与读取，不做断言；断言写在场景里。 */
export function helpers() {
  const root = () => document.querySelector('userscript-ui-root')?.shadowRoot ?? null;

  const panelByTitle = (title) =>
    [...(root()?.querySelectorAll('[data-ds-panel]') ?? [])].find(
      (node) => node.querySelector('.ds-panel-title')?.textContent.trim() === title,
    ) ?? null;
  const linkPanel = () => panelByTitle('捕获链接');
  const settingsPanel = () => panelByTitle('捕获链接设置');

  const rows = () => [...(linkPanel()?.querySelectorAll('.cl-row') ?? [])];
  const rowText = (selector) =>
    rows().map((row) => row.querySelector(selector)?.textContent.trim() ?? '');
  const stats = () => linkPanel()?.querySelector('.cl-stats')?.textContent.trim() ?? '';
  const selectedCount = () => Number(/选中 (\d+)/.exec(stats())?.[1] ?? -1);

  const press = (el) => {
    const init = { bubbles: true, cancelable: true, composed: true };
    el.dispatchEvent(new MouseEvent('mousedown', init));
    el.dispatchEvent(new MouseEvent('mouseup', init));
    el.click();
  };

  const openMenu = (label) => {
    const entry = window.__gm.menus.find((menu) => menu.label === label);
    if (!entry) throw new Error(`没有菜单项「${label}」`);
    entry.run();
  };

  const clickButton = (panel, label) => {
    const button = [...(panel?.querySelectorAll('button') ?? [])].find(
      (node) => node.textContent.trim() === label,
    );
    if (!button) return false;
    press(button);
    return true;
  };

  const field = (panel, label) =>
    [...(panel?.querySelectorAll('[data-ds-field]') ?? [])].find(
      (node) => node.querySelector('.ds-field-label')?.textContent.trim() === label,
    ) ?? null;

  window.__page = {
    linkPanel,
    settingsPanel,
    panelByTitle,
    rows,
    titles: () => rowText('.cl-title'),
    urls: () => rowText('.cl-url'),
    stats,
    selectedCount,
    press,
    openMenu,
    clickButton,
    clipboardTexts: () => window.__gm.clipboard.map((entry) => entry.text),
    lastClipboard: () => window.__gm.clipboard.at(-1)?.text ?? '',
    toastText: () =>
      [...(root()?.querySelectorAll('[data-ds-toast]') ?? [])]
        .map((node) => node.textContent.trim())
        .join(' | '),
    launcher: () => root()?.querySelector('.ds-launcher') ?? null,
    setSearch: (value) => {
      const input = linkPanel()?.querySelector('input.cl-search');
      if (!input) return false;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
    setMagnet: (checked) => {
      const input = linkPanel()?.querySelector('.cl-toggle input');
      if (!input) return false;
      if (input.checked !== checked) window.__page.press(input);
      return input.checked === checked;
    },
    checkRow: (index, checked) => {
      const input = rows()[index]?.querySelector('input[type="checkbox"]');
      if (!input) return false;
      if (input.checked !== checked) window.__page.press(input);
      return input.checked === checked;
    },
    setSwitch: (panel, label, checked) => {
      const input = field(panel, label)?.querySelector('input[type="checkbox"]');
      if (!input) return false;
      if (input.checked !== checked) window.__page.press(input);
      return input.checked === checked;
    },
    setSelect: (panel, label, value) => {
      const select = field(panel, label)?.querySelector('select');
      if (!select) return false;
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return select.value === value;
    },
    closePanel: (panel) => {
      const button = panel?.querySelector('.ds-panel-close');
      if (!button) return false;
      window.__page.press(button);
      return panel.hidden;
    },
  };
}

const TITLES = [
  'Alpha 页面标题',
  'Beta 链接',
  '磁力链接',
  '种子文件',
  '相对链接',
  '表格行标题',
  '列表项标题',
];

export const scenarios = [
  {
    name: '菜单「面板」→ 列出本页全部链接，空地址与重复项被忽略',
    async run(ctx) {
      const state = await ctx.evaluate(() => {
        window.__page.openMenu('面板');
        const panel = window.__page.linkPanel();
        return {
          title: panel?.querySelector('.ds-panel-title')?.textContent.trim() ?? '',
          visible: panel ? !panel.hidden : false,
          titles: window.__page.titles(),
          stats: window.__page.stats(),
        };
      });
      return {
        expected: `捕获链接 / 面板可见 / ${TITLES.join('、')} / 共 7 / 筛选 7 / 选中 0`,
        actual: `${state.title} / ${state.visible ? '面板可见' : '面板不可见'} / ${state.titles.join('、')} / ${state.stats}`,
      };
    },
  },
  {
    name: '右下角悬浮按钮 → 点击打开链接面板',
    async run(ctx) {
      const state = await ctx.evaluate(() => {
        const launcher = window.__page.launcher();
        if (!launcher) return { label: '', opened: false };
        const label = launcher.getAttribute('aria-label') ?? '';
        window.__page.press(launcher);
        const panel = window.__page.linkPanel();
        return {
          label,
          opened: panel ? !panel.hidden : false,
          rows: window.__page.rows().length,
          stats: window.__page.stats(),
        };
      });
      return {
        expected: '打开链接面板 / 面板已打开 / 7 行 / 共 7 / 筛选 7 / 选中 0',
        actual: `${state.label} / ${state.opened ? '面板已打开' : '面板未打开'} / ${state.rows} 行 / ${state.stats}`,
      };
    },
  },
  {
    name: '关键词筛选 → 同时匹配标题与地址，清空后恢复',
    async run(ctx) {
      const state = await ctx.evaluate(() => {
        window.__page.openMenu('面板');
        window.__page.setSearch('example.com');
        const byUrl = window.__page.rows().length;
        window.__page.setSearch('beta');
        const byTitle = window.__page.rows().length;
        window.__page.setSearch('');
        const cleared = window.__page.rows().length;
        return { byUrl, byTitle, cleared };
      });
      return {
        expected: '地址匹配 5 / 标题匹配 1 / 清空后 7',
        actual: `地址匹配 ${state.byUrl} / 标题匹配 ${state.byTitle} / 清空后 ${state.cleared}`,
      };
    },
  },
  {
    name: '仅磁链 → 只剩磁力链接，没有匹配时显示空状态',
    async run(ctx) {
      const state = await ctx.evaluate(() => {
        window.__page.openMenu('面板');
        window.__page.setMagnet(true);
        const magnetRows = window.__page.rows().length;
        const firstUrl = window.__page.urls()[0] ?? '';
        window.__page.setSearch('种子');
        const emptyText =
          window.__page.linkPanel()?.querySelector('.cl-empty')?.textContent.trim() ?? '';
        return { magnetRows, firstUrl, emptyText };
      });
      return {
        expected: '1 / magnet: 开头 / 无匹配结果',
        actual: `${state.magnetRows} / ${state.firstUrl.startsWith('magnet:') ? 'magnet: 开头' : state.firstUrl} / ${state.emptyText}`,
      };
    },
  },
  {
    name: '全选 / 全不选 / 反选 → 统计跟着变',
    async run(ctx) {
      const state = await ctx.evaluate(() => {
        window.__page.openMenu('面板');
        const panel = window.__page.linkPanel();
        window.__page.clickButton(panel, '全选');
        const all = window.__page.selectedCount();
        window.__page.clickButton(panel, '全不选');
        const none = window.__page.selectedCount();
        window.__page.clickButton(panel, '反选');
        const inverted = window.__page.selectedCount();
        return { all, none, inverted };
      });
      return {
        expected: '全选 7 / 全不选 0 / 反选 7',
        actual: `全选 ${state.all} / 全不选 ${state.none} / 反选 ${state.inverted}`,
      };
    },
  },
  {
    name: '链接超过首屏 200 行时，全选仍覆盖全部筛选结果',
    async run(ctx) {
      const state = await ctx.evaluate(async () => {
        for (let index = 0; index < 210; index += 1) {
          const link = document.createElement('a');
          link.href = `https://example.com/bulk/${index}`;
          link.textContent = `批量链接 ${index}`;
          document.body.appendChild(link);
        }
        window.__page.openMenu('面板');
        const panel = window.__page.linkPanel();
        window.__page.clickButton(panel, '全选');
        const selected = window.__page.selectedCount();
        window.__page.clickButton(panel, '复制选中');
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {
          selected,
          total: window.__page.stats().split(' / ')[0],
          copied: window.__page.lastClipboard().split('\n').length,
        };
      });
      return {
        expected: '选中 217 / 共 217 / 复制 217 行',
        actual: `选中 ${state.selected} / ${state.total} / 复制 ${state.copied} 行`,
      };
    },
  },
  {
    name: '复制选中（纯链接）→ 每行一个地址并提示条数',
    async run(ctx) {
      const state = await ctx.evaluate(async () => {
        window.__page.openMenu('面板');
        const panel = window.__page.linkPanel();
        window.__page.clickButton(panel, '全选');
        window.__page.clickButton(panel, '复制选中');
        // 复制是异步的（剪贴板通道可能返回 Promise），等提示出现再读。
        await new Promise((resolve) => setTimeout(resolve, 50));
        const text = window.__page.lastClipboard();
        return {
          lines: text === '' ? 0 : text.split('\n').length,
          first: text.split('\n')[0] ?? '',
          toast: window.__page.toastText(),
        };
      });
      return {
        expected: '7 行 / https://example.com/alpha / 已复制 7 条链接',
        actual: `${state.lines} 行 / ${state.first} / ${state.toast}`,
      };
    },
  },
  {
    name: '没选中就复制 → 提示未选中，剪贴板不变',
    async run(ctx) {
      const state = await ctx.evaluate(() => {
        window.__page.openMenu('面板');
        window.__page.clickButton(window.__page.linkPanel(), '复制选中');
        return {
          toast: window.__page.toastText(),
          writes: window.__gm.clipboard.length,
        };
      });
      return {
        expected: '未选中任何链接 / 0',
        actual: `${state.toast} / ${state.writes}`,
      };
    },
  },
  {
    name: '设置里改成 Markdown → 复制出 [标题](地址)',
    async run(ctx) {
      const state = await ctx.evaluate(() => {
        window.__page.openMenu('设置');
        const settings = window.__page.settingsPanel();
        const changed = window.__page.setSelect(settings, '复制格式', 'markdown');
        window.__page.closePanel(settings);
        window.__page.openMenu('面板');
        const panel = window.__page.linkPanel();
        window.__page.clickButton(panel, '全选');
        window.__page.clickButton(panel, '复制选中');
        const lines = window.__page.lastClipboard().split('\n');
        return {
          changed,
          stored: window.__gm.store.settings?.copyFormat ?? '',
          lines: lines.length,
          first: lines[0] ?? '',
        };
      });
      return {
        expected: '已切换 / markdown / 7 行 / [Alpha 页面标题](https://example.com/alpha)',
        actual: `${state.changed ? '已切换' : '切换失败'} / ${state.stored} / ${state.lines} 行 / ${state.first}`,
      };
    },
  },
  {
    name: '设置里关掉悬浮按钮 → 按钮消失并记住；打开后重新出现',
    async run(ctx) {
      const state = await ctx.evaluate(() => {
        window.__page.openMenu('设置');
        const panel = window.__page.settingsPanel();
        window.__page.setSwitch(panel, '显示浮动按钮', false);
        const hidden = window.__page.launcher() === null;
        const stored = window.__gm.store.settings?.showFloatButton;
        window.__page.setSwitch(panel, '显示浮动按钮', true);
        const restored = window.__page.launcher() !== null;
        return { hidden, stored, restored };
      });
      return {
        expected: '按钮消失 / false / 重新出现',
        actual: `${state.hidden ? '按钮消失' : '按钮仍在'} / ${String(state.stored)} / ${
          state.restored ? '重新出现' : '没有回来'
        }`,
      };
    },
  },
  {
    name: '关闭按钮收起面板；再次打开会重新扫描并清空筛选',
    async run(ctx) {
      const state = await ctx.evaluate(() => {
        window.__page.openMenu('面板');
        const panel = window.__page.linkPanel();
        window.__page.setSearch('beta');
        const closed = window.__page.closePanel(panel);
        window.__page.openMenu('面板');
        return {
          closed,
          rows: window.__page.rows().length,
          search: window.__page.linkPanel()?.querySelector('input.cl-search')?.value ?? '非空',
        };
      });
      return {
        expected: '已收起 / 7 行 / 搜索框为空',
        actual: `${state.closed ? '已收起' : '仍打开'} / ${state.rows} 行 / ${
          state.search === '' ? '搜索框为空' : `搜索框有「${state.search}」`
        }`,
      };
    },
  },
  {
    name: '复制失败时提示失败，不谎报成功',
    async run(ctx) {
      const state = await ctx.evaluate(async () => {
        // 三个写入通道全部失效，验证面板不会谎报“已复制”。
        window.__gm.clipboardThrows = true;
        Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
        document.execCommand = () => false;
        window.__page.openMenu('面板');
        const panel = window.__page.linkPanel();
        window.__page.checkRow(0, true);
        window.__page.clickButton(panel, '复制选中');
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          toast: window.__page.toastText(),
          writes: window.__gm.clipboard.length,
        };
      });
      return {
        expected: '复制失败，请检查剪贴板权限 / 0',
        actual: `${state.toast} / ${state.writes}`,
      };
    },
  },
];
