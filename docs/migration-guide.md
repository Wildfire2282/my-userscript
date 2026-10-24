# 迁移指南

> 读者：Agent。目标是把 `scripts/<slug>/legacy/` 的线上原版改写成 `src/` 模块化源码 + `@ui` 界面，并在真实浏览器里验证行为不变。

## 1. 当前范围

| 脚本 | 状态 | 建议顺序 |
| --- | --- | --- |
| `super-drag` | 已迁移，作为参考样本 | — |
| `capture-links` | 已迁移 | — |
| `selection-copy` | 已迁移 | — |
| `youtube-transcript-copy` | 已迁移 | — |

一次只迁移一个脚本，单独提交；`main` 始终保持可构建、可安装。迁移前先读目标包的 `README.md`、`legacy/` 元数据与 `package.json`，记录 `@name` / `@match` / `@include` / `@grant`、设置键和核心行为；迁移后逐项对照。

## 2. 前置

```powershell
npm install          # 沙箱里 HOME 不可写时：$env:npm_config_cache = "<仓库>\.npm-cache"
npm run check        # 必须先是全绿状态，才知道后面哪一步弄坏了东西
```

需要系统 Chrome 或 Edge 跑浏览器场景；找不到时用 `CHROME_PATH` 指定。

## 3. 目标结构

```text
scripts/<slug>/
├─ userscript.meta.ts      # 元数据块；不写 @version
├─ package.json            # 唯一版本来源；build 指向 ../../tools/build.mjs
├─ src/
│  ├─ main.ts              # 入口：装监听、注册菜单、懒建 UI
│  ├─ settings.ts          # 设置 schema、默认值、存储读写
│  ├─ <纯逻辑>.ts          # 例如 url.ts / rules.ts / search.ts
│  ├─ features/*.ts        # 事件与副作用层：DOM 命中、打开页面、状态机
│  └─ ui/*.ts              # 只做 @ui 组合，不含业务判断
├─ tests/
│  ├─ *.test.ts            # Vitest：纯逻辑 + DOM 片段
│  ├─ browser-scenarios.mjs# 真实浏览器场景：导出 fixture / helpers / scenarios
│  └─ fixtures/*.html      # 场景用的本地夹具页
└─ legacy/                 # 线上快照，对照用；线上验收后再删
```

`userscript.meta.ts` 只写 `@name` / `@namespace` / `@description` / `@run-at` / `@grant` / `@match` / `@include` / `@noframes` / `@downloadURL` / `@updateURL`。**不写 `@version`**：构建时注入，`check:meta` 再核对。字段值与语言标记按 [`metadata.md`](metadata.md)。

## 4. 拆分顺序

先判断，后交互，最后界面。能被单测覆盖的判断不要写进事件回调；回调只做「收集信息 → 交给纯函数 → 执行结果」。

| 模块 | 类型 | 覆盖方式 |
| --- | --- | --- |
| `features/drop-action.ts` 一类 | 纯函数：这次交互归谁、打开什么地址、前台还是后台 | Vitest，优先补 |
| `features/url.ts` 一类 | 纯函数：文本是不是网址、地址是否合法 | Vitest |
| `search.ts` 一类 | 纯函数：选项列表、拼地址、自定义地址校验 | Vitest |
| `settings.ts` | 纯逻辑 + 存储注入 | Vitest |
| `features/hit-test.ts` / `selection.ts` / `editable.ts` 一类 | DOM 查询 | happy-dom 单测 |
| `features/dnd.ts` / `openers.ts` 一类 | 监听器与副作用 | 真实浏览器场景 |
| `ui/*.ts` | `@ui` 组合 | 真实浏览器场景 |

迁移期间保留现有存储键与数据格式；只有数据结构确实变化时才写迁移，迁移失败要回退，不能静默覆盖可恢复数据。

## 5. UI 映射

