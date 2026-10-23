# 架构

> 读者：Agent。人类入口是 [`README.md`](../README.md)；文档地图见 [`docs/README.md`](README.md)。

## 1. 目标与边界

一个仓库维护 4 个用户脚本，共用一套 Shadow DOM UI（`@ui`）和一份 GM / 设置 / 剪贴板适配（`@shared`）。4 个脚本都已迁移，由 `scripts/<slug>/src/` 的 TypeScript 源码构建；`legacy/` 只保留线上原版作为元数据与行为对照。线上交付物都是单个 `.user.js`。

硬约束：

- 运行时零依赖，不加载 CDN、远程字体或远程脚本；
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
| `packages/userscript-ui/` | UI 设计体系，git submodule，只读；升级走独立提交 |
| `packages/shared/` | 跨脚本共用代码：GM 适配（`gm.ts`）、设置读写（`storage.ts`）与剪贴板写入（`clipboard.ts`） |
| `scripts/<slug>/` | 一个脚本一个 npm workspace 包 |
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
| `scripts.json` | 机器可读清单，由 `npm run sync` 刷新 |
| `.github/workflows/release.yml` | push `main` 后检查、构建并推送 `release` 分支 |

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
- `packages/shared` 只收纳在多个 legacy 脚本中重复出现、且已在新结构中使用的逻辑，目前是 `gm`、`storage` 与 `clipboard`。UI、站点规则、日志、i18n 一律不进。

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
npm run build               # 全部已迁移脚本
npm run build super-drag    # 单个
npm run build:min           # 压缩产物，仅用于排查体积
```

`tools/build.mjs` 的流程：

1. 扫描 `scripts/*/package.json`；
2. 没有 `src/main.ts`（或 `.js` / `index.ts` / `index.js`）的包直接跳过，这样新增脚本在迁移前不会阻塞构建；
3. 读 `userscript.meta.ts`（兼容 `.js`），把包版本注入成 `@version`；
4. 用 Vite lib 模式打成 IIFE，`@ui` / `@shared` 指向各自源码入口；
5. 把元数据作为 Rollup banner 放在产物最顶部，输出 `scripts/<slug>/dist/<slug>.user.js`。

产物是单文件、无外部资源，CSS 已内联为字符串。构建目标固定为 `chrome111`。

## 6. 验证

测试分两层，同一件事只在一层断言：

- **纯逻辑**（`npm test`）：能脱离页面判断的函数、设置归一化、地址拼接、DOM 小片段；
- **真实浏览器**（`npm run test:browser`）：用户能看见的交互，一条行为一个场景。

```powershell
npm test                # 单元测试（Vitest，毫秒级）
npm run test:browser    # 真实 Chrome/Edge 场景（需要先构建）
npm run check           # 交付前全量：静态检查 + 单测 + 构建 + 元数据 + 浏览器场景
```

`check` 的最后一步就是浏览器场景，所以本地一条命令与 CI 的 `npm run check` 都会覆盖真实交互，不存在「记得在本地点一遍」的手工环节。

| 检查 | 失败意味着 |
| --- | --- |
| `lint` | 违反硬规则（`innerHTML`、`==`、未清理监听器等）或类型感知问题 |
| `format:check` | 代码风格与 Prettier 配置不一致 |
| `typecheck` | 类型错误，或别名 / `types` 配置缺项 |
| `test` | 纯逻辑回归（Vitest，毫秒级） |
| `build` | 构建失败、产物缺失，或体积超出预算（raw ≤ 200 KB / gzip ≤ 60 KB，只提示不拦） |
| `check:meta` | 版本漂移、元数据不在首行、权限与 legacy 不一致、GM 调用缺授权 |
| `test:browser` | 真实交互回归（拖拽、面板、存储、键盘） |

`check:meta` 只扫描元数据块之后的代码来判断 `GM_*` 是否都有对应 `@grant`；迁移确实要改元数据时，加 `--allow-meta-change`，并在提交信息里写明理由。

已知未覆盖：`@match` / `@include` 的 pattern 语法（写错的表现是脚本装上了却不生效）。新增或修改匹配地址时由 Agent 核对站点地址与通配符写法，不依赖自动检查。

`test:browser` 用系统 Chrome/Edge 与 Node 内置 WebSocket 驱动 CDP，不下载 Playwright 浏览器：Windows、macOS、Linux（CI 的 ubuntu-latest 自带 Chrome）都能自动找到，`CHROME_PATH` 可覆盖。场景写在 `scripts/<slug>/tests/browser-scenarios.mjs`：

- `fixture` 指向 `tests/fixtures/` 下的页面；需要真实布局、坐标或选区时必须用真页面；
- `helpers` 是可选的页面侧助手，工具本身不认识任何脚本专属的 DOM；
- `scenarios` 每项为 `{ name, run(ctx) }`，`run(ctx)` 返回 `{ expected, actual }`；
- 每个场景都在新页面里跑：重新加载夹具、重新注入 GM 打桩与产物。场景自己写前置条件，不依赖执行顺序，也不需要「收尾复位」；
- 页面里的未捕获异常直接判该场景失败，控制台错误单独列出。

没有实际执行的检查不得写成「已通过」；无法验证时明确写「未验证」及原因。

## 7. 关键决策

| 决策 | 当前做法 | 理由 |
| --- | --- | --- |
| 构建 | 自研 `tools/build.mjs` + Vite IIFE，不引入 `vite-plugin-monkey` | 单文件、banner、CSS 内联已满足需求，插件带来的权限收集与配置成本没有收益 |
| 版本 | `package.json` 唯一来源，构建时注入 | 元数据与包版本两处手写必然漂移 |
| 元数据 lint | 只用 `tools/check-meta.mjs`，不引入 `eslint-plugin-userscripts` | 该插件只认 `.user.js` 里的元数据块，而本仓元数据在 `.ts`、产物不提交；`use-homepage-and-url` 要求非标准 `@homepage`，`align-attributes` 的自动修复会重排整块并插入 `@homepage`，与 `metadata.md` 的字段清单冲突；`@match` 语法它也不校验，唯一能补的是未使用 `@grant` 的拼写，价值低于多一个 devDependency |
| 共享内核 | 只收纳 `gm`、`storage` 与 `clipboard` | 重复事实来自多个 legacy 脚本；其余抽象尚无稳定复用 |
| UI 复用 | 子模块源码直引，按需 tree-shake | 不发布运行时包，不引入全局样式与远程资源 |
| 测试分层 | 纯逻辑走 Vitest，用户可见交互走真实浏览器；同一事实只在一层断言 | 两层都断言同一规则会让维护成本翻倍，失败时也看不出该改哪一层 |
| 浏览器验证 | 自建 CDP 驱动，不用 Playwright；每个场景独立重载页面 | 环境已有 Chrome/Edge，避免下载浏览器与额外依赖；场景互不污染，可单独删除或调试 |
| 发布 | 确认发布后 push `main`，CI 推送 `release` 分支，webhook 通知 Greasy Fork | 构建与上线自动完成；发布时机、登录与元数据变化仍由人确认 |
| 存储 | 旧键不改名，新键用 `<slug>:<area>.<key>` | 改名会丢用户设置 |
| 自绘 UI 的例外 | 没有对应组件的交互（复制提示标签、可拖动悬浮按钮）仍在 `@ui` 的 Shadow Root 内、用 `--ds-*` Token 自绘；链接列表的数据行用原生 checkbox | `@ui` 没有这些形态，套现成组件会改掉用户熟悉的手势，或让上千行列表的每次筛选都重建组件句柄；样式仍受 Token 约束 |
| 设置入口 | 选中复制只在脚本管理器菜单里提供设置，不建悬浮按钮；菜单只在顶层页面注册 | 这是高频旁路脚本，页面上多一个常驻按钮会打扰阅读；菜单入口零占位，关掉后仍能重新打开；只在顶层注册避免每个 iframe 各加一项 |
| 复制反馈 | 中性卡片底 + 彩色图标；成功停留 1.2s、失败 1.8s | 12px 文字在整块绿色 / 红色底上对比度不足；失败信息需要更长的阅读时间 |
| 剪贴板 | `@shared` 的 `createClipboard` 在每次写入时解析可用通道 | 页面或管理器可能替换写入能力，固定引用会让降级顺序与实际能力不一致 |
| 主题 | `light` / `dark` / `system` 显式传入 | 不跟随宿主页面，避免被站点主题带偏 |
| 目标平台 | 只认 Windows 11 上的 Chromium 系（Chrome / Edge 111+，桌面端鼠标操作）；触屏手势、macOS 按键、Safari / Firefox 私有 API 的 fallback 一律不写 | 用户群就是 Windows 11 桌面浏览器，每条兼容分支都要人读、要测、要修，不写就是最省 |

## 8. 发布与迁移

- 发布链路、元数据变更与回滚见 [`release-automation.md`](release-automation.md)。
- 元数据字段、语言标记与校验规则见 [`metadata.md`](metadata.md)。
- 四个脚本都已迁移，发布 `dist/` 产物；`legacy/` 只用于元数据对照，线上验收通过后删除。
- 迁移步骤与验收见 [`migration-guide.md`](migration-guide.md)，同样适用于以后新增的脚本。
- 校验、命名、注释、文档与安全规则以根目录 [`AGENTS.md`](../AGENTS.md) 为准；UI 硬约束以 [`packages/userscript-ui/AGENTS.md`](../packages/userscript-ui/AGENTS.md) 为准。
