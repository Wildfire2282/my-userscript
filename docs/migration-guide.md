# 脚本迁移指南

> 面向 Agent 的执行文档。维护者无需阅读，人类入口见 `README.md`。

把 `legacy/` 里的原版脚本改写成模块化源码 + `@ui` 界面，并让它在真实浏览器里被验证过。
`super-drag`（2026-10-21）是第一个完成的样本，下面的步骤与坑都来自那次迁移的实际操作。

## 0. 先决条件

```powershell
npm install          # 沙箱里 HOME 不可写时：$env:npm_config_cache = "<仓库>\.npm-cache"
npm run check        # 必须先是全绿状态，才知道后面哪一步弄坏了东西
```

`npm run check` = `lint + format:check + typecheck + test + build + check:meta + check:size`。

## 1. 目录形态

```text
scripts/<slug>/
├─ userscript.meta.ts      # 元数据块；不写 @version（构建时注入）
├─ package.json            # 唯一版本来源；build 脚本指向 ../../tools/build.mjs
├─ src/
│  ├─ main.ts              # 入口：装监听、注册菜单、懒建 UI
│  ├─ settings.ts          # 设置 schema、默认值、存储读写
│  ├─ search.ts            # 业务纯函数（按脚本改名，例如 url.ts / rules.ts）
│  ├─ features/*.ts        # 事件与副作用层：DOM 命中、打开页面、状态机
│  └─ ui/*.ts              # 只做 `@ui` 组合，不含业务判断
├─ tests/
│  ├─ *.test.ts            # Vitest：纯逻辑 + DOM 片段
│  ├─ browser-scenarios.mjs# 真实浏览器场景，导出 run(ctx)
│  └─ fixtures/*.html      # 场景用的本地夹具页
└─ legacy/                 # 线上快照，对照用；线上验收后再删
```

`userscript.meta.ts` 只写 `@name` / `@namespace` / `@description` / `@run-at` / `@grant` /
`@match` / `@noframes` / `@downloadURL` / `@updateURL`。**不要写 `@version`**：`tools/build.mjs`
会把 `package.json` 的 `version` 插在 `@namespace` 后面，`check:meta` 再核对产物里的版本。

## 2. 拆分顺序：先判断，后交互，最后界面

这个顺序决定了单测能覆盖多少行为。`super-drag` 的实际拆法：

| 模块 | 类型 | 覆盖方式 |
| --- | --- | --- |
| `features/drop-action.ts` | 纯函数：这次拖拽归谁、打开什么地址、前台还是后台 | 14 条单测 |
| `features/url.ts` | 纯函数：文本是不是网址 | 5 条单测 |
| `search.ts` | 纯函数：引擎列表、拼地址、自定义地址校验 | 10 条单测 |
| `settings.ts` | 纯逻辑 + 存储注入 | 8 条单测 |
| `features/hit-test.ts` / `selection.ts` / `editable.ts` | DOM 查询 | happy-dom 单测 |
| `features/dnd.ts` / `openers.ts` | 监听器与副作用 | 真实浏览器场景 |
| `ui/settings-panel.ts` | `@ui` 组合 | 真实浏览器场景 |

规则：**能被单测覆盖的判断绝不写进事件回调**。事件回调只做“收集信息 → 交给纯函数 → 执行结果”。

## 3. UI 映射

| 原版实现 | 迁移到 | 注意 |
| --- | --- | --- |
| 自绘模态 + 遮罩的设置窗口 | `createPanel`（右下角） | 设置表单用 Panel；`createDialog` 的 actions 点击即关闭并 resolve，表单校验会变成“关掉再弹” |
| 必须当场决策 / 危险操作 | `createDialog` / `confirmDialog` | 只有这种场景才用 Dialog |
| 分组标题 + 分隔线 | `createSection` | 相邻 Section 自动分隔，不要套卡片 |
| label + 控件 + 说明 | `createField` | 原版的提示文案并进 `description`，不要再造提示列表 |
| 手写开关 / 下拉 / 输入 | `createSwitch` / `createSelect` / `createInput` | 开关用 `inline: true` |
| 底部保存 / 取消 / 恢复默认 | `createButton` + `panel.setFooter([...])` | 页脚是 flex-end，三个按钮都靠右，主操作放最后 |
| 校验错误 | `field.setError(msg)` | 控件自身的 `aria-invalid` 由组件合并，不要手改 |
| 按条件显示某个字段 | `field.el.hidden = true` | 不要 `replaceChildren` 后重建控件 |
| 独立的效果预览块 / 图标提示 | 并入 Field description 或 Panel description | 不为了还原布局新造组件 |
| 操作结果提示 | `createToast(ui)` | 每个 UI 只建一次；没有提示需求就不要加 |

挂载策略二选一，不要重复挂：

- **懒挂载**（`super-drag` 的做法）：第一次打开设置才 `mountUI()`，普通页面零 DOM、零样式；
- **启动即挂**：有悬浮入口（`createLauncher`）时必须这样，否则按钮不会出现。

`pagehide` 里不要销毁 UI（bfcache 回来会留下空壳）；要清理的只有定时器和 blob，交给
`openers.release()` 之类的显式函数。

