# Userscript UI 集成指南

## 接入方式

本目录不单独安装或分发。仓库内脚本通过根目录配置的 `@ui` 别名按需直引 `packages/userscript-ui/src/index.ts`：

```ts
import {
  mountUI,
  createPanel,
  createSection,
  createField,
  createSwitch,
  createButton,
  createToast,
} from '@ui';

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

未导入的组件可被 tree-shake；CSS 通过 `?inline` 进入 JS，无需加载外部样式。

## 构建单文件 userscript

构建命令与产物规则见仓库 `docs/architecture.md` 第 5 节，从仓库根目录执行 `bun run build`。

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
- 清空已执行的清理函数集合，不让保留的 UI 句柄继续引用组件闭包；
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
- 根目录 `bun run check:ui-safety` 检查 UI 的危险能力使用。
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
- Dialog 滚动锁会临时设置 `documentElement.style.overflow` 为 `hidden !important`，右内边距在现有计算值上补偿滚动条宽度（包括页面样式表设置的内边距）；同一执行环境的 UI 通过 `globalThis` 上的 Symbol 共享计数，最后一个 Dialog 关闭/销毁后恢复原有内联值及优先级。Tampermonkey / ScriptCat 不同脚本沙箱之间的共享未验证，不保证跨沙箱协调。
- 多个脚本同时使用 Launcher 时可能重叠；请协调 `position` 或自定义 offset Token。
- Toast/Tooltip 只会跟随同一 UI 的最上层 Dialog；另一个用户脚本的 Dialog 仍可能覆盖它们。
- 原生 `<select>` 的展开样式由浏览器/OS 决定，无法完全跨平台统一。
- Tooltip 内容为纯文本，不支持 HTML；不要用它承载核心信息。

## 验证

所有命令从仓库根目录执行：

从仓库根目录执行 `bun run verify`，UI 场景加 `bun run test:browser -- userscript-ui`；验证含义与分层见仓库 `docs/architecture.md` 第 6 节。UI 入口是 `tests/browser-entry.ts`，场景是 `tests/browser-scenarios.mjs`，宿主页面在 `tests/fixtures/`；单元测试保留在 `tests/unit/`。

默认查找系统 Chrome/Edge，可用 `CHROME_PATH` 指定：

```powershell
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
bun run test:browser -- userscript-ui
```

涉及最低版本兼容性的改动（尤其是 CSS 特性）仍应在 Chrome/Edge 111 单独验证。
