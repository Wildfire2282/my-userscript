/**
 * selection-copy 的真实浏览器验收场景。
 *
 * 脚本只接受 `isTrusted` 的鼠标 / 键盘事件，所以这里全部用 `ctx.input` 派发真实输入，
 * 页面里合成的 MouseEvent 不算数。场景之间不共享页面、设置与剪贴板：
 * 每个场景都由 `node tools/browser-check.mjs selection-copy` 在新页面里跑。
 */

export const fixture = 'selection.html';

/** 页面侧助手：只做操作与读取，不做断言；断言写在场景里。 */
export function helpers() {
  const root = () => document.querySelector('userscript-ui-root')?.shadowRoot ?? null;
  const pillNode = () => root()?.querySelector('.sel-copy-pill') ?? null;
  const panelNode = () => root()?.querySelector('.ds-panel') ?? null;
  const switches = () => [...(root()?.querySelectorAll('.ds-panel input[role="switch"]') ?? [])];

  const linePoints = (selector, startDx, endDx) => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    const y = Math.round(rect.top + rect.height / 2);
    return {
      start: { x: Math.round(rect.left + startDx), y },
      end: { x: Math.round(rect.left + endDx), y },
    };
  };

  const point = (selector, dx) => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return {
      x: Math.round(rect.left + dx),
      y: Math.round(rect.top + rect.height / 2),
    };
  };

  const shadowLinePoints = (startDx, endDx) => {
    const input = document.querySelector('#shadow-host')?.shadowRoot?.querySelector('input');
    if (!input) throw new Error('Shadow 输入框缺失');
    const rect = input.getBoundingClientRect();
    const y = Math.round(rect.top + rect.height / 2);
    return {
      start: { x: Math.round(rect.left + startDx), y },
      end: { x: Math.round(rect.left + endDx), y },
    };
  };

  const shadowTextLinePoints = (startDx, endDx) => {
    const paragraph = document.querySelector('#shadow-text-host')?.shadowRoot?.querySelector('p');
    if (!paragraph) throw new Error('Shadow 正文缺失');
    const rect = paragraph.getBoundingClientRect();
    const y = Math.round(rect.top + rect.height / 2);
    return {
      start: { x: Math.round(rect.left + startDx), y },
      end: { x: Math.round(rect.left + endDx), y },
    };
  };

  window.__page = {
    linePoints,
    point,
    shadowLinePoints,
    shadowTextLinePoints,
    selection: () => window.getSelection()?.toString().trim() ?? '',
    clipboard: () => window.__gm.clipboard.at(-1)?.text ?? '',
    writes: () => window.__gm.clipboard.length,
    pill: () => {
      const node = pillNode();
      return node
        ? {
            visible: node.dataset.visible === 'true',
            variant: node.dataset.variant ?? '',
            text: node.textContent?.trim() ?? '',
            left: Number.parseFloat(node.style.left || '0'),
            top: Number.parseFloat(node.style.top || '0'),
          }
        : null;
    },
    panel: () => {
      const node = panelNode();
      return node
        ? {
            open: node.dataset.open === 'true',
            title: node.querySelector('.ds-panel-title')?.textContent?.trim() ?? '',
          }
        : null;
    },
    switchCount: () => switches().length,
    switchChecked: (index) => switches()[index]?.checked ?? null,
    toggleSwitch: (index) => {
      const input = switches()[index];
      if (!input) return false;
      input.click();
      return true;
    },
    closePanel: () => {
      panelNode()?.querySelector('.ds-panel-close')?.click();
    },
    blockClipboard: () => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      document.execCommand = () => false;
      window.__gm.clipboardThrows = true;
    },
  };
}

