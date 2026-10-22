# 捕获链接

捕获页面中的全部链接，支持关键词筛选与批量复制。

| 项目 | 值 |
| --- | --- |
| Greasy Fork | [582371](https://greasyfork.org/zh-CN/scripts/582371) |
| 当前版本 | 1.1.0 |
| 迁移状态 | 已迁移：由 `src/` 模块构建，界面使用 `@ui` |
| 匹配站点 | `https://*/*`、`http://*/*`（`@noframes`，`document-end`） |
| 授予权限 | `GM_addStyle`（保留旧授权，当前代码不再使用）、`GM_registerMenuCommand`、`GM_setClipboard`、`GM_setValue`、`GM_getValue` |
| 设置键 | `settings`（旧键，未改名）：`showFloatButton`、`copyFormat` |

## 行为

| 操作 | 结果 |
| --- | --- |
| 油猴菜单「面板」或右下角按钮 | 列出本页全部链接；空地址与重复地址被忽略 |
| 关键词筛选 | 同时匹配标题与地址，大小写不敏感 |
| 仅磁链 | 只显示 `magnet:` 开头的链接 |
| 全选 / 全不选 / 反选 | 只作用于当前筛选结果，筛选之外的勾选保留 |
| 复制选中 | 按「复制格式」写入剪贴板，每行一条；没选中时提示「未选中任何链接」 |
| 油猴菜单「设置」 | 悬浮按钮开关、复制格式（纯链接 / Markdown / HTML），改动立即生效 |

链接标题的取值顺序与旧版一致：行 / 列表项 / 表格行上的 `title`，其次链接文字，最后地址本身。

## 结构

```text
src/
├─ main.ts                 # 入口：读设置、显示悬浮按钮、注册菜单
├─ settings.ts             # 设置 schema / 默认值 / 归一化 / 存储
├─ links.ts                # 地址补全、去重、筛选（纯函数）
├─ format.ts               # 三种复制格式（纯函数）
├─ selection.ts            # 全选 / 全不选 / 反选的集合运算
├─ features/
│  ├─ scan-page.ts         # 扫描页面 <a href>
│  └─ titles.ts            # 链接标题策略
└─ ui/
   ├─ app.ts               # UI 生命周期、悬浮按钮、提示条
   ├─ link-panel.ts        # 链接列表与批量复制
   ├─ settings-panel.ts    # 设置面板
   ├─ icons.ts             # 链接图标
   └─ link-list.css        # 列表行样式（只用 --ds-* Token）
```

## 命令

```powershell
npm run build capture-links     # 产物 scripts/capture-links/dist/capture-links.user.js
npm test                        # 单元测试
npm run test:browser            # 真实 Chrome/Edge 场景（先构建）
npm run check                   # 全部检查，含浏览器场景
```

## 已知取舍

- 链接列表用原生 checkbox，而不是为每一行创建 `@ui` 组件：列表可能上千行，逐行句柄没有收益，筛选时还会重复重建。
- 面板固定居中、宽 440px，比原版的 640px 浮层窄；内容多时面板内部滚动。
- 悬浮按钮是统一的 40px 圆形图标按钮；原版是 48px 深色 🔗 按钮。
- `GM_addStyle` 授权保留未删，避免安装提示变化；当前样式全部在 Shadow Root 内。
- 面板是非模态的：点面板外面不会关闭，用标题栏的 × 或 Esc 收起。
- 复制失败（管理器拒绝、没有安全上下文）时会提示「复制失败」，不再像旧版那样一律显示「已复制」。

## 待办

- [ ] 线上验收通过后删除 `legacy/`（对照用的原版快照）。
