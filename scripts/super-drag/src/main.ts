import { createGmApi, createUserscript } from '@shared';
import { createUiHost } from '@ui';
import { installDragSensor } from './features/dnd';
import { createOpeners } from './features/openers';
import { createSettingsStore } from './settings';
import { createSettingsPanel, type SettingsPanelHandle } from './ui/settings-panel';

/**
 * 入口：挂拖拽监听、注册菜单项。
 *
 * 设置面板与 UI 都在第一次打开设置时才创建，所以普通页面只有几条事件监听，
 * 不注入样式、不生成节点。
 */
createUserscript(createGmApi(), {
  slug: 'super-drag',
  // `@noframes` 已保证只在顶层跑一遍，不需要 DOM 安装锁。
  installLock: false,
  onReady: (kit) => {
    const store = createSettingsStore(kit.gm);
    const openers = createOpeners();
    const host = createUiHost();

    const sensor = installDragSensor({
      getSettings: store.get,
      openUrl: openers.openUrl,
      openImage: openers.openImage,
    });

    // 面板懒建：菜单回调在 onReady 之后才可能被点，store 到那时已就绪。
    let panel: SettingsPanelHandle | null = null;
    kit.menu({
      label: '功能设置',
      run: () => {
        if (!panel) {
          panel = createSettingsPanel({
            ui: host.ensure(),
            getSettings: store.get,
            save: (patch) => void store.update(patch),
          });
        }
        panel.open();
      },
    });

    return () => {
      sensor.destroy();
      panel?.destroy();
      host.destroy();
      panel = null;
    };
  },
});
