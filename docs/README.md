# 文档索引

本仓库的设计与操作文档只描述**当前有效的设计、流程与状态**。历史方案、评审意见和一次性实施记录不再单独归档，需要时查 git 历史。

## 文档地图

| 文档 | 读者 | 内容 |
| --- | --- | --- |
| [`README.md`](../README.md) | 维护者 | 脚本清单、安装、提需求、反馈方式 |
| [`AGENTS.md`](../AGENTS.md) | Agent | 执行规范、权限边界、验证与汇报要求 |
| [`architecture.md`](architecture.md) | Agent | 仓库结构、依赖、构建、验证、关键决策 |
| [`metadata.md`](metadata.md) | Agent | 脚本元数据字段、语言、顺序与发布规则 |
| [`migration-guide.md`](migration-guide.md) | Agent | 把 `legacy/` 原版迁入 `src/` 的步骤与验收清单 |
| [`release-automation.md`](release-automation.md) | Agent | 自动发布链路、元数据变更、回滚与排障 |
| `scripts/<slug>/README.md` | Agent | 单个脚本的用途、权限、匹配、设置键与迁移状态 |
| `scripts/<slug>/CHANGELOG.md` | 维护者 | 用户能感知的版本变化 |
| [`packages/userscript-ui/README.md`](../packages/userscript-ui/README.md) | Agent | UI 设计体系；子模块自带文档，本仓库不重复维护 |

## 阅读顺序

- **维护者**：只读根目录 `README.md`，以及各脚本的 `CHANGELOG.md`。
- **Agent 接手任务**：`AGENTS.md` → `architecture.md` → 按任务读元数据、迁移或发布文档 → 目标脚本的 `README.md`。
- **改 UI**：先读 `packages/userscript-ui/AGENTS.md`，再按需读该子模块的设计、组件与集成文档。

## 当前状态

| 脚本 | 版本 | 状态 |
| --- | --- | --- |
| 拖拽打开（`super-drag`） | 2.6.0 | 已迁移：由 `src/` 构建，界面使用 `@ui` |
| 捕获链接（`capture-links`） | 1.1.1 | 已迁移：由 `src/` 构建，界面使用 `@ui` |
| 选中复制（`selection-copy`） | 1.3.1 | 已迁移：由 `src/` 构建，界面使用 `@ui` |
| YouTube 转写文稿复制（`youtube-transcript-copy`） | 1.2.1 | 已迁移：由 `src/` 构建，界面使用 `@ui` |

状态变化时同步更新本表与目标脚本的 `README.md`。四个脚本都已迁移，`legacy/` 只做对照，不再作为发布来源。

## 写作规则

1. **只写当前事实**：不写方案演进、工期估算、评审过程；这些内容留在提交信息或 git 历史里。
2. **一个事实只写一处**：架构讲「是什么」，迁移与发布文档讲「怎么做」，脚本 `README.md` 讲「这个脚本有什么」。
3. **可直接执行**：Agent 文档必须给出命令、路径与判定标准，不出现「酌情处理」。
4. **不写易漂移的数字**：测试条数、产物体积用命令查看，不抄进文档。
5. **与实现同步**：文档与实现不一致时，以能跑通的实现为准，并在同一个提交里修正文档。
6. **语言**：中文、陈述句、一段一个意思；日期用 `YYYY-MM-DD`，命令块标注语言，链接用相对路径。

## 变更时更新哪里

| 变更 | 需要同步的文档 |
| --- | --- |
| 新增、迁移或下线脚本 | 本页状态表、根 `README.md` 脚本表（`npm run sync` 生成）、脚本 `README.md` |
| 改目录、构建、检查命令 | `architecture.md`、`AGENTS.md` 中对应的命令 |
| 改脚本元数据、作者链接或语言标记 | `metadata.md`、目标脚本的元数据块 |
| 改迁移步骤或验收方式 | `migration-guide.md` |
| 改发布流程、权限或回滚方式 | `release-automation.md`、`AGENTS.md` 第 10 节 |
| 升级 UI 子模块 | 子模块自己的文档；本仓库只在 `architecture.md` 记录指针与验证要求 |
