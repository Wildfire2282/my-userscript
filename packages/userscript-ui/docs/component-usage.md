# 组件使用指南

所有组件都从 `src/index.ts` 导入。组件工厂的第一个参数是 `mountUI()` 返回的 `ui`；这样样式、主题、浮层和生命周期都属于同一个 Shadow Root。

```ts
import {
  mountUI,
  createButton,
  createField,
  createInput,
  createPanel,
  createSection,
  createSwitch,
  createToast,
} from './src/index';

const ui = mountUI({ theme: 'light' });
const toast = createToast(ui);
```

每个句柄都有 `destroy()`，它只清理这一个组件（中止监听器、移除元素）；`ui.destroy()` 会调用所有组件的同一条 teardown。动态重建面板内容时先 `destroy()` 旧控件，不要只把节点从 DOM 里删掉。UI 销毁后再创建组件会抛错。

## Panel

面板外壳，提供两种规格：设置面板（默认，360px）和操作面板（560px）。固定定位，默认右下，带标题、描述、可滚动内容区和底部操作区。

```ts
const panel = createPanel(ui, {
  title: '页面增强设置',
  description: '修改后保存生效。',
  open: false,
  closeLabel: '关闭设置',
  position: 'bottom-right',
  onClose: () => console.log('closed'),
});
```

| 选项 | 说明 |
| --- | --- |
| `title` / `description` | 标题和辅助说明；分别建立 `aria-labelledby` / `aria-describedby` |
| `ariaLabel` | 无标题时的可访问名称 |
| `closeLabel` | 关闭按钮的 `aria-label` |
| `size` | `settings`（默认）或 `operation`；只切换宽度和最大高度 |
| `footer` | 内容或内容数组；也可以用 `panel.setFooter(content)` 随时替换，不传就隐藏底栏 |
| `open` | 初始是否打开，默认 `true` |
| `position` | `bottom-right` / `bottom-left` / `top-right` / `top-left` / `center`；居中时设置面板宽 `--ds-panel-width-wide`（440px），操作面板保持 560px |
| `scrollHint` | 默认开启；`false` 关闭，`{ text }` 覆盖 `ui.labels.scrollHint` |
| `autoFocus` | 默认 `true`；传 `false` 时打开面板不移动焦点 |
| `onOpen` / `onClose` | 打开/关闭回调 |

### 两种规格

| `size` | 用途 | 宽度 | 最大高度 | 内容布局 |
| --- | --- | --- | --- | --- |
| `settings`（默认） | 脚本参数、开关、表单 | 360px（居中 440px） | 70vh | 单列 |
| `operation` | 脚本具体功能、批量操作 | 560px | 80vh | 单列，或由内容自行分栏 |

```ts
const settings = createPanel(ui, { title: '页面增强设置' });

const operations = createPanel(ui, {
  size: 'operation',
  title: '页面操作',
  description: '扫描、导出等页面功能。',
  open: false,
});
```

- 两档规格共用 16px 内边距、标题层级、控件密度、滚动提示和底部操作区；差异只有宽度与最大高度。
- 不传 `size` 时保持原有设置面板行为；`panel.setSize('operation')` 可以在运行时切换，不重建 DOM 或控件。
- `position: 'center'` 只改变位置：视口正中、仍非模态；设置面板居中时放宽到 440px，操作面板保持 560px。
- 设置面板只放参数；操作面板承载页面功能。不要把大量常规设置塞进操作面板，也不要把密集操作塞进设置面板。
- 操作面板不会自动分栏。需要两栏时，在 `panel.body` 中放一个容器，用 `display: grid` 组合两个 `Section`；建议最小列宽约 220px，窄视口自动降为单列。示例见 `demo/showcase.ts`。
- 两种面板都是非模态浮层；同一角落同时打开会重叠。切换时由入口先关闭另一个，例如：
  ```ts
  const openOperations = createButton(ui, {
    label: '打开操作面板',
    onClick: () => {
      settings.close();
      operations.open();
    },
  });
  ```
- `createLauncher` 一次只绑定一个面板。共用一个入口时，把主面板交给 Launcher，另一个面板由面板内按钮或脚本事件切换，并在切换时关闭当前面板。
- 无标题的 `operation` 面板使用 `ui.labels.operation`（默认 `Operations`）作为可访问名称；显式 `ariaLabel` 始终优先。

```ts
panel.body.append(section.el);
panel.setFooter(save.el);

panel.open();
panel.close();
panel.toggle();
panel.isOpen();
panel.setTitle('新的标题');
panel.setDescription('新的说明');
panel.setFooter([reset.el, save.el]);
panel.setPosition('top-left');
panel.setSize('operation');
panel.onOpenChange((open) => console.log(open));
panel.destroy();
```

