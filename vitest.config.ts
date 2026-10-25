import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // 别名必须与 tsconfig.json、tools/build.mjs 三处一致：缺一处就会出现
    // “类型检查过、构建挂”或“构建过、单测挂”。精确与前缀形式都要写。
    alias: [
      { find: /^@ui$/, replacement: path.join(root, 'packages/userscript-ui/src/index.ts') },
      { find: /^@ui\//, replacement: path.join(root, 'packages/userscript-ui/src/') },
      { find: /^@shared$/, replacement: path.join(root, 'packages/shared/src/index.ts') },
      { find: /^@shared\//, replacement: path.join(root, 'packages/shared/src/') },
    ],
  },
  test: {
    // UI 组件依赖真实 DOM 与 CSS 导入；脚本单测在 happy-dom 下同样能跑。
    environment: 'happy-dom',
    // 每个测试文件各建一个 happy-dom 曾占掉约四分之三的测试时间；vmThreads 让同一
    // worker 复用已建好的环境，文件之间仍各自隔离（默认 threads 池每文件重建环境）。
    // Bun 的 module runner 解析不了 vmThreads worker 里的 chai，Bun 下退回 forks。
    pool: typeof process !== 'undefined' && 'bun' in process.versions ? 'forks' : 'vmThreads',
    css: true,
    include: [
      'tools/**/*.test.mjs',
      'scripts/*/tests/**/*.test.ts',
      'packages/shared/tests/**/*.test.ts',
      'packages/userscript-ui/tests/unit/**/*.test.ts',
    ],
  },
});
