# Userscript UI Agent 指南

> 本包已并入 `my-userscript` monorepo（路径 `packages/userscript-ui/`），不再单独维护。
> 构建 / lint / 单测走根目录命令；UI 专属的 safety 与 token 检查已挂在根 `bun run verify` 里。

本仓库为 Tampermonkey / Greasemonkey 用户脚本提供统一的 Shadow DOM UI 层。写任何 UI 之前先读本文件；需要细节时再读：

- `docs/design-guidelines.md` — 视觉、Token、布局与可访问性规则
- `docs/component-usage.md` — 每个组件的 API 与示例
- `docs/integration.md` — 挂载、主题、生命周期、构建与宿主兼容
- `docs/decisions.md` — 技术选型与取舍

## 1. 不可违反的约束

- 运行时零依赖：禁止 React、Vue、Tailwind、组件库运行时、远程字体、CDN。
- 所有 UI 必须挂载在 `mountUI()` 创建的 Shadow Root 内；不得修改宿主页面的全局 CSS。
- 颜色、尺寸、间距、圆角、阴影、动效只能使用 `--ds-*` Token；不要硬编码。
- 禁止 `innerHTML`、`insertAdjacentHTML`、`outerHTML`、`document.write`、`eval`、`new Function`。
- 用户内容一律 `textContent` 或 DOM 节点；需要富内容时用 DOM API 组装。
- 不默认接管页面快捷键；组件内部的 Escape 只处理自己的浮层。
- 所有监听器必须能随 `ui.destroy()` 或组件 `destroy()` 清理。
- 每个组件用 `createScope(ui)`（`core/lifecycle.ts`）拿自己的 `signal`，并在 `destroy()` 里调用 `scope.destroy()`；动态重建内容时必须先销毁旧组件，不要只从 DOM 删节点。
- 创建任何组件前先 `assertAlive(ui, name)`：UI 已销毁时直接抛错，不要返回一个“能用但没反应”的控件。
- 每个页面只创建一次 UI；不要因为打开/关闭面板重复 `mountUI()`。
- 先复用现有组件；不要为单个页面的一次性需求新增通用抽象。

## 2. 快速开始

最小可用组合见 `docs/integration.md` 接入方式：`mountUI` 建 UI，`createPanel` 加 `createSection` 加 `createField` 组装，`createLauncher` 做入口，页面卸载时 `ui.destroy()` 清理。默认文案经 `mountUI({ labels })` 一次注入；承载脚本功能用 `size: 'operation'` 操作面板，设置仍留在默认设置面板。

## 3. 组件选择

| 需求 | 使用 | 不要 |
| --- | --- | --- |
| 设置页外壳 / 脚本功能面板 | `createPanel`（`size: 'settings'` / `'operation'`） | 自己拼固定定位卡片 |
| 相关设置分组 | `createSection` | 每组都套一张卡片 |
| 标签 + 控件 + 说明/错误 | `createField` | 手写 label / aria 关联 |
| 明确操作（保存、刷新、复制） | `createButton` | 把每个操作都做成图标按钮 |
| 立即生效的二元设置 | `createSwitch` + inline Field | 用 Checkbox 假装 Switch |
| 多个可独立勾选 / 需提交 | `createCheckbox` | 用 Select 做多选 |
| 有限互斥选项 | `createSelect` | 自绘下拉菜单 |
| 文本、数字、短参数 | `createInput` | 为每个输入框新建组件 |
| 长文本 | `createTextarea` | 复杂富文本编辑器 |
| 短暂操作结果 | `createToast` | 用 Alert 做 3 秒消失的提示 |
| 必须持续显示的信息 | `createAlert` | 用 Toast 展示需要反复阅读的错误 |
| 需要用户明确决策 | `createDialog` / `confirmDialog` | 只用遮罩 div 模拟模态 |
| 解释图标或术语 | `createTooltip` | 把核心信息只放在 Tooltip 里 |
| 页面独立入口 | `createLauncher` | 修改宿主页面导航或全局 DOM |

