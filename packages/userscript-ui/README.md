# Userscript UI — Agent 入口

本目录是 `my-userscript` 的共享 Shadow DOM UI 源码，不单独安装或分发。先遵守根目录规则，再读 [AGENTS.md](AGENTS.md)。脚本通过 `@ui` 按需引用 `src/index.ts`，由根目录 `tools/build.mjs` 打入单文件 userscript；CSS 随 JS 内联，无运行时依赖、远程字体或 CDN。

## 按需阅读

- [设计规范](docs/design-guidelines.md)：视觉、Token、布局与可访问性。
- [组件用法](docs/component-usage.md)：组件 API 与组合示例。
- [集成指南](docs/integration.md)：挂载、主题、生命周期、CSP 与宿主兼容。
- [技术决策](docs/decisions.md)：设计取舍与已知限制。

## 维护入口

所有命令从仓库根目录执行：

```bash
npm run build
npm run check
npm run test:browser -- userscript-ui
```

`check` 统一运行静态检查、单元测试、构建、metadata、安全与 Token 检查以及浏览器场景。UI 浏览器行为由 `tools/browser-check.mjs` 通过 CDP 驱动系统 Chrome/Edge；可用 `CHROME_PATH` 指定浏览器。

UI 测试入口是 `tests/browser-entry.ts`，场景是 `tests/browser-scenarios.mjs`，宿主测试页面保留在 `tests/fixtures/`；单元测试在 `tests/unit/`。修改组件时同步相关测试与组件文档，不另建展示页或验证链。
