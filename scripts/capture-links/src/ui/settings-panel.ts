import { createSettingsForm, type SettingsFormHandle, type UI } from '@ui';
import { toCopyFormat, type Settings } from '../settings';

/**
 * 设置面板：悬浮按钮开关与复制格式。
 *
 * 两项都改动即生效（与线上旧版一致），所以不设保存按钮：面板只负责把当前值
 * 回填到控件，用户改哪一项就存哪一项。
 */

export interface SettingsPanelOptions {
  ui: UI;
  getSettings: () => Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  /** 开关改动后同步悬浮按钮的显隐。 */
  onFloatButtonChange: () => void;
}

export interface SettingsPanelHandle {
  panel: SettingsFormHandle<Settings>['panel'];
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
}

export function createSettingsPanel(options: SettingsPanelOptions): SettingsPanelHandle {
  const form = createSettingsForm<Settings>(
    options.ui,
    {
      title: '功能设置',
      sections: [
        {
          title: '常规',
          fields: [
            {
              key: 'showFloatButton',
              type: 'switch',
              label: '显示浮动按钮',
              description: '关掉后仍可从油猴菜单打开链接面板',
            },
          ],
        },
        {
          title: '复制格式',
          fields: [
            {
              key: 'copyFormat',
              type: 'select',
              label: '复制格式',
              description: '纯链接最省事；Markdown 与 HTML 适合直接贴进笔记',
              options: [
                { value: 'url', label: '纯链接' },
                { value: 'markdown', label: 'Markdown' },
                { value: 'html', label: 'HTML' },
              ],
            },
          ],
        },
      ],
    },
    {
      mode: 'immediate',
      get: options.getSettings,
      onChange: (patch) => {
        const next = { ...patch };
        if (next.copyFormat !== undefined) {
          next.copyFormat = toCopyFormat(next.copyFormat);
        }
        options.updateSettings(next);
        if (next.showFloatButton !== undefined) options.onFloatButtonChange();
      },
    },
  );

  return {
    panel: form.panel,
    open: () => form.open(),
    close: () => form.close(),
    isOpen: () => form.isOpen(),
  };
}
