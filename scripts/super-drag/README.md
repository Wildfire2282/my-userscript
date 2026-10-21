# 超级拖拽

拖拽文本搜索，拖拽链接在新标签页打开，拖拽图片查看。

| 项目 | 值 |
| --- | --- |
| Greasy Fork | [580630](https://greasyfork.org/zh-CN/scripts/580630) |
| 当前版本 | 2.3.0 |
| 状态 | 已迁移：由 `src/` 模块构建，UI 使用 `@ui` |
| 匹配站点 | `https://*/*`, `http://*/*`（`@noframes`，`document-end`） |
| 授予权限 | `GM_getValue`, `GM_setValue`, `GM_registerMenuCommand`, `GM_openInTab` |
| 设置键 | `settings`（旧键，未改名），单个对象 |

## 行为（迁移时逐项对照 `legacy/`）

| 操作 | 结果 |
| --- | --- |
| 选中文字后拖动 | 用当前搜索引擎搜索；拖动的文字本身是 http(s)/ftp 地址时直接打开 |
| 拖动链接 | 新标签页打开链接（后台，可在设置里改成前台） |
| 拖动图片 | 新标签页打开深色查看器；`blob:` / `data:` 图片直接打开原地址 |
| 拖动时按住 Shift | 这一次在前台打开 |
| 拖进输入框 | 不接管，交给页面原生粘贴 |
| 按住 Ctrl / Cmd / Alt 拖动 | 不接管 |
| 拖拽后立即松开产生的点击 | 400ms 内吞掉，避免误触页面跳转；更晚的点击不再受影响 |

## 结构

```text
src/
├─ main.ts                 # 入口：装监听、注册菜单、懒建面板
├─ settings.ts             # 设置 schema / 默认值 / 归一化 / 存储
├─ search.ts               # 引擎列表、拼搜索地址、自定义地址校验
├─ features/
│  ├─ dnd.ts               # 拖拽事件与状态机
│  ├─ drop-action.ts       # 纯判断：接管谁、打开什么、前台还是后台
│  ├─ hit-test.ts          # 命中链接 / 图片（穿透 Shadow DOM）
│  ├─ selection.ts         # 选区命中判断
│  ├─ editable.ts          # 输入框与可编辑区域判断
│  ├─ openers.ts           # 开标签页、图片查看器页面
│  └─ url.ts               # 文本是不是网址
└─ ui/settings-panel.ts    # @ui 面板组合
```

## 命令

```powershell
npm run build super-drag     # 产物 scripts/super-drag/dist/super-drag.user.js
npm run test                 # 全部单测：本包 56 条 + 共享包 14 条
npm run check                # 静态检查 + 类型 + 单测 + 构建 + 元数据 + 体积
npm run check:browser        # 真实 Chrome/Edge，16 个场景
```

## 设置面板

入口是油猴菜单「超级拖拽：设置」，没有悬浮按钮。第一次打开时才创建 UI 与面板，普通页面零 DOM。
面板为右下角 `@ui` Panel：启用开关、搜索引擎、自定义搜索地址（含实时示例与校验）、
新标签页打开方式、恢复默认 / 取消 / 保存。原版的「使用方式」提示并入了面板和各字段的说明文字。

## 已知取舍

- 设置面板从居中模态改成右下角 Panel（维护者确认）：不再锁页面滚动，也不再点遮罩关闭。
- 设置表单不用 `createDialog`：它的按钮点击即关闭并返回结果，校验失败会变成「关掉再弹」。
- 自定义搜索地址选填；选了「自定义」但地址无效时保存会被拦下（原版会静默回退 Google）。
- 图片查看器仍是独立 blob 页面（深色居中），没有改成浏览器原生图片页。

## 待办

- [ ] 线上验收通过后删除 `legacy/`（对照用的原版快照）。
- [ ] 发布 2.3.0（需维护者在 Greasy Fork 页面确认），之后跑 `npm run sync` 刷新清单。
