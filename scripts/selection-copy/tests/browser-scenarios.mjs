/**
 * selection-copy 的真实浏览器验收场景。
 *
 * 脚本只接受 `isTrusted` 的鼠标 / 键盘事件，所以这里全部用 `ctx.input` 派发真实输入，
 * 页面里合成的 MouseEvent 不算数。场景之间不共享页面与剪贴板：
 * 每个场景都由 `node tools/browser-check.mjs selection-copy` 在新页面里跑。
 */

export const fixture = 'selection.html';

/** 页面侧助手：只做操作与读取，不做断言；断言写在场景里。 */
export function helpers() {
  const root = () => document.querySelector('userscript-ui-root')?.shadowRoot ?? null;
  const dot = () => root()?.querySelector('.sel-copy-dot') ?? null;

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

  window.__page = {
    linePoints,
    point,
    selection: () => window.getSelection()?.toString().trim() ?? '',
    clipboard: () => window.__gm.clipboard.at(-1)?.text ?? '',
    writes: () => window.__gm.clipboard.length,
    dot: () => {
      const node = dot();
      return node ? { visible: node.dataset.visible === 'true', text: node.textContent } : null;
    },
  };
}

export const scenarios = [
  {
    name: '拖动选中一段文字 → 自动复制并显示勾号',
    async run(ctx) {
      const points = await ctx.evaluate(() => window.__page.linePoints('#text', 2, 200));
      await ctx.input.drag(points.start, points.end);
      await ctx.wait(80);
      const state = await ctx.evaluate(() => ({
        selected: window.__page.selection(),
        clipboard: window.__page.clipboard(),
        dot: window.__page.dot(),
      }));
      const same = state.selected !== '' && state.clipboard === state.selected;
      return {
        expected: '选中非空 / 剪贴板与选中的文字一致 / 勾号显示',
        actual: `${state.selected === '' ? '选中为空' : '选中非空'} / ${
          same ? '剪贴板与选中的文字一致' : `剪贴板是「${state.clipboard}」`
        } / ${state.dot?.visible ? '勾号显示' : '勾号缺失'}`,
      };
    },
  },
  {
    name: '勾号约一秒后淡出消失',
    async run(ctx) {
      const points = await ctx.evaluate(() => window.__page.linePoints('#text', 2, 120));
      await ctx.input.drag(points.start, points.end);
      await ctx.wait(100);
      const shown = await ctx.evaluate(() => window.__page.dot() !== null);
      await ctx.wait(1400);
      const gone = await ctx.evaluate(() => window.__page.dot() === null);
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
    name: '在输入框里拖动选中 → 不复制',
    async run(ctx) {
      const points = await ctx.evaluate(() => window.__page.linePoints('#field', 6, 140));
      await ctx.input.drag(points.start, points.end);
      await ctx.wait(80);
      const state = await ctx.evaluate(() => ({
        selected: window.__page.selection(),
        writes: window.__page.writes(),
      }));
      return {
        expected: '0',
        actual: String(state.writes),
      };
    },
  },
  {
    name: '在富文本编辑器里拖动选中 → 不复制',
    async run(ctx) {
      const points = await ctx.evaluate(() => window.__page.linePoints('#editor-text', 2, 140));
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
];