注意：

- Panel 会自动挂到 `ui.layers.base`，不要自己 append 到宿主页面。
- 默认打开；配合 Launcher 时传 `open: false`。
- `size` 只切换预设尺寸，DOM、控件、滚动位置和焦点都保持不变；无标题时 `aria-label` 会随规格更新。
- 非模态：不锁定页面滚动，也不加遮罩；需要用户集中决策时用 Dialog。`center` 只是把面板放到视口正中，交互语义与角落位置相同。
- 打开时聚焦 body 中第一个实际可聚焦控件，跳过隐藏、inert、禁用的候选；不需要这个行为时传 `autoFocus: false`。关闭时如果焦点仍在 Panel 内，会还给打开前的元素。打开状态下调用 `destroy()` 也会触发 `onClose` 并恢复焦点。
- 内容超出可视区域时，滚动区底部会显示渐隐提示，滚到底部后自动消失；默认文案取 `ui.labels.scrollHint`（默认英文），提示是纯视觉元素，不抢焦点。
- `setFooter()` 和手动重建 `panel.body` 只替换 DOM，不会 destroy 旧控件；动态替换前保留旧句柄并调用 `destroy()`，否则它们的监听器会保留到 `ui.destroy()`。
- 需要固定提示条或完全关闭时传 `scrollHint: false`。

## Section

把相关设置组织成一组，支持标题、描述和自动分隔线。

```ts
const section = createSection(ui, {
  title: '常规',
  description: '控制脚本在页面中的行为。',
});

section.body.append(field.el);
```

- 相邻 Section 之间自动显示 1px 分隔线。
- 不创建卡片，不重复 Panel 标题。
- `section.el` 是 `<section>`，`section.body` 是内容容器。

## Field

统一组织标签、控件、辅助说明和错误提示，并自动建立可访问性关联。

```ts
const apiInput = createInput(ui, {
  type: 'url',
  placeholder: 'https://example.com/api',
});

const apiField = createField(ui, {
  label: 'API 地址',
  description: '留空时使用脚本内置地址。',
  control: apiInput,
});

panel.body.append(apiField.el);
```

| 选项 | 说明 |
| --- | --- |
| `label` | 字段标签；会设置 `label[for]` |
| `description` | 辅助说明 |
| `error` | 初始错误 |
| `control` | 任何满足 `{ el, input }` 的 `FormControl` |
| `inline` | 标签在左、控件在右；用于 Switch / Checkbox 行 |
| `id` | 控件没有 id 时使用 |

```ts
apiField.setError('请输入有效的 http(s) 地址。');
apiField.setError(undefined);
apiField.setDescription('新的说明');
```

注意：

- 输入类 / Select 用默认 stacked 布局；Switch / Checkbox 用 `inline: true`。
- 错误会设置 `aria-invalid`，并把错误文字加入 `aria-describedby`。
- `setDescription()` 支持创建后再添加或移除说明；Field 只管理自己的描述/错误 ID，不覆盖外部 `aria-describedby` 关联。
- 不要在 Field 里再手写 label 或错误提示。

## Button

执行明确操作。

```ts
const save = createButton(ui, {
  label: '保存',
  variant: 'primary',
  onClick: () => toast.success('已保存'),
});

const remove = createButton(ui, {
  label: '删除',
  variant: 'destructive',
});

// 图标是调用方提供的任意 Element；库不绑定图标集。
const refreshIcon = document.createElement('span');
refreshIcon.textContent = '↻';

const refresh = createButton(ui, {
  size: 'icon',
  variant: 'ghost',
  ariaLabel: '刷新',
  icon: refreshIcon,
  onClick: () => toast.info('已刷新'),
});
```

| 选项 | 值 |
| --- | --- |
| `variant` | `primary` / `secondary` / `outline` / `ghost` / `destructive` |
| `size` | `sm` / `md` / `lg` / `icon` |
| `type` | 默认 `button`；只有明确需要提交表单才用 `submit` |
| `disabled` / `loading` | 禁用 / 加载状态 |
| `icon` | 放在文字前的 Element（通常是 SVG）；图标由调用方提供，库不内置图标集 |
| `iconOnly` | 纯图标按钮；必须提供 `ariaLabel`，可与 `sm` / `md` / `lg` 组合为对应尺寸的方形按钮 |
| `onClick` | 点击回调；监听器随 UI 销毁 |

```ts
save.setLoading(true);
await doSave();
save.setLoading(false);
```