| 原版实现 | 迁移到 | 注意 |
| --- | --- | --- |
| 自绘模态 + 遮罩的设置窗口 | `createPanel` | 设置表单用 Panel；`createDialog` 的 actions 点击即关闭并 resolve，表单校验会变成「关掉再弹」 |
| 必须当场决策 / 危险操作 | `createDialog` / `confirmDialog` | 只有这种场景才用 Dialog |
| 分组标题 + 分隔线 | `createSection` | 相邻 Section 自动分隔，不要套卡片 |
| label + 控件 + 说明 | `createField` | 原版提示文案并进 `description`，不要再造提示列表 |
| 手写开关 / 下拉 / 输入 | `createSwitch` / `createSelect` / `createInput` | 开关用 `inline: true` |
| 底部保存 / 取消 / 恢复默认 | `createButton` + `panel.setFooter([...])` | 主操作放最后 |
| 校验错误 | `field.setError(msg)` | 控件自身的 `aria-invalid` 由组件合并，不要手改 |
| 按条件显示字段 | `field.el.hidden = true` | 不要 `replaceChildren` 后重建控件 |
| 操作结果提示 | `createToast(ui)` | 每个 UI 只建一次；没有提示需求就不要加 |

挂载策略二选一，不要重复挂：

- **懒挂载**：第一次打开设置才 `mountUI()`，普通页面零 DOM、零样式；
- **启动即挂**：有悬浮入口（`createLauncher`）时必须这样，否则按钮不会出现。

`pagehide` 里不要销毁 UI（bfcache 回来会留下空壳）；要清理的只有定时器和 blob，交给显式函数处理。

## 6. 实施步骤

1. **冻结行为**：读 legacy，列出操作、预期结果、权限、匹配站点、设置键。
2. **搭骨架**：补 `package.json`、`userscript.meta.ts`，建立 `src/main.ts` 与 `tests/`。
3. **先写纯逻辑**：把判断、拼地址、校验抽成函数，补 Vitest；此时不碰 DOM。
4. **再做副作用**：事件监听、GM 调用、开标签页单独成层，便于在场景里替换与断言。
5. **最后接 UI**：只组合 `@ui` 组件；设置面板与入口的挂载策略按上一节确定。
6. **补浏览器场景**：本地夹具页 + GM 打桩，驱动构建产物跑核心交互；一条用户可见行为一个场景。
7. **跑检查**：`npm run check` 全绿（最后一步就是浏览器场景）。
8. **收尾**：提 `package.json` 版本，写 `CHANGELOG.md` 一条人话，更新脚本 `README.md`。
9. **提交**：一个脚本一个提交；线上验收通过后再删除 `legacy/`，并跑 `npm run sync` 刷新清单。

## 7. 构建与验证

```powershell
npm run build <slug>            # 产物：scripts/<slug>/dist/<slug>.user.js
npm test                        # 单元测试（纯逻辑 + DOM 片段）
npm run test:browser <slug>     # 真实 Chrome/Edge，跑 tests/browser-scenarios.mjs
npm run check                   # 全量：静态检查 + 单测 + 构建 + 元数据 + 浏览器场景
```

`check:meta` 会拦住：元数据块不在首行、`@version` 与 `package.json` 不一致、`@name` / `@match` / `@include` / `@grant` 与 `legacy/` 不同、代码用了某个 `GM_*` 却没有对应 `@grant`。

确需修改元数据（`@name` / `@match` / `@include` / `@grant`）时：

1. 先由维护者确认安装提示与匹配范围的变化；
2. 重新构建后本地跑 `node tools/check-meta.mjs --allow-meta-change` 验证；
3. 在最后一个提交的信息里写明理由，并带上 `[allow-meta]`；正常 push 即随本次运行发布；该标记同时放行 `check:meta` 与 `release.mjs` 的元数据比对。已经 push 过的用 `gh workflow run release.yml --ref main -f allow_meta_change=true` 补发。

浏览器场景的写法：

