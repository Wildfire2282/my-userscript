import { createClipboard, createGmApi, createUserscript } from '@shared';
import { createSettingsStore } from './settings';
import { createApp } from './ui/app';

/**
 * 入口：读设置、按设置显示悬浮按钮、注册油猴菜单。
 *
 * 页面本体不放任何 DOM：UI 全部在 `@ui` 的 Shadow Root 里，关掉悬浮按钮后
 * 只有菜单入口，普通页面零节点零样式。
 */
createUserscript(createGmApi(), {
  slug: 'capture-links',
  // `@noframes` 已保证只在顶层跑一遍，不需要 DOM 安装锁。
  installLock: false,
  onReady: (kit) => {
    const store = createSettingsStore(kit.gm);
    const clipboard = createClipboard();

    const app = createApp({
      getSettings: store.get,
      updateSettings: (patch) => void store.update(patch),
      copy: clipboard.copy,
    });

    app.syncLauncher();

    kit.menu({
      label: '操作面板',
      run: () => app.openLinks(),
    });
    kit.menu({
      label: '功能设置',
      run: () => app.openSettings(),
    });

    return () => app.destroy();
  },
});
