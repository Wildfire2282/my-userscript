# YouTube 转写文稿复制

视频播放页面出现可拖拽悬浮按钮，可一键复制转写文稿（transcript），支持英语等多语言界面

| 项目 | 值 |
| --- | --- |
| Greasy Fork | [579560](https://greasyfork.org/zh-CN/scripts/579560) |
| 当前版本 | 1.1.2 |
| 状态 | 未迁移：仍使用 `legacy/` 下的原版实现 |
| 原版文件 | `legacy/579560-youtube-transcript-copy.user.js` |
| 匹配站点 | `https://www.youtube.com/*` |
| 授予权限 | `GM_setClipboard`, `GM_registerMenuCommand`, `GM_addStyle`, `GM_setValue`, `GM_getValue`, `GM_deleteValue` |

## 待办

- [ ] 按 [迁移指南](../../docs/migration-guide.md) 把 UI 换成 `@ui`（userscript-ui），逻辑拆到 `src/`。
- [ ] 迁移完成后删除 `legacy/`，并从 [GreasyFork](https://greasyfork.org/zh-CN/scripts/579560) 发布新版本。
