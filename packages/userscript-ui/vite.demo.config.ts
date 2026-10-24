import { defineConfig, type Plugin } from 'vite';

const METADATA = (name: string, description: string) => `// ==UserScript==
// @name         ${name}
// @namespace    https://github.com/Wildfire2282/userscript-ui
// @version      0.1.0
// @description  ${description}
// @match        https://example.com/*
// @match        http://localhost/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==
`;

function userscriptBanner(banner: string): Plugin {
  return {
    name: 'userscript-banner',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk') {
          output.code = `${banner}\n${output.code}`;
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const minimal = mode === 'minimal';
  const name = minimal ? 'Userscript UI Minimal Demo' : 'Userscript UI Showcase';
  const description = minimal
    ? 'Minimal single-file build of the Userscript UI design system.'
    : 'Interactive showcase of the Userscript UI design system.';

  return {
    plugins: [userscriptBanner(METADATA(name, description))],
    build: {
      target: 'chrome111',
      cssTarget: 'chrome111',
      outDir: 'packages/userscript-ui/dist',
      emptyOutDir: false,
      sourcemap: false,
      lib: {
        entry: minimal
          ? 'packages/userscript-ui/demo/minimal.ts'
          : 'packages/userscript-ui/demo/showcase.ts',
        formats: ['iife'],
        name: 'UserscriptUIDemo',
        fileName: () => (minimal ? 'minimal.user.js' : 'showcase.user.js'),
      },
    },
  };
});
