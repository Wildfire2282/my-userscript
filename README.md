# my-userscript

Wildfire2282 的用户脚本 monorepo。多个脚本共享同一套 Shadow DOM UI 设计体系
[userscript-ui](https://github.com/Wildfire2282/userscript-ui)，以 git submodule 的形式挂在
`packages/userscript-ui`，源码级复用、按需 tree-shaking。

当前处于迁移初期：5 个脚本仍是 Greasy Fork 上的原版实现，原样保存在各包的 `legacy/` 下；
后续按 [迁移指南](docs/migration-guide.md) 逐个改写到 `@ui` 组件上，视觉与交互随之统一。

## 脚本列表

<!-- scripts:start -->
| 脚本 | 版本 | 状态 | 简介 | 安装 |
| --- | --- | --- | --- | --- |
| [YouTube 转写文稿复制](scripts/youtube-transcript-copy/README.md) | 1.1.2 | 原版 | 视频播放页面出现可拖拽悬浮按钮，可一键复制转写文稿（transcript），支持英语等多语言界面 | [安装](https://update.greasyfork.org/scripts/579560/YouTube%20%E8%BD%AC%E5%86%99%E6%96%87%E7%A8%BF%E5%A4%8D%E5%88%B6.user.js) |
| [超级拖拽](scripts/super-drag/README.md) | 2.2.1 | 原版 | 拖拽文本搜索，拖拽链接在新标签页打开，拖拽图片查看。 | [安装](https://update.greasyfork.org/scripts/580630/%E8%B6%85%E7%BA%A7%E6%8B%96%E6%8B%BD.user.js) |
| [捕获链接](scripts/capture-links/README.md) | 1.0.0 | 原版 | 捕获页面中的全部链接，支持关键词筛选与批量复制 | [安装](https://update.greasyfork.org/scripts/582371/%E6%8D%95%E8%8E%B7%E9%93%BE%E6%8E%A5.user.js) |
| [选中复制](scripts/selection-copy/README.md) | 1.1.4 | 原版 | 选中文本后自动纯文本复制到剪贴板，去除首尾空白 | [安装](https://update.greasyfork.org/scripts/582576/%E9%80%89%E4%B8%AD%E5%A4%8D%E5%88%B6.user.js) |
| [输入框自动填充](scripts/input-autofill/README.md) | 1.0.0 | 原版 | 在指定网页的输入框聚焦时，显示预置内容下拉菜单并自动填充 | [安装](https://update.greasyfork.org/scripts/584534/%E8%BE%93%E5%85%A5%E6%A1%86%E8%87%AA%E5%8A%A8%E5%A1%AB%E5%85%85.user.js) |
<!-- scripts:end -->

## 目录结构

```
.
├─ packages/
│  └─ userscript-ui/           # 共享 UI 设计体系（git submodule，独立仓库）
├─ scripts/                    # 每个用户脚本一个 workspace 包
│  └─ <slug>/
│     ├─ userscript.meta.js    # ==UserScript== 元数据，构建时作为 banner
│     ├─ package.json          # 包信息，版本与元数据里的 @version 一致
│     ├─ README.md             # 脚本说明与迁移进度
│     ├─ src/                  # 迁移后的源码入口（src/main.ts，目前大多还没有）
│     └─ legacy/               # Greasy Fork 线上版本快照，由 sync.py 维护
├─ tools/
│  ├─ build.mjs                # 统一构建：Vite → dist/<slug>.user.js
│  └─ sync.py                  # 发现并同步全部已发布脚本到对应包
├─ docs/
│  ├─ architecture.md          # 结构、构建与发布流程
│  ├─ migration-guide.md       # 单个脚本的迁移步骤与检查清单
│  └─ refactoring-plan.md      # 工程重构方案（RFC-0001，待评审）
├─ scripts.json                # 自动生成的清单（版本 / SHA-256 / 下载地址）
└─ package.json                # npm workspaces 根配置
```

## 常用命令

```powershell
npm install                  # 首次执行，安装 Vite 并链接各 workspace 包
npm run build                # 构建所有已迁移的脚本（未迁移的自动跳过）
npm run build:min            # 同上，但压缩产物
npm run build capture-links  # 只构建指定的包
npm run sync                 # 从 Greasy Fork 同步线上版本到 legacy/，刷新清单与表格
npm run sync:check           # 只检查是否有新版本，有则退出码 1
```

## 约定

- 每个脚本一个目录，目录名即 `slug`，包名统一为 `@my-userscript/<slug>`。
- 元数据只写在 `userscript.meta.js`；版本号同时体现在 `package.json` 与 `@version` 上。
- UI 一律使用 `@ui`（`packages/userscript-ui/src`）的组件与 `--ds-*` Token，不再各写一套样式。
- 构建产物（`scripts/<slug>/dist/`）不入库，发布时上传 GreasyFork。
- 迁移完成并验证后，删除该包的 `legacy/` 目录。

设计系统的硬性约束见 [packages/userscript-ui/AGENTS.md](packages/userscript-ui/AGENTS.md)。

## 版本管理

```powershell
git log --oneline -- scripts/<slug>   # 单个脚本的历史
git diff HEAD~1 -- scripts/           # 上一次同步/迁移带来的改动
git submodule update --init --recursive   # 克隆后拉取 UI 子模块
```

## 许可

各脚本版权归原作者所有，许可证以文件头 `@license` 声明为准（当前均为 MIT）。
