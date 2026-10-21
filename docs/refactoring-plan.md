# 工程重构方案

| 项目 | 内容 |
| --- | --- |
| 文档编号 | RFC-0001 |
| 状态 | 待评审 |
| 版本 | v0.1 |
| 日期 | 2026-10-21 |
| 影响范围 | 仓库结构、构建链路、5 个用户脚本、发布流程 |
| 评审对象 | 仓库维护者 |

## 1. 摘要

本方案把现有的「脚本归档 + 共享 UI 骨架」推进为可长期维护的工程体系，核心是三件事：**统一 UI**、**统一工程规范**、**统一发布链路**。目标不是增加功能，而是在不改变现有行为的前提下，降低 5 个脚本的重复实现与维护成本。

四项关键决策：

- **D1 构建**：拟以 `vite-plugin-monkey` 替换自研 `tools/build.mjs`（见 Q1），换取 HMR、`@grant` 自动推断与元数据生成；以一次 0.5 人日 spike 作为准入条件。
- **D2 版本**：以 `package.json` 为版本唯一来源，经构建注入 `@version`；用 Changesets 生成 CHANGELOG 与版本提交。
- **D3 共享内核**：新增 `packages/shared`，沉淀 GM API 适配、设置存储与迁移、DOM/SPA 工具、日志；UI 仍由 `packages/userscript-ui` 提供，二者不互相依赖。
- **D4 发布**：构建产物 + SHA-256 存为 Release 资产，经 Greasy Fork 预填表单人工确认发布；回滚即重传上一版资产。

总工期估算 **18–20 人日**，分 5 个阶段，任一阶段结束都可停在稳定点。

## 2. 背景与现状

### 2.1 已完成的基础

仓库已从「平铺归档」重组为 monorepo：npm workspaces 管理 5 个脚本包，`packages/userscript-ui` 以 git submodule 固定到具体提交，`tools/build.mjs` 提供 Vite IIFE 构建骨架，`tools/sync.py` 负责从 Greasy Fork 反向同步。当前 5 个脚本仍为线上原版，保存在各包 `legacy/` 下，尚未迁入 `src/`。

### 2.2 量化现状

统计口径：`legacy/*.user.js` 去掉元数据块后的正文。

| 指标 | 数值 | 说明 |
| --- | --- | --- |
| 脚本数 | 5 | — |
| 代码量 | 3546 行 / 126 KB | 纯 JavaScript，无类型 |
| Shadow Root | 0 | 全部直接操作宿主页面 DOM |
| 全局样式注入 | 3 个脚本 | 通过 `GM_addStyle` 或 `<style>` 写入宿主页面 |
| `!important` | 398 处 | 其中 super-drag 215、input-autofill 183 |
| 硬编码颜色 | 34 种 | 无 Token 体系 |
| `z-index` 声明 | 7 处 | 与宿主页面层级博弈 |
| `innerHTML` | 13 处 | 存在注入与 XSS 风险 |
| GM API 风格 | 混用 | 同步 `GM_*` 与异步 `GM.*` 并存，单脚本内也混用 |
| 自动化测试 | 0 | — |
| 类型检查 / Lint | 0 | — |

### 2.3 问题归因

| 编号 | 问题 | 证据 | 影响 |
| --- | --- | --- | --- |
| P1 | UI 各写一套，视觉不一致 | 5 套自建浮层/面板/提示，34 种颜色，0 个 Shadow Root | 用户感知割裂；改一次风格要改 5 处 |
| P2 | 宿主样式污染与反污染 | 398 处 `!important`，3 个脚本向宿主注入全局样式 | 与网站样式互相打架，故障难复现 |
| P3 | 重复实现共享能力 | 4 份设置读写、2 种 GM API 风格混用、多份工具函数 | 修 bug 要改多处，行为逐渐分叉 |
| P4 | 无质量门禁 | 无 lint/类型/测试/CI | 回归只能靠人工点击，重构风险高 |
| P5 | 元数据与版本分散 | `userscript.meta.js`、`package.json`、Greasy Fork 三处 | 版本漂移，发布易出错 |
| P6 | 发布与回滚靠手工 | 无产物校验、无 CHANGELOG、无归档 | 无法快速定位与回退 |
| P7 | 安全基线缺失 | 13 处 `innerHTML` | 用户内容进入 DOM 时有注入风险 |