## 4. 构建与验证

```powershell
npm run build <slug>            # 产物：scripts/<slug>/dist/<slug>.user.js
npm run check                   # 全量静态检查 + 单测 + 构建 + 元数据 + 体积
npm run check:browser <slug>    # 真实 Chrome/Edge，跑 tests/browser-scenarios.mjs
```

`check:meta` 会拦住这些情况：元数据块不在首行、`@version` 与 `package.json` 不一致、
`@match` / `@grant` 与 `legacy/` 原版不同、代码用到某个 `GM_*` 却没有对应 `@grant`。
确实要改元数据时加 `--allow-meta-change` 并在提交信息里说明理由。

`check:browser` 的写法：

1. 夹具页放 `tests/fixtures/*.html`，需要真实布局（选区矩形、坐标）就必须是真页面，不能用 happy-dom；
2. 在页面里注入 GM 打桩（`GM_getValue` / `GM_setValue` / `GM_registerMenuCommand` / `GM_openInTab`），
   记录打开的地址与菜单回调，而不是真的开标签页；
3. `browser-scenarios.mjs` 导出 `run(ctx)`，返回 `{ scenario, expected, actual, pass }[]`；
4. 断言写“期望值 / 实际值”，**不要把诊断信息拼进实际值**，否则两边永远不相等。

## 5. 收尾

- `package.json` 提版本（见第 6 节），`CHANGELOG.md` 加一条人话；
- 包 `README.md` 更新状态、权限、设置键；
- `dist/` 不入库；`legacy/` 等线上验收通过后再删；
- 发布由维护者在 Greasy Fork 页面确认，Agent 不代劳。

## 6. 常见坑（2026-10-21 `super-drag` 迁移实录）

| 现象 | 原因 | 做法 |
| --- | --- | --- |
| `tsc` 通过，构建报找不到 `@shared` | 别名只写进了 `tsconfig.json` | `@ui` / `@shared` 必须在 `tsconfig.json`、`tools/build.mjs`、`vitest.config.ts` 三处一致 |
| 构建通过，单测报找不到模块 | `vitest.config.ts` 少了别名 | 同上，测试也要解析同一套别名 |
| `tsc` 报 `baseUrl` 已废弃 | TS 6 起弃用 `baseUrl` | `paths` 直接写相对路径（`./packages/...`），不要 `baseUrl` |
| 找不到 `./x.css?inline` 的类型 | 没有引入 Vite 的类型声明 | `tsconfig.json` 的 `types` 加 `"vite/client"` |
| lint 报 `unbound-method` | 把对象上的方法当回调传出去 | 接口里把 `get(): T` 改成函数属性 `get: () => T` |
| 合成拖拽事件在 Shadow DOM 里完全没反应 | 合成事件的 `composed` 默认 `false`，事件到不了 window | 构造 `DragEvent` / `MouseEvent` 时加 `composed: true` |
| 拖拽很久之后点开关没反应 | 原版用布尔标记吞掉“拖拽后的下一次点击”，会误伤后续点击 | 改成 400ms 时间窗 + 遇到 `mousedown` 立即失效（这是本次真实修掉的缺陷） |
| 生成独立页面（图片查看器）不能拼 HTML | 禁止 HTML 字符串注入 | `createHTMLDocument()` 建 DOM，再 `XMLSerializer` 序列化 |
| `check:meta` 把 `@grant` 判成未使用 / 用了未授权 | 产物里 `GM_*` 会以属性名出现 | 只扫描元数据块**之后**的代码再和 `@grant` 比对 |
| 浏览器检查启动就失败 | 受限环境下捕获子进程输出会因命名管道被拒 | `spawn(browser, args, { stdio: 'ignore' })` |
| 浏览器调试端口被占用 / 随机失败 | 固定端口会撞车 | `--remote-debugging-port=0` + 读 `DevToolsActivePort` |
| 场景里点按钮不生效 | 只派发 `click`，真实交互是先 `mousedown` 再 `mouseup` | 页面侧 helper 用 `mousedown` + `mouseup` + `click` |
| `prettier --check` 报 legacy 快照 | 格式化工具会重排线上原版 | `.prettierignore` 排除 `scripts/*/legacy/`、`scripts.json` |
| eslint 对未迁移脚本报类型错误 | 那些 `userscript.meta.js` 不在 tsconfig 里 | eslint `ignores` 里排除 `scripts/*/userscript.meta.*` 与 `legacy/` |
| `npm install` 报 `EPERM` | 沙箱不让写用户目录下的 npm 缓存 | `npm_config_cache` 指向仓库内 `.npm-cache/`（已 gitignore） |
| `npm run sync` 后多出一个 `userscript.meta.js` | 旧脚本按 `.js` 判断“是否已存在” | 已修：`.ts` / `.js` 任一存在就跳过 |

## 7. 单脚本完成定义

1. `npm run check` 全绿；
2. `npm run check:browser <slug>` 场景全过；
3. `@name` / `@match` / `@grant` 与 `legacy/` 一致（或已确认变更）；
4. 包 `README.md` 与 `CHANGELOG.md` 已更新；
5. 单独提交，`main` 一直可构建。
