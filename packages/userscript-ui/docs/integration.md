# Userscript UI 集成指南

## 产物形态

```text
dist/
  lib/
    userscript-ui.js       ESM，适合被其他 Vite 项目引入
    userscript-ui.iife.js  IIFE，暴露 UserscriptUI 全局
  showcase.user.js         完整示例，单文件可直接注入
  minimal.user.js          最小按需示例
```

单文件产物不包含外部 CSS、字体或网络请求；CSS 在构建时已经变成 JS 字符串。

## 接入方式

### 方式一：源码复用（推荐，当前默认）

把本仓库作为同仓依赖、Git submodule 或本地包引入，在自己的 Vite 入口中按需导入：

```ts
import {
  mountUI,
  createPanel,
  createSection,
  createField,
  createSwitch,
  createButton,
  createToast,
} from '../userscript/src/index';

const ui = mountUI({ theme: 'light' });
const toast = createToast(ui);

const panel = createPanel(ui, {
  title: '设置',
  open: false,
});

const section = createSection(ui, { title: '常规' });
const enabled = createSwitch(ui, { checked: true });
section.body.append(
  createField(ui, {
    label: '启用',
    control: enabled,
    inline: true,
  }).el,
);
panel.body.append(section.el);

const save = createButton(ui, {
  label: '保存',
  onClick: () => toast.success('已保存'),
});
panel.setFooter(save.el);
```

未导入的组件会被 tree-shake；`minimal.user.js` 就是只导入 Panel/Field/Switch/Button 的产物。

### 方式二：复制 `src/`

适合不想引入包管理的单脚本项目。复制 `src/` 到脚本目录，保持目录结构，然后按方式一导入。代价是设计系统升级需要手动同步。

### 方式三：发布 npm 包

当前 `package.json` 是 `private: true`。需要发布时：

1. 去掉 `private`，确定包名。
2. 增加 `exports` 与类型声明构建（`tsc --emitDeclarationOnly`）。
3. 保留 `sideEffects: false`，确保按需 tree-shaking。
4. 在脚本项目中 `npm install <package>`。

## 构建单文件 userscript

参考 `vite.demo.config.ts`：

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'chrome111',
    cssTarget: 'chrome111',
    outDir: 'dist',
    lib: {
      entry: 'src/main.ts',
      formats: ['iife'],
      name: 'MyUserscript',
      fileName: () => 'my.user.js',
    },
    rollupOptions: {
      output: {
        banner: `// ==UserScript==
// @name         My Userscript
// @namespace    https://example.com
// @version      0.1.0
// @description  ...
// @match        https://example.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==
`,
      },
    },
  },
});
```

要点：

- `@match` 改成脚本真正需要的站点，不要直接分发示例的 `example.com`。
- 只有使用 GM API 时才加 `@grant`；纯 DOM UI 用 `@grant none`。
- `banner` 必须位于文件最顶部；Rollup 会保证这一点。
- 不要引入 `vite-plugin-monkey`：CSS 已是字符串，IIFE 已经自包含。
- `target: 'chrome111'` 避免 Lightning CSS 为旧浏览器生成大量 RTL/兼容回退；构建目标是 Chrome/Edge 111+，但 E2E 使用系统当前 Chrome/Edge，最低版本未固定复现。
- 构建后用 `npm run size` 查看 raw / gzip / brotli 体积。

## Shadow DOM 结构

```text
<userscript-ui-root>            position: fixed; inset: 0; pointer-events: none
  #shadow-root
    <div class="ds-root">       all: initial; display: contents
      <div class="ds-layer ds-layer-base">      Panel / Launcher
      <div class="ds-layer ds-layer-toast">     Toast viewport
      <div class="ds-layer ds-layer-tooltip">   Tooltip
      <dialog class="ds-dialog">                top layer
```

设计要点：

- Host 用内联 `!important` 固定定位、层级、可见性和 pointer-events，抵御宿主 `* { ... !important }`。
- `.ds-root` 用 `all: initial` 阻断宿主继承的字体、颜色、字号和 visibility，再恢复设计系统值。
- 三个 layer 都是 `pointer-events: none`，只有具体组件恢复 `auto`，因此全屏 host 不会挡住页面点击。
- Dialog 直接挂到 `.ds-root`，使用原生 top layer；Toast/Tooltip 默认在同一 Shadow Root 内 fixed 定位，同一 UI 有 Dialog 打开时会移动到该 Dialog 内。
- Panel 与 Dialog 的滚动区包在 `position: relative` 的容器里，滚动提示绝对定位在该容器底部，不参与布局。
- Host 默认挂到 `document.documentElement`，避免 `body` 的 transform / overflow 影响 fixed 定位。

## 主题

```ts
const ui = mountUI({ theme: 'light' });