## 3. 目标与非目标

### 3.1 目标

| 编号 | 目标 | 判定方式 |
| --- | --- | --- |
| G1 | UI 全部由 `@ui` 组件构成，视觉与交互统一 | 5/5 脚本使用 Shadow DOM；自写面板/Tooltip 样式为 0 |
| G2 | 共享能力单一实现 | GM 适配、存储、DOM 工具只存在于 `packages/shared` |
| G3 | 质量门禁自动执行 | PR 上 lint、类型、单测、构建、体积检查全绿才可合并 |
| G4 | 发布可追溯、可回滚 | 每次发布产出 CHANGELOG + 校验和 + 归档产物；回滚 ≤ 10 分钟 |
| G5 | 开发体验可用 | 本地 HMR 调试单个脚本；全量构建 ≤ 15 秒 |

### 3.2 非目标

- 不新增用户可见功能，不改脚本的匹配站点与授予权限（除非迁移后不再需要）。
- 不引入 React/Vue/Tailwind 等运行时框架，不引入远程资源。
- 不把脚本改成后台服务或独立 Web 应用。
- 不改动 Greasy Fork 账号与脚本 ID。

### 3.3 约束

- 产物必须是单文件 `.user.js`，元数据块位于首行。
- 所有 UI 挂在 `mountUI()` 创建的 Shadow Root 内，不修改宿主全局 CSS。
- Greasy Fork 只提供只读 JSON API，没有上传 API；更新必须经预填表单人工确认。
- 运行时零依赖，CSS 以字符串形式内联。

## 4. 参照方案与取舍

| 领域 | 参照 | 采纳点 | 不采纳 / 保留 |
| --- | --- | --- | --- |
| 构建 | `vite-plugin-monkey` | 元数据注入、`@grant` 自动收集、HMR 调试、`@require`/`@resource` 能力 | 不使用其脚手架模板；保留现有包结构 |
| 版本管理 | npm workspaces + Changesets | 语义化版本、CHANGELOG、发布提交自动化 | 暂不引入 Nx/Turborepo：5 个包规模下缓存收益低于维护成本 |
| 设计系统 | `packages/userscript-ui` 既有实践 | Shadow DOM 隔离、`--ds-*` Token、ESLint 硬规则、Vitest + Playwright 验证 | 暂不发布 npm 包，继续源码复用 |
| 测试 | Vitest + happy-dom / Playwright-core | 与设计体系同一套工具链，复用其 E2E 夹具与对比度检查思路 | 暂不做云端视觉回归（截图基线入库成本高于收益） |
| 发布 | Greasy Fork 官方能力 | 只读 JSON API 做版本核对；`prefill` 预填更新；GitHub release webhook 触发重新检测 | 不写模拟登录的自动化上传：稳定性与账号风险不可接受 |
| 规范 | Conventional Commits + Keep a Changelog + SemVer | 提交类型驱动 CHANGELOG 与版本号 | 不引入 commitlint 强校验，改为 CI 校验 PR 标题 |

选择 `vite-plugin-monkey` 的理由：HMR 是该项目的最大缺口——当前改一次 UI 需要重新构建并手动重装脚本；`@grant` 自动推断可消除手工维护权限列表的漂移；其元数据注入与现有 `userscript.meta.js` 可平滑衔接。

## 5. 目标架构

### 5.1 分层

```text
scripts/<slug>        业务与交互，依赖 shared 与 ui
        │
        ├──▶ packages/shared    GM 适配、存储、DOM/SPA、日志（无 UI、无业务）
        └──▶ packages/userscript-ui   设计体系（Shadow DOM 组件、Token）

依赖方向单向：scripts → shared；scripts → ui。shared 与 ui 之间不互相依赖。
```

### 5.2 包职责

