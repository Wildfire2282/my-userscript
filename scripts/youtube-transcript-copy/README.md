# YouTube 转写文稿复制

视频播放页面出现可拖拽悬浮按钮，可一键复制转写文稿（transcript），支持英语等多语言界面。

| 项目 | 值 |
| --- | --- |
| Greasy Fork | [579560](https://greasyfork.org/zh-CN/scripts/579560) |
| 准备版本 | 1.4.5（待发布，2026-10-24） |
| 迁移状态 | 已迁移：由 `src/` 模块构建，界面使用 `@ui` |
| 匹配站点 | `https://www.youtube.com/*`（`document-start`） |
| 授予权限 | `GM_setClipboard`、`GM_registerMenuCommand`、`GM_setValue`、`GM_getValue`、`GM_deleteValue` |
| 设置键 | `pos`（按钮位置）、`strategy`（提取策略记忆） |

## 本次版本准备

1.4.5 尚未发布：整理共享剪贴板实现与更新前的检查流程，日常转写复制操作和已有设置保持不变，授予权限不变。此处不代表检查已通过或线上验收已完成。

## 行为

| 操作 | 结果 |
| --- | --- |
| 打开视频页 | 播放器右上角出现可拖动的按钮，暂停、播完、还没缓冲好都不会消失 |
| 点击按钮 | 抓取转写并复制，每条一行、带 `[分:秒]` 前缀；抓取中转圈，成功变 ✓，失败或没有文稿变 ✕，1.5 秒后恢复 |
| 拖动按钮 | 任意移动，松手后记住位置；拖动本身不会触发复制 |
| 页面全屏 | 按钮隐藏，避免挡住播放器控件 |
| 换视频（单页切换） | 不沿用上一个视频的转写 |
| 菜单「操作面板」 | 面板里复制本页转写文稿（不依赖按钮是否可见），或把按钮放回播放器右上角；复制成功、没找到文稿、复制失败都会在面板上给出提示 |
| 菜单「功能设置」 | 面板里清空策略记忆：下次重新按默认顺序尝试提取方式 |

抓取顺序（成功一次就记住这次的方式，下次优先）：

1. `ytInitialPlayerResponse` 里的第一条字幕轨（最快，不用打开面板）；
2. 播放器自己拉字幕、页面请求转写面板时被网络钩子留下的缓存（含带 `pot` 的 `timedtext`）；
3. 打开转写面板后读新版 view-model 结构；
4. 再退到面板里的“时间戳 + 文字”纯文本行；
5. 最后直接请求 `get_panel`。

## 结构

```text
src/
├─ main.ts                    # 入口：网络钩子、组装服务、菜单、SPA 与显隐监听
├─ store.ts                   # 按钮位置与策略记忆（旧键 pos / strategy）
├─ features/
│  ├─ position.ts             # 位置表示、夹紧与默认位置
│  ├─ visibility.ts           # 播放状态判断与监听
│  └─ spa.ts                  # yt-navigate-finish + 地址变化 + 轮询
├─ transcript/
│  ├─ types.ts                # 片段、策略记忆类型
│  ├─ format.ts               # 清洗、时间戳互转、输出格式
│  ├─ extract.ts              # get_panel / json3 / view-model / 纯文本行
│  ├─ initial-track.ts        # 初始字幕轨读取与下载
│  ├─ network.ts              # fetch / XHR 钩子
│  ├─ open-panel.ts           # 找按钮、展开描述、打开面板
│  ├─ api.ts                  # get_panel 兜底请求
│  ├─ strategy.ts             # 策略排序
│  └─ service.ts              # 策略编排、按视频缓存
└─ ui/
   ├─ app.ts                  # UI 生命周期与按钮状态机
   ├─ button.ts               # 可拖动按钮与状态显示
   └─ transcript-button.css   # 按钮样式（只用 --ds-* Token）
```

## 命令

```powershell
npm run build youtube-transcript-copy     # 产物 scripts/youtube-transcript-copy/dist/youtube-transcript-copy.user.js
npm test                                  # 单元测试
npm run test:browser                      # 真实 Chrome/Edge 场景（先构建）
npm run check                             # 全部检查，含浏览器场景
```

## 已知取舍

- 按钮外观完全由 `@ui` 的按钮组件决定（36px、实心红、悬停变亮、抓取中显示转圈），不再有自绘的圆形与半透明；拖动定位由脚本补，因为框架的悬浮入口只支持四个角。
- 打开面板是慢操作：最多四轮，每轮要等界面渲染。能走网络缓存或初始字幕轨时不会碰面板。
- `get_panel` 兜底的客户端版本写死；YouTube 升级会让它失效，但它排在最后，不影响主路径。
- 策略记忆只记下标和时间，不保存任何文稿内容。
- 初始字幕轨按视频 ID 绑定；旧版在单页换视频后会沿用旧字幕轨，这里已修正。
- 复制结果：点按钮时只在按钮上显示 ✓ / ✕；从操作面板复制时用提示条说明结果（成功 / 没有文稿 / 失败），不在提示里输出文稿内容。
- 菜单只有两项（操作面板、功能设置），其余入口都放面板里；代价是产物比只有按钮时大约多 7KB（压缩后）。

## 待办

- [ ] 线上验收通过后删除 `legacy/`（对照用的原版快照）。
