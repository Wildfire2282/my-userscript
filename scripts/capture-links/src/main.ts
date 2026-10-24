import { createClipboard, createGmApi } from '@shared';
import { createSettingsStore } from './settings';
import { createApp } from './ui/app';

/**
 * 入口：读设置、按设置显示悬浮按钮、注册油猴菜单。
 *
 * 页面本体不放任何 DOM：UI 全部在 `@ui` 的 Shadow Root 里，关掉悬浮按钮后
 * 只有菜单入口，普通页面零节点零样式。
 */

const MENU_LINKS = '操作面板';
const MENU_SETTINGS = '功能设置';

function start(): void {
  const gm = createGmApi();
  const store = createSettingsStore(gm);
  const clipboard = createClipboard();

  const app = createApp({
    getSettings: store.get,
    updateSettings: (patch) => void store.update(patch),
    copy: clipboard.copy,
  });

  app.syncLauncher();

  const register = (label: string, run: () => void): void => {
    if (!gm.registerMenuCommand(label, run)) {
      console.warn(`[capture-links] 菜单命令不可用：${label}`);
    }
  };
  // 面板打开与扫描可能抛错：菜单回调里兜住，否则异常冒到脚本管理器且没有提示。
  const openLinks = (): void => {
    try {
      app.openLinks();
    } catch (error) {
      console.error('[capture-links] 打开链接面板失败', error);
    }
  };
  const openSettings = (): void => {
    try {
      app.openSettings();
    } catch (error) {
      console.error('[capture-links] 打开设置面板失败', error);
    }
  };
  register(MENU_LINKS, openLinks);
  register(MENU_SETTINGS, openSettings);
}

try {
  start();
} catch (error) {
  // 初始化失败只影响本脚本，不能让异常冒到宿主页面。
  console.error('[capture-links] 启动失败', error);
}