| 包 | 名称 | 职责 | 禁止 |
| --- | --- | --- | --- |
| `packages/userscript-ui` | 子模块，只读 | 组件、Token、主题、生命周期 | 业务逻辑、GM API |
| `packages/shared` | `@my-userscript/shared` | `gm`（同步/异步统一）、`storage`（命名空间 + schema 版本 + 迁移）、`dom`（选择器、等待、MutationObserver、SPA 监听）、`log`、`i18n` | 任何 UI 元素、任何具体站点逻辑 |
| `scripts/<slug>` | `@my-userscript/<slug>` | 站点适配、业务规则、UI 组合 | 跨脚本 import、直接复制共享工具 |

### 5.3 单脚本目录

```text
scripts/<slug>/
├─ userscript.meta.ts     # 静态元数据：名称、描述、@match、@grant（版本不在此处）
├─ package.json           # version 为版本唯一来源
├─ src/
│  ├─ main.ts             # 启动：读设置 → mountUI → 组合 UI → 注册清理
│  ├─ settings.ts         # 设置 schema、默认值、迁移
│  ├─ ui/                 # 面板/浮层组装（只调用 @ui 组件）
│  └─ features/           # 站点业务，纯函数优先，便于单测
├─ tests/                 # 单元与集成测试
└─ legacy/                # 迁移期对照，迁完删除
```

### 5.4 构建管线

```text
userscript.meta.ts + package.json
        │  校验元数据完整、@match 非空
        ▼
Vite（vite-plugin-monkey）── 按需 tree-shake @ui 与 shared
        ▼
dist/<slug>.user.js（单文件，元数据在首行）
        ▼
体积检查（raw / gzip）+ SHA-256 + 归档到 Release
```

- 构建目标 `chrome111`，与设计体系保持一致。
- 默认不压缩，便于 Greasy Fork 代码审阅；`--minify` 保留给特殊场景。
- 产物不入库；需要追溯时取 Release 资产。

### 5.5 版本与元数据

单一来源：`package.json` 的 `version` → 构建时注入 `@version`。`userscript.meta.ts` 只声明名称、描述、匹配、权限等静态字段。CI 校验三件事：构建产物 banner 的版本等于包版本（防止手改或缓存产物）、`@match` 非空、`@grant` 与代码实际调用的 GM API 一致（由插件推断，校验兜底）。

### 5.6 运行时约定

- **生命周期**：每个脚本一个 `ui` 实例；`pagehide` 或脚本卸载时 `ui.destroy()`；SPA 路由变化不重建 UI。
- **主题**：挂载前从存储读取，显式传 `light | dark | system`，不跟随宿主页面。
- **存储**：键统一 `<slug>:` 前缀，schema 带 `version` 字段，升级时执行迁移函数；失败回退默认值并记录日志。
- **GM 适配**：`shared/gm` 同时兼容 `GM.*` 与 `GM_*`，按可用性降级；异步 API 统一返回 Promise。
- **日志**：统一前缀与级别，生产环境只输出 warn/error。

## 6. 工程规范

### 6.1 代码规范

- TypeScript `strict`，禁止 `any`（确需时集中声明并注释原因）。
- ESLint flat config + typescript-eslint 类型感知规则，沿用设计体系的硬规则：禁止 `innerHTML`、`outerHTML`、`insertAdjacentHTML`、`document.write`、`eval`、`new Function`、`==`。
- Prettier 统一格式（单引号、100 列、尾逗号、LF）。
- 命名：包目录 kebab-case；导出函数 camelCase；存储键 `<slug>:<area>.<key>`。

### 6.2 测试策略

| 层级 | 工具 | 范围 | 门槛 |
| --- | --- | --- | --- |
| 单元 | Vitest + happy-dom | `shared` 全部模块、脚本纯函数 | `shared` 行覆盖 ≥ 90%，脚本核心逻辑 ≥ 80% |
| 集成 | Vitest + happy-dom | UI 组装、设置读写、生命周期 | 每个脚本 ≥ 1 条主流程 |
| 端到端 | Playwright + 系统 Chrome | 5 个脚本各 1 条主路径 + 深色主题 | 每次发布前必跑 |
| 体积 | 自研脚本 | 单包 raw / gzip | 超预算即失败 |