- loading 会设置 `aria-busy="true"`、`aria-disabled="true"` 并禁用点击。
- 一个区域通常只保留一个 primary；危险操作使用 destructive。
- 不要用 Button 代替 Switch / Checkbox / Select。

## Input / Textarea

输入文字、数值或短参数。

```ts
const api = createInput(ui, {
  type: 'url',
  placeholder: 'https://example.com/api',
  autocomplete: 'off',
  onInput: (value) => console.log(value),
});

const count = createInput(ui, {
  type: 'number',
  value: '50',
  min: 1,
  max: 200,
  step: 1,
  inputMode: 'numeric',
});

const notes = createTextarea(ui, {
  placeholder: '备注',
  rows: 4,
});
```

| 选项 | 说明 |
| --- | --- |
| `type` | `text` / `email` / `password` / `number` / `search` / `url` / `tel` |
| `value` / `placeholder` / `name` / `id` | 原生属性 |
| `disabled` / `readonly` / `required` | 原生状态 |
| `invalid` | 初始 `aria-invalid` |
| `autocomplete` / `inputMode` | 原生提示 |
| `min` / `max` / `step` | 数字输入 |
| `ariaLabel` | 无 Field label 时的可访问名称 |
| `onInput` / `onChange` | 输入 / 失焦变化 |

句柄：`{ el, input, setValue, getValue, setInvalid, destroy }`。`el` 与 `input` 都是原生元素。

- 长文本用 `createTextarea`，不引入富文本编辑器。
- 校验错误优先放在 Field 上；`setInvalid` 只用于独立使用的输入框。控件自己持有无效状态（`data-ds-invalid`），Field 用 `data-ds-field-invalid` 叠加错误，`aria-invalid` 由两边求并集；清除错误不会抹掉 `setInvalid(true)`，之后调用 `setInvalid(false)` 也不会抹掉仍显示的错误。

## Select

从有限互斥选项中选择一个，基于原生 `<select>`。

```ts
const theme = createSelect(ui, {
  options: [
    { value: 'light', label: '浅色' },
    { value: 'dark', label: '深色' },
  ],
  value: 'light',
  onChange: (value) => ui.setTheme(value as 'light' | 'dark'),
});
```

| 选项 | 说明 |
| --- | --- |
| `options` | `{ value, label, disabled? }[]` |
| `value` | 初始值 |
| `placeholder` | 空值占位项（disabled） |
| `name` / `id` / `disabled` / `required` / `invalid` | 原生属性 |
| `ariaLabel` | 无 Field label 时的可访问名称 |
| `onChange` | 值变化回调 |

句柄：`{ el, input, setValue, getValue, setOptions, setInvalid }`。

- `el` 是外层定位容器，`input` 是原生 select；Field 会自动使用 `input` 建立 label。
- `setOptions` 会尽量保留当前值；没有匹配项时回到 placeholder 或第一项。
- 空字符串也是合法选项值；有 placeholder 时可用 `setValue('')` 恢复占位状态。程序更新不触发 `onChange`，disabled 或不存在的值不会覆盖当前选择；初始 `value` 也不会选中 disabled 项。
- 不实现自定义下拉菜单；选项很多时仍应优先考虑搜索框或拆分设置。

## Switch

立即生效的二元设置，使用原生 checkbox + `role="switch"`。

```ts
const enabled = createSwitch(ui, {
  checked: true,
  onChange: (checked) => console.log(checked),
});

const field = createField(ui, {
  label: '启用页面增强',
  description: '关闭后恢复页面原始行为。',
  control: enabled,
  inline: true,
});
```

句柄：`{ el, input, setChecked, isChecked }`。

- `el` 是轨道容器，`input` 是隐藏但可聚焦的原生 checkbox。
- 键盘 Space 切换；点击整行 label 可切换。
- 只用于“立即生效”的二元功能。需要随表单一起提交的选项用 Checkbox。

## Checkbox

多个可独立勾选的项目，或需要明确提交的状态。

```ts
const copy = createCheckbox(ui, {
  checked: true,
  onChange: (checked) => console.log(checked),
});

const field = createField(ui, {
  label: '导出后复制到剪贴板',
  description: '只复制本次导出的内容。',
  control: copy,
  inline: true,
});
```

句柄：`{ el, input, setChecked, setIndeterminate, isChecked }`。

- 支持 `indeterminate`（会设置 `aria-checked="mixed"`）；用户点击后会在 `onChange` 前清除混合状态，`setChecked()` 也会清除混合状态，`value: ''` 保留为空字符串提交。
- 多个选项放在同一个 Section 中，每项一个 Field；不要用 Select 代替。
- 需要“全选/部分选中”时，父级 Checkbox 用 indeterminate。

