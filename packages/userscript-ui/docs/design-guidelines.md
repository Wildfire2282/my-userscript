# 设计规范

## 目标

这套 UI 面向用户脚本中的设置面板、操作面板、浮动入口、表单、反馈和确认流程。它不追求覆盖所有 Web 场景，而是让不同脚本看起来像同一个产品：中性、清晰、克制、信息密度适中。

## 设计原则

1. **中性优先**：黑白灰承担大部分界面，颜色只用于主操作、危险操作和反馈状态。
2. **层级清楚**：面板标题、分组标题、字段标签、辅助说明四级足够，不靠多层卡片堆叠。
3. **密度适中**：控件 32px 高，正文 14px，辅助 12px；一屏能完成常见设置。
4. **状态明确**：hover、focus-visible、active、disabled、error、loading 都有可见差异。
5. **克制装饰**：1px 边框、6/8px 圆角、低阴影；不用渐变背景和无意义动画。
6. **可访问**：键盘可达、焦点可见、标签和错误有关联；颜色不是唯一信息载体。

## Design Tokens

所有 Token 定义在 `src/tokens/tokens.css` 和 `src/tokens/themes.css`，通过 `--ds-*` 前缀避免宿主页面变量穿透。

### 颜色

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--ds-background` | `#ffffff` | `#09090b` | 画布背景 |
| `--ds-foreground` | `#18181b` | `#fafafa` | 主文字 |
| `--ds-card` | `#ffffff` | `#18181b` | 面板、Dialog、Toast |
| `--ds-card-foreground` | `#18181b` | `#fafafa` | 卡片文字 |
| `--ds-primary` | `#18181b` | `#fafafa` | 主按钮、选中态 |
| `--ds-primary-foreground` | `#fafafa` | `#18181b` | 主色上的文字 |
| `--ds-secondary` | `#f4f4f5` | `#27272a` | 次要按钮 |
| `--ds-secondary-foreground` | `#18181b` | `#fafafa` | 次要按钮文字 |
| `--ds-muted` | `#f4f4f5` | `#27272a` | hover、弱背景 |
| `--ds-muted-foreground` | `#6b6b74` | `#a1a1aa` | 辅助文字 |
| `--ds-border` | `#e4e4e7` | `#2b2b31` | 分隔线、面板边框 |
| `--ds-input` | `#8e8e97` | `#70707a` | 输入框、选择框边框 |
| `--ds-track` | `#8e8e97` | `#6b6b74` | 未选中开关轨道 |
| `--ds-ring` | `#71717a` | `#d4d4d8` | focus ring |
| `--ds-destructive` | `#dc2626` | `#f87171` | 危险操作、错误 |
| `--ds-destructive-foreground` | `#fafafa` | `#450a0a` | 危险按钮文字 |
| `--ds-success` | `#16a34a` | `#4ade80` | 成功图标/强调 |
| `--ds-warning` | `#d97706` | `#fbbf24` | 警告图标/强调 |
| `--ds-switch-thumb` | `#ffffff` | `#fafafa` | 未选中开关滑块 |
| `--ds-overlay` | `rgb(9 9 11 / 0.45)` | `rgb(0 0 0 / 0.7)` | Dialog 遮罩 |

成功/警告色只用于图标、边框和轻微底色，不用于大面积文字背景。警示信息仍以 `--ds-foreground` 为主文字色。

`--ds-input` 与 `--ds-track` 在两种主题下都按 3:1 的控件边界目标取值；浅色 `--ds-muted-foreground` 保留余量，避免在轻微着色背景（Alert、滚动提示）上低于 4.5:1。

#### 深色模式取值原则

深色主题只替换 Token 取值，不新增语义；取值遵循以下规则：

1. **不用纯黑纯白**：画布 `#09090b`，正文 `#fafafa`，避免深色下的眩光与视觉疲劳。
2. **用亮度差表达层级**：深色下阴影几乎不可见，因此卡片 `#18181b` 必须比画布更亮，靠明度而不是投影区分面板与页面。
3. **边框跟着表面走**：`--ds-border` 只做发丝分隔线，`--ds-input` 承担控件边界，两者的对比度要求不同，不共用一个值。
4. **状态色提亮**：深色底上的状态色整体提亮（`--ds-success`、`--ds-warning`、`--ds-destructive`），保证正文对比度 ≥ 4.5:1。
5. **危险色成对调整**：深色下 `--ds-destructive` 使用亮红，配套的 `--ds-destructive-foreground` 换成深色，保证实心危险按钮的文字同样达标（Material 3 深色主题的做法）。
6. **焦点环提亮**：`--ds-ring` 在深色下用亮灰，浅色下保持深灰，保证 `:focus-visible` 在两种主题下同样醒目。

### 排版

