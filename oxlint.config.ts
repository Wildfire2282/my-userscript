import { defineConfig } from 'oxlint';

export default defineConfig({
  plugins: ['typescript', 'unicorn', 'import'],
  env: { es2022: true },
  globals: {
    GM_getValue: 'readonly',
    GM_setValue: 'readonly',
    GM_deleteValue: 'readonly',
    GM_listValues: 'readonly',
    GM_getResourceURL: 'readonly',
    GM_addStyle: 'readonly',
    GM_openInTab: 'readonly',
    GM_registerMenuCommand: 'readonly',
    GM_unregisterMenuCommand: 'readonly',
    GM_notification: 'readonly',
    GM_setClipboard: 'readonly',
    GM_addValueChangeListener: 'readonly',
    GM_removeValueChangeListener: 'readonly',
    GM_log: 'readonly',
    GM_info: 'readonly',
    unsafeWindow: 'readonly',
  },
  rules: {
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'no-var': 'error',
    'prefer-const': 'error',
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-restricted-properties': [
      'error',
      { object: 'document', property: 'write', message: 'Use DOM APIs.' },
      { object: 'document', property: 'writeln', message: 'Use DOM APIs.' },
    ],
    'typescript/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
    ],
    'typescript/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    // 遍历中回调可能删自己（emit/notify/teardown）：快照拷贝是故意的，不是多余。
    'unicorn/no-useless-spread': 'off',
    'unicorn/no-empty-file': 'off',
  },
  ignorePatterns: [
    'dist/**',
    '**/dist/**',
    'coverage/**',
    'test-results/**',
    '.npm-cache/**',
    '.bun-cache/**',
    '.tmp/**',
    'scripts/*/userscript.meta.*',
    'scripts/*/legacy/**',
    'scripts/*/dist/**',
  ],
  overrides: [
    { files: ['tools/**/*.mjs', 'oxlint.config.ts'], env: { node: true } },
    {
      files: [
        'scripts/*/src/**/*.ts',
        'packages/shared/src/**/*.ts',
        'packages/userscript-ui/src/**/*.ts',
      ],
      env: { browser: true },
    },
    {
      files: ['tools/browser-check.mjs'],
      env: { node: true, browser: true },
    },
    {
      files: ['scripts/*/tests/**/*.mjs', 'packages/userscript-ui/tests/**/*.mjs'],
      env: { node: true, browser: true },
    },
  ],
});
