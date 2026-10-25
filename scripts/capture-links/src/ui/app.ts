import {
  createLauncher,
  createToast,
  createUiHost,
  icon,
  type LauncherHandle,
  type PanelHandle,
  type ToastController,
  type UI,
} from '@ui';
import type { Settings } from '../settings';
import { createLinkPanel, type LinkPanelHandle } from './link-panel';
import { createSettingsPanel, type SettingsPanelHandle } from './settings-panel';

/** 悬浮按钮的链接图标；线条规则与 `@ui` 内置图标一致。 */
const LINK_ICON_PATHS = [
  'M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 4',
  'M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07L13 20',
];

/**
 * 脚本的界面外壳。
 *
 * UI 只在真正需要时创建：默认显示悬浮按钮，所以启动时会建链接面板（浮标点开的那个）；
 * 功能设置面板第一次打开菜单时才建——它在页面上不可见，启动时构建只会白占布局与样式。
 * 面板在第一次创建后复用，不重复 `mountUI()`。
 */

export type NotifyVariant = 'success' | 'warning' | 'error';

export interface AppOptions {
  getSettings: () => Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  copy: (text: string) => Promise<boolean>;
}

export interface AppHandle {
  /** 按当前设置显示或移除悬浮按钮。 */
  syncLauncher: () => void;
  openLinks: () => void;
  openSettings: () => void;
  destroy: () => void;
}

interface Session {
  ui: UI;
  linkPanel: LinkPanelHandle;
  launcher: LauncherHandle | null;
}

export function createApp(options: AppOptions): AppHandle {
  const host = createUiHost();
  let toast: ToastController | null = null;
  let session: Session | null = null;
  let settingsPanel: SettingsPanelHandle | null = null;

  const notify = (message: string, variant: NotifyVariant): void => {
    // 面板里的操作都发生在 UI 创建之后；这里只是防御，不让提示缺失变成异常。
    toast ??= createToast(host.ensure());
    toast[variant](message);
  };

  const syncLauncher = (): void => {
    if (!options.getSettings().showFloatButton) {
      session?.launcher?.destroy();
      if (session) session.launcher = null;
      return;
    }
    const current = ensure();
    if (current.launcher) return;
    // Launcher 点击时只会 toggle 传给它的面板本身；直接接原始面板会打开一个从未
    // 扫描过的空列表。包一层，让浮标和菜单「面板」走同一条重新扫描的路径。
    const launcherPanel: PanelHandle = {
      ...current.linkPanel.panel,
      open: () => current.linkPanel.open(),
    };
    current.launcher = createLauncher(current.ui, {
      label: '打开链接面板',
      closeLabel: '关闭链接面板',
      panel: launcherPanel,
      icon: icon(LINK_ICON_PATHS, 18),
    });
    // 链接面板居中显示；Launcher 默认会把面板摆到自己的角落。
    current.linkPanel.panel.setPosition('center');
  };

  const ensure = (): Session => {
    if (session) return session;
    const ui = host.ensure();
    const linkPanel = createLinkPanel({
      ui,
      getCopyFormat: () => options.getSettings().copyFormat,
      copy: options.copy,
      notify,
    });
    session = { ui, linkPanel, launcher: null };
    return session;
  };

  const ensureSettings = (): SettingsPanelHandle => {
    if (settingsPanel) return settingsPanel;
    const current = ensure();
    settingsPanel = createSettingsPanel({
      ui: current.ui,
      getSettings: options.getSettings,
      updateSettings: options.updateSettings,
      onFloatButtonChange: syncLauncher,
    });
    return settingsPanel;
  };

  return {
    syncLauncher,
    openLinks: () => ensure().linkPanel.open(),
    openSettings: () => ensureSettings().open(),
    destroy() {
      host.destroy();
      toast = null;
      session = null;
      settingsPanel = null;
    },
  };
}
