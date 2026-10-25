# 脚本元数据规范

> 读者：Agent。适用所有 `scripts/<slug>/` 的 `==UserScript==` 元数据块。本文是唯一清单，`tools/check-meta.mjs` 按本文校验。

## 1. 事实来源

| 脚本状态 | 元数据来源 | 说明 |
| --- | --- | --- |
| 已迁移 | `userscript.meta.ts` | 构建时注入 `package.json` 的版本 |
| 未迁移 | `legacy/*.user.js` | 线上发布物；`userscript.meta.js` 必须与它的元数据块一致 |

`@version` 的规则：

- 已迁移脚本的源码不写 `@version`，构建时注入；
- 未迁移脚本的 `@version` 写在 `legacy/` 里，并与 `package.json` 保持同值；
- 任何情况下都不手改 `dist/` 产物。

## 2. 统一字段

| 字段 | 要求 |
| --- | --- |
| `@name` | 中文展示名，保持已发布值；不加「脚本 / 助手 / 增强版」 |
| `@name:en` | 英文短名，给英文界面使用 |
| `@namespace` | 固定 `https://github.com/Wildfire2282`；改动会改变安装识别，必须单独确认 |
| `@version` | 见第 1 节；不额外手写 |
| `@description` | 中文一句话，≤ 60 字，句末不加句号 |
| `@description:en` | 英文一句话，≤ 60 字，句末不加句号 |
| `@author` | 固定 `Wildfire2282 (https://github.com/Wildfire2282)` |
| `@license` | 固定 `MIT` |
| `@homepageURL` | 固定 `https://github.com/Wildfire2282/my-userscript` |
| `@supportURL` | 固定 `https://github.com/Wildfire2282/my-userscript/issues` |
| `@source` | 固定 `https://github.com/Wildfire2282/my-userscript` |
| `@match` / `@include` | 按脚本实际站点；至少一条 |
| `@grant` | 按代码实际调用；不多写、不漏写 |
| `@run-at` | 按脚本实际需要 |
| `@noframes` | 按脚本实际需要；不需要就不写 |
| `@downloadURL` / `@updateURL` | 保持 Greasy Fork 地址，不改成 GitHub |

不使用的字段：`@icon`、`@iconURL`、`@icon64`、`@require`、`@resource`、`@connect`、`@contributionURL`、`@antifeature`、`@locale`。需要新增时必须先说明运行时或隐私影响。

## 3. 语言

- 基准语言是中文：`@name` / `@description` 就是中文文案；
- 英文用 `@name:en` / `@description:en` 覆盖，不重复写 `@name:zh-CN`；
- 不写 `@locale`，Greasy Fork 只按 `:en` 这类语言后缀切换；
- 中英文案意思一致，不新增功能承诺；英文也不加句末句号。

当前英文值：

| `@name` | `@name:en` | `@description:en` |
| --- | --- | --- |
| 拖拽打开 | Drag to Open | Drag text to search, links to open, and images to view |
| 捕获链接 | Link Capture | Collect, filter, and copy all links on a page |
| 选中复制 | Copy on Select | Copy selected text as plain text with whitespace trimmed |
| YouTube 转写文稿复制 | YouTube Transcript Copy | Add a draggable button to copy YouTube transcripts |

## 4. 模板

已迁移脚本（不写 `@version`）：

```text
// ==UserScript==
// @name         拖拽打开
// @name:en      Drag to Open
// @namespace    https://github.com/Wildfire2282
// @description  拖拽文本搜索，拖拽链接在新标签页打开，拖拽图片查看
// @description:en Drag text to search, links to open, and images to view
// @author       Wildfire2282 (https://github.com/Wildfire2282)
// @license      MIT
// @homepageURL  https://github.com/Wildfire2282/my-userscript
// @supportURL   https://github.com/Wildfire2282/my-userscript/issues
// @source       https://github.com/Wildfire2282/my-userscript
// @match        https://*/*
// @match        http://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @run-at       document-end
// @noframes
// @downloadURL  https://update.greasyfork.org/scripts/580630/%E8%B6%85%E7%BA%A7%E6%8B%96%E6%8B%BD.user.js
// @updateURL    https://update.greasyfork.org/scripts/580630/%E8%B6%85%E7%BA%A7%E6%8B%96%E6%8B%BD.meta.js
// ==/UserScript==
```

未迁移脚本在 `@namespace` 后多一行 `@version`，其余相同。

## 5. 字段顺序

```text
@name
@name:en
@namespace
@version（仅未迁移脚本；构建产物在此位置注入）
@description
@description:en
@author
@license
@homepageURL
@supportURL
@source
@match / @include / @exclude
@grant
@run-at
@noframes
@downloadURL
@updateURL
```

同类多值字段相邻排列；单值字段只出现一次；元数据块内不写空行、注释或说明文字。

## 6. 校验与发布

`bun run check:meta` 会校验：

1. 必填字段齐全，单值字段不重复；
2. `@namespace`、`@author`、`@license`、`@homepageURL`、`@supportURL`、`@source` 等于本文约定值；
3. `@description` / `@description:en` 不超过 60 字且不以句号结尾；
4. 字段顺序符合第 5 节；
5. 已迁移脚本的源码没有 `@version`，产物版本等于 `package.json`；
6. 未迁移脚本的 `userscript.meta.js` 与 `legacy/` 元数据块逐字段一致；
7. `@downloadURL` / `@updateURL` 指向 Greasy Fork，且脚本 ID 与 `legacy/<ID>-<slug>.user.js` 一致。

产物中的 `GM_*`、`GM.*` 与静态字符串属性访问会按各自名称核对授权；`GM_setClipboard` 不代替 `GM.setClipboard`，反之亦然。两者在管理器中需要分别声明，本仓保留已发布的 `GM_setClipboard`，不为兼容分支增加权限。动态拼接的属性名不在静态检查范围内。

需要变更 `@name`、`@namespace`、`@match`、`@include`、`@grant` 时，先由维护者确认，再按 [`release-automation.md`](release-automation.md) 第 4 节的元数据变更流程发布。版本规则见 [`release-automation.md`](release-automation.md) 第 2 节。

未迁移脚本的元数据改动必须先发布再跑 `bun run sync`，否则同步会用线上版本覆盖 `legacy/`。

Greasy Fork 会把 `@downloadURL` / `@updateURL` 的对齐空格规范成单个空格。同步后的这类格式差异由 `tools/release.mjs` 按字段值与代码正文比较，不需要再次升版本。