ui.setTheme('dark');
ui.setTheme('system');
ui.setTheme('light');
```

- `light` / `dark` 是显式主题；`system` 跟随 `prefers-color-scheme`。
- 默认不跟随宿主网站，避免被页面主题意外带偏。
- 主题通过 `data-ds-theme` 和 `color-scheme` 应用；组件只消费 `--ds-*`。
- 切换主题时短暂关闭过渡，避免颜色闪动。
- 自定义 Token：

```ts
const ui = mountUI({
  theme: 'light',
  tokens: {
    '--ds-primary': '#2563eb',
    '--ds-primary-foreground': '#ffffff',
  },
});
```

`tokens` 的 key 必须以 `--` 开头；设置到 host 内联样式，优先级高于主题默认值。

## 生命周期

```ts
const ui = mountUI();

// 页面卸载或脚本 UI 被移除时
ui.destroy();
```

`ui.destroy()` 会：

- 按注册的逆序调用 `ui.onDestroy()` 的清理函数；
- 中止 `ui.signal` 上的所有事件监听；
- 销毁每个组件自己的 scope，再移除 host，连带 Panel/Launcher/Toast/Tooltip/Dialog；
- 释放 Dialog 打开的页面滚动锁。

组件级句柄都有 `destroy()`：Panel、Section、Field、Button、Input、Textarea、Select、Switch、Checkbox、Toast 控制器、Alert、Dialog、Tooltip、Launcher。每个组件持有自己的 `AbortController`（`core/lifecycle.ts` 的 `createScope`），所以：

- 显式 `destroy()` 只影响自己：中止自己的监听器、移除自己的元素；
- `ui.destroy()` 会自动调用同一条 teardown，不需要重复写；
- 动态重建面板内容时，先 `destroy()` 旧控件再移除节点；否则监听器记录会挂到 scope 上直到 UI 销毁。`panel.setFooter()` 和直接操作 `panel.body` 都只移动 DOM，不会替你销毁旧控件。

`ui.destroy()` 之后再创建组件会直接抛错（`Cannot create a … after ui.destroy()`）。这是刻意的：在已中止的信号上注册的监听器永远不会触发，静默返回一个“能用但没反应”的控件比报错更难排查。

销毁后 `ui.setTheme()` / `ui.useStyles()` / `ui.mount()` 同样抛错，避免向已摘除的 Shadow Root 写入状态。`ui.onDestroy()` 如果注册在销毁之后，会立即执行回调后返回空函数，与组件 scope 的行为保持一致，不会留下永远不会执行的清理逻辑。

### 标签（i18n）

组件的默认文案（关闭、设置、通知…）由 `mountUI` 一次注入：

```ts
const ui = mountUI({
  labels: {
    close: '关闭',
    settings: '设置',
    operation: '操作',
    notifications: '通知',
    dismissNotification: '关闭通知',
    closeSettings: '关闭设置',
    scrollHint: '向下滚动查看更多内容',
    cancel: '取消',
    confirm: '确定',
  },
});
```

单个组件的 `closeLabel` / `dismissLabel` / `regionLabel` / `ariaLabel` 仍然可以覆盖。

### SPA / 重复注入

- 脚本启动时只 `mountUI()` 一次，把 `ui` 保存在模块变量里。
- 路由变化不需要重建 UI；重新打开 Panel 即可。
- 如果必须重建，先 `ui.destroy()`，再 `mountUI()`，不要同时存在两个 host。
- 不要监听 `pagehide` 后立即销毁又期待 bfcache 恢复；更稳妥的是在脚本自己的 teardown 路径里销毁。

## 安全

- 全部文本通过 `textContent` / `createTextNode`；源码中没有 `innerHTML`、`outerHTML`、`insertAdjacentHTML`、`document.write`。
- 没有 `eval`、`new Function`、`fetch`、`XMLHttpRequest` 或远程 CSS。
- 不注册页面级快捷键；Escape 只在 Panel/Dialog/Tooltip 自己的范围内处理。
- `npm run check:safety` 会扫描 `src/` 和 `demo/` 中的危险模式。
- `adoptedStyleSheets` 优先，严格 CSP 页面比 `<style>` 更稳；不支持时自动回退 `<style data-ds-style>`。
- Host 的关键样式通过 CSSOM 内联设置，不写 `<style>` 到宿主 `<head>`。

## 宿主页面兼容

已在包含以下攻击性样式的页面验证：

```css
* {
  font-family: "Comic Sans MS" !important;
  font-size: 18px !important;
  color: #b91c1c !important;
  letter-spacing: 1px !important;
}

