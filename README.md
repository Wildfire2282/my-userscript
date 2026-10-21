# my-userscript

Wildfire2282 在 [Greasy Fork](https://greasyfork.org/zh-CN/users/852134-wildfire2282) 上发布的用户脚本（userscript）归档与版本管理仓库。

脚本本体按原样保存（含完整 `==UserScript==` 元数据块），便于审计、比对与本地安装。

## 脚本列表

<!-- scripts:start -->
| ID | 脚本 | 版本 | 说明 | 安装 |
| --- | --- | --- | --- | --- |
| 579560 | [YouTube 转写文稿复制](https://greasyfork.org/zh-CN/scripts/579560) | 1.1.2 | 视频播放页面出现可拖拽悬浮按钮，可一键复制转写文稿（transcript），支持英语等多语言界面 | [安装](https://update.greasyfork.org/scripts/579560/YouTube%20%E8%BD%AC%E5%86%99%E6%96%87%E7%A8%BF%E5%A4%8D%E5%88%B6.user.js) |
| 580630 | [超级拖拽](https://greasyfork.org/zh-CN/scripts/580630) | 2.2.1 | 拖拽文本搜索，拖拽链接在新标签页打开，拖拽图片查看。 | [安装](https://update.greasyfork.org/scripts/580630/%E8%B6%85%E7%BA%A7%E6%8B%96%E6%8B%BD.user.js) |
| 582371 | [捕获链接](https://greasyfork.org/zh-CN/scripts/582371) | 1.0.0 | 捕获页面中的全部链接，支持关键词筛选与批量复制 | [安装](https://update.greasyfork.org/scripts/582371/%E6%8D%95%E8%8E%B7%E9%93%BE%E6%8E%A5.user.js) |
| 582576 | [选中复制](https://greasyfork.org/zh-CN/scripts/582576) | 1.1.4 | 选中文本后自动纯文本复制到剪贴板，去除首尾空白 | [安装](https://update.greasyfork.org/scripts/582576/%E9%80%89%E4%B8%AD%E5%A4%8D%E5%88%B6.user.js) |
| 584534 | [输入框自动填充](https://greasyfork.org/zh-CN/scripts/584534) | 1.0.0 | 在指定网页的输入框聚焦时，显示预置内容下拉菜单并自动填充 | [安装](https://update.greasyfork.org/scripts/584534/%E8%BE%93%E5%85%A5%E6%A1%86%E8%87%AA%E5%8A%A8%E5%A1%AB%E5%85%85.user.js) |
<!-- scripts:end -->

> 安装链接在装有 Tampermonkey / Violentmonkey 的浏览器中打开即可弹出安装页；若不放心，可先阅读 `scripts/` 下的源码。

## 目录结构

```
.
├─ scripts/                      # 用户脚本原文，命名规则 <Greasy Fork ID>-<英文别名>.user.js
├─ tools/sync.py                 # 从 Greasy Fork 拉取/更新全部脚本（Python，仅用标准库）
├─ scripts.json                  # 自动生成的清单（版本、SHA-256、下载地址等）
└─ README.md
```

## 同步更新

需要 Python 3.10+，不依赖任何第三方包：

```powershell
# 下载有更新的脚本，并刷新 scripts.json 与 README 脚本表格
python tools/sync.py

# 仅检查是否有新版本（有新版本时退出码为 1，不写文件）
python tools/sync.py --check

# 忽略内容比对，强制重新下载全部脚本
python tools/sync.py --force
```

脚本自动遍历用户页（含分页）发现全部脚本，并从每个脚本页解析真实安装地址；本地文件按 HTTP 头里的 `@version` 与正文内容判断是否需要重写，未变化的文件不会被改动，方便 `git diff` 审阅。

新增脚本会自动纳入同步；若想要更友好的英文文件名，在 `tools/sync.py` 的 `SLUGS` 中补一行 `脚本 ID: 英文别名` 即可。

## 版本管理

```powershell
git log --oneline -- scripts/     # 查看同步历史
git diff HEAD~1 -- scripts/       # 查看上次同步带来的具体改动
git status                        # 同步后确认待提交的变更
```

每个脚本文件顶部都保留了 `@version`、`@downloadURL`、`@updateURL` 等字段，浏览器端的自动更新不受本仓库影响。

## 许可

各脚本版权归原作者所有，许可证以文件头 `@license` 声明为准（当前均为 MIT）。
