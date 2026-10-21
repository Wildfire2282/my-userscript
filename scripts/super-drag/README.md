# 超级拖拽

拖拽文本搜索，拖拽链接在新标签页打开，拖拽图片查看。

| 项目 | 值 |
| --- | --- |
| Greasy Fork | [580630](https://greasyfork.org/zh-CN/scripts/580630) |
| 当前版本 | 2.2.1 |
| 状态 | 未迁移：仍使用 `legacy/` 下的原版实现 |
| 原版文件 | `legacy/580630-super-drag.user.js` |
| 匹配站点 | `https://*/*`, `http://*/*` |
| 授予权限 | `GM_setValue`, `GM_getValue`, `GM_registerMenuCommand`, `GM_openInTab` |

## 待办

- [ ] 按 [迁移指南](../../docs/migration-guide.md) 把 UI 换成 `@ui`（userscript-ui），逻辑拆到 `src/`。
- [ ] 迁移完成后删除 `legacy/`，并从 [GreasyFork](https://greasyfork.org/zh-CN/scripts/580630) 发布新版本。