判断顺序：**已有组件组合 → 原生控件 + Field → 新增组件**。

## 4. 常用 API

所有组件返回至少 `{ el }` 的句柄；表单控件的 `el` 是外层元素，`input` 是原生控件。所有句柄都有 `destroy()`。

| 工厂 | 返回 | 关键点 |
| --- | --- | --- |
| `mountUI(options)` | `UI` | `theme`、`tokens`、`labels`、`target`、`zIndex`；`destroyed` 表示是否已销毁 |
| `createPanel(ui, options)` | `PanelHandle` | `size`（settings/operation）、`body`、`footer`、`open/close/toggle`、`setFooter`、`setSize`、`autoFocus` |
| `createSection(ui, options)` | `SectionHandle` | `body` |
| `createField(ui, options)` | `FieldHandle` | `control` 传 `FormControl`；`inline` 用于 Switch/Checkbox 行 |
| `createButton(ui, options)` | `ButtonHandle` | `variant`、`size`、`loading` |
| `createInput/createTextarea` | `InputHandle` / `TextareaHandle` | `setValue/getValue/setInvalid` |
| `createSelect(ui, options)` | `SelectHandle` | 原生 `select`，`el` 是包装层 |
| `createSwitch/createCheckbox` | `SwitchHandle` / `CheckboxHandle` | 原生 `input`，`el` 是包装层 |
| `createToast(ui, options)` | `ToastController` | 每个 UI 创建一个，复用 |
| `createAlert(ui, options)` | `AlertHandle` | 持久内容；`dismiss()` 触发 `onDismiss`，`destroy()` 不触发 |
| `createDialog(ui, options)` | `DialogHandle` | `open()` 返回 `Promise<string \| null>` |
| `confirmDialog(ui, options)` | `Promise<boolean>` | 危险操作确认 |
| `createTooltip(ui, target, options)` | `TooltipHandle` | 只解释图标/术语 |
| `createLauncher(ui, options)` | `LauncherHandle` | 传入 `panel` 自动开关并同步 `aria-expanded` |

完整签名见 `docs/component-usage.md`。

## 5. 布局与视觉

- Panel 只有两档规格：设置面板（默认，`size: 'settings'`）宽 360px、居中时 440px、最大高度 70vh、单列；操作面板（`size: 'operation'`）宽 560px、最大高度 80vh，用于承载脚本功能。两档内边距都是 16px，共用标题、字段、滚动提示和底栏。
- 设置面板只放参数；操作面板放页面功能。操作面板不会自动分栏，需要两栏时在 `panel.body` 里用一个网格容器组合 Section；窄视口折叠为单列。
- `position: 'center'` 只改变位置：视口正中、仍非模态；设置面板居中时放宽到 440px，操作面板保持 560px。
- 同一角落不要同时打开两个 Panel；切换时在入口处先关闭另一个（如 `settings.close(); operations.open();`）。
- 相关设置放同一个 Section；Section 之间用分隔线，不嵌套卡片。
- Field 统一组织 label、description、error；输入/选择用 stacked，Switch/Checkbox 用 inline 行。
- 主操作只保留一个；次要操作在左，主操作在右；危险操作单独分组，并用 `confirmDialog`。
- 控件高度 32px（sm 28 / lg 36）；正文 14px，辅助 12px；间距用 4/8/12/16/24。
- Panel 底部操作区用 `panel.setFooter(content)`；不要直接改 `footer.hidden`。
- 圆角：控件 6px，面板/Dialog 8px；边框 1px；阴影克制。
- 面板/Dialog 内容超出时由组件自带底部渐隐滚动提示，不要自己再写一套；用 `scrollHint: false` 关闭。
- 不要用渐变、装饰性动画、过多边框或重复标题；滚动提示的功能性渐隐除外。
- 浅色和深色都必须可读；不要把颜色写死在组件里。

