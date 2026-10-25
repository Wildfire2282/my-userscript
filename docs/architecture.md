# 架构

> 读者：Agent。人类入口是 [`README.md`](../README.md)；文档地图见 [`docs/README.md`](README.md)。

## 1. 目标与边界

一个仓库维护 4 个用户脚本，共用一套 Shadow DOM UI（`@ui`）和一份 GM / 设置 / 剪贴板适配（`@shared`）。4 个脚本都已迁移，由 `scripts/<slug>/src/` 的 TypeScript 源码构建；`legacy/` 只保留线上原版作为元数据与行为对照。线上交付物都是单个 `.user.js`。

硬约束：

- 运行时零依赖，不加载 CDN、远程字体或远程脚本；
- 工程环境使用 Bun `>=1.4.4`（包管理、脚本调度、工具运行都走 Bun；
  `vitest` 在 Bun 下用 `forks` 池，因 `vmThreads` 池的 worker 在 Bun module runner 下解析失败）；
  CI 使用 Bun 1.4.4。
- 自有 UI 挂载在 `@ui` 创建的 Shadow Root 内，不向宿主注入全局 CSS；
- 构建与自动化以 Chromium 111+ 为基线；Firefox 只做手工冒烟，不纳入 E2E；
- 不采集、不上报用户数据，日志不含页面内容或个人信息；
- 不模拟 Greasy Fork 登录，不自动提交发布。
- 只针对 Windows 11 上的 Chromium 系浏览器（Chrome / Edge 111+，桌面端鼠标操作）优化：触屏手势、macOS 按键、
  Safari / Firefox 的私有 API fallback 一律不写，相关代码出现即删。

非目标：引入 React / Vue / Tailwind 等运行时框架，把脚本改成后台服务，或为尚未出现的重复提前造抽象。

## 2. 目录职责

| 路径 | 职责 |
| --- | --- |
| `packages/userscript-ui/` | UI 设计体系，仓库内普通包（原 `userscript-ui` 子模块已并入）；源码由 `@ui` 别名直引，不再单独发布或单独验收 |
| `packages/shared/` | 套件运行时（无界面）：`host/`（GM 适配、设置合并与读写、设置仓库、剪贴板）、`settings/`（设置定义）、`runtime/`（启动、菜单、frame、日志）、`dom/`（目标判定、遍历、视口夹紧）、`url/`（URL 解析）；门面只导出多脚本共用的符号，规则见 `packages/shared/AGENTS.md` |
| `scripts/<slug>/` | 一个脚本一个 Bun workspace 包 |
| `scripts/<slug>/userscript.meta.ts` | 静态元数据（名称、匹配、权限），不含 `@version` |
| `scripts/<slug>/src/` | 模块化源码，入口 `src/main.ts` |
| `scripts/<slug>/tests/*.test.ts` | Vitest 单测：纯逻辑与 DOM 片段 |
| `scripts/<slug>/tests/browser-scenarios.mjs` | 真实浏览器场景，由 `tools/browser-check.mjs` 驱动 |
| `scripts/<slug>/tests/fixtures/` | 场景用的本地夹具页 |
| `scripts/<slug>/legacy/` | 线上原版快照，只做元数据与行为对照；线上验收后删除 |
| `tools/build.mjs` | 遍历包、注入版本与 banner、调用 Vite，输出单文件并报告 raw / gzip 体积 |
| `tools/check-meta.mjs` | 产物元数据校验：首行、版本、权限、与 legacy 对照 |
| `tools/browser-check.mjs` | 无依赖 CDP 驱动：每个场景新开页面、注入 GM 打桩与产物 |
| `tools/release.mjs` | 汇总发布物、校验版本与元数据变化 |
| `tools/sync.py` | 从 Greasy Fork 把线上版本同步回 `legacy/`、元数据、`scripts.json` 与 README 表格 |
| `scripts.json` | 机器可读清单，由 `bun run sync` 刷新 |
| `.github/workflows/release.yml` | 脚本包与共享运行时代码变化后检查、构建并推送 `release` 分支；每个产物发生变化的脚本必须同步提版 |

## 3. 依赖关系

