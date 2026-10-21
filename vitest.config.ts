import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@ui': path.join(root, 'packages/userscript-ui/src/index.ts'),
      '@shared': path.join(root, 'packages/shared/src/index.ts'),
    },
  },
  test: {
    include: ['scripts/*/tests/**/*.test.ts', 'packages/shared/tests/**/*.test.ts'],
    environment: 'node',
  },
});
