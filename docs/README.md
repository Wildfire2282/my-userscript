# 文档索引

本仓库的设计与操作文档只描述**当前有效的设计、流程与状态**。历史方案、评审意见和一次性实施记录不再单独归档，需要时查 git 历史。

## 文档地图

| 文档 | 读者 | 内容 |
| --- | --- | --- |
| [`README.md`](../README.md) | 维护者 | 脚本清单、安装、提需求、反馈方式 |
| [`AGENTS.md`](../AGENTS.md) | Agent | 执行规范、权限边界、验证与汇报要求 |
| [`architecture.md`](architecture.md) | Agent | 仓库结构、依赖、构建、验证、关键决策 |
| [`kit.md`](kit.md) | Agent | 开发套件的分层、模块契约、工程护栏、迁移步骤与技术依据 |
| [`metadata.md`](metadata.md) | Agent | 脚本元数据字段、语言、顺序与发布规则 |
| [`migration-guide.md`](migration-guide.md) | Agent | 把 `legacy/` 原版迁入 `src/` 的步骤与验收清单 |
| [`release-automation.md`](release-automation.md) | Agent | 自动发布链路、元数据变更、回滚与排障 |
| `scripts/<slug>/README.md` | Agent | 单个脚本的用途、权限、匹配、设置键与迁移状态 |
| `scripts/<slug>/CHANGELOG.md` | 维护者 | 用户能感知的版本变化 |
| [`packages/userscript-ui/README.md`](../packages/userscript-ui/README.md) | Agent | UI 设计体系；文档随包放在本仓库内 |

## 阅读顺序

- **维护者**：只读根目录 `README.md`，以及各脚本的 `CHANGELOG.md`。
- **Agent 接手任务**：`AGENTS.md` → `architecture.md` → 按任务读元数据、迁移或发布文档 → 目标脚本的 `README.md`。
- **改套件或新增通用模块**：`AGENTS.md` → `kit.md`（分层、模块准入、迁移步骤）→ `packages/userscript-ui/AGENTS.md`。
- **改 UI**：先读 `packages/userscript-ui/AGENTS.md`，再按需读该包的设计、组件与集成文档。

## 当前状态

| 脚本 | 准备版本（待发布） | 状态 |
| --- | --- | --- |
| 拖拽打开（`super-drag`） | 2.9.11 | 已迁移：由 `src/` 构建，界面使用 `@ui` |
| 捕获链接（`capture-links`） | 1.3.8 | 已迁移：由 `src/` 构建，界面使用 `@ui` |
| 选中复制（`selection-copy`） | 1.4.10 | 已迁移：由 `src/` 构建，界面使用 `@ui` |
| YouTube 转写文稿复制（`youtube-transcript-copy`） | 1.4.11 | 已迁移：由 `src/` 构建，界面使用 `@ui` |

状态变化时同步更新本表与目标脚本的 `README.md`。四个脚本都已迁移，`legacy/` 只做对照，不再作为发布来源。

## 项目级技能

`.omp/skills/` 下是按 omp 原生规范安装、并按本仓库规则适配过的技能（只在项目内生效）：

| 技能 | 调用 | 用途 |
| --- | --- | --- |
| `improve-codebase-architecture` | `/skill:improve-codebase-architecture` | 扫描架构摩擦，生成可视化报告后再讨论方案 |
| `retro` | `/skill:retro` | 会话复盘，把能自动拦住的问题变成检查 |
| `diagnosing-bugs` | 自动（说「诊断 / 调试」时） | 先建能变红的复现回路，再定位原因 |
| `writing-for-agents` | 自动（写 `AGENTS.md`、`docs/` 或技能时） | 面向 Agent 的文档写法 |
| `codebase-design` | 自动（设计模块接口时） | 深模块、接缝与测试面的共同词汇 |
| `grilling` | 自动（要盘问方案 / 决策时） | 按设计树逐支问透 |
| `domain-modeling` | 自动（梳理术语或决策记录时） | 维护领域词表与 ADR 格式 |

技能内容与上游 [`mattpocock/skills`](https://github.com/mattpocock/skills) 仓库一致，不做本地修改；与 `AGENTS.md` 冲突时以 `AGENTS.md` 为准。
后三个是 `improve-codebase-architecture` 原文调用的上游技能，为保证它完整可用而一并安装。

## 写作规则

写作规则见 [`AGENTS.md` 第 8 节](../AGENTS.md#8-文档规范)。

## 变更时更新哪里

| 变更 | 需要同步的文档 |
| --- | --- |
| 新增、迁移或下线脚本 | 本页状态表、[`README.md`](../README.md)、脚本 `README.md` |
| 改目录、构建、检查命令 | [`architecture.md`](architecture.md) |
| 增删套件模块、改分层或模块准入规则 | [`kit.md`](kit.md) |
| 改脚本元数据、作者链接或语言标记 | [`metadata.md`](metadata.md) |
| 改迁移步骤或验收方式 | [`migration-guide.md`](migration-guide.md) |
| 改发布流程、权限或回滚方式 | [`release-automation.md`](release-automation.md) |
| 改 UI 组件或 Token | [`packages/userscript-ui/AGENTS.md`](../packages/userscript-ui/AGENTS.md) |
| 增删项目级技能 | 本页「项目级技能」表 |