```text
scripts/<slug>
   ├── @ui       packages/userscript-ui    Shadow DOM 组件、Token、主题
   └── @shared   packages/shared           GM 适配、设置读写
```

- `scripts` 可以依赖 `@ui` 与 `@shared`；后两者互不依赖，也不包含站点业务。
- 别名只有 `@ui` 与 `@shared`，必须在三处同时声明，缺一处会导致「类型检查过、构建挂」或「构建过、测试挂」：

| 位置 | 用途 |
| --- | --- |
| `tsconfig.json` 的 `paths` | 类型检查、编辑器跳转 |
| `tools/build.mjs` 的 `resolve.alias` | 构建 |
| `vitest.config.ts` 的 `resolve.alias` | 单测 |

- 包之间不互相 import；共享代码只从上表两个来源进入。
- `packages/shared` 只收纳已被两个以上脚本验证的重复逻辑（准入规则见 `kit.md` 第 4 节）：
  `host`（`gm`、`storage`、`settings-store`、`clipboard`）已入；`settings` / `runtime` /
  `dom` / `url` 按迁移步骤进入；UI、站点规则一律不进（日志与中文文案随第 1 步进入）。

## 4. 单脚本形态

```text
scripts/<slug>/
├─ userscript.meta.ts      # 元数据块；不写 @version
├─ package.json            # 唯一版本来源；build 指向 ../../tools/build.mjs
├─ src/
│  ├─ main.ts              # 入口：装监听、注册菜单、懒建 UI
│  ├─ settings.ts          # 设置 schema、默认值、归一化、存储读写
│  ├─ features/*.ts        # 纯判断与副作用分层
│  └─ ui/*.ts              # 只做 @ui 组合
├─ tests/
│  ├─ *.test.ts
│  ├─ browser-scenarios.mjs
│  └─ fixtures/*.html
└─ legacy/                 # 线上快照；线上验收后删除
```

`package.json` 的 `version` 是唯一版本来源：`userscript.meta.ts` 不写 `@version`，构建时注入，`check:meta` 再核对产物与包版本一致。`dist/` 不入库，正式产物以发布记录为准。

## 5. 构建

```powershell
bun run build               # 全部已迁移脚本
bun run build super-drag    # 单个
```

`tools/build.mjs` 的流程：

1. 扫描 `scripts/*/package.json`；指定多个包时，任一名称不存在即失败，不构建已匹配的部分；
2. 没有 `src/main.ts`（或 `.js` / `index.ts` / `index.js`）的包直接跳过，这样新增脚本在迁移前不会阻塞构建；
3. 读 `userscript.meta.ts`（兼容 `.js`），把包版本注入成 `@version`；
4. 用 Vite lib 模式打成 IIFE，`@ui` / `@shared` 指向各自源码入口；
5. 把元数据作为 Rollup banner 放在产物最顶部，输出 `scripts/<slug>/dist/<slug>.user.js`。

产物是单文件、无外部资源，CSS 已内联为字符串。构建目标固定为 `chrome111`。

## 6. 验证

测试分两层，同一件事只在一层断言：

- **纯逻辑**（`bun run test`）：能脱离页面判断的函数、设置归一化、地址拼接、DOM 小片段；
- **真实浏览器**（`bun run test:browser`）：用户能看见的交互，一条行为一个场景。

```powershell
bun run test               # 单元测试（Vitest，毫秒级）
bun run test:browser    # 真实 Chrome/Edge 场景（需要先构建）
bun run verify           # 交付前全量：静态检查 + 单测 + 构建 + 元数据 + 浏览器场景
```

`check` 的最后一步就是浏览器场景，所以本地一条命令与 CI 的 `bun run verify` 都会覆盖真实交互，不存在「记得在本地点一遍」的手工环节。

`check.yml` 对 PR 全量执行；main 上工具、根配置、共享包、脚本 `tests/` 与任一 workflow 的修改也会触发检查，单改场景或发布流程不会漏检。工程回归在 `tools/pipeline.test.mjs` 中使用临时仓库与模拟下载，不访问 Greasy Fork、不启动发布。

