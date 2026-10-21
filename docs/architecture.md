# 项目结构

> 面向 Agent 的执行文档。维护者无需阅读，人类入口见 `README.md`。

## 目标

一个仓库维护多个用户脚本，共享同一套 UI 设计体系与同一套 GM / 设置读写实现，避免每个脚本各写
一份按钮、面板、Toast、配色和存储兜底。设计体系是独立仓库
[userscript-ui](https://github.com/Wildfire2282/userscript-ui)，通过 git submodule 引入，按源码
方式复用（Vite 直接把它的 TS/CSS 打进当前脚本，未用到的组件会被 tree-shake）。

## 开发方式

**模块化源码，构建成单文件。** 线上交付物是一个 `.user.js`，但它由 `scripts/<slug>/src/` 的模块
源码构建出来，不直接编辑产物、也不在单文件上叠功能。细则见 `AGENTS.md` 9.1 与
`docs/migration-guide.md`。

## 目录职责

| 路径 | 职责 |
| --- | --- |
| `packages/userscript-ui/` | UI 设计体系子模块，只读；升级靠 `git submodule update --remote` |
| `packages/shared/` | 跨脚本共用：GM 适配（`gm.ts`）、设置默认值合并与读写（`storage.ts`） |
| `scripts/<slug>/` | 一个脚本一个 npm workspace 包 |
| `scripts/<slug>/userscript.meta.ts` | 静态元数据（名称、匹配、权限），**不含 `@version`** |
| `scripts/<slug>/src/` | 模块化源码，入口 `src/main.ts` |
| `scripts/<slug>/tests/*.test.ts` | Vitest 单测（纯逻辑与 DOM 片段） |
| `scripts/<slug>/tests/browser-scenarios.mjs` | 真实浏览器验收场景，由 `tools/browser-check.mjs` 驱动 |
| `scripts/<slug>/tests/fixtures/` | 场景用的本地夹具页 |
| `scripts/<slug>/legacy/` | 线上原版快照，迁移期对照；线上验收后删除 |
| `tools/build.mjs` | 遍历包、注入版本与 banner、调用 Vite、输出单文件 |
| `tools/check-meta.mjs` | 产物元数据校验（首行、版本、权限、与 legacy 对照） |
| `tools/check-size.mjs` | 产物体积（raw / gzip / brotli）对照预算 |
| `tools/browser-check.mjs` | 无依赖 CDP 驱动：注入产物与 GM 打桩，跑场景脚本 |
| `tools/sync.py` | 反向同步：把 Greasy Fork 上的发布版本拉回 `legacy/` |
| `scripts.json` | 机器可读清单（来源是 Greasy Fork，发布后由 `npm run sync` 刷新） |

## 包约定

每个 `scripts/<slug>/package.json` 至少包含：

```json
{
  "name": "@my-userscript/<slug>",
  "version": "1.2.3",
  "private": true,
  "type": "module",
  "scripts": { "build": "node ../../tools/build.mjs <slug>" }
}
```

`version` 是唯一版本来源：元数据块里不写 `@version`，构建时注入，`check:meta` 核对产物与包版本
一致。包之间不互相依赖；共享代码只有三个来源：`@ui`（设计体系）、`@shared`（GM 与设置）和脚本
自己的 `src/`。

`legacy/*.user.js` 顶部的元数据块与 `userscript.meta.ts` 有意重复：前者保证线上快照逐字节一致，
后者是构建入口。`check:meta` 会逐条对比两者的 `@name` / `@match` / `@include` / `@grant`。

别名只有 `@ui` 与 `@shared`，必须在三处同时声明：

| 位置 | 用途 |
| --- | --- |
| `tsconfig.json` 的 `paths` | 类型检查、编辑器跳转 |
| `tools/build.mjs` 的 `resolve.alias` | 构建 |
| `vitest.config.ts` 的 `resolve.alias` | 单测 |

命名、注释、文档与验证规范见根目录 `AGENTS.md`；UI 硬约束见 `packages/userscript-ui/AGENTS.md`。

## 构建

```powershell
npm run build               # 全部（未迁移的包会跳过）
npm run build super-drag    # 单个
```

`tools/build.mjs` 的工作方式：

1. 扫描 `scripts/*/package.json`；
2. 没有 `src/main.ts`（或 `.js` / `index.ts` / `index.js`）的包直接跳过，未迁移脚本不会阻塞构建；
3. 读 `userscript.meta.ts`（兼容 `.js`），把 `package.json` 的版本注入成 `@version`；
4. 用 Vite lib 模式打成 IIFE，别名 `@ui` / `@shared` 指向各自源码入口；
5. 把元数据作为 Rollup banner 放在产物最顶部，输出 `scripts/<slug>/dist/<slug>.user.js`。

产物是单文件、无外部资源，可直接安装。`dist/` 在 `.gitignore` 中：正式产物以发布记录为准。
构建目标固定为 `chrome111`（与设计体系一致）。

## 验证流水线

```powershell
npm run check          # lint + format:check + typecheck + test + build + check:meta + check:size
npm run check:browser  # 真实 Chrome/Edge 场景（默认 super-drag）
```

| 检查 | 失败意味着 |
| --- | --- |
| `lint` | 违反硬规则（`innerHTML`、`==`、未清理监听器等）或类型感知问题 |
| `format:check` | 代码风格与 Prettier 配置不一致 |
| `typecheck` | 类型错误，或别名 / `types` 配置缺项 |
| `test` | 纯逻辑回归（Vitest，毫秒级） |
| `build` | 构建失败，或产物缺失 |
| `check:meta` | 版本漂移、权限与 legacy 不一致、GM 调用缺授权 |
| `check:size` | 超出体积预算（默认只警告，发布前用 `--strict`） |
| `check:browser` | 真实交互回归（拖拽、面板、存储、键盘） |

## 版本与发布

1. 只改 `scripts/<slug>/package.json` 的 `version`、写 `CHANGELOG.md` 一条人话；
2. `npm run check && npm run check:browser <slug>`；
3. 把 `dist/<slug>.user.js` 交给维护者，在 Greasy Fork 页面确认版本与权限提示后提交；
4. 发布后 `npm run sync` 刷新 `scripts.json` 与 README 表格；
5. 回退：取上一版产物，以**更高**版本号重新发布，不降版本号。

## 反向同步（sync.py）

`tools/sync.py` 负责把「已发布」的版本拉回仓库：

- 首次导入一个已有脚本；
- 检查线上是否有人直接改过（与 `legacy/` 比对）；
- 新脚本出现在用户页时自动建立包骨架。

它只写 `legacy/`、`package.json`（仅缺失时）、元数据块（`.ts` / `.js` 任一存在就跳过）、
`scripts.json` 和 README 表格，不会覆盖已迁移的 `src/`。

## 子模块

```powershell
git clone --recurse-submodules <repo>
git submodule update --init --recursive
git submodule update --remote packages/userscript-ui   # 升级设计体系
```

升级子模块后跑一次 `npm run check` 与受影响脚本的 `check:browser`，确认视觉与交互无回归。
子模块的提交指针也要一并提交。