E2E 使用本地 fixture 页面 + 路由拦截模拟站点响应，不依赖真实网络与账号。

### 6.3 提交与分支

- Trunk-based：`main` 受保护，短期分支 `feat/<slug>/<topic>`、`fix/<slug>/<topic>`。
- Conventional Commits：`feat|fix|refactor|docs|test|chore|build(scope): subject`，scope 为脚本 slug 或包名。
- PR 必须通过 `npm run check`；单人维护时以 CI 结果代替人工 review，但重构类 PR 需自行核对「行为对照表」。

### 6.4 CI 流水线

| 阶段 | 内容 | 时限 |
| --- | --- | --- |
| 静态检查 | lint、format check、tsc、元数据校验 | ≤ 2 min |
| 单元/集成 | Vitest，含覆盖率门槛 | ≤ 2 min |
| 构建 | 全量构建 + 体积预算 | ≤ 2 min |
| E2E | Playwright，仅 PR 与 main | ≤ 8 min |
| 发布 | tag 触发，构建 + 校验和 + Release | ≤ 3 min |

### 6.5 发布流程

1. `npx changeset` 记录变更，合并后由机器人提出版本 PR；
2. 合并版本 PR，打 tag `<slug>@<version>`；
3. CI 构建、校验体积、生成 SHA-256，上传 Release 资产与 CHANGELOG；
4. 用 Greasy Fork 预填链接提交更新（`/scripts/<ID>/versions/prefill`，POST `script_version[code]`），人工确认后发布；
5. 记录发布说明，保留上一版资产用于回滚。

## 7. 实施路线

| 阶段 | 范围 | 主要产出 | 退出标准 | 人日 |
| --- | --- | --- | --- | --- |
| P0 基线 | 工具链与特征测试 | ESLint/Prettier/tsc/Vitest 配置、CI、legacy 行为快照、体积基线 | `npm run check` 全绿；5 个脚本有行为基线 | 2 |
| P1 共享内核 | `packages/shared` 与构建替换 | gm/storage/dom/log/i18n + 单测；构建 spike | `shared` 覆盖率 ≥ 90%；spike 通过则替换构建 | 5 |
| P2 UI 迁移 | 5 个脚本逐个迁移 | 每脚本 `src/`、E2E、UI 一致性验收 | 5/5 使用 `@ui`；自写 CSS 中 `!important` 归零；`innerHTML` 归零 | 8 |
| P3 发布工程 | Changesets、Release、预填脚本 | 版本 PR、发布 workflow、回滚手册 | 完成一次端到端发布与一次回滚演练 | 2 |
| P4 收尾 | 清理与文档 | 删除全部 `legacy/`、更新 README 与架构文档、复盘 | 仓库无遗留原版；文档与实现一致 | 1 |

迁移顺序按「UI 复杂度升序」：capture-links → selection-copy → input-autofill → youtube-transcript-copy → super-drag。前两个用于验证组件组合，后三个用于验证复杂交互与性能。

P0 的关键动作是**先固化行为再重构**：把每个脚本的纯逻辑（URL 归一化、规则匹配、文本清洗）提取为可测函数并写快照测试，作为后续重写的对照基线。没有这层的重构不予合入。

## 8. 验收标准

| 维度 | 指标 | 目标 |
| --- | --- | --- |
| UI 一致性 | 使用 `@ui` 组件的脚本占比 | 100% |
| 样式隔离 | Shadow Root 覆盖 / 全局样式注入 | 5/5；0 处 |
| 安全 | `innerHTML` 等危险 API | 0 处 |
| 类型 | `tsc --noEmit` | 0 error，无隐式 any |
| 测试 | shared 覆盖率 / 脚本核心覆盖率 | ≥ 90% / ≥ 80% |
| 体积 | 单脚本 raw / gzip | ≤ 80 KB / ≤ 25 KB |
| 构建 | 全量构建耗时 | ≤ 15 s |
| CI | 静态 + 单测 + 构建 | ≤ 6 min |
| 发布 | 产物到可发布状态 | 一条命令 + 一次确认 |
| 回滚 | 恢复到上一版 | ≤ 10 min |