button {
  background: hotpink !important;
  border-radius: 0 !important;
}
```

结果：组件字体、字号、颜色、按钮背景保持设计系统值；宿主按钮保持原样；宿主按钮仍可点击；UI CSS 不泄漏。

已知边界：

- 宿主对 `html` 使用 `transform` / `filter` 时，fixed 定位仍可能偏移；已通过挂到 `documentElement` 规避常见的 body transform。
- 宿主强制 `opacity: 0 !important` 于 host 自身时，内部无法恢复；关键属性已加内联 important。
- 页面进入全屏时，host 外的 UI 可能不可见；v1 未做 fullscreen 迁移。
- Dialog 滚动锁会临时设置 `documentElement.style.overflow` 为 `hidden !important`；最后一个 Dialog 关闭/销毁后恢复原值及优先级，多个脚本通过全局 Symbol 共享计数。
- 多个脚本同时使用 Launcher 时可能重叠；请协调 `position` 或自定义 offset Token。
- Toast/Tooltip 只会跟随同一 UI 的最上层 Dialog；另一个用户脚本的 Dialog 仍可能覆盖它们。
- 原生 `<select>` 的展开样式由浏览器/OS 决定，无法完全跨平台统一。
- Tooltip 内容为纯文本，不支持 HTML；不要用它承载核心信息。

## 构建与体积

```bash
npm run build
npm run size
```

体积不写死在文档里，用 `npm run size` 看当前构建的实际数字：

```text
file                                  raw       gzip     brotli
dist/lib/userscript-ui.js  ...        —— 体积报告同时做一次按需检查，
dist/showcase.user.js      ...        断言 minimal 产物不含未导入组件的 CSS
dist/minimal.user.js       ...        （类名与 `data-ds-*` 在 CSS 字符串里，不会被压缩改名）
```

CSS 在 JS 内，gzip/brotli 后的体积更能代表网络传输成本。

## 验证

```bash
npm run check
```

包含：

1. `check:safety` — 源码能力扫描（HTML 字符串注入、动态执行、网络）。
2. `check:tokens` — 组件 CSS 的颜色与尺寸是否都来自 `--ds-*` Token。
3. `lint` — ESLint flat config + typescript-eslint 类型感知规则（在 tsconfig 范围内）；同时把 `innerHTML`、`insertAdjacentHTML`、`document.write`、`new Function`、`==` 等硬规则变成错误。
4. `format:check` — Prettier 校验（单引号、100 列、尾逗号、LF）；Markdown 不在范围内。
5. `typecheck` — TypeScript 严格检查。
6. `test` — happy-dom 单元测试（挂载、主题、生命周期、表单、反馈、Launcher、Tooltip）。
7. `build` — 库 + 两个单文件 userscript。
8. `check:userscript` — 检查 metadata 名称、namespace 与 banner 是否位于文件顶部。
9. `test:e2e` — 真实 Chrome/Edge：样式隔离、键盘/焦点、Dialog、浅色/深色对比度、modal 内 Toast/Tooltip、Toast、Launcher、Tooltip、按需产物。
10. `size` — 体积与 “minimal 不包含未导入组件” 检查。

同样的命令跑在 `.github/workflows/ci.yml` 里：一个 job 跑类型/单测/构建/体积，另一个 job 用 runner 自带的 Chrome 跑 E2E。

E2E 使用系统浏览器，不下载 Playwright 浏览器。默认查找 Chrome/Edge；可用 `CHROME_PATH` 指定：

```powershell
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:e2e
```

CI 同样使用 runner 自带的当前 Chrome，不会固定到 Chrome 111。最低版本兼容性改动（尤其是 CSS 特性）仍应在本地用 111 单独复验。
