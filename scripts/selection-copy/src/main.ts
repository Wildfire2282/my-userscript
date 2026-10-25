import { createClipboard, createGmApi, createLogger, guard } from '@shared';
import { createCopyAction } from './features/copy-action';
import { installCopySensor } from './features/sensor';
import { createSettingsStore, topSiteKey } from './settings';
import { createUiHost } from './ui/app';
import { createSettingsPanel, type SettingsPanelHandle } from './ui/settings-panel';

/**
 * 入口：安装选中传感器并按顶层站点注册设置菜单。
 *
 * 每个 frame 独立注入：父文档收不到 iframe 内的鼠标事件，加 `@noframes` 会丢掉
 * iframe 内的复制能力。同一文档只装一份，用 DOM 属性兜底——不同管理器的沙箱之间
 * window 不一定共享，DOM 一定共享。
 *
 * 总开关 / 本站开关在每次复制时检查，不在启动时决定是否监听：这样顶层页面关掉
 * 当前站点后，同页 iframe 的下一次复制也会停下；反过来打开也能立即恢复。
 *
 * 菜单只在顶层页面注册：每个 iframe 各注册一次会让管理器菜单里出现重复项，
 * 面板也可能被塞进看不见的小 iframe 里。
 */

const INSTALL_LOCK_ATTRIBUTE = 'data-selection-auto-copy-installed';
const MENU_LABEL = '功能设置';

function start(): void {
  const log = createLogger('selection-copy');
  const root = document.documentElement;
  if (!root || root.hasAttribute(INSTALL_LOCK_ATTRIBUTE)) return;
  root.setAttribute(INSTALL_LOCK_ATTRIBUTE, '');

  const gm = createGmApi();
  const store = createSettingsStore(gm);
  const site = topSiteKey(window);
  const app = createUiHost();

  const copy = createCopyAction({
    clipboard: createClipboard(),
    getSettings: store.get,
    site,
    showFeedback: app.showFeedback,
  });

  installCopySensor({ onCopy: (target, point) => void copy(target, point) });

  let panel: SettingsPanelHandle | null = null;
  const openSettings = (): void => {
    guard(log, '设置面板打开失败', () => {
      if (!panel) {
        panel = createSettingsPanel({
          ui: app.ensure(),
          site,
          getSettings: store.get,
          save: (next) => {
            store.update(next);
          },
        });
      }
      panel.open();
    });
  };

  if (window.top === window.self && !gm.registerMenuCommand(MENU_LABEL, openSettings)) {
    log.warn('菜单命令不可用，设置面板无法打开');
  }
}

guard(createLogger('selection-copy'), '启动失败', () => {
  start();
});
