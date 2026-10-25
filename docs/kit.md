# 开发套件（userscript kit）

> 读者：Agent。人类入口仍是根目录 `README.md`。
> 状态：方案已定，待执行（2026-10-25）。执行时更新第 5 节状态列；全部完成后删掉状态列与迁移表，只保留设计、模块规则与技术依据。

## 1 目标与边界

把现有的「UI 框架 + 少量共享工具」扩展成脚本开发套件，让新脚本只需要写业务：

1. 启动、生命周期、菜单、安装锁、设置读写收敛到 `@shared`。
2. 界面编排（懒挂载、Toast、面板、设置表单）收敛到 `@ui`。
3. 已确认的通用判定（可编辑区域、真实事件目标、URL、视口夹紧）收敛为纯函数。

必须承认的事实：**每个脚本独立打包，抽套件不会减小下载体积**。收益是去掉重复源码、把安全敏感逻辑（剪贴板、可编辑判定、URL 过滤）集中到一处、修掉已确认的缺陷。任何以「减小体积」为理由的抽取都不成立；只有删掉死代码才算收益。

非目标（各自只有 1 个脚本在用，抽了就是猜）：

| 能力 | 当前实现 | 触发条件 |
| --- | --- | --- |
| 打开新标签页 / 图片查看器 | `scripts/super-drag/src/features/openers.ts` | 第二个脚本需要打开新标签页 |
| 网络旁听（fetch/XHR） | `scripts/youtube-transcript-copy/src/transcript/network.ts` | 第二个脚本要读接口数据，且需先解决多脚本重复包装 |
| URL / SPA 变化监听 | `scripts/youtube-transcript-copy/src/features/spa.ts` | 第二个单页站点脚本（可评估 `@grant window.onurlchange`） |
| 可拖动悬浮按钮 | `scripts/youtube-transcript-copy/src/ui/button.ts` | 第二个脚本需要自由定位入口 |
| 选区几何 / 原生 DnD 传感器 / 站点黑白名单 / 复制格式 | 各 1 处 | 出现第二个消费者 |
| 转写提取与策略链、站点选择器、搜索引擎模板、勾选集合运算 | 各 1 处 | 永不进套件 |

## 2 结构与依赖规则

```text
packages/shared/src/            @shared = 套件运行时（无界面）
  host/       gm.ts  storage.ts  clipboard.ts  settings-store.ts
  settings/   define-settings.ts
  runtime/    boot.ts  menu.ts  frame.ts  logger.ts
  dom/        target.ts  traverse.ts  position.ts
  url/        url.ts
  index.ts    门面：只导出 createUserscript / defineSettings 与类型
packages/userscript-ui/src/     @ui = 表现层 + 界面编排
  components/ 现有 27 个组件
  core/       mount / lifecycle / labels / …
  patterns/   app-host.ts  settings-form.ts
scripts/<slug>/src/             main.ts（接线）+ features/ + ui/
```

规则：

1. `@ui` 不依赖 `@shared`；`@shared` 不依赖 `@ui`。界面编排放 `@ui`，宿主与生命周期放 `@shared`，脚本自己接线。
2. 别名仍为 `@ui` / `@shared`，不做重命名：别名在 `tsconfig.json`、`tools/build.mjs`、`vitest.config.ts` 三处声明，重命名是零收益 churn。
3. 套件模块在模块级不得有副作用（不写全局、不注册监听、不读存储），否则树摇失效。
4. 脚本只导入实际使用的导出；套件不建「为将来预留」的空模块。
5. 套件模块**不得要求新增 `@grant`**；能力缺失时降级，风格对齐 `host/gm.ts`（读不到给默认值，写不进去返回 false，不抛错）。

## 3 模块契约

| 模块 | 导出 | 消费者 | 语义 |
| --- | --- | --- | --- |
| `@ui` | `ZH_LABELS` | 4 | 中文文案预设，键覆盖 `UILabels` 全部 9 项（含 `operation`） |
| `@shared/settings` | `defineSettings({ key, defaults, normalize? })` | 4 | 包装 `mergeDefaults` + `createSettingsStore`，返回 `get/update/reset/onChange`；`normalize` 仍由脚本提供 |
| `@shared/runtime` | `createUserscript(options)` | 4 | 启动兜底、安装锁、frame 判断、菜单注册、页面级 `signal`、`pagehide` 清理 |
| `@shared/runtime/frame` | `isTopFrame` / `siteKey` / `installOnce` | 3 | `siteKey` 取顶层 hostname；跨域回退 `ancestorOrigins`，再回退本帧；无 hostname 用 protocol |
| `@shared/runtime/logger` | `createLogger(slug)` / `guard(label, fn)` | 4 | 统一 `[slug]` 前缀与兜底 |
| `@ui/patterns/app-host` | `createUiHost({ theme })` → `ensure/destroy` | 4 | 整页只 `mountUI()` 一次；Toast 由需要的脚本各自单例（统一引用会把 toast 拉进不用它的产物，+11KB）；面板懒建留在脚本 |
| `@ui/patterns/settings-form` | `createSettingsForm(ui, schema, options)` | 3 | 声明式设置面板，见下方硬边界 |
| `@shared/dom` | `isEditableField` / `isInsideEditable` / `deepActiveElement` | 2 | 单元素判定（super-drag 语义 + `plaintext-only`）与祖先链判定（selection-copy 全语义）并存；`realTarget` / `queryAllDeep` 各只有一处用，留脚本内 |
| `@shared/url` | （未建） | 0 | `resolveUrl` / `extractUrlFromText` / `isImageUrl` 各只有一处用（准入要求两处）；`isBlockedScheme` 与 super-drag `isIgnorableHref` 的 `#` 语义不同，硬合并改行为；留脚本内 |
| `@shared/dom/position` | `clamp(value, min, max)` / `clampToViewport(box, viewport, margin)` | 2 | `max < min` 时贴左上角 |

