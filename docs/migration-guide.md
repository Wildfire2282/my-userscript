# 脚本迁移指南

> 面向 Agent 的执行文档。维护者无需阅读，人类入口见 `README.md`。

把 `legacy/` 里的原版脚本改写成基于 `@ui` 的实现。原版保留在仓库里作为行为对照，迁移完成、
线上验证过后再删除。

## 目标

- UI 全部来自 `@ui`（`packages/userscript-ui/src`），不再手写按钮 / 面板 / Toast / 遮罩；
- 颜色、尺寸、间距只用 `--ds-*` Token；
- 单个页面只 `mountUI()` 一次，销毁时 `ui.destroy()`；
- 脚本业务逻辑与 UI 分层，便于单独测试。

## 步骤

### 1. 建入口

```text
scripts/<slug>/
├─ userscript.meta.js     # 已存在，改 @version
├─ src/
│  ├─ main.ts             # 入口：挂载 UI、绑定业务
│  ├─ settings.ts         # GM_setValue/GM_getValue 封装（可选）
│  └─ features/           # 业务模块（可选）
└─ legacy/                # 对照用，迁移完成后删除
```

`src/main.ts` 的最小形态：

```ts
import { createLauncher, createPanel, createToast, mountUI } from '@ui';

const ui = mountUI({
  theme: 'light',
  labels: { close: '关闭', settings: '设置', notifications: '通知' },
});
const toast = createToast(ui);

const panel = createPanel(ui, { title: '设置', open: false });
createLauncher(ui, { panel, label: '打开设置', closeLabel: '关闭设置' });

window.addEventListener('pagehide', () => ui.destroy(), { once: true });
```

### 2. 对着原版列 UI 清单

打开 `legacy/*.user.js`，把界面元素逐项映射到组件，先写下来再动手：

| 原版实现 | 迁移到 |
| --- | --- |
| 悬浮按钮 / 入口按钮 | `createLauncher` |
| 自绘模态、遮罩卡片 | `createPanel`（设置类）或 `createDialog`（需要用户决策） |
| 分组标题 + 分隔线 | `createSection` |
| label + 控件 + 说明 | `createField` |
| 手写下拉 / 复选 / 开关 | `createSelect` / `createCheckbox` / `createSwitch` |
| 底部保存 / 取消 | `createButton` + `panel.setFooter()` |
| 操作结果提示 | `createToast`（创建一次复用） |
| 持续可见的说明或错误 | `createAlert` |
| 图标说明 | `createTooltip` |
| 危险操作 | `confirmDialog` |

`AGENTS.md` 第 3 节有完整的选型表；`docs/component-usage.md` 有每个组件的签名与示例。

### 3. 拆业务逻辑

- GM 存储、网络、DOM 抓取等副作用留在 `src/` 的普通模块里，UI 模块只接收数据与回调；
- 设置项默认值集中在一处，`mountUI` 前读取主题并显式传入（不要依赖宿主页面主题）；
- 原版里的全局快捷键、页面级监听要确认是否保留；保留时用 `AbortController` 管理，随脚本卸载清理。

### 4. 迁移 UI

- 先搭外壳（Launcher + Panel + Section），再逐个填 Field；
- 所有文本用 `textContent` / DOM API，禁止 `innerHTML`（设计体系的 lint 规则会拦）；
- 原版的硬编码色值映射到现有 Token，确实没有对应语义时才在 `mountUI({ tokens })` 里覆盖；
- 空状态、错误状态用 `createAlert` 或 Field 的 `error`，不要临时拼 DOM。

### 5. 构建与验证

```powershell
npm run build <slug>
```

生成 `scripts/<slug>/dist/<slug>.user.js`，装进 Tampermonkey 后至少检查：

- [ ] 主要交互与旧版一致（复制、跳转、筛选等业务行为没有退化）；
- [ ] 浅色 / 深色主题都可读（`ui.setTheme('dark')` 试一次）；
- [ ] 页面滚动、键盘 Escape、焦点圈定正常；
- [ ] SPA 路由切换后 UI 没有重复挂载、没有残留监听；
- [ ] 宿主页面样式没有被污染（看 `document.head` 里没有新增全局 style）。

### 6. 收尾

- 改 `userscript.meta.js` 的 `@version` 与 `package.json` 的 `version`（保持一致）；
- 删除 `legacy/`，更新该包 `README.md` 的状态为「已迁移」；
- 上传 GreasyFork，确认 `@downloadURL` / `@updateURL` 指向同一脚本 ID；
- `npm run sync` 刷新 `scripts.json` 与 README 表格，提交。

## 常见坑

- **重复挂载**：`mountUI()` 放在模块顶层只执行一次；路由变化重新 `panel.open()`，不要重建 UI。
- **忘了 destroy**：`pagehide` 或脚本卸载路径里调用 `ui.destroy()`，否则监听器和滚动锁残留。
- **直接改内部 DOM**：`panel.footer.hidden = true` 这类写法不生效或绕过状态，用 `setFooter()` 等句柄方法。
- **重复 Toast**：`createToast(ui)` 每个 UI 只建一次，规则是「每次 UI 重建时重建」。
- **宿主样式穿透**：不要给宿主元素加类名或全局 CSS；一切挂在 Shadow Root 内。
- **GM 权限**：沿用原版 `@grant`，删掉不再使用的（例如不再 `GM_addStyle` 就不用授权）；纯 DOM UI 用 `@grant none`。
- **元数据漂移**：改版本时三处要一致：`userscript.meta.js`、`package.json`、GreasyFork 上的发布版本。

## 类型检查（可选）

Vite 构建不做类型检查。需要时在包内加 `tsconfig.json`，继承设计体系的配置并把 `@ui` 指到
`packages/userscript-ui/src/index.ts`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@ui": ["../../packages/userscript-ui/src/index.ts"] }
  },
  "include": ["src"]
}
```
