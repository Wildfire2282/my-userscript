import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url));

export default [
  {
    ignores: [
      'dist/**',
      '**/dist/**',
      'node_modules/**',
      'coverage/**',
      'test-results/**',
      '.npm-cache/**',
      '.tmp/**',
      // 元数据块只有注释，线上原版是迁移对照物，都不参与 lint。
      'scripts/*/userscript.meta.*',
      'scripts/*/legacy/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.{ts,mjs,js}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // AGENTS.md 第 9 节的硬规则中，linter 能管的部分。
      // `x != null` 是刻意的空值判断；其余比较一律严格。
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-restricted-properties': [
        'error',
        { object: 'document', property: 'write', message: 'Use DOM APIs.' },
        { object: 'document', property: 'writeln', message: 'Use DOM APIs.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "AssignmentExpression > MemberExpression[property.name='innerHTML']",
          message: 'Use textContent or DOM nodes; innerHTML is banned.',
        },
        {
          selector: "AssignmentExpression > MemberExpression[property.name='outerHTML']",
          message: 'Use DOM nodes; outerHTML is banned.',
        },
        // 计算属性写法（`el['innerHTML'] = x`）绕开了上面两条静态选择器。
        {
          selector:
            'AssignmentExpression > MemberExpression[computed=true] > Literal[value=/^(inner|outer)HTML$/]',
          message: 'Use textContent or DOM nodes; HTML string assignment is banned.',
        },
        {
          selector:
            "CallExpression[callee.property.name='assign'] ObjectExpression > Property[key.name=/^(inner|outer)HTML$/]",
          message: 'Object.assign with innerHTML/outerHTML is banned.',
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: 'Use textContent or DOM nodes; insertAdjacentHTML is banned.',
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: 'new Function is banned.',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // 类型感知规则需要 program；这些文件都在根 tsconfig.json 的 include 里。
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir },
    },
  },
  {
    // 构建与检查脚本是普通 Node ESM，不在 TS program 里。
    files: ['**/*.mjs', 'eslint.config.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: [
      'scripts/*/src/**/*.ts',
      'packages/shared/src/**/*.ts',
      'packages/userscript-ui/src/**/*.ts',
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // 浏览器检查脚本里内嵌了在页面里执行的函数（window / document / DragEvent）。
    files: ['tools/browser-check.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    // 浏览器场景脚本：跑在页面里，也会用 Node 的 import 写法。
    files: ['scripts/*/tests/**/*.mjs', 'packages/userscript-ui/tests/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: [
      'scripts/*/tests/**/*.ts',
      'packages/shared/tests/**/*.ts',
      'packages/userscript-ui/tests/**/*.ts',
      '*.config.ts',
    ],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // 测试替身与夹具会触发只在出货代码里才重要的规则。
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  // 必须放最后：关掉所有与 Prettier 重叠的风格规则。
  prettier,
];
