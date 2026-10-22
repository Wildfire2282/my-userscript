# 架构

> 读者：Agent。人类入口是 [`README.md`](../README.md)；文档地图见 [`docs/README.md`](README.md)。

## 1. 目标与边界

一个仓库维护 4 个用户脚本，共用一套 Shadow DOM UI（`@ui`）和一份 GM / 设置适配（`@shared`）。已迁移脚本由 `scripts/<slug>/src/` 的 TypeScript 源码构建；未迁移脚本直接发布 `legacy/` 原版。两者的线上交付物都是单个 `.user.js`。

硬约束：

- 运行时零依赖，不加载 CDN、远程字体或远程脚本；
- 自有 UI 挂载在 `@ui` 创建的 Shadow Root 内，不向宿主注入全局 CSS；
- 构建与自动化以 Chromium 111+ 为基线；Firefox 只做手工冒烟，不纳入 E2E；
- 不采集、不上报用户数据，日志不含页面内容或个人信息；
- 不模拟 Greasy Fork 登录，不自动提交发布。

非目标：引入 React / Vue / Tailwind 等运行时框架，把脚本改成后台服务，或为尚未出现的重复提前造抽象。

## 2. 目录职责

| 路径 | 职责 |
| --- | --- |
| `packages/userscript-ui/` | UI 设计体系，git submodule，只读；升级走独立提交 |
| `packages/shared/` | 跨脚本共用代码：GM 适配（`gm.ts`）与设置读写（`storage.ts`） |
| `scripts/<slug>/` | 一个脚本一个 npm workspace 包 |
| `scripts/<slug>/userscript.meta.ts` | 静态元数据（名称、匹配、权限），不含 `@version` |
| `scripts/<slug>/src/` | 模块化源码，入口 `src/main.ts` |
| `scripts/<slug>/tests/*.test.ts` | Vitest 单测：纯逻辑与 DOM 片段 |
| `scripts/<slug>/tests/browser-scenarios.mjs` | 真实浏览器场景，由 `tools/browser-check.mjs` 驱动 |
| `scripts/<slug>/tests/fixtures/` | 场景用的本地夹具页 |
| `scripts/<slug>/legacy/` | 线上原版快照；未迁移脚本的发布来源，已迁移脚本的对照物 |
| `tools/build.mjs` | 遍历包、注入版本与 banner、调用 Vite，输出单文件 |
| `tools/check-meta.mjs` | 产物元数据校验：首行、版本、权限、与 legacy 对照 |
| `tools/check-size.mjs` | 产物 raw / gzip / brotli 体积与预算 |
| `tools/browser-check.mjs` | 无依赖 CDP 驱动：注入产物与 GM 打桩，执行场景脚本 |
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
- `packages/shared` 只收纳在多个 legacy 脚本中重复出现、且已在新结构中使用的逻辑，目前是 `gm` 与 `storage`。UI、站点规则、日志、i18n 一律不进。

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
2. 没有 `src/main.ts`（或 `.js` / `index.ts` / `index.js`）的包直接跳过，未迁移脚本不会阻塞构建；
3. 读 `userscript.meta.ts`（兼容 `.js`），把包版本注入成 `@version`；
4. 用 Vite lib 模式打成 IIFE，`@ui` / `@shared` 指向各自源码入口；
5. 把元数据作为 Rollup banner 放在产物最顶部，输出 `scripts/<slug>/dist/<slug>.user.js`。

产物是单文件、无外部资源，CSS 已内联为字符串。构建目标固定为 `chrome111`。

## 6. 验证

```powershell
npm run check          # lint + format:check + typecheck + test + build + check:meta + check:size
npm run check:browser  # 真实 Chrome/Edge 场景，默认 super-drag
```

| 检查 | 失败意味着 |
| --- | --- |
| `lint` | 违反硬规则（`innerHTML`、`==`、未清理监听器等）或类型感知问题 |
| `format:check` | 代码风格与 Prettier 配置不一致 |
| `typecheck` | 类型错误，或别名 / `types` 配置缺项 |
| `test` | 纯逻辑回归（Vitest，毫秒级） |
| `build` | 构建失败或产物缺失 |
| `check:meta` | 版本漂移、元数据不在首行、权限与 legacy 不一致、GM 调用缺授权 |
| `check:size` | 超出体积预算（默认只警告；需要严格把关时手动加 `--strict`） |
| `check:browser` | 真实交互回归（拖拽、面板、存储、键盘） |

体积预算：单脚本 ≤ 200 KB raw / 60 KB gzip，超限默认只警告；需要严格把关时手动加 `--strict`。

`check:meta` 只扫描元数据块之后的代码来判断 `GM_*` 是否都有对应 `@grant`；迁移确实要改元数据时，加 `--allow-meta-change`，并在提交信息里写明理由。

`check:browser` 用系统 Chrome/Edge 与 Node 内置 WebSocket 驱动 CDP，不下载 Playwright 浏览器；场景脚本导出 `run(ctx)`，返回 `{ scenario, expected, actual, pass }[]`。CI 不跑这一项，改交互的版本必须在本地跑过。

没有实际执行的检查不得写成「已通过」；无法验证时明确写「未验证」及原因。

## 7. 关键决策

| 决策 | 当前做法 | 理由 |
| --- | --- | --- |
| 构建 | 自研 `tools/build.mjs` + Vite IIFE，不引入 `vite-plugin-monkey` | 单文件、banner、CSS 内联已满足需求，插件带来的权限收集与配置成本没有收益 |
| 版本 | `package.json` 唯一来源，构建时注入 | 元数据与包版本两处手写必然漂移 |
| 共享内核 | 只收纳 `gm` 与 `storage` | 重复事实来自多个 legacy 脚本；其余抽象尚无稳定复用 |
| UI 复用 | 子模块源码直引，按需 tree-shake | 不发布运行时包，不引入全局样式与远程资源 |
| 浏览器验证 | 自建 CDP 驱动，不用 Playwright | 环境已有 Chrome/Edge，避免下载浏览器与额外依赖 |
| 发布 | 确认发布后 push `main`，CI 推送 `release` 分支，webhook 通知 Greasy Fork | 构建与上线自动完成；发布时机、登录与元数据变化仍由人确认 |
| 存储 | 旧键不改名，新键用 `<slug>:<area>.<key>` | 改名会丢用户设置 |
| 主题 | `light` / `dark` / `system` 显式传入 | 不跟随宿主页面，避免被站点主题带偏 |

## 8. 发布与迁移

- 发布链路、元数据变更与回滚见 [`release-automation.md`](release-automation.md)。
- 元数据字段、语言标记与校验规则见 [`metadata.md`](metadata.md)。
- 未迁移脚本直接发布 `legacy/` 原版；迁移后 `dist/` 产物优先。迁移步骤与验收见 [`migration-guide.md`](migration-guide.md)。
- 校验、命名、注释、文档与安全规则以根目录 [`AGENTS.md`](../AGENTS.md) 为准；UI 硬约束以 [`packages/userscript-ui/AGENTS.md`](../packages/userscript-ui/AGENTS.md) 为准。
