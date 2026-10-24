# 技术决策记录

## 目标与边界

为 Tampermonkey / Greasemonkey 用户脚本提供一套可复用、可内联、无运行时依赖的轻量设计系统。第一版覆盖设置面板、操作面板、浮动入口、基础表单、反馈与确认场景，不追求完整复刻 shadcn/ui。

## 调研结论

### Basecoat

[Basecoat](https://basecoatui.com/) 提供了成熟的 shadcn 风格 vanilla 组件和主题包，视觉质量高，但：

- 依赖 Tailwind CSS v4；
- 组件是完整集合，CSS 体积无法按组件裁剪；
- 运行时通过全局 `window.basecoat.init()` 扫描 DOM，和 Shadow DOM 内的组件生命周期不一致；
- 面向通用 Web 页面，而非用户脚本的单文件内联与隔离需求。

因此只参考其视觉与 Token 语义，不直接依赖。

### shadcn/ui

只借用语义 Token（background、primary、muted、border、ring 等）和组件状态规范。不引入 React、Radix，也不复制其全部组件。

### 其他被排除的方案

- **React / Vue**：运行时体积和挂载成本不符合用户脚本场景。
- **Tailwind**：构建链和生成 CSS 体积不可控，且本项目的组件数量固定，手写 CSS 更小更直接。
- **额外的 userscript 构建插件**：CSS 已经以字符串形式进入 JS，根目录 `tools/build.mjs` 负责单文件 IIFE 与 metadata，无需另加一套构建链。
- **自定义 Dialog 遮罩**：原生 `<dialog>.showModal()` 已提供 top layer、焦点圈定、Escape、背景 inert，自己实现只会增加可访问性风险。

## 关键决策

### 1. 原生 DOM + 工厂函数

组件用 `document.createElement` 构建，统一返回 `{ el, ... }` 句柄。输入类组件保留原生 `input` / `select` / `textarea` 语义；不引入自定义元素注册，避免和宿主页面的 custom elements 冲突。

### 2. CSS 文件 + Vite `?inline`

组件 CSS 写在真实 `.css` 文件中，通过 `?inline` 在构建时转成字符串。组件首次创建时把字符串注入当前 Shadow Root：

- 天然按需：未导入的组件不会带入 CSS；
- 无运行时 CSS 编译器；
- 单文件产物不需要额外的 CSS 资源；
- 仍可用编辑器的 CSS 工具链。

### 3. `--ds-*` Token 命名

shadcn 的 `--background`、`--border` 等名称太通用，会从宿主页面继承进 Shadow DOM。统一加 `--ds-` 前缀，并在 `:host` 上声明，阻断宿主同名变量。

### 4. 双层隔离

- Host `<userscript-ui-root>` 使用内联 `!important` 固定定位、层级、可见性和 pointer-events，抵抗宿主 `* { ... !important }`。
- Shadow 内 `.ds-root` 使用 `all: initial` 重置继承的字体、颜色、字号、可见性等，再显式恢复设计系统值。

这解决了一个常见问题：页面全局 `font-family` / `color` / `visibility` 会穿过 Shadow 边界。

### 5. Constructable Stylesheets

优先使用 `adoptedStyleSheets` 注入样式，严格 CSP 页面比 `<style>` 更稳；不支持时回退为 `<style data-ds-style>`。

### 6. 单一 UI 上下文

`mountUI()` 持有 host、Shadow Root、主题、样式注册表、浮层和销毁信号。组件显式接收 `ui`：

- 多实例互不污染；
- 不需要全局单例；
- 组件模块保持独立，未导入的组件可以被 tree-shake。

### 7. 原生 Dialog

Dialog 基于 `<dialog>` + `showModal()`，保留浏览器提供的焦点管理和键盘行为，只补充关闭语义、焦点恢复、危险操作确认和滚动锁定。

### 8. 单文件构建

仓库内脚本通过 `@ui` 按需直引 UI 源码，由根目录 `tools/build.mjs` 统一构建为单文件 IIFE，并写入各脚本的 userscript metadata。不再单独输出 UI 库。CSS 已在 JS 字符串内，产物不依赖 CDN、远程字体或网络请求。

### 9. Launcher 不做拖拽

第一版不引入拖拽：固定四角 + 安全区偏移足够覆盖用户脚本入口，拖拽会带来事件冲突、位置持久化和移动端手势问题。位置需要变化时通过 `position` 或自定义 offset Token。

### 10. Tooltip 用 fixed 定位

Tooltip 挂在 `ui.layers.tooltip`，显示时用 `getBoundingClientRect()` 计算 fixed 坐标，并做视口边缘翻转/夹取。内容只接受字符串，避免把 Tooltip 变成富内容容器。

### 11. Dialog 滚动锁用共享 Symbol

Dialog 打开时临时设置 `documentElement.style.overflow`，关闭后恢复。锁计数放在 `globalThis[Symbol.for('userscript-ui.scroll-lock')]` 上，同一执行环境中的多个 UI 同时打开 Dialog 时不会互相提前解锁。这是运行时唯一会触碰宿主全局样式的地方。

### 12. 深色主题用亮度差而不是阴影表达层级

深色下投影几乎不可见，若卡片与画布同为 `#09090b`，浮层会糊在页面上。因此深色主题单独给出一套取值：

- 画布 `#09090b`，卡片 `#18181b`，用明度差表达"浮起"，边框只做发丝分隔；
- 状态色整体提亮，`--ds-destructive` 用亮红配深色前景，保证实心按钮文字同样达到 4.5:1；
- 焦点环提亮到 `#d4d4d8`，保证 `:focus-visible` 在两种主题下同样醒目；
- 控件描边（`--ds-input`）与未选中开关轨道（`--ds-track`）拆成两个 Token；两者都按 3:1 的控件边界取值，轨道用稍柔和的灰，而不是几乎看不见的弱填充。

深色取值不新增语义组件，全部落在既有 `--ds-*` Token 上；浅色值单独维护。

### 13. 每个组件一个 scope，而不是只挂 `ui.signal`

早期只有 `ui.signal`：控件的监听器活到整个 UI 销毁，动态重建面板内容会留下不可回收的节点和闭包。现在每个组件持有自己的 `AbortController`（`core/lifecycle.ts` 的 `createScope`）：

- 所有句柄都有 `destroy()`，只中止自己的监听器、移除自己的元素；
- `createScope` 自动注册到 `ui.onDestroy`，所以 `ui.destroy()` 仍然一条路径清完；
- 因为“清理”只有一处实现，也不再有“先建句柄还是先注册回调”的 TDZ 风险。

`ui` 暴露 `destroyed`，所有工厂入口用 `assertAlive(ui, name)` 直接抛错：在已中止的信号上注册监听器永远不会触发，静默返回一个“能用但没反应”的控件比报错更难排查。`ui` 自身的 `setTheme` / `useStyles` / `mount` 也遵守同一规则；销毁后注册的 `onDestroy` 回调立即执行，和组件 scope 的语义一致。

### 14. Dialog 用状态判定，不用关闭计数器

以前用 `ignoredCloseEvents` 计数来吞掉自己引发的 `close` 事件。一旦某次 `close` 事件没派发，计数残留就会吞掉下一次真实关闭（promise 不 resolve、滚动锁不释放、焦点不恢复）。现在只依赖两条已有事实：`finish()` 幂等，且 `el.open === true` 时绝不结算结果。

### 15. Field 与控件分离 invalid 所有权

控件用 `data-ds-invalid` 记录“我自己是无效的”，Field 用 `data-ds-field-invalid` 记录“字段错误正在显示”，`aria-invalid` 始终由两者求并集得到。无论先调用 `setInvalid(false)` 还是先调用 `setError()`，另一方的状态都不会被覆盖。Field 销毁时只移除自己的 `data-ds-field-invalid`、错误 ID 和描述 ID，保留控件自身的 invalid 和外部 `aria-describedby`。

### 16. 标签集中注入

默认文案（关闭、设置、通知、滚动提示、取消、确定…）由 `mountUI({ labels })` 一次给全，组件只保留单点覆盖选项。滚动提示也走同一个入口，不再在 `core/scroll-hint.ts` 硬编码语言。

### 17. 浮层挂载规则集中在一处

“谁在最上层”是唯一需要 token 的地方：`core/top-layer.ts` 提供 `overlayHost()`（通知：最上层 Dialog，否则自己的 layer）和 `anchorOverlayHost()`（Tooltip：目标所在 Dialog；目标在模态之外时返回 null，不静默渲染到看不见的地方）。Toast 和 Tooltip 不再各自实现这套规则。

### 18. 安全扫描检查能力，不检查字符串

`check-safety.mjs` 先去掉注释，再匹配能力：`innerHTML`/`setHTML`/`srcdoc`、`eval`/`new Function`/动态 `import()`、`fetch`/`XHR`/`WebSocket`/`sendBeacon`、远程 `@import`/`url(http…)`。它不再因为注释里出现 `fetch(` 或占位符里有 `https://example.com/api` 而误报，也补上了旧白名单漏掉的 `setHTMLUnsafe`、`srcdoc` 等入口。

## 验证入口

- 根目录 `npm run check` 统一执行静态检查、happy-dom 单元测试、脚本构建、metadata、安全与 Token 检查，以及浏览器场景；本文不记录易过期的通过状态或测试数量。
- `npm run test:browser -- userscript-ui` 通过 `tools/browser-check.mjs` 的 CDP 驱动执行 UI 场景，入口是 `tests/browser-entry.ts`，场景是 `tests/browser-scenarios.mjs`，宿主页面在 `tests/fixtures/`。
- 浏览器场景覆盖样式隔离、键盘/焦点、Dialog、Toast、Launcher、Tooltip、主题与面板尺寸等真实 DOM 行为；happy-dom 单元测试负责无需布局的组件状态与生命周期。
- 构建使用根目录 `npm run build`，userscript metadata 使用 `npm run check:meta` 检查，不维护独立 UI 发布或体积检查链。

### 19. ESLint 负责语法与规则，自定义脚本负责能力与 Token

两种关注点分开：

- `eslint.config.js`（flat config + typescript-eslint 类型感知）管语言层面：未使用变量、浮动 Promise、误用 async 回调、`==`、`prefer-const`，并用 `no-restricted-syntax` 把 `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`new Function`/`document.write` 变成错误；
- `check-safety.mjs` 管跨文件能力扫描（不能被单文件 AST 规则可靠表达的），`check-tokens.mjs` 管 CSS 设计约束。

ESLint 只对 tsconfig 覆盖的文件开类型感知；`scripts/*.mjs` 与配置文件用 `disableTypeChecked` + Node globals。

### 20. Prettier 管格式，规则关给 Prettier

格式化与规则分开：`npm run format` 用 Prettier 统一代码风格（单引号、100 列、尾逗号、LF），`eslint-config-prettier` 放在 flat config 最后，关掉所有与 Prettier 重叠的 ESLint 规则，两个工具不会为同一行吵架。

`format:check` 进入根目录 `npm run check`，所以风格不再靠 review 提醒。Markdown 不在范围内（`.prettierignore`）：中文正文和表格会被重排成不可读的换行。

### 21. Toast 的可视元素与播报分离

读屏软件对“插入 DOM 时已经带内容”的 live region 支持不一致，`role="status"` 不保证播报。Toast 因此把两件事拆开：

- 可视 Toast 只负责显示、悬停/聚焦暂停和手动关闭，不声明 live role；
- 控制器创建两个常驻的视觉隐藏播报区，普通通知写 polite，错误写 assertive；播报区先于通知存在，后续只更新文本。

`duration: 0` 表示常驻，不再复用“剩余时间为 0”的表达；悬停和焦点结束不会移除常驻通知。

### 22. Panel 用两档命名规格，而不是任意宽度

最初只有 360px 设置面板。操作面板出现后，如果允许调用方自由传宽度，每个脚本都会得到不同的画布，设计系统就失去“同一产品”的一致性。因此只保留两档：

- `settings`（默认）：360px / 70vh，单列，放参数；
- `operation`：560px / 80vh，放页面功能，允许内容用一个网格容器自行分两栏。

两档共用内边距、标题层级、控件、滚动提示和底栏，差异只有 `--ds-panel-width-*` 与 `--ds-panel-max-h-*`。`size` 落在同一个 `createPanel` 上，而不是新增一个组件：外壳结构、焦点、Escape、滚动提示和生命周期完全一致，复制一份只会有两套实现要同步。`--ds-panel-width` / `--ds-panel-max-h` 保留为设置档的兼容别名，旧脚本无需修改。

操作面板不会自动分栏：两栏是内容结构，不是外壳属性。分栏容器、列宽和断点属于脚本自身的布局；`Section` 仍然只负责分组。两个面板同角重叠的问题也交给入口处理：面板只知道自己的状态，入口才知道用户此刻想看到哪个界面，因此由入口在打开一个时关闭另一个。

## 已知限制

- 以 Chrome / Edge + Tampermonkey 为验证目标；Firefox 未纳入当前浏览器场景。
- 浏览器场景使用系统安装的当前 Chrome/Edge；111 是构建目标，不是每次测试实际运行的版本。最低版本兼容性改动需在本地用 111 复验。
- 宿主页面若用 `!important` 设置祖先的 `transform` / `filter`，仍可能影响 fixed 定位；Host 挂到 `document.documentElement` 已规避常见的 body transform。
- 宿主页面若强制 `opacity: 0 !important` 于 host 自身，内部无法完全恢复；当前已对 host 的关键属性做内联 important。
- 页面进入全屏时，宿主外的 UI 可能不可见；第一版未处理 fullscreen 迁移。
- 主题切换默认瞬时完成，不播放全局颜色过渡，避免整页 UI 闪动。
- Chrome 111 没有 popover API，浮层要盖过模态就只能出现在 top layer 的 Dialog 内部，所以 Toast 视口仍会在 Dialog 开关时迁移父节点；实际是否打断读屏播报取决于浏览器。
- 单元测试跑在 happy-dom 上，它不实现布局、top layer，也不实现“已中止的 signal 不再注册监听”；这类语义只由真实浏览器场景覆盖。
- 现有多 UI 滚动锁场景在同一执行环境中运行，不能证明 Tampermonkey / ScriptCat 不同脚本沙箱共享 `globalThis`；跨沙箱同时打开 Dialog 的滚动锁协调尚未验证。
- 滚动锁只处理 `documentElement`，并按滚动条宽度补 `padding-right`；滚动条落在 body（怪癖模式）的页面可能仍有轻微偏移。
