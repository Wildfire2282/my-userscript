import {
  createButton,
  createField,
  createPanel,
  createSection,
  createSelect,
  createSwitch,
  type PanelHandle,
  type UI,
} from '@ui';
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
  panel: PanelHandle;
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
}

export function createSettingsPanel(options: SettingsPanelOptions): SettingsPanelHandle {
  const { ui } = options;

  const panel = createPanel(ui, {
    title: '功能设置',
    open: false,
    position: 'center',
    closeLabel: '关闭设置',
  });

  const generalSection = createSection(ui, { title: '常规' });
  const floatSwitch = createSwitch(ui, {
    checked: options.getSettings().showFloatButton,
    onChange: (checked) => {
      options.updateSettings({ showFloatButton: checked });
      options.onFloatButtonChange();
    },
  });
  generalSection.body.append(
    createField(ui, {
      label: '显示浮动按钮',
      description: '关掉后仍可从油猴菜单打开链接面板',
      control: floatSwitch,
      inline: true,
    }).el,
  );

  const copySection = createSection(ui, { title: '复制格式' });
  const formatSelect = createSelect(ui, {
    options: [
      { value: 'url', label: '纯链接' },
      { value: 'markdown', label: 'Markdown' },
      { value: 'html', label: 'HTML' },
    ],
    value: options.getSettings().copyFormat,
    onChange: (value) => {
      options.updateSettings({ copyFormat: toCopyFormat(value) });
    },
  });
  copySection.body.append(
    createField(ui, {
      label: '复制格式',
      description: '纯链接最省事；Markdown 与 HTML 适合直接贴进笔记',
      control: formatSelect,
    }).el,
  );

  panel.body.append(generalSection.el, copySection.el);

  // 与线上旧版一样只保留“关闭”：没有需要提交的表单，不需要保存/取消。
  const closeButton = createButton(ui, {
    label: '关闭',
    variant: 'secondary',
    onClick: () => panel.close(),
  });
  panel.setFooter([closeButton.el]);

  return {
    panel,
    open() {
      const settings = options.getSettings();
      floatSwitch.setChecked(settings.showFloatButton);
      formatSelect.setValue(settings.copyFormat);
      panel.open();
    },
    close: () => panel.close(),
    isOpen: () => panel.isOpen(),
  };
}
