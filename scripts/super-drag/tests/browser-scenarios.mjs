/**
 * super-drag 的真实浏览器验收场景。
 *
 * 每条场景对应脚本 README「行为」表里的一行，自己准备前置条件（需要非默认设置时先写
 * window.__gm.store.settings），自己断言结果。场景之间不共享页面与设置：
 * 每个场景都由 `node tools/browser-check.mjs super-drag` 在新页面里跑。
 */

export const fixture = 'drag.html';

/** 页面侧助手：只做操作与读取，不做断言；断言写在场景里。 */
export function helpers() {
  const root = () => document.querySelector('userscript-ui-root')?.shadowRoot ?? null;
  const panel = () => root()?.querySelector('[data-ds-panel]') ?? null;
  const field = (label) =>
    [...(panel()?.querySelectorAll('[data-ds-field]') ?? [])].find(
      (node) => node.querySelector('.ds-field-label')?.textContent.trim() === label,
    ) ?? null;

  window.__page = {
    panel,
    openMenu: () => window.__gm.menu?.(),
    point: (el) => {
      const rect = el.getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      };
    },
    select: (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const rect = range.getBoundingClientRect();
      return {
        text: selection.toString(),
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      };
    },
    clearSelection: () => window.getSelection()?.removeAllRanges(),
    drag: (target, dropTarget, options = {}) => {
      const dataTransfer = new DataTransfer();
      const point = options.point ?? window.__page.point(target);
      const init = {
        bubbles: true,
        cancelable: true,
        // 真实拖拽事件是 composed 的；不加这一条，Shadow DOM 内的合成事件到不了 window。
        composed: true,
        dataTransfer,
        clientX: point.x,
        clientY: point.y,
        shiftKey: options.shiftKey === true,
        ctrlKey: options.ctrlKey === true,
      };
      target.dispatchEvent(new DragEvent('dragstart', init));
      const claimed = dataTransfer.getData('text/plain');
      (dropTarget ?? target).dispatchEvent(new DragEvent('drop', init));
      (dropTarget ?? target).dispatchEvent(new DragEvent('dragend', init));
      return claimed;
    },
    lastOpened: () => window.__gm.opened.at(-1) ?? null,
    openedCount: () => window.__gm.opened.length,
    /** 模拟一次真实点击：先按下再松开，最后才是 click（页面会据此判断新交互）。 */
    press: (el) => {
      const init = { bubbles: true, cancelable: true, composed: true };
      el.dispatchEvent(new MouseEvent('mousedown', init));
      el.dispatchEvent(new MouseEvent('mouseup', init));
      el.click();
    },
    clickButton: (label) => {
      const button = [...(panel()?.querySelectorAll('button') ?? [])].find(
        (node) => node.textContent.trim() === label,
      );
      if (!button) return false;
      window.__page.press(button);
      return true;
    },
    setSelect: (label, value) => {
      const select = field(label)?.querySelector('select');
      if (!select) return false;
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return select.value === value;
    },
    setInput: (label, value) => {
      const input = field(label)?.querySelector('input');
      if (!input) return false;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
    setSwitch: (label, checked) => {
      const input = field(label)?.querySelector('input[type="checkbox"]');
      if (!input) return false;
      if (input.checked !== checked) window.__page.press(input);
      return input.checked === checked;
    },
    fieldError: () =>
      [...(panel()?.querySelectorAll('.ds-field-error') ?? [])]
        .map((node) => node.textContent.trim())
        .find(Boolean) ?? '',
    panelRect: () => {
      const node = panel();
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    },
  };
}

const searchUrl = (text) => `https://www.google.com/search?q=${encodeURIComponent(text)}`;

/** 选中一个元素里的文字，拖到 target（默认是它自己）。 */
function dragSelection(ctx, { from = '#text', to = null } = {}) {
  return ctx.evaluate(
    (fromSelector, toSelector) => {
      const source = document.querySelector(fromSelector);
      const target = toSelector ? document.querySelector(toSelector) : source;
      const point = window.__page.select(source);
      const claimed = window.__page.drag(source, target, { point });
      return { selected: point.text, claimed };
    },
    from,
    to ?? null,
  );
}

/** 拖一个元素到它自己（或指定落点），返回写进 dataTransfer 的文字。 */
function dragElement(ctx, selector, { to = null, shiftKey = false, ctrlKey = false } = {}) {
  return ctx.evaluate(
    (targetSelector, toSelector, shift, ctrl) => {
      const target = document.querySelector(targetSelector);
      const drop = toSelector ? document.querySelector(toSelector) : target;
      return window.__page.drag(target, drop, { shiftKey: shift, ctrlKey: ctrl });
    },
    selector,
    to ?? null,
    shiftKey,
    ctrlKey,
  );
}

