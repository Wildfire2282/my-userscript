# 选中复制

选中文本后自动纯文本复制到剪贴板，去除首尾空白。

| 项目 | 值 |
| --- | --- |
| Greasy Fork | [582576](https://greasyfork.org/zh-CN/scripts/582576) |
| 当前版本 | 1.2.0 |
| 迁移状态 | 已迁移：由 `src/` 模块构建，界面使用 `@ui` |
| 匹配站点 | `*://*/*`（`document-end`，每个 frame 独立生效） |
| 授予权限 | `GM_setClipboard` |
| 设置键 | 无：行为由脚本内常量固定 |

## 行为

| 操作 | 结果 |
| --- | --- |
| 拖动选中文字后松开 | 自动复制选中的文字，去掉首尾空白，并在选区终点旁显示绿色勾号 |
| 双击 / 三击选中文字 | 自动复制 |
| Shift + 方向键 / Home / End / PageUp / PageDown 扩选 | 自动复制 |
| Ctrl+A 全选 | 自动复制 |
| 普通单击（只移动光标） | 不复制 |
| 在输入框、富文本编辑器里选中 | 不复制，保留页面原生行为 |
| 程序化选区（页面脚本改的） | 不复制，只认用户手势 |
| 勾号 | 显示约 1 秒后淡出，不遮挡点击 |

与旧版一致：只接受 `isTrusted` 的鼠标与键盘事件；页面合成的 `mousedown` / `mouseup` / `keyup` 不算数。

## 结构

```text
src/
├─ main.ts                    # 入口：安装锁、组装传感器与复制动作
├─ config.ts                  # 行为常量与勾号尺寸
├─ gesture.ts                 # 纯判断：拖动 / 双击 / Shift 扩选 / Ctrl+A
├─ selection.ts               # 选区、焦点、可编辑区域与输入框门控
├─ features/
│  ├─ sensor.ts               # 鼠标 / 键盘监听，只收集快照
│  ├─ copy-action.ts          # 读选区 → 过门控 → 写剪贴板 → 点亮勾号
│  └─ geometry.ts             # 选区终点的行盒与兜底矩形
└─ ui/
   ├─ app.ts                  # 第一次复制成功才创建 UI
   ├─ indicator.ts            # 勾号圆点与淡出
   ├─ indicator-position.ts   # 位置计算（纯函数）
   └─ indicator.css           # 勾号样式（只用 --ds-* Token）
```

## 命令

```powershell
npm run build selection-copy     # 产物 scripts/selection-copy/dist/selection-copy.user.js
npm test                         # 单元测试
npm run test:browser             # 真实 Chrome/Edge 场景（先构建）
npm run check                    # 全部检查，含浏览器场景
```

## 已知取舍

- 勾号从独立的顶层 popover 改为 `@ui` Shadow Root 里的 `position: fixed` 标记：普通页面完全等价，且颜色走 `--ds-success`；宿主进入浏览器全屏时标记不会显示（旧版靠 popover 顶层也能显示）。
- 每个 frame 仍独立注入，没有加 `@noframes`：父文档收不到 iframe 内的鼠标事件，加了会丢掉 iframe 内的复制能力。
- 同一文档用 `data-selection-auto-copy-installed` 属性防重复注入；不再依赖 `window` 标记，避免不同管理器的沙箱之间判断不一致。
- 剪贴板优先用 `GM_setClipboard`，没有时依次退回浏览器剪贴板与隐藏 textarea。

## 待办

- [ ] 线上验收通过后删除 `legacy/`（对照用的原版快照）。