## Toast

短暂的操作结果通知。每个 UI 创建一个控制器并复用。

```ts
const toast = createToast(ui, { max: 4 });

toast.success('设置已保存');
toast.info('已恢复默认值', { description: '演示环境不会写入存储。' });
toast.warning('网络较慢', { duration: 6000 });
toast.error('保存失败', { description: '请检查 API 地址。' });
```

| 选项 | 说明 |
| --- | --- |
| `title` / `description` | 标题和描述；至少一个 |
| `variant` | `success` / `info` / `warning` / `error` |
| `duration` | 毫秒；`0` 表示不自动关闭 |
| `id` | 相同 id 会替换旧 Toast |
| `onDismiss` | 关闭回调 |

默认时长：成功/信息 4s，警告 6s，错误 8s。最多同时显示 4 条（可配置），新的在最上方；悬停或聚焦时暂停计时。

控制器选项：`max`、`regionLabel`（默认 `Notifications`）、`dismissLabel`（默认 `Dismiss notification`），可用于本地化通知区域和关闭按钮。

```ts
const handle = toast.show({ title: '处理中', duration: 0 });
handle.dismiss();
toast.dismiss(handle.id);
toast.clear();
```

- Toast 容器固定在右上，不抢焦点。同一 UI 打开 Dialog 时，容器会移动到最上层 Dialog 内，保证模态期间仍可见、可关闭。
- 可视 Toast 本身不声明 live role；控制器内有两个常驻播报区，普通通知走 `aria-live="polite"`，错误走 `aria-live="assertive"`，避免“先有内容、后插入 live region”的漏播风险。
- 悬停与焦点都结束后才恢复剩余时长；`duration: 0` 的常驻通知不会因为悬停或失焦被移除；移除通知立即清理其监听器和计时器。
- `destroy()` 后不得继续 `show()` 或调用通知快捷方法，否则抛错；需要再次使用时创建新的控制器。
- 需要持续阅读的信息用 Alert，不要用 Toast。

## Alert

持续显示的提示、警告和错误。

```ts
const alert = createAlert(ui, {
  variant: 'warning',
  title: '此操作不可撤销',
  description: '确认后会删除当前脚本的全部本地配置。',
  dismissible: true,
  dismissLabel: '关闭提示',
});

section.body.appendChild(alert.el);
```

| 选项 | 说明 |
| --- | --- |
| `variant` | `info` / `success` / `warning` / `error` |
| `title` / `description` | 文本内容 |
| `action` | 可选的按钮/节点 |
| `dismissible` | 是否显示关闭按钮 |
| `onDismiss` | 关闭回调 |

- 错误使用 `role="alert"`，警告使用 `role="status"`，信息/成功不设置 live role。
- Alert 是内联元素，不会自动挂载；放在相关设置附近。句柄为 `{ el, dismiss, destroy }`：`dismiss()` 是用户关闭（会调用 `onDismiss`），`destroy()` 是程序化 teardown（**不会**调用 `onDismiss`）。
- 不要用 Alert 做 3 秒消失的操作结果。

## Dialog

需要用户明确决策或集中处理的任务，基于原生 `<dialog>`。

```ts
const dialog = createDialog(ui, {
  title: '清空本地设置？',
  description: '这会删除当前脚本的全部配置，且无法撤销。',
  dismissible: true,
  actions: [
    { label: '取消', value: 'cancel', variant: 'secondary', autofocus: true },
    { label: '清空', value: 'confirm', variant: 'destructive' },
  ],
});

const result = await dialog.open();
if (result === 'confirm') {
  // ...
}
dialog.destroy();
```

| 选项 | 说明 |
| --- | --- |
| `title` | 必填；建立 `aria-labelledby` |
| `description` | 可选；建立 `aria-describedby` |
| `content` | 文本或 DOM 节点 |
| `actions` | `{ label, value, variant?, autofocus? }[]` |
| `dismissible` | 是否允许 Escape / 遮罩关闭，默认 `true` |
| `scrollHint` | 默认开启；`false` 关闭，`{ text }` 覆盖 `ui.labels.scrollHint` |
| `onOpen` / `onClose` | 生命周期回调 |

`open()` 返回 `Promise<string | null>`：点击 action 得到对应 `value`，Escape/遮罩/关闭按钮得到 `null`。`close()` 同步释放滚动锁并结束本次结果，可立即重开；未打开时关闭不触发回调。`destroy()` 或 `ui.destroy()` 会以 `null` 结束仍打开的结果。

