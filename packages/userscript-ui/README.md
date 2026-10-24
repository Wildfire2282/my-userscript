# Userscript UI

> 本包已并入 `my-userscript` monorepo 的 `packages/userscript-ui/`，不再作为独立仓库维护；
> 脚本通过 `@ui` 别名直接引用它的 `src/`，构建、lint 与测试统一在主仓库根目录跑。

[English](#english) | [简体中文](#简体中文)

A lightweight, Shadow DOM based design system for Tampermonkey / Greasemonkey userscripts: `--ds-*` design tokens, native DOM components, on-demand imports, and a single-file userscript build.

Zero runtime dependencies. No CDN, remote fonts, or network requests.

## English

### Features

- **Consistent settings UI**: Panel + Section + Field, single-column and compact.
- **Two panel presets**: compact 360px settings panel and a wider 560px operation panel for the script's actual functions.
- **Core form controls**: Button, Input, Textarea, Select, Switch, Checkbox.
- **Feedback and overlays**: Toast, Alert, Dialog, Tooltip.
- **Userscript entry point**: Floating Launcher with four-corner positioning, safe-area offsets, and synchronized `aria-expanded`.
- **Real style isolation**: `<userscript-ui-root>` + `.ds-root { all: initial }` against aggressive host CSS.
- **Light / dark / system themes**: switched only through CSS Variables.
- **On-demand builds**: component CSS is inlined into JS through `?inline`; unused components stay out of the bundle.
- **Native accessibility**: native `input` / `select` / `textarea` / `<dialog>`, full keyboard and focus behavior.
- **Agent-ready rules**: `AGENTS.md` plus design, component, and integration docs.

### Quick start

```ts
import {
  mountUI,
  createPanel,
  createSection,
  createField,
  createSwitch,
  createButton,
  createLauncher,
  createToast,
} from './src/index';

const ui = mountUI({ theme: 'light' });
const toast = createToast(ui);

const panel = createPanel(ui, {
  title: 'Page enhancement',
  description: 'Changes take effect after saving.',
  open: false,
});

const section = createSection(ui, { title: 'General' });
const enabled = createSwitch(ui, { checked: true });

section.body.append(
  createField(ui, {
    label: 'Enable page enhancement',
    description: 'Restore the original page behavior when disabled.',
    control: enabled,
    inline: true,
  }).el,
);
panel.body.append(section.el);

const save = createButton(ui, {
  label: 'Save',
  variant: 'primary',
  onClick: () => toast.success('Settings saved'),
});
panel.setFooter(save.el);

createLauncher(ui, {
  panel,
  label: 'Open settings',
  closeLabel: 'Close settings',
});
```

See the [component usage guide](docs/component-usage.md) for the complete API. Use `createPanel(ui, { size: 'operation', title: 'Actions' })` for the script's functional surface; it is 560px wide and tall enough to hold a two-column working area.

### Commands

```bash
# from the repo root, not inside this folder (this package is imported via @ui):
npm run lint            # ESLint flat config with type-aware rules
npm run format          # Prettier (write)
npm run build:ui-demo   # library + demo single-file userscripts
npm run test:ui-e2e     # build:ui-demo first; uses system Chrome/Edge
npm run check:ui-tokens # component CSS must use --ds-* tokens
```

- `dist/lib/userscript-ui.js` — ESM library.
- `dist/lib/userscript-ui.iife.js` — IIFE library.

### Documentation

- [AGENTS.md](AGENTS.md) — execution rules and component decision table for AI agents
- [Design guidelines](docs/design-guidelines.md) — tokens, typography, layout, states, accessibility
- [Component usage](docs/component-usage.md) — API, examples, and notes for every component
- [Integration guide](docs/integration.md) — Shadow DOM, themes, lifecycle, build, host compatibility
- [Technical decisions](docs/decisions.md) — tradeoffs and verification results

The detailed guides are currently written in Chinese; API names and code examples are language-neutral.

### Project structure

```text
src/
  core/          mount, styles, theme, focus, scroll lock, lifecycle
  tokens/        tokens.css + themes.css
  styles/        base.css
  components/    13 core components, CSS next to TS
demo/            two single-file userscript example entries
tests/unit/      happy-dom unit tests
tests/e2e/       real Chrome/Edge browser tests
docs/            design, component, integration, and decision docs
```

### Verification and compatibility

- Target: Chrome / Edge 111+ with Tampermonkey. E2E uses the installed current Chrome/Edge, no browser download; 111 is the build target, not a pinned CI version.
- Covered: aggressive host `!important` CSS, keyboard/focus, Escape, Dialog focus trap, light/dark contrast, modal Toast/Tooltip placement, Toast timers, Launcher toggle, Tooltip positioning, single-file builds, and tree-shaking.
- Not covered: Firefox E2E, Safari/mobile, page fullscreen mode, automatic collision avoidance between Launchers from multiple scripts.
- Dialogs temporarily lock page scroll and restore it on close; this is the only host-global style the runtime touches.

### License

MIT

## 简体中文

一套面向 Tampermonkey / Greasemonkey 用户脚本的轻量设计系统：Shadow DOM 隔离、`--ds-*` Design Tokens、原生 DOM 组件、按需引入，以及可内联为单文件的构建方案。

运行时零依赖；不加载 CDN、远程字体或网络资源。

### 特性

- **统一的设置页体验**：Panel + Section + Field，单列、克制、信息密度适中。
- **两种面板规格**：360px 设置面板负责参数，560px 操作面板承载脚本功能。
- **核心表单组件**：Button、Input、Textarea、Select、Switch、Checkbox。
- **反馈与浮层**：Toast、Alert、Dialog、Tooltip。
- **用户脚本入口**：Floating Launcher，四角定位 + 安全区，自动开关面板并同步 `aria-expanded`。
- **真正的样式隔离**：`<userscript-ui-root>` + `.ds-root { all: initial }`，抵抗宿主全局 `!important` CSS。
- **浅色 / 深色 / 系统主题**：只通过 CSS Variables 切换。
- **按需构建**：组件 CSS 通过 `?inline` 进入 JS，未导入的组件不会进入产物。
- **原生可访问性**：原生 `input` / `select` / `textarea` / `<dialog>`，完整键盘与焦点行为。
- **AI 可执行规范**：`AGENTS.md` + 设计、组件、集成文档。

### 快速开始

```ts
import {
  mountUI,
  createPanel,
  createSection,
  createField,
  createSwitch,
  createButton,
  createLauncher,
  createToast,
} from './src/index';

const ui = mountUI({ theme: 'light' });
const toast = createToast(ui);

const panel = createPanel(ui, {
  title: '页面增强设置',
  description: '修改后保存生效。',
  open: false,
});

const section = createSection(ui, { title: '常规' });
const enabled = createSwitch(ui, { checked: true });

section.body.append(
  createField(ui, {
    label: '启用页面增强',
    description: '关闭后恢复页面原始行为。',
    control: enabled,
    inline: true,
  }).el,
);
panel.body.append(section.el);

const save = createButton(ui, {
  label: '保存',
  variant: 'primary',
  onClick: () => toast.success('设置已保存'),
});
panel.setFooter(save.el);

createLauncher(ui, {
  panel,
  label: '打开设置',
  closeLabel: '关闭设置',
});
```

完整 API 见 [组件使用指南](docs/component-usage.md)。脚本功能用 `createPanel(ui, { size: 'operation', title: '页面操作' })`：宽度 560px，可以并排放置两栏功能元素。

### 命令

```bash
# 从仓库根目录执行（本包通过 @ui 别名引用，不单独安装）：
npm run lint            # ESLint flat config（含类型感知规则）
npm run format          # Prettier 格式化
npm run build:ui-demo   # 库 + 演示用单文件 userscript
npm run test:ui-e2e     # 需要先 build:ui-demo；使用系统 Chrome/Edge
npm run check:ui-tokens # 组件 CSS 是否只用了 --ds-* Token
```

演示保存会校验 http(s) 地址和 1–200 的整数范围；校验错误保留在对应字段，销毁 UI 会取消待执行的保存计时器。

单文件产物：

- `dist/lib/userscript-ui.js` — ESM 库。
- `dist/lib/userscript-ui.iife.js` — IIFE 库。

分发前修改 `vite.demo.config.ts` 中的 `@match`。

### 文档

- [AGENTS.md](AGENTS.md) — AI Agent 必读的执行规则与决策表
- [设计规范](docs/design-guidelines.md) — Token、排版、布局、状态、可访问性
- [组件使用指南](docs/component-usage.md) — 每个组件的 API、示例与注意事项
- [集成指南](docs/integration.md) — Shadow DOM、主题、生命周期、构建、宿主兼容
- [技术决策](docs/decisions.md) — 选型理由、取舍与验证结果

### 结构

```text
src/
  core/          mount、style、theme、focus、scroll lock、生命周期
  tokens/        tokens.css + themes.css
  styles/        base.css
  components/    13 个核心组件，CSS 与 TS 同目录
demo/            两个单文件 userscript 示例入口
tests/unit/      happy-dom 单元测试
tests/e2e/       真实 Chrome/Edge 浏览器测试
docs/            设计、组件、集成、决策文档
```

### 验证与兼容性

- 目标环境：Chrome / Edge 111+ + Tampermonkey。E2E 使用系统当前 Chrome/Edge，不下载浏览器；111 是构建目标，不是 CI 固定复现的版本。
- 已覆盖：宿主 `!important` 全局样式、键盘/焦点、Escape、Dialog 焦点圈定、浅色/深色对比度、modal 内 Toast/Tooltip、Toast 计时、Launcher 开关、Tooltip 定位、单文件产物、按需 tree-shaking。
- 未覆盖：Firefox 的 E2E、Safari / 移动端、页面全屏模式、多个脚本 Launcher 的自动避让。
- Dialog 打开时会临时锁定页面滚动，关闭后恢复；这是唯一会触碰宿主全局样式的地方。

### License

MIT
