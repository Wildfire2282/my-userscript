import { createGmApi } from '@shared';
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

const MENU_LABEL = '功能设置';

function start(): void {
  const gm = createGmApi();
  const store = createSettingsStore(gm);
  const openers = createOpeners();

  installDragSensor({
    getSettings: store.get,
    openUrl: openers.openUrl,
    openImage: openers.openImage,
  });

  let panel: SettingsPanelHandle | null = null;
  const openSettings = () => {
    try {
      if (!panel) {
        panel = createSettingsPanel({
          getSettings: store.get,
          save: (patch) => void store.update(patch),
        });
      }
      panel.open();
    } catch (error) {
      // 面板建不起来只影响设置入口，不能把菜单回调的异常抛给脚本管理器。
      console.error('[super-drag] 设置面板打开失败', error);
    }
  };

  if (!gm.registerMenuCommand(MENU_LABEL, openSettings)) {
    // 没有菜单项时设置无从打开，但不影响拖拽本身。
    console.warn('[super-drag] 菜单命令不可用，设置面板无法打开');
  }
}

try {
  start();
} catch (error) {
  console.error('[super-drag] 启动失败', error);
}