危险确认优先用 `confirmDialog`：

```ts
const confirmed = await confirmDialog(ui, {
  title: '清空本地设置？',
  description: '此操作不可撤销。',
  confirmLabel: '清空',
  cancelLabel: '取消',
  destructive: true,
});

if (confirmed) toast.success('本地设置已清空');
```

- 原生 `showModal()` 提供焦点圈定、Escape、背景 inert 和 top layer。
- 打开时临时锁定页面滚动，最后一个 Dialog 关闭后恢复原有 overflow 值和 `!important`；多个 Dialog 用共享计数。
- 默认关闭后焦点回到打开前的元素。
- 需要强制选择时传 `dismissible: false`（不显示关闭按钮，Escape/遮罩不关闭）。
- 只在点击 Dialog 边界外的遮罩时关闭，内部留白/边框不会取消。原生 `showModal()` 失败会释放滚动锁并抛错，不静默退化为非模态。
- 内容超出可视区域时，滚动区底部会显示渐隐提示，滚到底部后自动消失；默认文案取 `ui.labels.scrollHint`。

## Tooltip

解释不直观的图标或术语。

```ts
const tooltip = createTooltip(ui, launcher.el, {
  content: '打开或关闭设置面板',
  placement: 'left',
  delay: 400,
});
```

| 选项 | 说明 |
| --- | --- |
| `content` | 纯文本；必填 |
| `placement` | `top` / `bottom` / `left` / `right`，自动翻转避免出界 |
| `delay` | hover 显示延迟，默认 400ms；focus 立即显示 |
| `hideDelay` | 离开后的隐藏延迟，默认 80ms |

句柄：`{ el, show, hide, destroy }`。

- 只用于补充说明；核心信息必须在界面上可见。
- 会自动设置 `aria-describedby`，只管理自身 ID；隐藏/销毁时保留消费者的其他描述。Escape 只关闭当前 Tooltip。
- 目标应可聚焦；disabled 元素不触发鼠标事件，必要时包一层。目标位于已打开的 Dialog 内时，Tooltip 会挂到该 Dialog 上，避免被 top layer 盖住。
- 内容为纯文本，不支持 HTML 字符串。
- `hide()` / `destroy()` 会取消尚未执行的延迟显示，销毁后不会重新显示。

## Floating Launcher

用户脚本在宿主页面中的独立入口。

```ts
const launcher = createLauncher(ui, {
  panel,
  label: '打开设置',
  closeLabel: '关闭设置',
  position: 'bottom-right',
});
```

| 选项 | 说明 |
| --- | --- |
| `label` | 关闭状态下的 `aria-label` |
| `closeLabel` | 打开状态下的 `aria-label` |
| `panel` | 传入后自动开关 Panel，并同步 `aria-expanded` |
| `position` | 四个角；同时设置 Panel 的位置 |
| `icon` | 自定义图标 Element；默认滑块图标 |
| `onClick` | 额外点击回调 |

句柄：`{ el, setExpanded, destroy }`。

- 自动挂到 `ui.layers.base`，40px 圆形按钮，带安全区偏移。
- 不提供拖拽；需要换位置时通过 `position` 或自定义 offset Token。
- 点击会阻止冒泡，避免触发宿主页面的点击处理。
- 面板关闭时焦点回到 Launcher。
- 不要覆盖宿主页面的核心操作区；默认右下 20px。

## 组合示例

```ts
const ui = mountUI({ theme: 'light' });
const toast = createToast(ui);

const panel = createPanel(ui, {
  title: '页面增强设置',
  open: false,
});

const general = createSection(ui, { title: '常规' });

const enabled = createSwitch(ui, { checked: true });
general.body.append(
  createField(ui, {
    label: '启用页面增强',
    description: '关闭后恢复页面原始行为。',
    control: enabled,
    inline: true,
  }).el,
);

const mode = createSelect(ui, {
  options: [
    { value: 'standard', label: '标准模式' },
    { value: 'quiet', label: '静默模式' },
  ],
  value: 'standard',
});
general.body.append(
  createField(ui, { label: '运行模式', control: mode }).el,
);

panel.body.append(general.el);

const save = createButton(ui, {
  label: '保存',
  onClick: () => {
    save.setLoading(true);
    window.setTimeout(() => {
      save.setLoading(false);
      toast.success('设置已保存');
    }, 400);
  },
});
panel.setFooter(save.el);

createLauncher(ui, { panel, label: '打开设置', closeLabel: '关闭设置' });
```