`createUserscript` 契约：

```ts
createUserscript<T>({
  slug: string;
  settings: SettingsDefinition<T>;
  menus?: Array<{ label: string; run: () => void; topFrameOnly?: boolean }>;
  topFrameOnly?: boolean;   // 默认 false：selection-copy 需要在每个 iframe 里运行
  installLock?: boolean;    // 默认 true：documentElement 属性锁
  runAt?: 'document-start' | 'document-end';  // 默认 document-end
  onStart?: () => void | (() => void);        // 脚本执行时同步运行，可返回清理函数
  onReady?: (kit) => void;                    // DOM 就绪后运行
});
```

- `onStart` 同步执行，供需要抢在页面 JS 之前的行为（转写复制的网络钩子）使用。
- `destroy()` 幂等，`pagehide` 且 `persisted === false` 时自动调用。
- 菜单回调统一 `try/catch` + 前缀告警；注册失败只告警，不阻断脚本主功能。

`createSettingsForm` 硬边界（防止长成第二套框架）：

- 字段只有 `switch | select | input`；布局只有 `inline | stacked`。
- 动态能力只有两个回调：`visible(key, values)` 与 `validate(key, value, values)`。
- 派生文案、动态选项表、按钮型动作（如「清空策略记忆」）不进 schema，留在脚本。
- 两种提交模型：`immediate`（改动即保存）与 `draft`（`onSubmit` 返回 false 时留在面板）。

## 4 工程护栏

1. 模块准入：同一次提交里至少迁移两个脚本，否则留在脚本内。
2. 树摇：每步构建后用哨兵字符串确认未使用模块没进产物（见第 8 节实测方法）。
3. 体积：每步对比 raw/gzip，任一脚本涨幅 > 1KB 必须解释。
4. 授权：`@name`、`@match`、`@include`、`@grant` 全程零变动；需要授权的改动单列确认项。
5. 生命周期：监听挂在 `kit.signal` 或 `createScope(ui)`；`destroy()` 幂等；禁止「写了 cleanup 不接线」。
6. 错误边界：启动、菜单回调、面板打开三层捕获；界面失败不得影响脚本主功能。
7. 不新建第二套浏览器夹具：套件行为通过 4 个脚本现有场景验证，纯逻辑用单测。

## 5 迁移步骤

一次一个提交，`main` 始终可构建可安装。每步完成后跑 `npm run build <slug>` 与 `npm run check`，把净删除行数写进提交信息。

| 步 | 内容 | 触及 | 行为变化 | 净变化（估算） | 状态 |
| --- | --- | --- | --- | --- | --- |
| 0 | `@shared` 目录分组、门面 `index.ts`、新增 `packages/shared/AGENTS.md`、`architecture.md` 分层与决策 | 移动 + 文档 | 无（产物逐字节不变） | 0 | 已完成（2026-10-25；构建切到 `rolldownOptions`，产物逐字节不变见提交内取证） |
| 1 | `ZH_LABELS` + `createLogger` | `@ui/core/labels.ts`、`@shared/runtime/logger.ts`、4 个脚本 UI | 仅 `operation` 补中文 aria 名 | −90 | 已完成（2026-10-25） |
| 2 | `defineSettings` | 3 个 `settings.ts`（youtube 双键 `pos`/`strategy` 带缓存与删除，不在范围内） | 无 | −40 | 已完成（2026-10-25） |
| 3 | `createUserscript`，顺序 super-drag → capture-links → youtube → selection-copy | 4 个 `main.ts` | 卸载时真正清理监听；补启动兜底 | −230 | 已完成（2026-10-25） |
| 4 | `createUiHost`，顺序 capture-links → youtube → selection-copy → super-drag | 3 个 `ui/app.ts` + 1 处内联 | 无（Toast 改为按需单例，不进不用它的产物） | −125 | 已完成（2026-10-25） |
| 5 | `createSettingsForm`，顺序 capture-links → selection-copy → super-drag | 3 个设置面板 | 无 | −300 | 已完成（2026-10-25） |
| 6 | `dom`（可编辑判定×2、焦点穿透）/`position`（夹紧原语）纯函数搬入；`url` 按准入留脚本内 | 3 个脚本 features | super-drag `contenteditable=""`/`plaintext-only` 目标此前误判为不可编辑，现交还页面（修复） | −80 | 已完成（2026-10-25） |
| 7 | 清理死代码、脚本 `README.md` / `CHANGELOG.md`、四条 patch 版本 | 文档 + `package.json` | 无 | — | 待做 |

