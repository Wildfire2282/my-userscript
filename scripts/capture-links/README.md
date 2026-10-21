# 捕获链接

捕获页面中的全部链接，支持关键词筛选与批量复制

| 项目 | 值 |
| --- | --- |
| Greasy Fork | [582371](https://greasyfork.org/zh-CN/scripts/582371) |
| 当前版本 | 1.0.0 |
| 状态 | 未迁移：仍使用 `legacy/` 下的原版实现 |
| 原版文件 | `legacy/582371-capture-links.user.js` |
| 匹配站点 | `https://*/*`, `http://*/*` |
| 授予权限 | `GM_addStyle`, `GM_registerMenuCommand`, `GM_setClipboard`, `GM_setValue`, `GM_getValue` |

## 待办

- [ ] 按 [迁移指南](../../docs/migration-guide.md) 把 UI 换成 `@ui`（userscript-ui），逻辑拆到 `src/`。
- [ ] 迁移完成后删除 `legacy/`，并从 [GreasyFork](https://greasyfork.org/zh-CN/scripts/582371) 发布新版本。
