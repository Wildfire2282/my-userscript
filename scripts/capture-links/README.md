# 捕获链接

捕获页面中的全部链接，支持关键词筛选与批量复制

| 项目 | 值 |
| --- | --- |
| Greasy Fork | [582371](https://greasyfork.org/zh-CN/scripts/582371) |
| 当前版本 | 1.0.1 |
| 迁移状态 | 未迁移：线上发布使用 `legacy/` 原版 |
| 原版文件 | `legacy/582371-capture-links.user.js` |
| 匹配站点 | `https://*/*`、`http://*/*`（`@noframes`，`document-end`） |
| 授予权限 | `GM_addStyle`、`GM_registerMenuCommand`、`GM_setClipboard`、`GM_setValue`、`GM_getValue` |
| 设置键 | `settings`（旧键，未改名）：`showFloatButton`、`copyFormat` |

## 迁移状态

未迁移。线上继续使用 `legacy/` 原版；迁移后改由 `src/` 构建，并按 [`docs/migration-guide.md`](../../docs/migration-guide.md) 验收，通过后再删除 `legacy/`。