每步的行为等价清单（逐脚本核对六项）：字段与顺序、文案、默认值、保存时机、存储键（`settings` / `pos` / `strategy` / `selection-copy:config.settings`）、菜单项与快捷键。

步骤内的实现要求：

- 第 0 步顺带把 `tools/build.mjs` 的 `rollupOptions` 改为 `rolldownOptions`（Vite 8 已把前者标记为废弃别名），核对 banner 与产物体积不变。
- 第 3 步中 youtube 的 `installNetworkCapture` 必须留在 `onStart`；selection-copy 必须传 `topFrameOnly: false`。
- 第 5 步只迁表单；youtube 的设置面板是「清空策略记忆」按钮，不是表单，保持脚本内实现。

## 6 验证矩阵

| 层 | 手段 | 覆盖 |
| --- | --- | --- |
| 纯逻辑 | Vitest（现有 happy-dom 单配置，不新增 `projects`） | URL 解析与黑名单、中文标点提链、夹紧边界、可编辑判定、`siteKey` 跨域回退 |
| DOM 交互 | `tests/*.test.ts` | 表单两种模式、动态显隐、校验错误、焦点与关闭 |
| 真实浏览器 | `npm run test:browser` | 菜单 → 面板 → 保存 → 生效；selection-copy 的 iframe 用例；youtube 的 document-start 时序 |
| 产物 | `npm run build` + 哨兵字符串 | 未用模块不入产物；体积不涨 |
| 元数据 | `npm run check:meta` | 授权与匹配地址零变化 |

## 7 风险

| 风险 | 处置 |
| --- | --- |
| `createSettingsForm` 长出第二套框架 | 字段白名单 + 只允许两个回调；扩字段必须两个脚本同时需要 |
| `topFrameOnly` 设错导致 iframe 内失效 | 默认 false；逐脚本显式传参；浏览器场景补 iframe 用例 |
| boot 化延迟 document-start 阶段的网络钩子 | `onStart` 同步执行；第 3 步验证首屏网络缓存命中 |
| `pagehide` 清理影响 bfcache | 仅在 `persisted === false` 时清理；清理幂等 |
| 套件成为「改一处影响四个脚本」的单点 | 每步小提交 + 全量 `npm run check` + 先迁简单脚本 |
| Rolldown 与 Rollup 的 banner / 树摇差异 | 第 0 步核对产物头尾与体积 |

## 8 技术依据

Context7 核对结论：

| 结论 | 来源 | 影响 |
| --- | --- | --- |
| 每个 `GM_*` 必须单独 `@grant`；缺省等于空列表 | <https://www.tampermonkey.net/documentation.php?q=grant> | 套件模块不得隐式要求授权 |
| `GM_addValueChangeListener` 可跨标签页通知（回调带 `remote`），但需独立授权 | <https://www.tampermonkey.net/documentation.php?q=GM_values> | 跨标签页设置同步本期不做，继续「每次 get 直读存储」 |
| `build.rollupOptions` 是 `rolldownOptions` 的废弃别名 | <https://vite.dev/config/build-options> | 第 0 步改写构建配置 |
| lib 模式下 iife/umd 不支持多入口，且必须提供 `name` | <https://vite.dev/guide/build> | 维持一脚本一入口一产物 |
| `environmentMatchGlobs` 已废弃，多环境用 `test.projects` | <https://vitest.dev/guide/projects> | 不改造：纯逻辑在 happy-dom 下可测，不引入第二套配置 |

本仓库实测（2026-10-25）：

- `npm run build capture-links` → 103.4 KB raw / 27.1 KB gzip。
- 产物含 `createCheckbox`（脚本确实用了），不含 `createAlert` / `createTooltip` / `createDialog` 的函数体；未使用组件的 CSS 规则也不存在。说明桶导入 + 路径别名下树摇有效，哨兵字符串可以这样检查：

```bash
node -e "const s=require('fs').readFileSync('scripts/capture-links/dist/capture-links.user.js','utf8');console.log('createAlert', s.includes('createAlert'))"
```

## 9 待确认

1. 是否顺带补 `operation` 中文文案（默认补）。
2. 是否把 `tools/build.mjs` 切到 `rolldownOptions`（默认切，产物不变）。
3. 本次是否发布四条 patch 版本（默认不推送，等维护者确认发布）。