| Token | 值 | 用途 |
| --- | --- | --- |
| `--ds-font-sans` | 系统 UI 字体栈 | 全部 UI；不加载远程字体 |
| `--ds-font-mono` | 系统等宽字体 | 需要时用于代码/数值 |
| `--ds-text-xs` | 12px | 辅助说明、错误、Toast 描述 |
| `--ds-text-sm` | 13px | 按钮、输入、字段标签、Section 标题 |
| `--ds-text-base` | 14px | Panel 正文 |
| `--ds-text-lg` | 16px | Panel/Dialog 标题 |
| `--ds-leading-tight` | 1.25 | 标题 |
| `--ds-leading-snug` | 1.4 | 标签、Toast/Alert 标题 |
| `--ds-leading-normal` | 1.5 | 正文 |
| `--ds-icon-sm` | 14px | 按钮 spinner、Select 箭头 |
| `--ds-icon-xs` | 12px | Scroll hint 箭头 |
| `--ds-icon` | 16px | 按钮图标、Toast/Alert 图标 |

字重使用 400 / 500 / 600；不要用 700 以上制造层级。

### 间距与尺寸

| Token | 值 |
| --- | --- |
| `--ds-space-0-5` | 2px |
| `--ds-space-1` | 4px |
| `--ds-space-1-5` | 6px |
| `--ds-space-2` | 8px |
| `--ds-space-2-5` | 10px |
| `--ds-space-3` | 12px |
| `--ds-space-4` | 16px |
| `--ds-space-5` | 20px |
| `--ds-space-6` | 24px |
| `--ds-space-8` | 32px |
| `--ds-control-h-sm` | 28px |
| `--ds-control-h` | 32px |
| `--ds-control-h-lg` | 36px |
| `--ds-panel-width-settings` | 360px |
| `--ds-panel-width-wide` | 440px（设置面板居中） |
| `--ds-panel-width-operation` | 560px |
| `--ds-panel-width` | `var(--ds-panel-width-settings)`（兼容别名） |
| `--ds-panel-padding` | 16px |
| `--ds-panel-max-h-settings` | 70vh |
| `--ds-panel-max-h-operation` | 80vh |
| `--ds-panel-max-h` | `var(--ds-panel-max-h-settings)`（兼容别名） |
| `--ds-dialog-width` | 440px |
| `--ds-dialog-max-h` / `--ds-dialog-max-h-vh` | 640px / 80vh |
| `--ds-dialog-inset` | 32px |
| `--ds-switch-width` / `--ds-switch-height` | 36px / 20px |
| `--ds-switch-thumb-size` | 16px |
| `--ds-checkbox-size` | 16px |
| `--ds-accent-width` | 3px |
| `--ds-launcher-size` | 40px |
| `--ds-launcher-offset` | 20px |
| `--ds-toast-width` | 320px |
| `--ds-tooltip-max-w` | 240px |
| `--ds-tooltip-arrow-size` | 8px |
| `--ds-scroll-hint-height` | 56px |

### 圆角、边框、阴影、动效

| 类别 | Token | 值 |
| --- | --- | --- |
| 圆角 | `--ds-radius-sm` / `md` / `lg` / `xl` | 4 / 6 / 8 / 12px |
| 全圆 | `--ds-radius-full` | 9999px |
| 边框 | `--ds-border-width` | 1px |
| 焦点 | `--ds-ring-width` / `--ds-ring-offset` | 2px / 2px |
| 阴影 | `--ds-shadow-sm` / `md` / `lg` | 克制的三层 |
| 动效 | `--ds-duration-fast` / `base` / `slow` | 120 / 180 / 240ms |
| 缓动 | `--ds-ease` | `cubic-bezier(.2,0,0,1)` |

`prefers-reduced-motion: reduce` 会把动效时长归零；Toast/Tooltip 的入场动画也会关闭。

## 主题

- 默认 `light`；显式传入 `dark` 或 `system`。
- 主题通过 `data-ds-theme` 与 `color-scheme` 切换，组件不单独写颜色。
- 不自动跟随宿主网站；`system` 只跟随操作系统，不读取宿主 CSS。
- 主题切换时短暂禁用过渡，避免整页 UI 颜色闪动。
- 持久化由脚本负责，例如读取 `GM_getValue('theme')` 后传给 `mountUI`，切换时再写回。

```ts
const ui = mountUI({
  theme: (GM_getValue('theme') as 'light' | 'dark') ?? 'light',
});

function setTheme(theme: 'light' | 'dark') {
  ui.setTheme(theme);
  GM_setValue('theme', theme);
}
```

## 布局规则

### 面板规格

Panel 只有两档规格，不提供任意宽度：

