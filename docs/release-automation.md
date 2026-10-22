# 自动发布

> 读者：Agent。目标：维护者确认发布后 push `main` → CI 检查并构建 → 推送 `release` 分支 → webhook 通知 Greasy Fork。构建与上线由 CI 自动完成；发布时机、首次导入与元数据变化由人确认。

## 1. 链路

```text
push main
  → GitHub Actions：npm ci、npm run check（含构建）
  → tools/release.mjs 汇总发布物到 release 分支
  → GitHub push webhook
  → api.greasyfork.org
  → Greasy Fork 拉取 raw 文件并更新脚本
```

`release` 分支由 CI 生成，根目录只放 `<slug>.user.js`。**不要手改，也不要合并回 `main`。**

## 2. 发布物与版本

| 文件 | 作用 |
| --- | --- |
| `.github/workflows/release.yml` | CI：检查、构建、推 `release` 分支 |
| `tools/release.mjs` | 汇总发布物，校验版本与元数据变化 |
| `scripts/*/package.json` | 已迁移脚本的唯一版本来源 |
| `scripts/*/legacy/*.user.js` | 未迁移脚本的发布来源 |

发布物选择：

- 有 `src/main.ts`：发布 `scripts/<slug>/dist/<slug>.user.js`；
- 没有入口：发布 `scripts/<slug>/legacy/*.user.js`。

版本规则：

| 情况 | 行为 |
| --- | --- |
| 内容完全相同 | 跳过，不产生提交 |
| 版本更高 | 覆盖发布物 |
| 版本相同、内容不同 | CI 失败，要求先提升版本 |
| 版本更低 | CI 失败，拒绝回退 |
| `@name` / `@match` / `@include` / `@grant` 变化 | 默认 CI 失败；人工确认后用 `allow_meta_change` 放行 |

脚本从仓库删除后，下一次发布会清掉 `release` 分支里的旧文件；Greasy Fork 上的脚本不会自动删除，需要到脚本管理页手动停用或删除。

CI 不跑 `check:browser`（该检查使用本地安装的 Chrome/Edge）。改交互的版本发布前必须在本地跑一次 `npm run check:browser <slug>`。

## 3. 日常发布

1. 改源码。未迁移脚本只按 `AGENTS.md` 9.1 的紧急修复规则改 `legacy/`。
2. 提版本：已迁移脚本改 `scripts/<slug>/package.json` 的 `version`；未迁移脚本改 `legacy/*.user.js` 元数据里的 `@version`，并把 `package.json` 同步到同一值。在 `CHANGELOG.md` 写一条人话。
3. 本地跑 `npm run check`；涉及交互再跑 `npm run check:browser <slug>`。
4. 向维护者说明本次用户可见的变化，确认发布后提交并 push `main`。
5. Actions 通过后 `release` 分支出现新文件；webhook 触发后 Greasy Fork 通常一分钟内更新。
6. 发布生效后跑 `npm run sync`，刷新 `scripts.json` 与根 `README.md` 的脚本表。

## 4. 元数据变更

`@name` / `@match` / `@include` / `@grant` 会改变安装提示或运行范围，不能静默上线。字段标准见 [`metadata.md`](metadata.md)。

确认要改时：

1. 维护者确认「多看到什么、少看到什么」；
2. Agent 在本地跑 `ALLOW_META_CHANGE=1 npm run check`（PowerShell：`$env:ALLOW_META_CHANGE='1'; npm run check`）验证；
3. 在 Actions 里对「发布用户脚本」点 **Run workflow**，勾选 `allow_meta_change` 后运行；
4. 提交信息里写明变更理由与影响。

该开关同时放行 `check:meta` 的 legacy 对照与 `release.mjs` 的元数据比对；未确认时不要勾选。

## 5. Greasy Fork 同步

### Webhook

仓库 Settings → Webhooks → Add webhook：

| 字段 | 值 |
| --- | --- |
| Payload URL | `https://api.greasyfork.org/zh-CN/users/852134-wildfire2282/webhook` |
| Content type | `application/json` |
| Secret | Greasy Fork 脚本同步页给出的值，只填在 GitHub，不写进仓库 |
| Events | Just the push event |
| Active | 勾选 |

验证：Recent Deliveries 里最近一次 `push` 返回 2xx。`401` 表示 Secret 不一致。

### 首次导入与同步 URL

新脚本先在 Greasy Fork 配一次：脚本页 → 管理 → 脚本同步 → 填同步 URL、类型选「自动」，点「更新设置并立即同步」（不是「更新」）。这个按钮会立刻拉取一次并保存设置。

| 脚本 | 同步 URL |
| --- | --- |
| 超级拖拽 | `https://raw.githubusercontent.com/Wildfire2282/my-userscript/release/super-drag.user.js` |
| 捕获链接 | `https://raw.githubusercontent.com/Wildfire2282/my-userscript/release/capture-links.user.js` |
| 选中复制 | `https://raw.githubusercontent.com/Wildfire2282/my-userscript/release/selection-copy.user.js` |
| YouTube 转写文稿复制 | `https://raw.githubusercontent.com/Wildfire2282/my-userscript/release/youtube-transcript-copy.user.js` |

GitHub 的 push 事件只把「已存在文件的修改」算作 changed files，新建文件的提交不会被 webhook 处理；新增脚本必须走上面这个按钮，之后才由 webhook 自动更新。

## 6. 回退

按 `AGENTS.md` 第 10 节：恢复上一版代码，把版本号提升到**比线上更高**，再 push。禁止降版本号。

## 7. 排障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| Actions 失败 | lint / 类型 / 测试 / 元数据 / 版本校验 | 看失败步骤，修好再 push |
| Webhook 401 | Secret 与 Greasy Fork 不一致 | 用 Greasy Fork 页面上的值重填 |
| Webhook 2xx 但脚本没更新 | 版本没提升、同步 URL 不匹配、分支或文件名写错 | 对比 `release` 分支文件与同步 URL |
| CI 报「版本仍是 x」 | 改了内容没升版本 | 提升 `package.json` 版本 |
| CI 报「版本从 x 退到 y」 | 线上或 `release` 分支版本更高 | 先 `npm run sync`，再把版本提到更高 |
| 脚本显示「已是最新」 | 发布物版本不高于线上 | 正常结果；要发新版就升版本 |