export const scenarios = [
  {
    name: '拖选跨过 body 边界仍自动复制',
    async run(ctx) {
      const points = await ctx.evaluate(() => {
        document.body.style.width = '300px';
        document.body.style.margin = '8px';
        const rect = document.querySelector('#text').getBoundingClientRect();
        return {
          start: { x: Math.round(rect.left + 2), y: Math.round(rect.top + 10) },
          end: { x: 450, y: Math.round(rect.top + 10) },
        };
      });
      await ctx.input.drag(points.start, points.end);
      await ctx.wait(120);
      const copied = await ctx.evaluate(() => {
        const selected = window.__page.selection();
        return selected !== '' && window.__page.clipboard() === selected;
      });
      return { expected: '正文已复制', actual: copied ? '正文已复制' : '正文未复制' };
    },
  },
  {
    name: '拖动选中一段文字 → 自动复制并显示「已复制」标签',
    async run(ctx) {
      const points = await ctx.evaluate(() => window.__page.linePoints('#text', 2, 200));
      await ctx.input.drag(points.start, points.end);
      await ctx.wait(80);
      const state = await ctx.evaluate(() => ({
        selected: window.__page.selection(),
        clipboard: window.__page.clipboard(),
        pill: window.__page.pill(),
      }));
      const same = state.selected !== '' && state.clipboard === state.selected;
      return {
        expected: '选中非空 / 剪贴板与选中的文字一致 / 标签显示「已复制」',
        actual: `${state.selected === '' ? '选中为空' : '选中非空'} / ${
          same ? '剪贴板与选中的文字一致' : `剪贴板是「${state.clipboard}」`
        } / ${state.pill?.visible && state.pill.variant === 'success' && state.pill.text.includes('已复制') ? '标签显示「已复制」' : `标签是${JSON.stringify(state.pill)}`}`,
      };
    },
  },
  {
    name: '复制标签显示在鼠标松开点附近',
    async run(ctx) {
      const points = await ctx.evaluate(() => window.__page.linePoints('#text', 2, 200));
      await ctx.input.drag(points.start, points.end);
      await ctx.wait(80);
      const state = await ctx.evaluate((end) => ({ end, pill: window.__page.pill() }), points.end);
      const dx = state.pill ? Math.abs(state.pill.left + 34 - state.end.x) : -1;
      const near = state.pill?.visible && dx <= 60 && Math.abs(state.pill.top - state.end.y) <= 80;
      return {
        expected: '标签在鼠标附近',
        actual: near
          ? '标签在鼠标附近'
          : `标签不在鼠标附近：标签${JSON.stringify(state.pill)}，松开点${JSON.stringify(state.end)}`,
      };
    },
  },
  {
    name: '复制标签约一秒后淡出消失',
    async run(ctx) {
      const points = await ctx.evaluate(() => window.__page.linePoints('#text', 2, 120));
      await ctx.input.drag(points.start, points.end);
      await ctx.wait(100);
      const shown = await ctx.evaluate(() => window.__page.pill() !== null);
      await ctx.wait(1600);
      const gone = await ctx.evaluate(() => window.__page.pill() === null);
      return {
        expected: '先显示 / 后消失',
        actual: `${shown ? '先显示' : '没有显示'} / ${gone ? '后消失' : '仍留在页面上'}`,
      };
    },
  },
  {
    name: '普通单击只移动光标，不复制',
    async run(ctx) {
      const point = await ctx.evaluate(() => window.__page.point('#text', 120));
      await ctx.input.click(point);
      await ctx.wait(80);
      const writes = await ctx.evaluate(() => window.__page.writes());
      return { expected: '0', actual: String(writes) };
    },
  },
  {
    name: '在输入框里拖动选中 → 默认不复制',
    async run(ctx) {
      const points = await ctx.evaluate(() => window.__page.linePoints('#field', 6, 140));
      await ctx.input.drag(points.start, points.end);
      await ctx.wait(80);
      const writes = await ctx.evaluate(() => window.__page.writes());
      return { expected: '0', actual: String(writes) };
    },
  },
  {
    name: '打开输入框开关后，Shadow DOM 输入框里选中也能复制',
    async run(ctx) {
      const points = await ctx.evaluate(() => {
        window.__gm.store['selection-copy:config.settings'] = {
          copyInInputs: true,
          copyInEditors: false,
        };
        return window.__page.shadowLinePoints(6, 140);
      });
      await ctx.input.drag(points.start, points.end);
      await ctx.wait(80);
      const state = await ctx.evaluate(() => ({
        writes: window.__page.writes(),
        text: window.__page.clipboard(),
      }));
      return {
        expected: '1 次 / 剪贴板含 Shadow 文字',
        actual: `${state.writes} 次 / ${
          state.text.includes('Shadow') ? '剪贴板含 Shadow 文字' : `是「${state.text}」`
        }`,
      };
    },
  },
  {
    name: '在富文本编辑器里拖动选中 → 默认不复制',
    async run(ctx) {
      const points = await ctx.evaluate(() => window.__page.linePoints('#editor-text', 2, 140));
      await ctx.input.drag(points.start, points.end);
      await ctx.wait(80);
      const writes = await ctx.evaluate(() => window.__page.writes());
      return { expected: '0', actual: String(writes) };
    },
  },
  {
    name: 'Shadow DOM 里的正文拖选 → 自动复制',
    async run(ctx) {
      const points = await ctx.evaluate(() => window.__page.shadowTextLinePoints(4, 140));
      await ctx.input.drag(points.start, points.end);
      await ctx.wait(80);
      const state = await ctx.evaluate(() => ({
        writes: window.__page.writes(),
        text: window.__page.clipboard(),
      }));
      return {
        expected: '1 次 / 剪贴板含 Shadow 文字',
        actual: `${state.writes} 次 / ${
          state.text.includes('Shadow') ? '剪贴板含 Shadow 文字' : `是「${state.text}」`
        }`,
      };
    },
  },
  {
    name: '已有文字选区时拖滑块 → 不把旧选区再复制一次',
    async run(ctx) {
      const points = await ctx.evaluate(() => {
        window.__gm.store['selection-copy:config.settings'] = { copyInInputs: true };
        const paragraph = document.querySelector('#text');
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return window.__page.linePoints('#range', 10, 150);
      });
      await ctx.input.drag(points.start, points.end);
      await ctx.wait(80);
      const writes = await ctx.evaluate(() => window.__page.writes());
      return { expected: '0', actual: String(writes) };
    },
  },
  {
    name: '双击选中一个词 → 复制',
    async run(ctx) {
      const point = await ctx.evaluate(() => window.__page.point('#text', 120));
      await ctx.input.doubleClick(point);
      await ctx.wait(80);
      const state = await ctx.evaluate(() => ({
        selected: window.__page.selection(),
        clipboard: window.__page.clipboard(),
      }));
      return {
        expected: '选中非空 / 剪贴板一致',
        actual: `${state.selected === '' ? '选中为空' : '选中非空'} / ${
          state.selected === state.clipboard ? '剪贴板一致' : `剪贴板是「${state.clipboard}」`
        }`,
      };
    },
  },
  {
    name: 'Shift + 右方向键扩选 → 复制扩出来的文字',
    async run(ctx) {
      const point = await ctx.evaluate(() => window.__page.point('#text', 2));
      await ctx.input.click(point);
      await ctx.wait(40);
      // 无头浏览器对合成按键的默认动作时有时无，先按同样的语义放好 1 个字的选区；
      // 这里要验证的是脚本对一次真实 Shift+→ 按键的响应，扩展由浏览器自己决定。
      await ctx.evaluate(() => {
        const paragraph = document.querySelector('#text');
        const first = paragraph.firstChild;
        const range = document.createRange();
        range.setStart(first, 0);
        range.setEnd(first, 1);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      });
      await ctx.input.press('ArrowRight', { modifiers: ['shift'] });
      await ctx.wait(80);
      const state = await ctx.evaluate(() => ({
        selected: window.__page.selection(),
        clipboard: window.__page.clipboard(),
      }));
      return {
        expected: '选中至少 1 个字 / 剪贴板一致',
        actual: `${state.selected.length > 0 ? '选中至少 1 个字' : '没有选中'} / ${
          state.selected === state.clipboard ? '剪贴板一致' : `剪贴板是「${state.clipboard}」`
        }`,
      };
    },
  },
  {
    name: 'Ctrl+A 全选 → 复制整页文字',
    async run(ctx) {
      const point = await ctx.evaluate(() => window.__page.point('#text', 2));
      await ctx.input.click(point);
      await ctx.wait(40);
      await ctx.input.press('a', { code: 'KeyA', keyCode: 65, modifiers: ['ctrl'] });
      await ctx.wait(80);
      const state = await ctx.evaluate(() => ({
        selected: window.__page.selection(),
        clipboard: window.__page.clipboard(),
      }));
      return {
        expected: '全选非空 / 剪贴板一致',
        actual: `${state.selected.length > 10 ? '全选非空' : '选区为空'} / ${
          state.selected === state.clipboard ? '剪贴板一致' : `剪贴板是「${state.clipboard}」`
        }`,
      };
    },
  },
  {
    name: '程序化选区（没有用户手势）→ 不复制',
    async run(ctx) {
      await ctx.evaluate(() => {
        const paragraph = document.querySelector('#text');
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      });
      await ctx.wait(100);
      const writes = await ctx.evaluate(() => window.__page.writes());
      return { expected: '0', actual: String(writes) };
    },
  },
  {
    name: '剪贴板写入全失败 → 标签显示「复制失败」',
    async run(ctx) {
      await ctx.evaluate(() => window.__page.blockClipboard());
      const points = await ctx.evaluate(() => window.__page.linePoints('#text', 2, 160));
      await ctx.input.drag(points.start, points.end);
      await ctx.wait(120);
      const state = await ctx.evaluate(() => window.__page.pill());
      return {
        expected: '标签显示「复制失败」',
        actual:
          state?.visible && state.variant === 'failure' && state.text.includes('复制失败')
            ? '标签显示「复制失败」'
            : `标签是${JSON.stringify(state)}`,
      };
    },
  },
  {
    name: '降级复制失败也保留原选区及方向',
    async run(ctx) {
      await ctx.evaluate(() => {
        window.__page.blockClipboard();
        document.addEventListener(
          'mouseup',
          () => {
            const selection = window.getSelection();
            window.__beforeCopy = {
              text: selection.toString(),
              anchor: selection.anchorOffset,
              focus: selection.focusOffset,
            };
          },
          { once: true, capture: true },
        );
      });
      const points = await ctx.evaluate(() => window.__page.linePoints('#text', 160, 2));
      await ctx.input.drag(points.start, points.end);
      await ctx.wait(120);
      const preserved = await ctx.evaluate(() => {
        const selection = window.getSelection();
        const before = window.__beforeCopy;
        return (
          before.text !== '' &&
          selection.toString() === before.text &&
          selection.anchorOffset === before.anchor &&
          selection.focusOffset === before.focus
        );
      });
      return {
        expected: '选区与方向保留',
        actual: preserved ? '选区与方向保留' : '选区或方向已改变',
      };
    },
  },
  {
    name: '脚本菜单能打开设置面板',
    async run(ctx) {
      const opened = await ctx.evaluate(() => {
        window.__gm.menu?.();
        return window.__page.panel();
      });
      return {
        expected: '面板打开 / 标题是「功能设置」 / 5 个开关',
        actual: `${opened?.open ? '面板打开' : '面板没打开'} / ${
          opened?.title === '功能设置' ? '标题是「功能设置」' : `标题是「${opened?.title ?? ''}」`
        } / ${await ctx.evaluate(() => window.__page.switchCount())} 个开关`,
      };
    },
  },
  {
    name: '关闭当前网站后不复制，再打开恢复',
    async run(ctx) {
      await ctx.evaluate(() => window.__gm.menu?.());
      await ctx.wait(50);
      await ctx.evaluate(() => window.__page.toggleSwitch(1));
      await ctx.wait(50);
      const offChecked = await ctx.evaluate(() => window.__page.switchChecked(1));
      await ctx.evaluate(() => window.__page.closePanel());

      const first = await ctx.evaluate(() => window.__page.linePoints('#text', 2, 160));
      await ctx.input.drag(first.start, first.end);
      await ctx.wait(80);
      const writesOff = await ctx.evaluate(() => window.__page.writes());

      await ctx.evaluate(() => window.__gm.menu?.());
      await ctx.wait(50);
      await ctx.evaluate(() => window.__page.toggleSwitch(1));
      await ctx.wait(50);
      const onChecked = await ctx.evaluate(() => window.__page.switchChecked(1));
      await ctx.evaluate(() => window.__page.closePanel());

      // 换一段没被选中的文字：在已有选区里按下会被浏览器当成“拖动选中文字”，
      // 不会产生新的选区，验证的就不再是脚本对本站开关的响应。
      const second = await ctx.evaluate(() => window.__page.linePoints('#other', 2, 160));
      await ctx.input.drag(second.start, second.end);
      await ctx.wait(80);
      const writesOn = await ctx.evaluate(() => window.__page.writes());

      return {
        expected: '本站开关已关 / 0 次 / 本站开关已开 / 1 次',
        actual: `${offChecked === false ? '本站开关已关' : '本站开关仍开着'} / ${writesOff} 次 / ${
          onChecked === true ? '本站开关已开' : '本站开关仍关着'
        } / ${writesOn} 次`,
      };
    },
  },
  {
    name: '关闭总开关后不复制',
    async run(ctx) {
      await ctx.evaluate(() => window.__gm.menu?.());
      await ctx.wait(50);
      await ctx.evaluate(() => window.__page.toggleSwitch(0));
      await ctx.wait(50);
      await ctx.evaluate(() => window.__page.closePanel());

      const points = await ctx.evaluate(() => window.__page.linePoints('#text', 2, 160));
      await ctx.input.drag(points.start, points.end);
      await ctx.wait(80);
      const writes = await ctx.evaluate(() => window.__page.writes());
      return { expected: '0', actual: String(writes) };
    },
  },
  {
    name: '打开「输入框里也复制」后，输入框内选中也能复制',
    async run(ctx) {
      await ctx.evaluate(() => window.__gm.menu?.());
      await ctx.wait(50);
      await ctx.evaluate(() => window.__page.toggleSwitch(2));
      await ctx.wait(50);
      await ctx.evaluate(() => window.__page.closePanel());

      const points = await ctx.evaluate(() => window.__page.linePoints('#field', 6, 140));
      await ctx.input.drag(points.start, points.end);
      await ctx.wait(80);
      const state = await ctx.evaluate(() => {
        const field = document.querySelector('#field');
        return {
          selected: field.value.slice(field.selectionStart, field.selectionEnd).trim(),
          clipboard: window.__page.clipboard(),
          writes: window.__page.writes(),
        };
      });
      return {
        expected: '1 次 / 剪贴板与输入框选区一致',
        actual: `${state.writes} 次 / ${
          state.selected !== '' && state.clipboard === state.selected
            ? '剪贴板与输入框选区一致'
            : `剪贴板是「${state.clipboard}」`
        }`,
      };
    },
  },
  {
    name: '输入框降级复制失败后仍保留选区和焦点',
    async run(ctx) {
      await ctx.evaluate(() => {
        window.__gm.menu?.();
        window.__page.toggleSwitch(2);
        window.__page.closePanel();
        window.__page.blockClipboard();
        document.addEventListener(
          'mouseup',
          () => {
            const field = document.querySelector('#field');
            window.__beforeCopy = {
              start: field.selectionStart,
              end: field.selectionEnd,
              direction: field.selectionDirection,
            };
          },
          { once: true, capture: true },
        );
      });
      const points = await ctx.evaluate(() => window.__page.linePoints('#field', 140, 6));
      await ctx.input.drag(points.start, points.end);
      await ctx.wait(120);
      const preserved = await ctx.evaluate(() => {
        const field = document.querySelector('#field');
        const before = window.__beforeCopy;
        return (
          document.activeElement === field &&
          before.start < before.end &&
          field.selectionStart === before.start &&
          field.selectionEnd === before.end &&
          field.selectionDirection === before.direction
        );
      });
      return {
        expected: '选区、方向与焦点保留',
        actual: preserved ? '选区、方向与焦点保留' : '选区、方向或焦点已改变',
      };
    },
  },
];