| 规格 | `size` | 用途 | 宽度 | 最大高度 | 内容布局 |
| --- | --- | --- | --- | --- | --- |
| 设置面板 | `settings`（默认） | 脚本参数、开关、表单 | 360px（居中 440px） | 70vh | 单列 |
| 操作面板 | `operation` | 脚本具体功能、批量操作 | 560px | 80vh | 单列，或由内容自行分栏 |

- 两档共用 16px 内边距、标题与字段层级、滚动提示和底部操作区；差异只在宽度和最大高度。
- 设置面板只放参数，保持单列；操作面板承载功能，可以在一个网格容器里并排放置两个 Section；建议最小列宽约 220px，窄视口降为单列。
- 操作面板不是新组件，也不是模态：它仍是固定定位的 Panel，只是更大的功能画布。
- `position: 'center'` 只改变位置：视口正中、仍非模态；设置面板居中时放宽到 440px，操作面板保持自己的 560px。
- 同一角落只打开一个 Panel；在入口处先关闭另一个，避免两个面板重叠。

### 通用规则

1. **单列优先**：设置项默认单列；只有内容确实需要区分时才分栏。
2. **Section 分组**：相关设置放同一个 Section；Section 之间用分隔线，不要再套卡片。
3. **Field 组织**：label、description、control、error 由 Field 统一管理；不要手写重复结构。
4. **动作层级**：一个主操作；次要操作在左，主操作在右；危险操作独立分组。
5. **信息密度**：Panel 内边距 16px；Field 间距 6px；Section 间距 12–16px。
6. **避免重复**：Panel 已有标题时，第一个 Section 不再重复“设置”这类标题。
7. **浮层位置**：Panel 默认右下，入口在面板下方；需要把注意力集中到面板本身时用 `position: 'center'`（视口正中、仍非模态）。Toast 在右上，避免与入口重叠。
8. **响应式**：两档宽度都用 `min(<尺寸 Token>, calc(100vw - 2 * var(--ds-launcher-offset)))`，窄视口自动收窄，不横向溢出。
9. **滚动提示**：内容超出可视区域时，Panel/Dialog 底部显示渐隐提示，滚到底部后消失；文案默认取 `ui.labels.scrollHint`，可用 `scrollHint.text` 覆盖，`scrollHint: false` 关闭；提示是纯视觉元素，不抢焦点。

## 交互状态

| 状态 | 表现 |
| --- | --- |
| Hover | 背景或边框轻微变化；不改变布局 |
| Focus-visible | 2px `--ds-ring` 外轮廓；输入框使用边框 + 柔光环 |
| Active | 轻微下压或更深背景；不产生大幅位移 |
| Disabled | 透明度 0.5，`cursor: not-allowed` |
| Error | `aria-invalid="true"` + Field 错误文字；边框/焦点使用 destructive |
| Loading | 按钮内 spinner + `aria-busy="true"` + 禁用点击 |

不要用颜色单独表达错误；必须同时有文字（Field error / Alert / Toast description）。

## 反馈层级

- **Toast**：操作完成后的短暂结果；成功/信息默认 4s，警告 6s，错误 8s；可手动关闭；悬停/聚焦暂停计时。
- **Alert**：需要持续阅读的信息；不自动消失；危险说明放在操作附近。
- **Dialog**：需要用户明确决策；危险操作使用 destructive 确认按钮，默认聚焦取消。
- **Tooltip**：只解释图标、缩写或不直观的术语；不能承载唯一的关键信息。

## 可访问性

- 图标按钮必须有 `aria-label`；表单控件必须有 label 或 `aria-label`。
- Field 自动建立 `label[for]`、`aria-describedby`、`aria-invalid`。
- Switch 使用原生 checkbox + `role="switch"` + `aria-checked`；Checkbox 保留原生多选语义。
- Dialog 使用原生 `<dialog>` + `showModal()`；焦点圈定、Escape、背景 inert 由浏览器负责。
- Panel 打开时聚焦第一个控件，关闭时把焦点还给入口（Launcher）。
- Toast 通过常驻的 `aria-live` 播报区通知读屏：普通通知 polite，错误 assertive；可视 Toast 不自己声明 live role；容器不抢焦点。
- Tooltip 在 focus 时立即显示，Escape 关闭；隐藏时移除 `aria-describedby`。
- 所有交互元素都要有可见的 `:focus-visible` 样式。

## 不要做

- 不要用 `div` 模拟按钮、复选框或对话框。
- 不要把每个设置都做成卡片，或在一个 Panel 里嵌套多个 Panel。
- 不要用渐变、发光、过大的阴影和大面积品牌色。
- 不要用 Toast 显示表单校验错误；错误应留在字段旁边。
- 不要用 Tooltip 承载唯一说明；不要把危险操作放在没有确认的按钮上。
- 不要修改宿主的全局字体、按钮或布局样式。