## 9. 风险与对策

| 编号 | 风险 | 概率 | 影响 | 对策 |
| --- | --- | --- | --- | --- |
| R1 | 重写引入行为回归 | 高 | 高 | 先写特征测试；逐脚本灰度；保留上一版可回滚 |
| R2 | `@ui` 组件缺口导致重新自写样式 | 中 | 中 | 缺口先在上游补组件；临时方案仅允许 Token 组合，并登记待办 |
| R3 | 子模块漂移或升级后构建失败 | 中 | 中 | 锁定 commit；CI 校验子模块可构建；升级走独立 PR |
| R4 | 发布依赖人工确认，节奏不可控 | 中 | 中 | 预填脚本 + 发布清单；Greasy Fork webhook 触发版本检测 |
| R5 | 范围膨胀（顺手加功能） | 高 | 中 | 非目标清单；新增需求另开 RFC |
| R6 | 工期超支 | 中 | 中 | 每阶段可独立交付；P2 可按脚本拆分发布 |
| R7 | 浏览器差异（Firefox/Safari） | 低 | 中 | Chromium 111+ 为基线；其余仅手工冒烟 |

## 10. 灰度与回滚

- **灰度**：先发布 capture-links，观察一周安装量与反馈，无异常再推进其余脚本。
- **回滚**：Greasy Fork 保留历史版本；Release 中保留上一版产物与校验和，10 分钟内可重传。回滚后同步把 `package.json` 版本回退并记录 `revert:` 提交。
- **熔断条件**：目标站点上核心功能出现可复现的失效、UI 元素被宿主样式覆盖、Greasy Fork 反馈集中报错，任一命中即回滚并暂停后续迁移。脚本无遥测，判断依据为可复现的现场与用户反馈。

## 11. 待评审决策

| 编号 | 议题 | 建议 | 备选 |
| --- | --- | --- | --- |
| Q1 | 是否以 `vite-plugin-monkey` 替换自研构建 | 采纳，spike 未通过则保留 `build.mjs` | 继续维护自研构建 |
| Q2 | 共享内核是否包含「设置面板生成器」 | 不包含，面板结构属 UI，留在各脚本 | 提供声明式设置页 DSL |
| Q3 | `shared` 是否对外发布 npm 包 | 不发布，保持 private | 发布后供其他仓库复用 |
| Q4 | 是否把 Firefox 纳入自动 E2E | 暂不纳入，仅手工冒烟 | 增加 Firefox job |
| Q5 | 迁移顺序是否按复杂度升序 | 是 | 按用户量/收益排序 |

## 12. 评审结论

| 项目 | 结论 |
| --- | --- |
| 总体方案 | ☐ 批准 ☐ 有条件批准 ☐ 驳回 |
| D1 构建替换 | ☐ 同意 ☐ 保留自研 |
| D2 版本与 CHANGELOG | ☐ 同意 ☐ 调整 |
| D3 共享内核边界 | ☐ 同意 ☐ 调整 |
| D4 发布流程 | ☐ 同意 ☐ 调整 |
| 补充意见 | |

## 附录 A：参考实现与文档

- `vite-plugin-monkey`：https://github.com/lisonge/vite-plugin-monkey
- Greasy Fork 帮助（只读 JSON API、预填更新、webhook）：https://greasyfork.org/en/help/api
- Changesets：https://github.com/changesets/changesets
- Conventional Commits：https://www.conventionalcommits.org/
- Keep a Changelog：https://keepachangelog.com/
- 本仓库设计体系约束：`packages/userscript-ui/AGENTS.md`

## 附录 B：体积预算依据

| 组成 | 参考值 |
| --- | --- |
| `@ui` 最小组合（Panel/Field/Switch/Button） | 约 26 KB raw |
| `shared`（gm + storage + dom + log） | 约 6–8 KB raw |
| 单脚本业务逻辑 | 约 10–25 KB raw |
| 合计上限 | 80 KB raw / 25 KB gzip |

预算按当前 5 个脚本的实际体量上浮约 30% 设定，超限需在 PR 中说明并更新本表。