| 检查 | 失败意味着 |
| --- | --- |
| `lint` | 违反硬规则（`innerHTML`、`outerHTML`、`document.write`、`new Function`、`==`）或类型感知问题 |
| `format:check` | 代码风格与 Prettier 配置不一致 |
| `typecheck` | 类型错误，或别名 / `types` 配置缺项 |
| `test` | 纯逻辑回归（Vitest，毫秒级） |
| `build` | 构建失败、产物缺失，或体积超出预算（raw ≤ 200 KB / gzip ≤ 60 KB，只提示不拦） |
| `check:meta` | 版本漂移、元数据不在首行、权限与 legacy 不一致、GM 调用缺授权 |
| `test:browser` | 真实交互回归（拖拽、面板、存储、键盘） |

`check:meta` 只扫描元数据块之后的代码来判断 `GM_*` 是否都有对应 `@grant`；迁移确实要改元数据时，加 `--allow-meta-change`，并在提交信息里写明理由。

已知未覆盖：

- `@match` / `@include` 的 pattern 语法（写错的表现是脚本装上了却不生效）。新增或修改匹配地址时由 Agent 核对站点地址与通配符写法，不依赖自动检查。
- `@grant` 扫描 `dist/` 里的 `GM_*`、`GM.*` 和对应静态字符串属性；两种 API 必须分别授权，动态拼接属性与 `unsafeWindow` 不在检测范围。已迁移脚本缺少产物直接失败。
- `check:ui-safety` 只扫 `packages/userscript-ui/src`；脚本源码里刻意使用 `fetch`（转写网络钩子）不参与该检查，`scripts/*/src` 与 `packages/shared` 的危险能力靠 lint 规则与人工核对。

`test:browser` 用系统 Chrome/Edge 与运行时内置 WebSocket 驱动 CDP，不下载 Playwright 浏览器：Windows、macOS、Linux（CI 的 ubuntu-latest 自带 Chrome）都能自动找到，`CHROME_PATH` 可覆盖。场景写在 `scripts/<slug>/tests/browser-scenarios.mjs`：

- `fixture` 指向 `tests/fixtures/` 下的页面；需要真实布局、坐标或选区时必须用真页面；
- `helpers` 是可选的页面侧助手，工具本身不认识任何脚本专属的 DOM；
- `scenarios` 每项为 `{ name, run(ctx) }`，`run(ctx)` 返回 `{ expected, actual }`；
- 每个场景都在新页面里跑：重新加载夹具、重新注入 GM 打桩与产物。场景自己写前置条件，不依赖执行顺序，也不需要「收尾复位」；
- 页面里的未捕获异常直接判该场景失败，控制台错误单独列出。

全量浏览器检查要求每个已有源码入口的脚本提供场景，不能删除场景文件后静默跳过。脚本产物须不早于自身源码、版本、元数据以及 `packages/shared/src/`、`packages/userscript-ui/src/`；共享代码修改后必须重新构建，不能用旧产物得到假通过。

UI 组件浏览器场景统一放在 `packages/userscript-ui/tests/browser-scenarios.mjs`，同一驱动执行；测试入口只在内存中构建，不分发展示页或独立 UI 库产物。可用 `bun run test:browser -- userscript-ui` 单独验证。

Windows 提权终端启动测试浏览器时禁用降权重启，避免 Chrome 脱离父进程导致调试端口等待超时；只影响自动检查，不改变用户浏览器配置。

没有实际执行的检查不得写成「已通过」；无法验证时明确写「未验证」及原因。

浏览器场景覆盖带 `<base>` 的链接复制、取消拖拽后的外来文件放行、复制失败后选区/焦点恢复、旧字幕轨与 SPA 新视频隔离、新版 actions 转写提取、UI 销毁及滚动补偿。场景使用 GM 打桩，不等同于 Tampermonkey / ScriptCat 扩展实装；真实 YouTube 会话、跨脚本沙箱滚动锁、Chrome 111 最低版本与系统文件真实拖入仍需实装验收。仅 DOM 可读而没有完整网络响应时，长视频文稿仍可能不完整；未证实当前站点滚动加载契约前，不增加自动滚动采集与固定等待。

