import { defineConfig } from 'vitest/config';

// shortcut: e2e 仍用 playwright-core + demo 产物（dist/showcase.user.js），
// 与主仓库零依赖的 CDP 驱动 tools/browser-check.mjs 重复；把场景迁过去后删掉本文件。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/userscript-ui/tests/e2e/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
