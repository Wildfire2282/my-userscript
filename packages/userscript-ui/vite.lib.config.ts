import { defineConfig } from 'vite';

// 仅 e2e 使用：dialog 场景需要库形态的产物（window.UserscriptUI）。
// 交付的用户脚本不走这条链路，构建入口是 tools/build.mjs。
export default defineConfig({
  build: {
    target: 'chrome111',
    cssTarget: 'chrome111',
    lib: {
      entry: 'packages/userscript-ui/src/index.ts',
      formats: ['es', 'iife'],
      name: 'UserscriptUI',
      fileName: (format) => (format === 'es' ? 'userscript-ui.js' : 'userscript-ui.iife.js'),
    },
    outDir: 'packages/userscript-ui/dist/lib',
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: true,
  },
});