兼容契约依据：[Tampermonkey 授权](https://www.tampermonkey.net/documentation.php?q=grant)、[Tampermonkey 剪贴板](https://www.tampermonkey.net/documentation.php?q=GM_setClipboard)、[ScriptCat API](https://docs.scriptcat.org/docs/dev/api/)。ScriptCat 的同步 `GM_setValue` 返回不代表磁盘完成，但当前脚本不在写入后立即关闭页面；不为此引入第二套异步授权。YouTube 兜底请求及 actions 结构参照 [InnerTube 示例](https://github.com/tombulled/innertube/blob/main/examples/get-video-transcript.py)，这是非公开接口，仍可能随网站调整。

## 7. 关键决策

| 决策 | 当前做法 | 理由 |
| --- | --- | --- |
| 构建 | 自研 `tools/build.mjs` + Vite IIFE，不引入 `vite-plugin-monkey` | 单文件、banner、CSS 内联已满足需求，插件带来的权限收集与配置成本没有收益 |
| 类型检查 | `bun check`（Bun 内置，多核并行），`typescript` 包仅留给 `tools/gm-usages.mjs` 的 AST 扫描 | `bun check` 全项目约 60ms 且与 tsc 同错；`verify` 改名正是为了不挡 `bun check/lint/fmt` 内置命令；`typescript-eslint` 锁 TS 6（不支持 TS 7，见 `typescript-eslint#10940`） |
| 版本 | `package.json` 唯一来源，构建时注入 | 元数据与包版本两处手写必然漂移 |
| 元数据 lint | 只用 `tools/check-meta.mjs`，不引入 `eslint-plugin-userscripts` | 该插件只认 `.user.js` 里的元数据块，而本仓元数据在 `.ts`、产物不提交；`use-homepage-and-url` 要求非标准 `@homepage`，`align-attributes` 的自动修复会重排整块并插入 `@homepage`，与 `metadata.md` 的字段清单冲突；`@match` 语法它也不校验，唯一能补的是未使用 `@grant` 的拼写，价值低于多一个 devDependency |
| 共享内核 | `host`（GM 适配、存储、剪贴板、设置仓库）+ `settings.defineSettings` + `runtime`（启动、安装锁、日志）+ `dom`（可编辑判定、焦点穿透、夹紧）+ `@ui/patterns`（界面宿主、设置表单）；`url` 因只有一处用留脚本内 | 2026-10-25 七步迁移完成（见 `kit.md` 第 5 节）；准入仍是“两处复用才收”，其余抽象尚无稳定复用 |
| UI 复用 | 源码直引，按需 tree-shake | 不发布运行时包，不引入全局样式与远程资源 |
| 测试分层 | 纯逻辑走 Vitest（Bun 调度；Bun 下 `forks` 池，因 `vmThreads` worker 在 Bun module runner 下解析失败），用户可见交互走真实浏览器；同一事实只在一层断言 | 两层都断言同一规则会让维护成本翻倍，失败时也看不出该改哪一层；原生 `bun test` 已验证不可行（`toHaveBeenCalledExactlyOnceWith`、fake timer 语义、FormData 行为三处与 vitest 不一致，改单测是降级断言） |
| 浏览器验证 | 自建 CDP 驱动，不用 Playwright；每个场景独立重载页面 | 环境已有 Chrome/Edge，避免下载浏览器与额外依赖；场景互不污染，可单独删除或调试 |
| UI 验证与分发 | 删除独立展示页、库产物与第二套浏览器驱动，有效 UI 场景并入主检查 | UI 只供本仓脚本源码直引；测试不应要求维护展示应用 |
| 共享修复发布 | 共享运行时代码变化也触发发布检查，同批为每个实际产物改变的脚本提升 patch 版本 | 避免修复滞留仓库；复用同版本异内容拒绝机制，不自动改写版本 |
| 检查告警边界 | 控制台错误仅列出，体积预算超限仅警告 | 页面噪声和体积增长不等同功能失败；未捕获异常、行为断言与缺授权仍阻断 |
| 发布 | 确认发布后 push `main`，CI 推送 `release` 分支，webhook 通知 Greasy Fork | 构建与上线自动完成；发布时机、登录与元数据变化仍由人确认 |
| 存储 | 旧键不改名，新键用 `<slug>:<area>.<key>` | 改名会丢用户设置 |
| 设置读取 | 三个脚本共用一个设置仓库，每次读取都看存储，不长期缓存在内存 | 多标签页与同页 iframe 共用存储，长期缓存会让别处的改动不生效，只有刷新才好 |
| 页面变化观察 | YouTube 只保留导航事件 + 1.5 秒地址轮询，不观察整页 DOM；滚动提示、提示条等需要布局测量的回调合并到每帧一次 | 全页 MutationObserver 在页面每次 DOM 改动上都会回调，而最热的页面恰恰一直改 DOM；地址变化已有事件与轮询兜底。布局测量每帧一次就够，重复触发只会强制同步布局 |
| 自绘 UI 的例外 | 没有对应组件的交互（复制提示标签、可拖动悬浮按钮）仍在 `@ui` 的 Shadow Root 内、用 `--ds-*` Token 自绘；可拖动按钮的外观复用 `createButton`，脚本只补定位与拖动；链接列表的数据行用原生 checkbox | `@ui` 没有这些形态，套现成组件会改掉用户熟悉的手势，或让上千行列表的每次筛选都重建组件句柄；样式仍受 Token 约束 |
| 菜单入口 | 每个脚本的脚本管理器菜单只保留「操作面板」与「功能设置」两项：动作进操作面板，偏好与记忆进功能设置；没有动作的脚本（拖拽打开、选中复制）只注册「功能设置」。菜单只在顶层页面注册 | 菜单项一多就难找，名字不统一时更要靠试；两项固定分类让所有脚本的入口位置一致，其余入口放进面板后还能写说明、给反馈 |
| 设置入口 | 选中复制只在脚本管理器菜单里提供设置，不建悬浮按钮；菜单只在顶层页面注册 | 这是高频旁路脚本，页面上多一个常驻按钮会打扰阅读；菜单入口零占位，关掉后仍能重新打开；只在顶层注册避免每个 iframe 各加一项 |
| 复制反馈 | 中性卡片底 + 彩色图标；成功停留 1.2s、失败 1.8s | 12px 文字在整块绿色 / 红色底上对比度不足；失败信息需要更长的阅读时间 |
| 剪贴板 | `@shared` 的 `createClipboard` 在每次写入时解析可用通道 | 页面或管理器可能替换写入能力，固定引用会让降级顺序与实际能力不一致 |
| 设置合并 | 数组与对象独立复制，特殊键使用数据属性保留，不触发原型 setter | 防止修改读取结果污染存储对象；兼容旧键而不让异常数据改变对象原型 |
| 管理器兼容 | 使用两者共有的同步 `GM_*` 授权，不依赖剪贴板回调；textarea 降级恢复焦点、选区和方向 | ScriptCat 尚不支持 `GM_setClipboard` 回调；不因兼容分支增加权限，失败降级不应清空用户选区 |
| 主题 | `light` / `dark` / `system` 显式传入 | 不跟随宿主页面，避免被站点主题带偏 |
| 目标平台 | 只认 Windows 11 上的 Chromium 系（Chrome / Edge 111+，桌面端鼠标操作）；触屏手势、macOS 按键、Safari / Firefox 私有 API 的 fallback 一律不写 | 用户群就是 Windows 11 桌面浏览器，每条兼容分支都要人读、要测、要修，不写就是最省 |

## 8. 发布与迁移

- 发布链路、元数据变更与回滚见 [`release-automation.md`](release-automation.md)。
- 元数据字段、语言标记与校验规则见 [`metadata.md`](metadata.md)。
- 四个脚本都已迁移，发布 `dist/` 产物；`legacy/` 只用于元数据对照，线上验收通过后删除。
- 迁移步骤与验收见 [`migration-guide.md`](migration-guide.md)，同样适用于以后新增的脚本。
- 校验、命名、注释、文档与安全规则以根目录 [`AGENTS.md`](../AGENTS.md) 为准；UI 硬约束以 [`packages/userscript-ui/AGENTS.md`](../packages/userscript-ui/AGENTS.md) 为准。
