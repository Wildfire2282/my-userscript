export const fixture = 'stress.html';

export function helpers() {
  window.uiTest = {
    root: () => document.querySelector('userscript-ui-root').shadowRoot,
    frames: async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    },
    point: (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    colors: (el) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const rgb = (color) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
      };
      let node = el;
      while (
        node &&
        ['transparent', 'rgba(0, 0, 0, 0)'].includes(getComputedStyle(node).backgroundColor)
      )
        node = node.parentElement;
      const style = getComputedStyle(el);
      return {
        fg: rgb(style.color),
        bg: rgb(getComputedStyle(node).backgroundColor),
        ownBg: rgb(style.backgroundColor),
        border: rgb(style.borderTopColor),
      };
    },
  };
}

function result(actual, expected = true) {
  return { expected: JSON.stringify(expected), actual: JSON.stringify(actual) };
}

function contrast(a, b) {
  const luminance = (rgb) =>
    rgb
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export const scenarios = [
  ...[false, true].map((fromCallback) => ({
    name: `dialog ${fromCallback ? 'onClose 内' : '立即'}重开不受旧 close 事件影响`,
    async run(ctx) {
      return result(
        await ctx.evaluate(async (fromCallback) => {
          const { mountUI, createDialog } = window.UserscriptUI;
          const ui = mountUI();
          let second;
          const values = [];
          const dialog = createDialog(ui, {
            title: '确认',
            onClose(value) {
              values.push(value);
              if (fromCallback && value === 'first') second = dialog.open();
            },
          });
          const first = dialog.open();
          const closed = new Promise((resolve) =>
            dialog.el.addEventListener('close', resolve, { once: true }),
          );
          dialog.close('first');
          if (!fromCallback) second = dialog.open();
          await closed;
          const modal = dialog.el.matches(':modal');
          dialog.close('second');
          const answers = await Promise.all([first, second]);
          dialog.close('unused');
          return { modal, answers, values };
        }, fromCallback),
        { modal: true, answers: ['first', 'second'], values: ['first', 'second'] },
      );
    },
  })),
  {
    name: 'dialog 共享滚动锁保留至最后关闭并恢复 important',
    async run(ctx) {
      return result(
        await ctx.evaluate(async () => {
          const { mountUI, createDialog } = window.UserscriptUI;
          document.documentElement.style.setProperty('overflow', 'scroll', 'important');
          const a = mountUI();
          const b = mountUI();
          const pending = [
            createDialog(a, { title: 'A' }).open(),
            createDialog(b, { title: 'B' }).open(),
          ];
          a.destroy();
          const locked = getComputedStyle(document.documentElement).overflow;
          b.destroy();
          const answers = await Promise.all(pending);
          return {
            locked,
            answers,
            overflow: document.documentElement.style.overflow,
            priority: document.documentElement.style.getPropertyPriority('overflow'),
          };
        }),
        { locked: 'hidden', answers: [null, null], overflow: 'scroll', priority: 'important' },
      );
    },
  },
  {
    name: 'dialog 滚动补偿保留样式表中的页面右内边距',
    async run(ctx) {
      return result(
        await ctx.evaluate(async () => {
          const { mountUI, createDialog } = window.UserscriptUI;
          const style = document.createElement('style');
          style.textContent = 'html { padding-right: 40px !important; overflow-y: scroll; }';
          document.head.appendChild(style);
          const root = document.documentElement;
          const padding = Number.parseFloat(getComputedStyle(root).paddingRight);
          const scrollbar = Math.max(0, innerWidth - root.clientWidth);
          const ui = mountUI();
          const dialog = createDialog(ui, { title: '确认' });
          const answer = dialog.open();
          const compensated =
            Number.parseFloat(getComputedStyle(root).paddingRight) === padding + scrollbar;
          dialog.close();
          await answer;
          const restored =
            getComputedStyle(root).paddingRight === '40px' && root.style.paddingRight === '';
          ui.destroy();
          style.remove();
          return compensated && restored;
        }),
      );
    },
  },
  {
    name: 'showModal 失败回滚滚动锁且不降级非模态',
    async run(ctx) {
      return result(
        await ctx.evaluate(() => {
          const { mountUI, createDialog } = window.UserscriptUI;
          const dialog = createDialog(mountUI(), { title: '确认' });
          dialog.el.remove();
          let error;
          try {
            void dialog.open();
          } catch (value) {
            error = value.name;
          }
          return { error, open: dialog.el.open, overflow: document.documentElement.style.overflow };
        }),
        { error: 'InvalidStateError', open: false, overflow: '' },
      );
    },
  },
  {
    name: '原生 modal 聚焦取消、Tab 圈定、Escape 结算并解锁',
    async run(ctx) {
      const initial = await ctx.evaluate(() => {
        const { mountUI, createDialog } = window.UserscriptUI;
        const ui = mountUI();
        const dialog = createDialog(ui, {
          title: '确认',
          actions: [
            { label: '取消', value: 'cancel', autofocus: true },
            { label: '确认', value: 'yes' },
          ],
        });
        window.modalResult = dialog.open().then((value) => {
          dialog.destroy();
          return value;
        });
        return (
          dialog.el.matches(':modal') &&
          ui.root.activeElement.textContent === '取消' &&
          document.documentElement.style.overflow === 'hidden'
        );
      });
      for (let i = 0; i < 4; i += 1) await ctx.input.press('Tab');
      const trapped = await ctx.evaluate(() => {
        const root = window.uiTest.root();
        return root.querySelector('dialog').contains(root.activeElement);
      });
      await ctx.input.press('Escape');
      return result(
        {
          initial,
          trapped,
          final: await ctx.evaluate(async () => ({
            value: await window.modalResult,
            detached: !window.uiTest.root().querySelector('dialog'),
            overflow: document.documentElement.style.overflow,
          })),
        },
        { initial: true, trapped: true, final: { value: null, detached: true, overflow: '' } },
      );
    },
  },
  {
    name: 'dialog 边缘点击不关闭，backdrop 点击取消',
    async run(ctx) {
      const edge = await ctx.evaluate(() => {
        const { mountUI, createDialog } = window.UserscriptUI;
        const dialog = createDialog(mountUI(), { title: '确认' });
        window.modalResult = dialog.open();
        const r = dialog.el.getBoundingClientRect();
        return { x: r.left, y: r.top + r.height / 2 };
      });
      await ctx.input.click(edge);
      const stayedOpen = await ctx.evaluate(
        () => window.uiTest.root().querySelector('dialog').open,
      );
      await ctx.input.click({ x: 10, y: 10 });
      return result(
        {
          stayedOpen,
          cancelled: await ctx.evaluate(
            async () =>
              (await window.modalResult) === null && document.documentElement.style.overflow === '',
          ),
        },
        { stayedOpen: true, cancelled: true },
      );
    },
  },
  {
    name: 'modal 内 tooltip 在顶层且 toast 仍可真实点击关闭',
    async run(ctx) {
      const state = await ctx.evaluate(() => {
        const { mountUI, createDialog, createButton, createTooltip, createToast } =
          window.UserscriptUI;
        const ui = mountUI();
        const target = createButton(ui, { label: '目标' });
        const dialog = createDialog(ui, { title: '说明', content: target.el });
        const tooltip = createTooltip(ui, target.el, { content: '提示' });
        void dialog.open();
        tooltip.show();
        tooltip.el.style.pointerEvents = 'auto';
        const p = window.uiTest.point(tooltip.el);
        const hit = ui.root.elementFromPoint(p.x, p.y);
        const above = hit === tooltip.el || tooltip.el.contains(hit);
        const inside = tooltip.el.parentElement === dialog.el;
        tooltip.hide();
        createToast(ui).error('错误', { duration: 0 });
        return {
          above,
          inside,
          point: window.uiTest.point(ui.root.querySelector('.ds-toast-close')),
        };
      });
      await ctx.input.click(state.point);
      return result(
        {
          above: state.above,
          inside: state.inside,
          clickable: await ctx.evaluate(
            () =>
              !window.uiTest.root().querySelector('.ds-toast') &&
              window.uiTest.root().querySelector('dialog').open,
          ),
        },
        { above: true, inside: true, clickable: true },
      );
    },
  },
  {
    name: 'dialog 确认结果释放锁并可显示成功 toast',
    async run(ctx) {
      const point = await ctx.evaluate(() => {
        const { mountUI, createDialog, createToast } = window.UserscriptUI;
        const ui = mountUI();
        const dialog = createDialog(ui, {
          title: '确认',
          actions: [{ label: '确认', value: 'yes' }],
        });
        window.modalResult = dialog.open().then((value) => {
          dialog.destroy();
          createToast(ui).success('完成', { duration: 0 });
          return value;
        });
        return window.uiTest.point(ui.root.querySelector('.ds-dialog-footer button'));
      });
      await ctx.input.click(point);
      return result(
        await ctx.evaluate(
          async () =>
            (await window.modalResult) === 'yes' &&
            document.documentElement.style.overflow === '' &&
            Boolean(window.uiTest.root().querySelector('.ds-toast--success')),
        ),
      );
    },
  },
  {
    name: 'panel 聚焦跳过 hidden/inert/disabled，Escape 后重开仍聚焦可用控件',
    async run(ctx) {
      const initial = await ctx.evaluate(() => {
        const { mountUI, createPanel } = window.UserscriptUI;
        const ui = mountUI();
        const panel = createPanel(ui, { title: '设置', open: false });
        const hidden = document.createElement('button');
        hidden.hidden = true;
        const disabled = document.createElement('fieldset');
        disabled.disabled = true;
        disabled.append(document.createElement('button'));
        const inert = document.createElement('div');
        inert.inert = true;
        inert.append(document.createElement('button'));
        const usable = document.createElement('button');
        usable.textContent = '可用';
        panel.body.append(hidden, disabled, inert, usable);
        window.focusPanel = panel;
        panel.open();
        return ui.root.activeElement === usable;
      });
      await ctx.input.press('Escape');
      return result(
        {
          initial,
          reopened: await ctx.evaluate(() => {
            const panel = window.focusPanel;
            const closed = !panel.isOpen();
            panel.open();
            return closed && window.uiTest.root().activeElement === panel.body.lastElementChild;
          }),
        },
        { initial: true, reopened: true },
      );
    },
  },
  ...['dialog', 'settings', 'operation'].map((kind) => ({
    name: `${kind} 长内容边界、footer 与滚动提示`,
    async run(ctx) {
      return result(
        await ctx.evaluate(async (kind) => {
          const { mountUI, createPanel, createDialog } = window.UserscriptUI;
          const ui = mountUI();
          const lines = Array.from({ length: 60 }, () => {
            const p = document.createElement('p');
            p.textContent = '用于触发真实滚动的内容';
            return p;
          });
          let el;
          if (kind === 'dialog') {
            const dialog = createDialog(ui, {
              title: '长内容',
              content: lines,
              actions: [{ label: '完成', value: 'done' }],
            });
            void dialog.open();
            el = dialog.el;
          } else {
            const panel = createPanel(ui, { title: '长内容', size: kind, footer: '操作区' });
            panel.body.append(...lines);
            el = panel.el;
          }
          await window.uiTest.frames();
          const body = el.querySelector(kind === 'dialog' ? '.ds-dialog-body' : '.ds-panel-body');
          const hint = el.querySelector('.ds-scroll-hint');
          const r = el.getBoundingClientRect();
          const visible = hint.dataset.state === 'visible';
          const bounded =
            r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
          const width = kind === 'dialog' || r.width === (kind === 'settings' ? 360 : 560);
          const footer = el
            .querySelector(kind === 'dialog' ? '.ds-dialog-footer' : '.ds-panel-footer')
            .getBoundingClientRect();
          const footerVisible = footer.height > 0 && footer.bottom <= innerHeight;
          const scrollable = body.scrollHeight > body.clientHeight;
          const height =
            kind !== 'operation' || Number.parseFloat(getComputedStyle(el).maxHeight) <= 640;
          body.scrollTop = body.scrollHeight;
          await window.uiTest.frames();
          const bottomHidden = hint.dataset.state === 'hidden';
          body.scrollTop = 0;
          await window.uiTest.frames();
          return (
            bounded &&
            width &&
            height &&
            footerVisible &&
            scrollable &&
            visible &&
            bottomHidden &&
            hint.dataset.state === 'visible'
          );
        }, kind),
      );
    },
  })),
  {
    name: 'panel 运行时居中保留显式宽度，窄视口 operation 不越界',
    async run(ctx) {
      const centered = await ctx.evaluate(() => {
        const { mountUI, createPanel } = window.UserscriptUI;
        const panel = createPanel(mountUI(), { title: '面板' });
        panel.el.style.width = '440px';
        panel.setPosition('center');
        const r = panel.el.getBoundingClientRect();
        const centered =
          r.width === 440 &&
          Math.abs(r.left + r.width / 2 - innerWidth / 2) <= 1 &&
          Math.abs(r.top + r.height / 2 - innerHeight / 2) <= 1;
        panel.el.style.removeProperty('width');
        panel.setSize('operation');
        panel.setPosition('bottom-right');
        return centered;
      });
      await ctx.input.setViewport(420, 800);
      const narrow = await ctx.evaluate(() => {
        const r = window.uiTest.root().querySelector('.ds-panel').getBoundingClientRect();
        return r.width === 380 && r.left === 20 && r.right === 400;
      });
      return result(centered && narrow);
    },
  },
  {
    name: 'shadow 隔离攻击性宿主样式，宿主可点击且切主题不泄漏',
    async run(ctx) {
      const before = await ctx.evaluate(() => {
        const { mountUI, createPanel, createButton, createInput } = window.UserscriptUI;
        const ui = mountUI({ theme: 'light' });
        window.isolationUI = ui;
        const panel = createPanel(ui, { title: '面板', autoFocus: false });
        panel.body.append(
          createButton(ui, { label: '按钮', variant: 'primary' }).el,
          createInput(ui).el,
        );
        const root = ui.root;
        window.hostClicks = 0;
        const hostButton = document.querySelector('#host-button');
        hostButton.addEventListener('click', () => window.hostClicks++);
        const css = (selector) => getComputedStyle(root.querySelector(selector));
        return {
          isolated:
            document.querySelectorAll('userscript-ui-root').length === 1 &&
            getComputedStyle(ui.host).pointerEvents === 'none' &&
            getComputedStyle(document.body).fontFamily.includes('Comic Sans') &&
            !css('.ds-panel').fontFamily.includes('Comic Sans') &&
            css('.ds-panel').fontSize === '14px' &&
            css('.ds-panel-title').fontSize === '16px' &&
            css('.ds-input').fontSize === '13px' &&
            css('.ds-button--primary').backgroundColor === 'rgb(24, 24, 27)',
          point: window.uiTest.point(hostButton),
          hostBg: getComputedStyle(hostButton).backgroundColor,
          radius: getComputedStyle(hostButton).borderRadius,
        };
      });
      await ctx.input.click(before.point);
      await ctx.evaluate(() => window.isolationUI.setTheme('dark'));
      await ctx.wait(250);
      const after = await ctx.evaluate(() => {
        const ui = window.isolationUI;
        const panel = ui.root.querySelector('.ds-panel');
        return {
          clicks: window.hostClicks,
          theme: ui.host.dataset.dsTheme,
          panel: window.uiTest.colors(panel),
          color: getComputedStyle(panel).color,
          button: getComputedStyle(ui.root.querySelector('.ds-button--primary')).backgroundColor,
          hostBg: getComputedStyle(document.querySelector('#host-button')).backgroundColor,
        };
      });
      return result(
        before.isolated &&
          before.hostBg === 'rgb(255, 105, 180)' &&
          before.radius === '0px' &&
          after.clicks === 1 &&
          after.theme === 'dark' &&
          after.panel.ownBg.every((c) => c < 64) &&
          after.color === 'rgb(250, 250, 250)' &&
          after.button === 'rgb(250, 250, 250)' &&
          before.hostBg === after.hostBg,
      );
    },
  },
  {
    name: 'launcher 锚定面板、阻止宿主冒泡，hover tooltip 保持视口内间距',
    async run(ctx) {
      const state = await ctx.evaluate(() => {
        const { mountUI, createPanel, createLauncher, createTooltip } = window.UserscriptUI;
        const ui = mountUI();
        const panel = createPanel(ui, { title: '设置', autoFocus: false });
        const launcher = createLauncher(ui, { label: '设置', panel });
        createTooltip(ui, launcher.el, { content: '设置提示', placement: 'left' });
        window.pageClicks = 0;
        document.addEventListener('click', () => window.pageClicks++);
        const lr = launcher.el.getBoundingClientRect();
        const pr = panel.el.getBoundingClientRect();
        return {
          anchored:
            lr.right === 980 && lr.bottom === 780 && pr.right === 980 && lr.top - pr.bottom === 8,
          point: window.uiTest.point(launcher.el),
        };
      });
      await ctx.input.click(state.point);
      await ctx.evaluate(() => window.uiTest.root().activeElement?.blur());
      await ctx.input.mouseMove({ x: 500, y: 400 });
      await ctx.input.mouseMove(state.point);
      await ctx.wait(600);
      const hovered = await ctx.evaluate(() => {
        const root = window.uiTest.root();
        const tip = root.querySelector('.ds-tooltip');
        const tr = tip.getBoundingClientRect();
        const lr = root.querySelector('.ds-launcher').getBoundingClientRect();
        return (
          window.pageClicks === 0 &&
          !tip.hidden &&
          tip.dataset.placement === 'left' &&
          lr.left - tr.right === 8 &&
          tr.left >= 0 &&
          tr.top >= 0 &&
          tr.right <= innerWidth &&
          tr.bottom <= innerHeight
        );
      });
      await ctx.input.mouseMove({ x: 500, y: 400 });
      await ctx.wait(250);
      return result(
        state.anchored &&
          hovered &&
          (await ctx.evaluate(() => window.uiTest.root().querySelector('.ds-tooltip').hidden)),
      );
    },
  },
  ...['light', 'dark'].map((theme) => ({
    name: `${theme} 真实计算颜色满足文本 4.5:1 与控件边界 3:1`,
    fixture: 'clean.html',
    async run(ctx) {
      const point = await ctx.evaluate(async (theme) => {
        const lib = window.UserscriptUI;
        const ui = lib.mountUI({ theme });
        const panel = lib.createPanel(ui, {
          title: '标题',
          description: '说明',
          position: 'center',
          autoFocus: false,
        });
        const input = lib.createInput(ui);
        const field = lib.createField(ui, {
          label: '字段',
          description: '字段说明',
          control: input,
        });
        field.setError('错误');
        const buttons = ['primary', 'secondary', 'destructive'].map(
          (variant) => lib.createButton(ui, { label: variant, variant }).el,
        );
        const select = lib.createSelect(ui, { options: [{ label: '选项', value: 'one' }] });
        panel.body.append(
          field.el,
          select.el,
          ...buttons,
          lib.createSwitch(ui, { checked: false }).el,
          lib.createCheckbox(ui).el,
          lib.createAlert(ui, { variant: 'warning', title: '注意', description: '提示说明' }).el,
        );
        for (let i = 0; i < 30; i++) {
          const p = document.createElement('p');
          p.textContent = '滚动内容';
          panel.body.append(p);
        }
        await window.uiTest.frames();
        window.destructiveBase = window.uiTest.colors(buttons[2]);
        buttons[2].scrollIntoView({ block: 'center' });
        return window.uiTest.point(buttons[2]);
      }, theme);
      await ctx.input.mouseMove(point);
      await ctx.wait(250);
      const colors = await ctx.evaluate(() => {
        const root = window.uiTest.root();
        const read = (s) => window.uiTest.colors(root.querySelector(s));
        return {
          schemes: [
            getComputedStyle(root.querySelector('.ds-root')).colorScheme,
            getComputedStyle(root.querySelector('.ds-select')).colorScheme,
          ],
          text: [
            '.ds-panel-title',
            '.ds-panel-description',
            '.ds-field-description',
            '.ds-field-error',
            '.ds-button--primary',
            '.ds-button--secondary',
            '.ds-button--destructive',
            '.ds-alert-description',
            '.ds-scroll-hint-label',
          ].map(read),
          panel: read('.ds-panel'),
          input: read('.ds-input'),
          checkbox: read('.ds-checkbox-box'),
          track: read('.ds-switch-track'),
          thumb: read('.ds-switch-thumb'),
          destructiveBase: window.destructiveBase,
        };
      });
      const textRatios = colors.text.map((c) => contrast(c.fg, c.bg));
      textRatios.push(contrast(colors.destructiveBase.fg, colors.destructiveBase.bg));
      const boundaries = [
        contrast(colors.input.border, colors.panel.ownBg),
        contrast(colors.checkbox.border, colors.panel.ownBg),
        contrast(colors.track.ownBg, colors.panel.ownBg),
        contrast(colors.thumb.ownBg, colors.track.ownBg),
      ];
      if (
        !colors.schemes.every((scheme) => scheme === theme) ||
        textRatios.some((v) => v < 4.5) ||
        boundaries.some((v) => v < 3)
      ) {
        return result(
          { schemes: colors.schemes, textRatios, boundaries },
          { schemes: [theme, theme], textRatios: 'all >= 4.5', boundaries: 'all >= 3' },
        );
      }
      return result(true);
    },
  })),
];
