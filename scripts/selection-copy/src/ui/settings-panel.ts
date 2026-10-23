import { createButton, createField, createPanel, createSection, createSwitch, type UI } from '@ui';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  siteLabel,
  withSiteEnabled,
  type Settings,
} from '../settings';

/**
 * 设置面板。
 *
 * 入口只有脚本管理器菜单，所以不建悬浮按钮；面板在第一次打开设置时才创建，
 * 没打开过设置的页面不会多出任何 DOM。开关改动立即保存、立即生效，没有“保存”按钮。
 */

export interface SettingsPanelOptions {
  ui: UI;
  /** 当前站点的 `siteKey()`，用于“只关掉这个网站”。 */
  site: string;
  getSettings: () => Settings;
  save: (next: Settings) => void;
}

export interface SettingsPanelHandle {
  open(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

export function createSettingsPanel(options: SettingsPanelOptions): SettingsPanelHandle {
  const initial = options.getSettings();
  const siteName = siteLabel(options.site);

  const panel = createPanel(options.ui, {
    title: '功能设置',
    description: '选中文字后自动复制为纯文本；下面的开关改完立即生效。',
    open: false,
    position: 'center',
    closeLabel: '关闭设置',
  });

  const switchesSection = createSection(options.ui, {
    title: '开关',
    description: '总开关关掉后所有网站都停下来；单个网站可以单独关掉',
  });
  const enabledSwitch = createSwitch(options.ui, {
    checked: initial.enabled,
    onChange: (checked) => apply({ enabled: checked }),
  });
  const siteSwitch = createSwitch(options.ui, {
    checked: !initial.disabledSites.includes(options.site),
    onChange: (checked) => apply(withSiteEnabled(options.getSettings(), options.site, checked)),
  });
  switchesSection.body.append(
    createField(options.ui, {
      label: '启用选中复制',
      description: '关闭后不再复制，脚本菜单仍可打开这个面板',
      control: enabledSwitch,
      inline: true,
    }).el,
    createField(options.ui, {
      label: `当前网站：${siteName}`,
      description: '只影响当前网站；总开关关闭时此处不起作用',
      control: siteSwitch,
      inline: true,
    }).el,
  );

  const scopeSection = createSection(options.ui, {
    title: '复制范围',
    description: '这两类区域默认不复制，避免编辑文字时剪贴板被反复覆盖',
  });
  const inputsSwitch = createSwitch(options.ui, {
    checked: initial.copyInInputs,
    onChange: (checked) => apply({ copyInInputs: checked }),
  });
  const editorsSwitch = createSwitch(options.ui, {
    checked: initial.copyInEditors,
    onChange: (checked) => apply({ copyInEditors: checked }),
  });
  scopeSection.body.append(
    createField(options.ui, {
      label: '输入框里也复制',
      description: '包括搜索框、文本框与文本域',
      control: inputsSwitch,
      inline: true,
    }).el,
    createField(options.ui, {
      label: '富文本编辑器里也复制',
      description: '包括 contenteditable 区域；这类区域通常自带复制行为',
      control: editorsSwitch,
      inline: true,
    }).el,
  );

  const contentSection = createSection(options.ui, { title: '内容' });
  const trimSwitch = createSwitch(options.ui, {
    checked: initial.trimWhitespace,
    onChange: (checked) => apply({ trimWhitespace: checked }),
  });
  contentSection.body.append(
    createField(options.ui, {
      label: '去掉首尾空白',
      description: '关闭后按选中的原样复制，保留两端的空格与换行',
      control: trimSwitch,
      inline: true,
    }).el,
  );

  panel.body.append(switchesSection.el, scopeSection.el, contentSection.el);

  const reset = createButton(options.ui, {
    label: '恢复默认',
    variant: 'ghost',
    onClick: () => {
      // 恢复默认也把“本站暂停”清掉，否则面板看起来恢复了却仍然不复制。
      apply({ ...DEFAULT_SETTINGS, disabledSites: [] });
    },
  });
  panel.setFooter(reset.el);

  /** 合并一次改动、保存并回填，保证界面与真实设置保持一致。 */
  function apply(patch: Partial<Settings>): void {
    const next = normalizeSettings({ ...options.getSettings(), ...patch });
    options.save(next);
    fillForm(next);
  }

  function fillForm(next: Settings): void {
    enabledSwitch.setChecked(next.enabled);
    siteSwitch.setChecked(!next.disabledSites.includes(options.site));
    inputsSwitch.setChecked(next.copyInInputs);
    editorsSwitch.setChecked(next.copyInEditors);
    trimSwitch.setChecked(next.trimWhitespace);
  }

  return {
    open() {
      fillForm(options.getSettings());
      panel.open();
    },
    close: () => panel.close(),
    isOpen: () => panel.isOpen(),
    // UI 由入口统一持有，销毁面板不能连带清掉复制反馈。
    destroy: () => panel.destroy(),
  };
}
