# 选中复制

选中文本后自动纯文本复制到剪贴板，去除首尾空白

| 项目 | 值 |
| --- | --- |
| Greasy Fork | [582576](https://greasyfork.org/zh-CN/scripts/582576) |
| 当前版本 | 1.1.4 |
| 状态 | 未迁移：仍使用 `legacy/` 下的原版实现 |
| 原版文件 | `legacy/582576-selection-copy.user.js` |
| 匹配站点 | `*://*/*` |
| 授予权限 | `GM_setClipboard` |

## 待办

- [ ] 按 [迁移指南](../../docs/migration-guide.md) 把 UI 换成 `@ui`（userscript-ui），逻辑拆到 `src/`。
- [ ] 迁移完成后删除 `legacy/`，并从 [GreasyFork](https://greasyfork.org/zh-CN/scripts/582576) 发布新版本。
