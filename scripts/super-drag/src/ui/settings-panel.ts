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
  const initial = options.getSettings();

  const panel = createPanel(ui, {
    title: '功能设置',
    description:
      '拖拽选中文字搜索，拖拽链接或图片在新标签页打开；按住 Shift 这一次前台打开，按 Esc 取消。',
    open: false,
    position: 'center',
    closeLabel: '关闭设置',
  });

  const kindsSection = createSection(ui, {
    title: '拖拽类型',
    description: '关掉某一类后，这类拖拽交还网页的原生行为',
  });
  const textSwitch = createSwitch(ui, { checked: initial.dragKinds.text });
  const linkSwitch = createSwitch(ui, { checked: initial.dragKinds.link });
  const imageSwitch = createSwitch(ui, { checked: initial.dragKinds.image });
  kindsSection.body.append(
    createField(ui, {
      label: '文字',
      description: '选中文字后拖动即搜索',
      control: textSwitch,
      inline: true,
    }).el,
    createField(ui, {
      label: '链接',
      description: '拖动链接在新标签页打开',
      control: linkSwitch,
      inline: true,
    }).el,
    createField(ui, {
      label: '图片',
      description: '拖动图片在新标签页查看',
      control: imageSwitch,
      inline: true,
    }).el,
  );

  const textSection = createSection(ui, { title: '文字拖拽' });
  const engine = createSelect(ui, {
    options: engineOptions(initial),
    value: initial.defaultEngine,
    onChange: () => refresh(),
  });
  const engineField = createField(ui, {
    label: '搜索引擎',
    description: '拖动选中的文字即用它搜索',
    control: engine,
  });

  const customInput = createInput(ui, {
    type: 'url',
    placeholder: 'https://www.google.com/search?q={keyword}',
    autocomplete: 'off',
    onInput: () => refresh(),
  });
  const customField = createField(ui, {
    label: '自定义搜索地址',
    description: '用 {keyword} 占位，需以 http:// 或 https:// 开头',
    control: customInput,
  });

  const urlTextAction = createSelect(ui, {
    options: [
      { value: 'open', label: '直接打开' },
      { value: 'search', label: '仍然搜索' },
    ],
    value: initial.urlTextAction,
    onChange: () => refresh(),
  });
  const urlTextActionField = createField(ui, {
    label: '拖动的文字是网址时',
    description: '选「直接打开」时不再经过搜索引擎',
    control: urlTextAction,
  });

  textSection.body.append(engineField.el, customField.el, urlTextActionField.el);

  const linkSection = createSection(ui, { title: '链接与图片' });
  const openMode = createSelect(ui, {
    options: [
      { value: 'background', label: '后台打开（停留在当前页）' },
      { value: 'foreground', label: '前台打开（立即切换过去）' },
    ],
    value: initial.linkOpenMode,
    onChange: () => refresh(),
  });
  const openModeField = createField(ui, {
    label: '新标签页打开方式',
    description: '链接、图片和搜索结果都按这里的方式打开；按住 Shift 时这一次总是前台打开',
    control: openMode,
  });

  const imageAction = createSelect(ui, {
    options: [
      { value: 'viewer', label: '打开深色查看器' },
      { value: 'original', label: '直接打开原图' },
    ],
    value: initial.imageAction,
    onChange: () => refresh(),
  });
  const imageActionField = createField(ui, {
    label: '拖拽图片时',
    description: '查看器适合专注看图；原图适合保存或交给浏览器自带的图片页',
    control: imageAction,
  });

  linkSection.body.append(openModeField.el, imageActionField.el);
  panel.body.append(kindsSection.el, textSection.el, linkSection.el);

  /** 表单当前值；不改动已保存的设置。 */
  const draft = (): Settings => ({
    ...options.getSettings(),
    dragKinds: {
      text: textSwitch.isChecked(),
      link: linkSwitch.isChecked(),
      image: imageSwitch.isChecked(),
    },
    defaultEngine: engine.getValue(),
    customEngineUrl: customInput.getValue().trim(),
    urlTextAction: urlTextAction.getValue() === 'search' ? 'search' : 'open',
    imageAction: imageAction.getValue() === 'original' ? 'original' : 'viewer',
    linkOpenMode: openMode.getValue() === 'foreground' ? 'foreground' : 'background',
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
    textSwitch.setChecked(next.dragKinds.text);
    linkSwitch.setChecked(next.dragKinds.link);
    imageSwitch.setChecked(next.dragKinds.image);
    engine.setOptions(engineOptions(next));
    engine.setValue(next.defaultEngine);
    customInput.setValue(next.customEngineUrl);
    urlTextAction.setValue(next.urlTextAction);
    imageAction.setValue(next.imageAction);
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
