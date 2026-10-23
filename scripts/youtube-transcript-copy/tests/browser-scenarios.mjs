/**
 * youtube-transcript-copy 的真实浏览器验收场景。
 *
 * YouTube 的真实站点无法离线打开，夹具页模拟播放器、描述区与转写按钮；
 * `setup` 在产物注入前把播放器状态与 `get_panel` 响应准备好，脚本按真实路径
 * 钩 fetch、抓缓存、格式化并写剪贴板。场景之间不共享页面与设置。
 */

export const fixture = 'watch.html?v=first';

/** 产物注入前的页面准备：播放器状态 + 固定的 get_panel 响应。 */
export function setup() {
  const cues = [
    { transcriptCueRenderer: { startOffsetMs: 0, simpleText: '你好，世界' } },
    { transcriptCueRenderer: { startOffsetMs: 2000, simpleText: '第二句台词' } },
    { transcriptCueRenderer: { startOffsetMs: 5000, simpleText: 'Third line' } },
  ];
  window.__panel = {
    engagementPanels: [
      {
        engagementPanelSectionListRenderer: {
          panelIdentifier: 'engagement-panel-searchable-transcript',
          content: {
            transcriptRenderer: {
              body: {
                transcriptBodyRenderer: {
                  cueGroups: [{ transcriptCueGroupRenderer: { cues } }],
                },
              },
            },
          },
        },
      },
    ],
  };

  window.fetch = (input) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (/get_panel/i.test(url)) {
      return Promise.resolve(
        new Response(JSON.stringify(window.__panel), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    return Promise.resolve(new Response('{}', { status: 200 }));
  };

  const video = document.querySelector('video');
  Object.defineProperty(video, 'paused', { value: false, configurable: true });
  Object.defineProperty(video, 'ended', { value: false, configurable: true });
  Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
}

/** 页面侧助手：只做操作与读取，不做断言。 */
export function helpers() {
  const root = () => document.querySelector('userscript-ui-root')?.shadowRoot ?? null;
  const wrap = () => root()?.querySelector('.yt-transcript-wrap') ?? null;
  const button = () => wrap()?.querySelector('button') ?? null;

  window.__page = {
    wrap,
    button,
    lastClipboard: () => window.__gm.clipboard.at(-1)?.text ?? '',
    clipboardWrites: () => window.__gm.clipboard.length,
    state: () => wrap()?.dataset.state ?? '',
    buttonClass: () => button()?.className ?? '',
    label: () => button()?.textContent.trim() ?? '',
    visible: () => (wrap() ? !wrap().hidden : false),
    position: () => ({ right: wrap()?.style.right ?? '', top: wrap()?.style.top ?? '' }),
    center: () => {
      const rect = wrap()?.getBoundingClientRect();
      return rect
        ? { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
        : null;
    },
    menu: (label) => {
      const entry = window.__gm.menus.find((menu) => menu.label === label);
      if (!entry) throw new Error(`没有菜单项「${label}」`);
      entry.run();
    },
    menuItems: () => window.__gm.menus.map((menu) => menu.label),
    panelTitle: () =>
      root()?.querySelector('.ds-panel[data-open="true"] .ds-panel-title')?.textContent ?? '',
    clickInPanel: (text) => {
      const target = [...(root()?.querySelectorAll('button') ?? [])].find(
        (element) => element.textContent.trim() === text,
      );
      if (!target) throw new Error(`面板里没有「${text}」`);
      target.click();
    },
    /** 触发一次 get_panel 请求，让脚本的网络钩子拿到转写。 */
    capturePanel: () =>
      window.fetch('https://www.youtube.com/youtubei/v1/get_panel?prettyPrint=false'),
    expectedRightTop: () => {
      const rect = document.querySelector('#movie_player').getBoundingClientRect();
      return {
        right: `${Math.round(window.innerWidth - rect.right + 30)}px`,
        top: `${Math.round(rect.top + 30)}px`,
      };
    },
  };
}

const EXPECTED = '[0:00] 你好，世界\n[0:02] 第二句台词\n[0:05] Third line';

export const scenarios = [
  {
    name: '油猴菜单只有「操作面板」和「功能设置」两项',
    async run(ctx) {
      const items = await ctx.evaluate(() => window.__page.menuItems());
      return { expected: '操作面板 / 功能设置', actual: items.join(' / ') };
    },
  },
  {
    name: '视频播放中 → 悬浮按钮出现在播放器右上角',
    async run(ctx) {
      const state = await ctx.evaluate(() => ({
        visible: window.__page.visible(),
        position: window.__page.position(),
        expected: window.__page.expectedRightTop(),
      }));
      return {
        expected: `显示 / ${state.expected.right} / ${state.expected.top}`,
        actual: `${state.visible ? '显示' : '隐藏'} / ${state.position.right} / ${state.position.top}`,
      };
    },
  },
  {
    name: '播放器布局变化 → 没拖动过时按钮跟到新的右上角',
    async run(ctx) {
      const state = await ctx.evaluate(async () => {
        const player = document.querySelector('#movie_player');
        player.style.marginLeft = '200px';
        window.dispatchEvent(new Event('resize'));
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {
          position: window.__page.position(),
          expected: window.__page.expectedRightTop(),
        };
      });
      return {
        expected: `${state.expected.right} / ${state.expected.top}`,
        actual: `${state.position.right} / ${state.position.top}`,
      };
    },
  },
  {
    name: '点按钮复制一次后，播放器布局变化时按钮仍跟新的右上角',
    async run(ctx) {
      await ctx.evaluate(() => window.__page.capturePanel());
      await ctx.wait(80);
      const point = await ctx.evaluate(() => window.__page.center());
      await ctx.input.click(point);
      await ctx.wait(150);
      const state = await ctx.evaluate(async () => {
        document.querySelector('#movie_player').style.marginLeft = '200px';
        window.dispatchEvent(new Event('resize'));
        await new Promise((resolve) => setTimeout(resolve, 80));
        return { position: window.__page.position(), expected: window.__page.expectedRightTop() };
      });
      return {
        expected: `${state.expected.right} / ${state.expected.top}`,
        actual: `${state.position.right} / ${state.position.top}`,
      };
    },
  },
  {
    name: '拖动过按钮后再改布局 → 保持用户放的位置',
    async run(ctx) {
      const point = await ctx.evaluate(() => window.__page.center());
      await ctx.input.drag(point, { x: point.x - 120, y: point.y + 80 });
      await ctx.wait(80);
      const state = await ctx.evaluate(async () => {
        const dragged = window.__page.position();
        document.querySelector('#movie_player').style.marginLeft = '200px';
        window.dispatchEvent(new Event('resize'));
        await new Promise((resolve) => setTimeout(resolve, 80));
        return { dragged, after: window.__page.position() };
      });
      return {
        expected: `${state.dragged.right} / ${state.dragged.top}`,
        actual: `${state.after.right} / ${state.after.top}`,
      };
    },
  },
  {
    name: '暂停、播完后按钮仍然显示',
    async run(ctx) {
      await ctx.evaluate(() => {
        const video = document.querySelector('video');
        Object.defineProperty(video, 'paused', { value: true, configurable: true });
        video.dispatchEvent(new Event('pause'));
      });
      await ctx.wait(80);
      const paused = await ctx.evaluate(() => window.__page.visible());
      await ctx.evaluate(() => {
        const video = document.querySelector('video');
        Object.defineProperty(video, 'ended', { value: true, configurable: true });
        video.dispatchEvent(new Event('ended'));
      });
      await ctx.wait(80);
      const ended = await ctx.evaluate(() => window.__page.visible());
      return {
        expected: '暂停后显示 / 播完后显示',
        actual: `${paused ? '暂停后显示' : '暂停后隐藏'} / ${ended ? '播完后显示' : '播完后隐藏'}`,
      };
    },
  },
  {
    name: '按钮用的是统一界面组件，不是自绘样式',
    async run(ctx) {
      const info = await ctx.evaluate(() => ({
        className: window.__page.buttonClass(),
        ariaLabel: window.__page.button()?.getAttribute('aria-label') ?? '',
        label: window.__page.label(),
      }));
      return {
        expected: '含 ds-button / 复制当前转写文稿 / T',
        actual: `${info.className.includes('ds-button') ? '含 ds-button' : info.className} / ${info.ariaLabel} / ${info.label}`,
      };
    },
  },
  {
    name: '点击按钮 → 复制带时间戳的转写文稿并变 ✓',
    async run(ctx) {
      await ctx.evaluate(() => window.__page.capturePanel());
      await ctx.wait(80);
      const point = await ctx.evaluate(() => window.__page.center());
      await ctx.input.click(point);
      await ctx.wait(150);
      const state = await ctx.evaluate(() => ({
        clipboard: window.__page.lastClipboard(),
        buttonState: window.__page.state(),
        label: window.__page.label(),
      }));
      return {
        expected: `${EXPECTED.replace(/\n/g, ' / ')} / success / ✓`,
        actual: `${state.clipboard.replace(/\n/g, ' / ')} / ${state.buttonState} / ${state.label}`,
      };
    },
  },
  {
    name: '复制成功提示约 1.5 秒后回到 T',
    async run(ctx) {
      await ctx.evaluate(() => window.__page.capturePanel());
      await ctx.wait(80);
      const point = await ctx.evaluate(() => window.__page.center());
      await ctx.input.click(point);
      await ctx.wait(200);
      const during = await ctx.evaluate(() => window.__page.label());
      await ctx.wait(1600);
      const after = await ctx.evaluate(() => ({
        label: window.__page.label(),
        state: window.__page.state(),
      }));
      return {
        expected: '✓ / T / normal',
        actual: `${during} / ${after.label} / ${after.state}`,
      };
    },
  },
  {
    name: '菜单「操作面板」→ 复制当前转写文稿并关闭面板',
    async run(ctx) {
      await ctx.evaluate(() => window.__page.capturePanel());
      // fetch 的响应解析挂在钩子的 then 里，等一拍再点菜单，否则会走很慢的 DOM 兜底。
      await ctx.wait(80);
      const opened = await ctx.evaluate(() => {
        window.__page.menu('操作面板');
        return window.__page.panelTitle();
      });
      await ctx.evaluate(() => window.__page.clickInPanel('复制当前转写文稿'));
      await ctx.wait(150);
      const state = await ctx.evaluate(() => ({
        clipboard: window.__page.lastClipboard(),
        panel: window.__page.panelTitle(),
      }));
      return {
        expected: `操作面板 / ${EXPECTED.replace(/\n/g, ' / ')} / 已关闭`,
        actual: `${opened} / ${state.clipboard.replace(/\n/g, ' / ')} / ${
          state.panel === '' ? '已关闭' : '仍打开'
        }`,
      };
    },
  },
  {
    name: '拖动按钮 → 新位置立即生效并保存',
    async run(ctx) {
      const point = await ctx.evaluate(() => window.__page.center());
      const before = await ctx.evaluate(() => window.__page.position());
      await ctx.input.drag(point, { x: point.x - 120, y: point.y + 80 });
      await ctx.wait(80);
      const state = await ctx.evaluate(() => ({
        position: window.__page.position(),
        stored: window.__gm.store.pos ?? null,
      }));
      const right = `${Number.parseInt(before.right, 10) + 120}px`;
      const top = `${Number.parseInt(before.top, 10) + 80}px`;
      return {
        expected: `${right} / ${top} / 已保存`,
        actual: `${state.position.right} / ${state.position.top} / ${
          state.stored ? '已保存' : '未保存'
        }`,
      };
    },
  },
  {
    name: '操作面板「重置按钮位置」→ 回到右上角并删除记忆',
    async run(ctx) {
      const point = await ctx.evaluate(() => window.__page.center());
      await ctx.input.drag(point, { x: point.x - 120, y: point.y + 80 });
      await ctx.wait(60);
      await ctx.evaluate(() => {
        window.__page.menu('操作面板');
        window.__page.clickInPanel('重置按钮位置');
      });
      const state = await ctx.evaluate(() => {
        return {
          position: window.__page.position(),
          stored: window.__gm.store.pos ?? null,
        };
      });
      return {
        expected: '30px / 30px / 已删除',
        actual: `${state.position.right} / ${state.position.top} / ${
          state.stored === null ? '已删除' : '仍在'
        }`,
      };
    },
  },
  {
    name: '功能设置「清空策略记忆」→ 删除保存的策略',
    async run(ctx) {
      const stored = await ctx.evaluate(() => {
        window.__gm.store.strategy = { net: { idx: 1, at: 1 } };
        window.__page.menu('功能设置');
        window.__page.clickInPanel('清空策略记忆');
        return window.__gm.store.strategy ?? null;
      });
      return { expected: '已删除', actual: stored === null ? '已删除' : '仍在' };
    },
  },
  {
    name: '剪贴板不可用 → 按钮变 ✕，不谎报成功',
    async run(ctx) {
      await ctx.evaluate(() => window.__page.capturePanel());
      await ctx.wait(80);
      await ctx.evaluate(async () => {
        window.__gm.clipboardThrows = true;
        Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
        document.execCommand = () => false;
      });
      const point = await ctx.evaluate(() => window.__page.center());
      await ctx.input.click(point);
      await ctx.wait(200);
      const result = await ctx.evaluate(() => ({
        state: window.__page.state(),
        label: window.__page.label(),
        writes: window.__page.clipboardWrites(),
      }));
      return {
        expected: 'error / ✕ / 0',
        actual: `${result.state} / ${result.label} / ${result.writes}`,
      };
    },
  },
  {
    name: '换视频后不沿用上一个视频的转写',
    async run(ctx) {
      await ctx.evaluate(() => window.__page.capturePanel());
      await ctx.wait(80);
      const firstPoint = await ctx.evaluate(() => window.__page.center());
      await ctx.input.click(firstPoint);
      await ctx.wait(150);
      const first = await ctx.evaluate(() => window.__page.lastClipboard());

      await ctx.evaluate(() => {
        const panel = window.__panel;
        panel.engagementPanels[0].engagementPanelSectionListRenderer.content.transcriptRenderer.body.transcriptBodyRenderer.cueGroups[0].transcriptCueGroupRenderer.cues[0].transcriptCueRenderer.simpleText =
          '新视频台词';
        history.replaceState(null, '', '?v=second');
        window.dispatchEvent(new Event('yt-navigate-finish'));
      });
      await ctx.wait(120);
      await ctx.evaluate(() => window.__page.capturePanel());
      await ctx.wait(80);
      const secondPoint = await ctx.evaluate(() => window.__page.center());
      await ctx.input.click(secondPoint);
      await ctx.wait(150);
      const second = await ctx.evaluate(() => window.__page.lastClipboard());
      return {
        expected: '第一条视频的转写 / 第二条视频只有新台词',
        actual: `${first === EXPECTED ? '第一条视频的转写' : `第一条是「${first.split('\n')[0]}」`} / ${
          second.startsWith('[0:00] 新视频台词')
            ? '第二条视频只有新台词'
            : `第二条是「${second.split('\n')[0]}」`
        }`,
      };
    },
  },
  {
    name: '按钮可拖动时不会误触复制',
    async run(ctx) {
      const point = await ctx.evaluate(() => window.__page.center());
      const before = await ctx.evaluate(() => window.__page.clipboardWrites());
      await ctx.input.drag(point, { x: point.x - 80, y: point.y + 40 });
      await ctx.wait(200);
      const after = await ctx.evaluate(() => window.__page.clipboardWrites());
      return {
        expected: '拖动前 0 / 拖动后 0',
        actual: `拖动前 ${before} / 拖动后 ${after}`,
      };
    },
  },
];
