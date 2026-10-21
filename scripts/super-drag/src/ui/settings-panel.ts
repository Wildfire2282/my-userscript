import {
  createButton,
  createField,
  createInput,
  createPanel,
  createSection,
  createSelect,
  createSwitch,
  mountUI,
  type UI,
} from '@ui';
import {
  PREVIEW_KEYWORD,
  buildSearchUrl,
  defaultSettings,
  engineOptions,
  validateCustomEngineUrl,
} from '../search';
import { CUSTOM_ENGINE_ID, type Settings } from '../settings';

/**
 * 设置面板。
 *
 * 入口只有油猴菜单，所以这里不建悬浮按钮；面板在第一次打开设置时才创建，
 * 空闲页面不会多出任何 DOM 或样式。
 */

export interface SettingsPanelOptions {
  getSettings: () => Settings;
  save: (patch: Partial<Settings>) => void;
}

export interface SettingsPanelHandle {
  open(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

const LABELS = {
  close: '关闭',
  settings: '设置',
  notifications: '通知',
  dismissNotification: '关闭通知',
  closeSettings: '关闭设置',
  scrollHint: '向下滚动查看更多内容',
  cancel: '取消',
  confirm: '确定',
};

export function createSettingsPanel(options: SettingsPanelOptions): SettingsPanelHandle {
  const ui: UI = mountUI({ theme: 'system', labels: LABELS });

  const panel = createPanel(ui, {
    title: '超级拖拽设置',
    description: '拖动文字搜索，拖动链接、图片在新标签页打开',
    open: false,
    closeLabel: '关闭设置',
  });

  const general = createSection(ui, { title: '常规' });
  const enabled = createSwitch(ui, { checked: true });
  general.body.append(
    createField(ui, {
      label: '启用超级拖拽',
      description: '关闭后拖拽文字、链接、图片均无响应',
      control: enabled,
      inline: true,
    }).el,
  );

  const textSection = createSection(ui, { title: '文字拖拽' });
  const engine = createSelect(ui, {
    options: engineOptions(options.getSettings()),
    value: options.getSettings().defaultEngine,
    onChange: () => refresh(),
  });
  const engineField = createField(ui, {
    label: '搜索引擎',
    description: '拖动选中的文字即用它搜索；拖动的文字本身是网址时直接打开',
    control: engine,
  });

  const customInput = createInput(ui, {
    type: 'url',
    placeholder: 'https://www.google.com/search?q={keyword}',
    autocomplete: 'off',
    onInput: () => refresh(),
  });
  const customField = createField(ui, {
    label: '自定义搜索 URL',
    description: '用 {keyword} 占位，需以 http:// 或 https:// 开头',
    control: customInput,
  });

  textSection.body.append(engineField.el, customField.el);

  const linkSection = createSection(ui, { title: '链接拖拽' });
  const openMode = createSelect(ui, {
    options: [
      { value: 'background', label: '后台打开（停留在当前页）' },
      { value: 'foreground', label: '前台打开（立即切换过去）' },
    ],
    value: options.getSettings().linkOpenMode,
    onChange: () => refresh(),
  });
  linkSection.body.append(
    createField(ui, {
      label: '新窗口打开方式',
      description: '拖拽时按住 Shift，可让这一次在前台打开',
      control: openMode,
    }).el,
  );

  panel.body.append(general.el, textSection.el, linkSection.el);

  /** 表单当前值；不改动已保存的设置。 */
  const draft = (): Settings => ({
    ...options.getSettings(),
    defaultEngine: engine.getValue(),
    customEngineUrl: customInput.getValue().trim(),
    linkOpenMode: openMode.getValue() === 'foreground' ? 'foreground' : 'background',
    enabled: enabled.isChecked(),
  });

  /** 只刷新派生显示：自定义行的显隐、示例地址、错误提示。 */
  function refresh(): void {
    const current = draft();
    const isCustom = current.defaultEngine === CUSTOM_ENGINE_ID;
    customField.el.hidden = !isCustom;
    engineField.setDescription(`示例：${buildSearchUrl(current, PREVIEW_KEYWORD)}`);
    // 空地址交给保存时校验，避免刚打开面板就红一片。
    if (isCustom && current.customEngineUrl !== '') {
      customField.setError(validateCustomEngineUrl(current.customEngineUrl) ?? undefined);
    } else {
      customField.setError(undefined);
    }
  }

  /** 用给定设置回填表单（打开、取消、恢复默认都走这里）。 */
  function fillForm(next: Settings): void {
    enabled.setChecked(next.enabled);
    engine.setOptions(engineOptions(next));
    engine.setValue(next.defaultEngine);
    customInput.setValue(next.customEngineUrl);
    openMode.setValue(next.linkOpenMode);
    refresh();
  }

  const reset = createButton(ui, {
    label: '恢复默认',
    variant: 'ghost',
    onClick: () => fillForm(defaultSettings()),
  });

  const cancel = createButton(ui, {
    label: '取消',
    variant: 'secondary',
    onClick: () => {
      fillForm(options.getSettings());
      panel.close();
    },
  });

  const save = createButton(ui, {
    label: '保存',
    variant: 'primary',
    onClick: () => {
      const next = draft();
      if (next.defaultEngine === CUSTOM_ENGINE_ID) {
        const problem = validateCustomEngineUrl(next.customEngineUrl);
        if (problem) {
          // 校验失败留在面板里，用户不会丢掉刚填的内容。
          customField.setError(problem);
          customInput.input.focus();
          return;
        }
      }
      options.save(next);
      panel.close();
    },
  });

  panel.setFooter([reset.el, cancel.el, save.el]);

  return {
    open() {
      fillForm(options.getSettings());
      panel.open();
    },
    close: () => panel.close(),
    isOpen: () => panel.isOpen(),
    destroy: () => ui.destroy(),
  };
}
