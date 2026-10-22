# 自动发布到 Greasy Fork

> 面向 Agent 的执行文档。维护者只需要知道「改完 push，几分钟后线上就是新版」。

## 链路

```text
push main
  → GitHub Actions：npm ci、npm run check、构建
  → tools/release.mjs 汇总发布物到 release 分支
  → GitHub push webhook
  → api.greasyfork.org
  → Greasy Fork 拉取 raw 文件并更新脚本
```

发布物在 `release` 分支根目录，文件名 `<slug>.user.js`。该分支由 CI 生成，**不要手改**，
也不要把它合并回 `main`。

## 仓库侧

| 文件 | 作用 |
| --- | --- |
| `.github/workflows/release.yml` | CI：检查、构建、推 `release` 分支 |
| `tools/release.mjs` | 汇总发布物，做版本校验 |
| `scripts/*/package.json` | 已迁移脚本的唯一版本来源 |
| `scripts/*/legacy/*.user.js` | 未迁移脚本的发布来源 |

发布物选择：

- 有 `src/main.ts`：发布 `scripts/<slug>/dist/<slug>.user.js`（构建产物）；
- 没有入口：发布 `scripts/<slug>/legacy/*.user.js`（线上原版快照）。

脚本从仓库删除后，下一次发布会清掉 `release` 分支里的旧文件；Greasy Fork 上的脚本不会被自动删除，
需要到脚本管理页手动停用或删除。清理只处理发布目录里的 `*.user.js`，不会动源码仓库。

版本规则：

| 情况 | 行为 |
| --- | --- |
| 内容完全相同 | 跳过，不产生提交 |
| 版本更高 | 覆盖发布物 |
| 版本相同、内容不同 | CI 失败，要求先提升版本 |
| 版本更低 | CI 失败，拒绝回退 |
| `@name` / `@match` / `@include` / `@grant` 变化 | CI 失败，要求人工确认后手动发布 |

元数据变化会改变安装时的权限提示，不能静默上线。确认要改时，在 Actions 里对「发布用户脚本」
点 Run workflow，勾选 `allow_meta_change` 再运行。迁移后的脚本还会被 `check:meta` 再拦一次，
按 `docs/migration-guide.md` 的权限变更流程处理。

CI 不跑 `check:browser`（runner 没有浏览器）。改交互的版本发布前在本地跑一次
`npm run check:browser <slug>`。

## GitHub Webhook

仓库 Settings → Webhooks → Add webhook：

| 字段 | 值 |
| --- | --- |
| Payload URL | `https://api.greasyfork.org/zh-CN/users/852134-wildfire2282/webhook` |
| Content type | `application/json` |
| Secret | Greasy Fork 脚本同步页给出的值，只填在 GitHub，不写进仓库 |
| Events | Just the push event |
| Active | 勾选 |

验证：Webhook 的 Recent Deliveries 里最近一次 `push` 返回 2xx。`401` 表示 Secret 不一致。

## Greasy Fork 侧

每个脚本配置一次：脚本页 → 管理 → 脚本同步 → 填同步 URL、同步类型选「自动」，
点「更新设置并立即同步」（不是「更新」）。这个按钮会立刻拉取一次，同时保存同步设置。

| 脚本 | 同步 URL |
| --- | --- |
| 超级拖拽 | `https://raw.githubusercontent.com/Wildfire2282/my-userscript/release/super-drag.user.js` |
| 捕获链接 | `https://raw.githubusercontent.com/Wildfire2282/my-userscript/release/capture-links.user.js` |
| 选中复制 | `https://raw.githubusercontent.com/Wildfire2282/my-userscript/release/selection-copy.user.js` |
| YouTube 转写文稿复制 | `https://raw.githubusercontent.com/Wildfire2282/my-userscript/release/youtube-transcript-copy.user.js` |

发布物版本必须高于线上版本；相同版本会显示为已是最新，不会产生更新记录。

**新增脚本必须走这个按钮。** GitHub 的 push 事件只把「已存在文件的修改」算作 changed files，
新建文件的提交不会被 Greasy Fork 的 webhook 处理；第一次同步后，后续更新才由 webhook 自动完成。

## 日常发布

1. 改源码。未迁移脚本只按 `AGENTS.md` 9.1 的紧急修复规则改 `legacy/`。
2. 提升 `scripts/<slug>/package.json` 的 `version`，写 `CHANGELOG.md` 一条人话。
3. 本地 `npm run check`；涉及交互再跑 `npm run check:browser <slug>`。
4. 提交并 push `main`。
5. Actions 通过后 `release` 分支出现新文件；Webhook 触发后 Greasy Fork 通常一分钟内更新。
6. 发布生效后 `npm run sync`，刷新 `scripts.json` 与 README 表格。

## 回退

按 `AGENTS.md` 第 10 节：恢复上一版代码，把版本号提升到**比线上更高**，再 push。禁止降版本号。

## 排障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| Actions 失败 | lint / 类型 / 测试 / 版本校验 | 看失败步骤，修好再 push |
| Webhook 401 | Secret 与 Greasy Fork 不一致 | 用 Greasy Fork 页面上的值重填 |
| Webhook 2xx 但脚本没更新 | 版本没提升、同步 URL 不匹配、分支或文件名写错 | 对比 `release` 分支文件与同步 URL |
| CI 报「版本仍是 x」 | 改了内容没升版本 | 提升 `package.json` 版本 |
| CI 报「版本从 x 退到 y」 | 线上或 `release` 分支版本更高 | 先 `npm run sync`，再把版本提到更高 |
| 脚本显示「已是最新」 | 发布物版本不高于线上 | 这是正常结果；要发新版就升版本 |