## 6. Userscript 集成

- `mountUI()` 把 `<userscript-ui-root>` 挂到 `document.documentElement`，不要塞进宿主 `body` 的布局容器（避免 transform / overflow 影响 fixed 定位）。
- 主题默认 `light`；显式 `dark` 或 `system`。不要依赖宿主页面主题。
- 主题持久化由脚本自己负责（如 `GM_setValue`），在 `mountUI` 前读取。
- `createToast(ui)` 只创建一次；每次 UI 重建时重新创建。
- `confirmDialog` 用于不可逆/危险操作；普通保存用 Toast。
- Dialog 打开时会临时锁住页面滚动，关闭后恢复原值；这是唯一会触碰宿主全局样式的地方。
- 多个脚本同时运行时各自有 Shadow Root；协调 Launcher 的角标位置，避免重叠。
- SPA 路由变化不要重复 `mountUI`；保留实例并重新打开 Panel，或者在销毁后重建。
- 脚本通过 `@ui` 直引源码；根目录 `bun run build` 使用 `tools/build.mjs` 将 UI 打入各脚本产物，metadata 由脚本自身配置维护。
- 不需要远程资源；CSS 已以字符串形式进入 JS。

## 7. 新增组件

先回答三个问题：

1. 至少两个真实脚本会用到吗？
2. 现有组件组合真的无法满足吗？
3. 能否只加一个 CSS 文件 + 一个工厂函数，而不引入新依赖？

仍需要新增时：

- `src/components/<name>.css` + `<name>.ts`；CSS 通过 `?inline` 引入并用 `ui.useStyles()` 注册。
- 返回 `{ el, ... }` 句柄；表单类遵循 `FormControl`。
- 监听器使用 `createScope(ui).signal`；`destroy()` 里调用 `scope.destroy()`，它随 `ui.destroy()` 自动触发。
- 只使用 `--ds-*` Token；补浅/深色值。新增或改动代码后跑 `bun run format`，不要手调空格与引号。
- 添加单元测试与一条真实浏览器用例；更新 `docs/component-usage.md`、本文件和 `src/index.ts`。
- 不引入新运行时依赖。

## 8. 验证

命令以根 `package.json` 为准，含义与分层见仓库 `docs/architecture.md` 第 6 节：从仓库根目录执行 `bun run verify`，UI 浏览器场景加 `bun run test:browser -- userscript-ui`。规则取舍见 `docs/decisions.md` 第 20 节。

- `bun run check:ui-safety`：查危险能力使用（HTML 字符串注入、动态执行、网络请求）。
- `bun run check:ui-tokens`：查组件 CSS 的颜色与尺寸是否都来自 `--ds-*` Token。

## 9. 常见错误

- 用 `--background`、`--border` 而不是 `--ds-*`，导致宿主变量穿透。
- 把 Panel 挂进宿主 `body` 的 transform 容器，fixed 定位偏移。
- 用 `innerHTML` 拼设置项或 Toast 内容。
- 每个布尔设置都做 Switch；需要随表单提交的多选用 Checkbox。
- 用 Toast 展示必须持续阅读的错误；用 Alert。
- 自己写遮罩 div 做 Dialog，丢失焦点圈定、Escape 和背景 inert。
- 在 `document` 上注册快捷键或全局点击处理。
- 重复 `createToast()` / 重复 `mountUI()`，导致多条通知或重复响应。
- 用操作面板承载常规设置，或把页面功能塞进 360px 的设置面板；两者的差别是“参数”与“功能”，不是权限。
- 同一角落同时打开设置面板和操作面板，两个固定定位浮层会重叠。
- 忘记 `ui.destroy()`，在 SPA 中留下 host、监听器和滚动锁。
- 重建面板内容时只 `replaceChildren()` 而不 `destroy()` 旧控件，监听器会挂到 UI 销毁才释放。
- 跨组件直接改内部 DOM（如 `panel.footer.hidden`），用句柄方法代替。