1. 夹具页放 `tests/fixtures/*.html`；需要真实布局（选区矩形、坐标）就必须用真页面，不能用 happy-dom；
2. 模块导出三样东西：`fixture`（夹具文件名）、`helpers`（可选的页面侧助手，挂到 `window` 上）与 `scenarios`；
3. 每个场景是 `{ name, run(ctx) }`，`run` 返回 `{ expected, actual }`；写「期望值 / 实际值」，不要把诊断信息拼进实际值，否则两边永远不相等；
4. 场景之间互不共享页面与设置：每个场景都重新加载夹具、重新注入 GM 打桩与产物，需要非默认设置时先写 `window.__gm.store.settings`；
5. 页面里的未捕获异常会让该场景判失败；控制台错误单独列出，用来排查但不单独判失败。

## 8. 常见陷阱

| 现象 | 原因 | 做法 |
| --- | --- | --- |
| `tsc` 通过，构建报找不到 `@shared` | 别名只写进了 `tsconfig.json` | `@ui` / `@shared` 在三处保持一致 |
| 构建通过，单测报找不到模块 | `vitest.config.ts` 少了别名 | 同上 |
| `tsc` 报 `baseUrl` 已废弃 | TS 6 起弃用 `baseUrl` | `paths` 直接写相对路径，不加 `baseUrl` |
| 找不到 `./x.css?inline` 的类型 | 没有引入 Vite 类型声明 | `tsconfig.json` 的 `types` 加 `"vite/client"` |
| lint 报 `unbound-method` | 把对象方法当回调传出去 | 接口里把 `get(): T` 改成函数属性 `get: () => T` |
| 合成拖拽事件在 Shadow DOM 里没反应 | 合成事件的 `composed` 默认 `false` | 构造 `DragEvent` / `MouseEvent` 时加 `composed: true` |
| 生成独立页面时不能拼 HTML | 禁止 HTML 字符串注入 | `createHTMLDocument()` 建 DOM，再序列化 |
| `check:meta` 把 `@grant` 判错 | 产物里 `GM_*` 会以属性名出现 | 只扫描元数据块之后的代码 |
| 浏览器检查启动失败 | 受限环境下捕获子进程输出会因命名管道被拒 | `spawn(browser, args, { stdio: 'ignore' })` |
| 浏览器调试端口冲突 | 固定端口会撞车 | `--remote-debugging-port=0` + 读 `DevToolsActivePort` |
| 场景点按钮不生效 | 只派发了 `click` | 页面侧 helper 用 `mousedown` + `mouseup` + `click` |
| 场景依赖上一条留下的设置 | 场景之间共享了页面状态 | 每个场景都是新页面；前置条件写在场景开头 |
| 同一条规则在单测与场景里各断言一次 | 测试边界没分清 | 纯判断进 Vitest，用户可见交互进场景，只留一层 |
| `prettier --check` 报 legacy 快照 | 格式化工具会重排线上原版 | `.prettierignore` 排除 `scripts/*/legacy/`、`scripts.json` |
| eslint 对未迁移脚本报类型错误 | 那些 `userscript.meta.js` 不在 tsconfig 里 | eslint `ignores` 排除 `scripts/*/userscript.meta.*` 与 `legacy/` |
| `npm install` 报 `EPERM` | 沙箱不让写用户目录下的 npm 缓存 | `npm_config_cache` 指向仓库内 `.npm-cache/` |

## 9. 完成定义

1. `npm run check` 全绿（含该脚本的浏览器场景）；
2. 该脚本的 `tests/browser-scenarios.mjs` 覆盖本次改动的行为，没有只测实现细节的用例；
3. `@name` / `@match` / `@include` / `@grant` 与 `legacy/` 一致，或已按第 7 节确认变更；
4. 包 `README.md` 与 `CHANGELOG.md` 已更新；
5. 单独提交，`main` 始终可构建；`legacy/` 在线上验收后再删。