/** 场景前置条件：把存储里的设置换成给定值（设置在第一次拖拽或打开面板时才被读到）。 */
function presetSettings(ctx, settings) {
  return ctx.evaluate((preset) => {
    window.__gm.store.settings = preset;
  }, settings);
}

export const scenarios = [
  {
    name: '选中文字拖动 → 用 Google 搜索（后台）',
    async run(ctx) {
      const { selected, claimed } = await dragSelection(ctx);
      const opened = await ctx.evaluate(() => window.__page.lastOpened());
      return {
        expected: `${searchUrl(selected)} / active=false / 拖拽数据一致`,
        actual: `${opened?.url} / active=${String(opened?.options?.active)} / ${
          claimed === selected ? '拖拽数据一致' : `拖拽数据是「${claimed}」`
        }`,
      };
    },
  },
  {
    name: '拖链接 → 在后台打开链接地址',
    async run(ctx) {
      await dragElement(ctx, '#link');
      const opened = await ctx.evaluate(() => window.__page.lastOpened());
      return {
        expected: 'https://example.com/target?from=fixture&x=1 / active=false',
        actual: `${opened?.url} / active=${String(opened?.options?.active)}`,
      };
    },
  },
  {
    name: '按住 Shift 拖链接 → 这一次在前台打开',
    async run(ctx) {
      await dragElement(ctx, '#link', { shiftKey: true });
      const opened = await ctx.evaluate(() => window.__page.lastOpened());
      return {
        expected: 'active=true',
        actual: `active=${String(opened?.options?.active)}`,
      };
    },
  },
  {
    name: '拖图片 → 深色查看器里带原图地址与页面标题',
    async run(ctx) {
      const { url, content } = await ctx.evaluate(async () => {
        const image = document.querySelector('#image');
        window.__page.drag(image, image);
        const opened = window.__page.lastOpened();
        if (!opened) return { url: '', content: '' };
        return { url: opened.url, content: await (await fetch(opened.url)).text() };
      });
      return {
        expected: 'blob: 开头 / 含原图地址 / 标题 Image',
        actual: `${url.startsWith('blob:') ? 'blob: 开头' : url} / ${
          content.includes('https://example.com/image.png') ? '含' : '不含'
        }原图地址 / ${content.includes('<title>Image</title>') ? '标题 Image' : '标题缺失'}`,
      };
    },
  },
  {
    name: '拖进输入框或富文本编辑器 → 不接管、不打开页面',
    async run(ctx) {
      const { inputOpened, editorOpened } = await ctx.evaluate(() => {
        const before = window.__gm.opened.length;
        const paragraph = document.querySelector('#text');
        const point = window.__page.select(paragraph);
        window.__page.drag(paragraph, document.querySelector('#field'), { point });
        const afterInput = window.__gm.opened.length;
        window.__page.clearSelection();
        const editorText = document.querySelector('#editor-text');
        const editorPoint = window.__page.select(paragraph);
        window.__page.drag(paragraph, editorText, { point: editorPoint });
        return {
          inputOpened: afterInput - before,
          editorOpened: window.__gm.opened.length - afterInput,
        };
      });
      return {
        expected: '输入框 0 / 编辑器 0',
        actual: `输入框 ${inputOpened} / 编辑器 ${editorOpened}`,
      };
    },
  },
  {
    name: '拖拽后的那一次点击被吞掉，之后的点击照常送达',
    async run(ctx) {
      const { swallowed, restored, later } = await ctx.evaluate(async () => {
        const link = document.querySelector('#link');
        const area = document.querySelector('#click-area');
        const clicks = () => window.__clicks;

        window.__page.drag(link, link);
        const before = clicks();
        area.click();
        const first = clicks() - before;
        area.click();
        const second = clicks() - before - first;

        window.__page.drag(link, link);
        const laterBefore = clicks();
        await new Promise((resolve) => setTimeout(resolve, 450));
        area.click();
        return { swallowed: first, restored: second, later: clicks() - laterBefore };
      });
      return {
        expected: '吞掉 0 / 下一次 1 / 450ms 后 1',
        actual: `吞掉 ${swallowed} / 下一次 ${restored} / 450ms 后 ${later}`,
      };
    },
  },
  {
    name: '没有选中文字时拖普通段落 → 不接管',
    async run(ctx) {
      const claimed = await ctx.evaluate(() => {
        window.__page.clearSelection();
        const paragraph = document.querySelector('#text');
        return window.__page.drag(paragraph, paragraph);
      });
      return { expected: '没有拖拽数据', actual: claimed === '' ? '没有拖拽数据' : claimed };
    },
  },
  {
    name: '拖 Shadow DOM 里的链接 → 打开该链接',
    async run(ctx) {
      const opened = await ctx.evaluate(() => {
        const link = document
          .querySelector('#shadow-host')
          .shadowRoot.getElementById('shadow-link');
        window.__page.drag(link, link);
        return window.__page.lastOpened();
      });
      return { expected: 'https://example.com/shadow', actual: opened?.url ?? '' };
    },
  },
  {
    name: '菜单「功能设置」→ 居中的面板，八项设置齐全',
    async run(ctx) {
      const state = await ctx.evaluate(() => {
        const expected = [
          '文字',
          '链接',
          '图片',
          '搜索引擎',
          '自定义搜索地址',
          '拖动的文字是网址时',
          '新标签页打开方式',
          '拖拽图片时',
        ];
        window.__page.openMenu();
        const node = window.__page.panel();
        const labels = [...(node?.querySelectorAll('.ds-field-label') ?? [])].map((label) =>
          label.textContent.trim(),
        );
        const rect = window.__page.panelRect();
        const centered =
          rect != null &&
          Math.abs((rect.left + rect.right) / 2 - rect.viewportWidth / 2) <= 1 &&
          Math.abs((rect.top + rect.bottom) / 2 - rect.viewportHeight / 2) <= 1;
        return {
          label: window.__gm.menuLabel,
          visible: node ? !node.hidden : false,
          count: labels.length,
          missing: expected.filter((label) => !labels.includes(label)),
          centered,
        };
      });
      return {
        expected: '功能设置 / 面板可见 / 8 项齐全 / 居中',
        actual: `${state.label} / ${state.visible ? '面板可见' : '面板不可见'} / ${state.count} 项${
          state.missing.length === 0 ? '齐全' : `缺 ${state.missing.join('、')}`
        } / ${state.centered ? '居中' : '未居中'}`,
      };
    },
  },
  {
    name: '自定义地址缺 {keyword} → 留在面板里提示，不写入设置',
    async run(ctx) {
      const guard = await ctx.evaluate(() => {
        window.__page.openMenu();
        window.__page.setSelect('搜索引擎', 'custom');
        window.__page.setInput('自定义搜索地址', 'https://example.com/no-placeholder');
        window.__page.clickButton('保存');
        return {
          stillOpen: !window.__page.panel().hidden,
          error: window.__page.fieldError(),
          stored: window.__gm.store.settings ?? null,
        };
      });
      return {
        expected: '面板仍打开 / 提示含 {keyword} / 未写入设置',
        actual: `${guard.stillOpen ? '面板仍打开' : '面板已关闭'} / 提示${
          guard.error.includes('{keyword}') ? '含 {keyword}' : `不含（${guard.error}）`
        } / ${guard.stored === null ? '未写入设置' : '已写入设置'}`,
      };
    },
  },
  {
    name: '保存有效的自定义地址 → 立刻用它搜索',
    async run(ctx) {
      const saved = await ctx.evaluate(() => {
        window.__page.openMenu();
        window.__page.setSelect('搜索引擎', 'custom');
        window.__page.setInput('自定义搜索地址', 'https://example.com/s?q={keyword}');
        window.__page.clickButton('保存');
        const paragraph = document.querySelector('#text');
        const point = window.__page.select(paragraph);
        window.__page.drag(paragraph, paragraph, { point });
        return {
          closed: window.__page.panel().hidden,
          stored: window.__gm.store.settings ?? null,
          selected: point.text,
          opened: window.__page.lastOpened(),
        };
      });
      return {
        expected: `面板已关闭 / custom / https://example.com/s?q=${encodeURIComponent(saved.selected)}`,
        actual: `${saved.closed ? '面板已关闭' : '面板仍打开'} / ${
          saved.stored?.defaultEngine ?? '缺失'
        } / ${saved.opened?.url ?? '缺失'}`,
      };
    },
  },
  {
    name: '恢复默认 → 回到内置默认值并关闭面板',
    async run(ctx) {
      await presetSettings(ctx, {
        defaultEngine: 'baidu',
        linkOpenMode: 'foreground',
        urlTextAction: 'search',
        imageAction: 'original',
        dragKinds: { text: false },
      });
      const restored = await ctx.evaluate(() => {
        window.__page.openMenu();
        window.__page.clickButton('恢复默认');
        window.__page.clickButton('保存');
        return {
          stored: window.__gm.store.settings ?? {},
          closed: window.__page.panel().hidden,
        };
      });
      const stored = restored.stored;
      return {
        expected: 'google / 全开 / background / open / viewer / 面板已关闭',
        actual: `${stored.defaultEngine} / ${
          stored.dragKinds?.text && stored.dragKinds?.link && stored.dragKinds?.image
            ? '全开'
            : '有未开启'
        } / ${stored.linkOpenMode} / ${stored.urlTextAction} / ${stored.imageAction} / ${
          restored.closed ? '面板已关闭' : '面板仍打开'
        }`,
      };
    },
  },
  {
    name: '拖动 href="#" 链接里的图片 → 打开图片查看器',
    async run(ctx) {
      const { url, content } = await ctx.evaluate(async () => {
        window.__page.clearSelection();
        const image = document.querySelector('#dead-link-image');
        window.__page.drag(image, image);
        const opened = window.__page.lastOpened();
        if (!opened) return { url: '', content: '' };
        return { url: opened.url, content: await (await fetch(opened.url)).text() };
      });
      return {
        expected: 'blob: 开头 / 含原图地址',
        actual: `${url.startsWith('blob:') ? 'blob: 开头' : url} / ${
          content.includes('https://example.com/wrapped.png') ? '含' : '不含'
        }原图地址`,
      };
    },
  },
  {
    name: '拖相对地址链接 → 补成绝对地址再打开',
    async run(ctx) {
      const { expected, opened } = await ctx.evaluate(() => {
        const link = document.querySelector('#relative-link');
        window.__page.drag(link, link);
        return {
          expected: new URL('/rel/path?x=1', document.baseURI).href,
          opened: window.__page.lastOpened(),
        };
      });
      return { expected, actual: opened?.url ?? '' };
    },
  },
  {
    name: '拖页面自己的 draggable 卡片 → 不接管',
    async run(ctx) {
      const claimed = await ctx.evaluate(() => {
        window.__page.clearSelection();
        const card = document.querySelector('#card');
        return window.__page.drag(card, card);
      });
      return { expected: '没有拖拽数据', actual: claimed === '' ? '没有拖拽数据' : claimed };
    },
  },
  {
    name: '按住 Ctrl 拖链接 → 不接管（保留系统手势）',
    async run(ctx) {
      const { claimed, opened } = await ctx.evaluate(() => {
        const before = window.__gm.opened.length;
        const link = document.querySelector('#link');
        const claimed = window.__page.drag(link, link, { ctrlKey: true });
        return { claimed, opened: window.__gm.opened.length - before };
      });
      return {
        expected: '没有拖拽数据 / 0',
        actual: `${claimed === '' ? '没有拖拽数据' : claimed} / ${opened}`,
      };
    },
  },
  {
    name: '链接里只选中一部分，按在未选中的字符上 → 打开链接而不是搜索',
    async run(ctx) {
      const state = await ctx.evaluate(() => {
        window.__page.clearSelection();
        const link = document.querySelector('#partial-link');
        const text = link.firstChild;
        const selected = document.createRange();
        selected.setStart(text, 0);
        selected.setEnd(text, 4);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(selected);
        const later = document.createRange();
        later.setStart(text, 8);
        later.setEnd(text, 10);
        const rect = later.getBoundingClientRect();
        const point = { x: Math.round(rect.left + 1), y: Math.round(rect.top + rect.height / 2) };
        window.__page.drag(link, link, { point });
        return {
          selected: selection.toString(),
          opened: window.__page.lastOpened()?.url ?? '',
        };
      });
      return {
        expected: '已选中一部分 / https://example.com/partial',
        actual: `${state.selected === '' ? '未选中' : '已选中一部分'} / ${state.opened}`,
      };
    },
  },
  {
    name: '按 Esc 取消拖拽 → 不打开页面，随后的点击照常送达',
    async run(ctx) {
      const { claimed, opened, clicks } = await ctx.evaluate(() => {
        const before = window.__gm.opened.length;
        const clicksBefore = window.__clicks;
        const link = document.querySelector('#link');
        const point = window.__page.point(link);
        const dataTransfer = new DataTransfer();
        const init = {
          bubbles: true,
          cancelable: true,
          composed: true,
          dataTransfer,
          clientX: point.x,
          clientY: point.y,
        };
        link.dispatchEvent(new DragEvent('dragstart', init));
        const claimed = dataTransfer.getData('text/plain') !== '';
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        link.dispatchEvent(new DragEvent('drop', init));
        link.dispatchEvent(new DragEvent('dragend', init));
        document.querySelector('#click-area').click();
        return {
          claimed,
          opened: window.__gm.opened.length - before,
          clicks: window.__clicks - clicksBefore,
        };
      });
      return {
        expected: '已接管 / 0 / 1',
        actual: `${claimed ? '已接管' : '未接管'} / ${opened} / ${clicks}`,
      };
    },
  },
  {
    name: '在面板里关掉某一类 → 只停这一类',
    async run(ctx) {
      const state = await ctx.evaluate(() => {
        const open = () => window.__page.openMenu();
        const save = () => window.__page.clickButton('保存');
        const dragText = () => {
          const paragraph = document.querySelector('#text');
          const point = window.__page.select(paragraph);
          return window.__page.drag(paragraph, paragraph, { point });
        };
        const dragLink = () => {
          window.__page.clearSelection();
          const link = document.querySelector('#link');
          const before = window.__gm.opened.length;
          const claimed = window.__page.drag(link, link);
          return { claimed, opened: window.__gm.opened.length - before };
        };
        const dragImage = () => {
          window.__page.clearSelection();
          const image = document.querySelector('#image');
          const before = window.__gm.opened.length;
          const claimed = window.__page.drag(image, image);
          return { claimed, opened: window.__gm.opened.length - before };
        };

        open();
        window.__page.setSwitch('文字', false);
        save();
        const textOff = dragText();
        const linkStillOpens = dragLink();

        open();
        window.__page.setSwitch('文字', true);
        window.__page.setSwitch('图片', false);
        save();
        const imageOff = dragImage();

        open();
        window.__page.setSwitch('图片', true);
        window.__page.setSwitch('链接', false);
        save();
        const linkOff = dragLink();
        const textStill = dragText();

        return {
          textOff: textOff === '' ? '文字不接管' : '文字仍接管',
          linkStillOpens: linkStillOpens.opened,
          imageOff: imageOff.claimed === '' ? '图片不接管' : '图片仍接管',
          imageOpened: imageOff.opened,
          linkOff: linkOff.claimed === '' ? '链接不接管' : '链接仍接管',
          linkOffOpened: linkOff.opened,
          textStill: textStill === '' ? '文字不接管' : '文字仍接管',
        };
      });
      return {
        expected:
          '文字不接管 / 链接照常 1 / 图片不接管 / 图片不打开 0 / 链接不接管 / 链接不打开 0 / 文字仍接管',
        actual: `${state.textOff} / 链接照常 ${state.linkStillOpens} / ${state.imageOff} / 图片不打开 ${state.imageOpened} / ${state.linkOff} / 链接不打开 ${state.linkOffOpened} / ${state.textStill}`,
      };
    },
  },
  {
    name: '网址文字选「仍然搜索」→ 进搜索引擎而不是直接打开',
    async run(ctx) {
      await presetSettings(ctx, { urlTextAction: 'search' });
      const state = await ctx.evaluate(() => {
        const paragraph = document.createElement('p');
        paragraph.textContent = 'https://example.com/very/long?x=1';
        document.body.appendChild(paragraph);
        const point = window.__page.select(paragraph);
        window.__page.drag(paragraph, paragraph, { point });
        return { selected: point.text, opened: window.__page.lastOpened()?.url ?? '' };
      });
      return {
        expected: searchUrl(state.selected),
        actual: state.opened,
      };
    },
  },
  {
    name: '图片选「直接打开原图」→ 打开图片地址本身',
    async run(ctx) {
      await presetSettings(ctx, { imageAction: 'original' });
      const opened = await ctx.evaluate(() => {
        window.__page.clearSelection();
        const image = document.querySelector('#image');
        window.__page.drag(image, image);
        return window.__page.lastOpened()?.url ?? '';
      });
      return { expected: 'https://example.com/image.png', actual: opened };
    },
  },
  {
    name: '打开方式选前台 → 拖链接切换过去',
    async run(ctx) {
      await presetSettings(ctx, { linkOpenMode: 'foreground' });
      await dragElement(ctx, '#link');
      const opened = await ctx.evaluate(() => window.__page.lastOpened());
      return {
        expected: 'active=true',
        actual: `active=${String(opened?.options?.active)}`,
      };
    },
  },
  {
    name: '按 Escape 关闭设置面板',
    async run(ctx) {
      const closed = await ctx.evaluate(() => {
        window.__page.openMenu();
        const panel = window.__page.panel();
        panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return panel.hidden;
      });
      return { expected: '面板已关闭', actual: closed ? '面板已关闭' : '面板仍打开' };
    },
  },
];
