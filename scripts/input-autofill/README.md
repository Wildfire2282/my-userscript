# 输入框自动填充

在指定网页的输入框聚焦时，显示预置内容下拉菜单并自动填充

| 项目 | 值 |
| --- | --- |
| Greasy Fork | [584534](https://greasyfork.org/zh-CN/scripts/584534) |
| 当前版本 | 1.0.0 |
| 状态 | 未迁移：仍使用 `legacy/` 下的原版实现 |
| 原版文件 | `legacy/584534-input-autofill.user.js` |
| 匹配站点 | `http://*/*`, `https://*/*` |
| 授予权限 | `GM.getValue`, `GM.setValue`, `GM.registerMenuCommand`, `GM.addStyle` |

## 待办

- [ ] 按 [迁移指南](../../docs/migration-guide.md) 把 UI 换成 `@ui`（userscript-ui），逻辑拆到 `src/`。
- [ ] 迁移完成后删除 `legacy/`，并从 [GreasyFork](https://greasyfork.org/zh-CN/scripts/584534) 发布新版本。
