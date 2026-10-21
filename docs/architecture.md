# 项目结构

> 面向 Agent 的执行文档。维护者无需阅读，人类入口见 `README.md`。

## 目标

一个仓库维护多个用户脚本，共享同一套 UI 设计体系，避免每个脚本各写一份按钮、面板、Toast
和配色。设计体系本身是独立仓库 [userscript-ui](https://github.com/Wildfire2282/userscript-ui)，
通过 git submodule 引入，按源码方式复用（Vite 直接把它的 TS/CSS 打进当前脚本，未用到的组件会被
tree-shake）。

## 目录职责

| 路径 | 职责 |
| --- | --- |
| `packages/userscript-ui/` | UI 设计体系子模块，只读；升级靠 `git submodule update --remote` |
| `scripts/<slug>/` | 一个脚本一个 npm workspace 包 |
| `scripts/<slug>/userscript.meta.js` | 元数据唯一来源，构建时作为 banner 放在产物顶部 |
| `scripts/<slug>/src/` | 迁移后的源码，入口 `src/main.ts` |
| `scripts/<slug>/legacy/` | 线上原版快照，迁移期用于对照，迁移完成后删除 |
| `tools/build.mjs` | 遍历包、调用 Vite、注入 banner、输出单文件 userscript |
| `tools/sync.py` | 反向同步：把 Greasy Fork 上的发布版本拉回 `legacy/` |
| `scripts.json` | 机器可读清单，供脚本或 CI 查询版本与校验和 |

## 包约定

每个 `scripts/<slug>/package.json` 至少包含：

```json
{
  "name": "@my-userscript/<slug>",
  "version": "<与 @version 一致>",
  "private": true,
  "type": "module",
  "scripts": { "build": "node ../../tools/build.mjs <slug>" }
}
```

包之间不互相依赖。共享代码只有两个来源：`@ui`（设计体系）和脚本自己的 `src/`。

`userscript.meta.js` 与 `legacy/*.user.js` 顶部的元数据块是有意重复的：前者是构建入口的
单一事实来源，后者保证线上快照与 GreasyFork 逐字节一致，便于比对。迁移完成、删除 `legacy/`
之后，元数据只剩 `userscript.meta.js` 一处。

命名、注释、文档与验证规范见根目录 `AGENTS.md`；UI 硬约束见 `packages/userscript-ui/AGENTS.md`。

## 构建

```powershell
npm run build               # 全部
npm run build capture-links # 单个
```

`tools/build.mjs` 的工作方式：

1. 扫描 `scripts/*/package.json`；
2. 没有 `src/main.ts`（或 `.js` / `index.ts` / `index.js`）的包直接跳过，因此未迁移的脚本不会阻塞构建；
3. 用 Vite lib 模式打成 IIFE，别名 `@ui` → `packages/userscript-ui/src/index.ts`；
4. 把 `userscript.meta.js` 作为 Rollup banner 注入；
5. 输出 `scripts/<slug>/dist/<slug>.user.js`。

产物是单文件、无外部资源，可直接安装。`dist/` 在 `.gitignore` 中：构建产物由发布流程上传
GreasyFork，不进入版本库；需要追溯时看 `git tag`。

构建目标固定为 `chrome111`（与设计体系一致），因为 UI 使用了现代 CSS 特性，不针对旧浏览器做回退。

## 版本与发布

1. 改 `scripts/<slug>/userscript.meta.js` 里的 `@version`；
2. 同步改 `package.json` 的 `version`（两者必须一致，避免包管理和脚本元数据打架）；
3. `npm run build <slug>`；
4. 在浏览器里装 `dist/<slug>.user.js` 做一次冒烟测试；
5. 上传 GreasyFork，`@downloadURL` / `@updateURL` 保持与该脚本 ID 对应；
6. 提交时把源码、元数据、包配置一起提交；构建产物不入库。

## 反向同步（sync.py）

`tools/sync.py` 负责把「已发布」的版本拉回仓库，用于：

- 首次导入一个已有脚本；
- 检查线上是否有人直接改过（与 `legacy/` 比对）；
- 新脚本出现在用户页时自动建立包骨架。

它只写 `legacy/`、`package.json`（仅缺失时）、`userscript.meta.js`（仅缺失时）、
`scripts.json` 和 README 表格，不会覆盖已迁移的 `src/`。

## 子模块

```powershell
git clone --recurse-submodules <repo>
git submodule update --init --recursive
git submodule update --remote packages/userscript-ui   # 升级设计体系
```

升级子模块后跑一次 `npm run build`，确认各脚本仍能构建、视觉无回归。子模块的提交指针也要一并提交。
