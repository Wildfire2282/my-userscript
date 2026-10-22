# YouTube 转写文稿复制

视频播放页面出现可拖拽悬浮按钮，可一键复制转写文稿（transcript），支持英语等多语言界面

| 项目 | 值 |
| --- | --- |
| Greasy Fork | [579560](https://greasyfork.org/zh-CN/scripts/579560) |
| 当前版本 | 1.1.3 |
| 迁移状态 | 未迁移：线上发布使用 `legacy/` 原版 |
| 原版文件 | `legacy/579560-youtube-transcript-copy.user.js` |
| 匹配站点 | `https://www.youtube.com/*`（`document-start`） |
| 授予权限 | `GM_setClipboard`、`GM_registerMenuCommand`、`GM_addStyle`、`GM_setValue`、`GM_getValue`、`GM_deleteValue` |
| 设置键 | `pos`（按钮位置）、`strategy`（提取策略记忆） |

## 迁移状态

未迁移。线上继续使用 `legacy/` 原版；迁移后改由 `src/` 构建，并按 [`docs/migration-guide.md`](../../docs/migration-guide.md) 验收，通过后再删除 `legacy/`。
