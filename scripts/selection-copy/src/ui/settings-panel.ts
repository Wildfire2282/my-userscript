import { createButton, createSettingsForm, type UI } from '@ui';
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

/** 表单值 = 设置 + 本站开关派生值；保存时去掉派生键。 */
interface FormValues extends Settings {
  siteEnabled: boolean;
}

export function createSettingsPanel(options: SettingsPanelOptions): SettingsPanelHandle {
  const siteName = siteLabel(options.site);
  const getValues = (): FormValues => {
    const settings = options.getSettings();
    return { ...settings, siteEnabled: !settings.disabledSites.includes(options.site) };
  };

  const form = createSettingsForm<FormValues>(
    options.ui,
    {
      title: '功能设置',
      description: '选中文字后自动复制为纯文本；下面的开关改完立即生效。',
      sections: [
        {
          title: '开关',
          description: '总开关关掉后所有网站都停下来；单个网站可以单独关掉',
          fields: [
            {
              key: 'enabled',
              type: 'switch',
              label: '启用选中复制',
              description: '关闭后不再复制，脚本菜单仍可打开这个面板',
            },
            {
              key: 'siteEnabled',
              type: 'switch',
              label: `当前网站：${siteName}`,
              description: '只影响当前网站；总开关关闭时此处不起作用',
            },
          ],
        },
        {
          title: '复制范围',
          description: '这两类区域默认不复制，避免编辑文字时剪贴板被反复覆盖',
          fields: [
            {
              key: 'copyInInputs',
              type: 'switch',
              label: '输入框里也复制',
              description: '包括搜索框、文本框与文本域',
            },
            {
              key: 'copyInEditors',
              type: 'switch',
              label: '富文本编辑器里也复制',
              description: '包括 contenteditable 区域；这类区域通常自带复制行为',
            },
          ],
        },
        {
          title: '内容',
          fields: [
            {
              key: 'trimWhitespace',
              type: 'switch',
              label: '去掉首尾空白',
              description: '关闭后按选中的原样复制，保留两端的空格与换行',
            },
          ],
        },
      ],
    },
    {
      mode: 'immediate',
      get: getValues,
      onChange: (patch) => {
        if (patch.siteEnabled !== undefined) {
          // 本站开关是 disabledSites 的派生值：转成“在 / 不在列表”再存。
          const next = withSiteEnabled(options.getSettings(), options.site, patch.siteEnabled);
          options.save(next);
          form.fill({ ...next, siteEnabled: patch.siteEnabled });
          return;
        }
        const next = normalizeSettings({ ...options.getSettings(), ...patch });
        options.save(next);
        form.fill({ ...next, siteEnabled: !next.disabledSites.includes(options.site) });
      },
    },
  );

  const reset = createButton(options.ui, {
    label: '恢复默认',
    variant: 'ghost',
    onClick: () => {
      // 恢复默认也把“本站暂停”清掉，否则面板看起来恢复了却仍然不复制。
      const next: FormValues = { ...DEFAULT_SETTINGS, disabledSites: [], siteEnabled: true };
      options.save(next);
      form.fill(next);
    },
  });
  form.panel.setFooter([reset.el]);

  return {
    open: () => form.open(),
    close: () => form.close(),
    isOpen: () => form.isOpen(),
    // UI 由入口统一持有，销毁面板不能连带清掉复制反馈。
    destroy: () => form.destroy(),
  };
}
