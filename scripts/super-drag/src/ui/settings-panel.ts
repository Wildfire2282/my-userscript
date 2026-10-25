import {
  createButton,
  createSettingsForm,
  type InputHandle,
  type SelectHandle,
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
  ui: UI;
  getSettings: () => Settings;
  save: (patch: Partial<Settings>) => void;
}

export interface SettingsPanelHandle {
  open(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

/**
 * 表单拍平的值：开关三项拍平，嵌套的 `dragKinds` 在提交/回填时还原。
 * form 只认一层键，嵌套结构由这里翻译。
 */
interface FlatValues {
  text: boolean;
  link: boolean;
  image: boolean;
  defaultEngine: string;
  customEngineUrl: string;
  urlTextAction: string;
  linkOpenMode: string;
  imageAction: string;
}

function flatten(settings: Settings): FlatValues {
  return {
    text: settings.dragKinds.text,
    link: settings.dragKinds.link,
    image: settings.dragKinds.image,
    defaultEngine: settings.defaultEngine,
    customEngineUrl: settings.customEngineUrl,
    urlTextAction: settings.urlTextAction,
    linkOpenMode: settings.linkOpenMode,
    imageAction: settings.imageAction,
  };
}

function isInvalidControl(control: unknown): control is InputHandle | SelectHandle {
  return (
    !!control &&
    typeof control === 'object' &&
    'setInvalid' in control &&
    typeof control.setInvalid === 'function'
  );
}

function isOptionsControl(control: unknown): control is SelectHandle {
  return (
    !!control &&
    typeof control === 'object' &&
    'setOptions' in control &&
    typeof control.setOptions === 'function'
  );
}

export function createSettingsPanel(options: SettingsPanelOptions): SettingsPanelHandle {
  const form = createSettingsForm<FlatValues>(
    options.ui,
    {
      title: '功能设置',
      description:
        '拖拽选中文字搜索，拖拽链接或图片在新标签页打开；按住 Shift 这一次前台打开，按 Esc 取消。',
      sections: [
        {
          title: '拖拽类型',
          description: '关掉某一类后，这类拖拽交还网页的原生行为',
          fields: [
            {
              key: 'text',
              type: 'switch',
              label: '文字',
              description: '选中文字后拖动即搜索',
            },
            {
              key: 'link',
              type: 'switch',
              label: '链接',
              description: '拖动链接在新标签页打开',
            },
            {
              key: 'image',
              type: 'switch',
              label: '图片',
              description: '拖动图片在新标签页查看',
            },
          ],
        },
        {
          title: '文字拖拽',
          fields: [
            {
              key: 'defaultEngine',
              type: 'select',
              label: '搜索引擎',
              description: '拖动选中的文字即用它搜索',
              options: engineOptions(options.getSettings()),
            },
            {
              key: 'customEngineUrl',
              type: 'input',
              label: '自定义搜索地址',
              description: '用 {keyword} 占位，需以 http:// 或 https:// 开头',
            },
            {
              key: 'urlTextAction',
              type: 'select',
              label: '拖动的文字是网址时',
              description: '选「直接打开」时不再经过搜索引擎',
              options: [
                { value: 'open', label: '直接打开' },
                { value: 'search', label: '仍然搜索' },
              ],
            },
          ],
        },
        {
          title: '链接与图片',
          fields: [
            {
              key: 'linkOpenMode',
              type: 'select',
              label: '新标签页打开方式',
              description:
                '链接、图片和搜索结果都按这里的方式打开；按住 Shift 时这一次总是前台打开',
              options: [
                { value: 'background', label: '后台打开（停留在当前页）' },
                { value: 'foreground', label: '前台打开（立即切换过去）' },
              ],
            },
            {
              key: 'imageAction',
              type: 'select',
              label: '拖拽图片时',
              description: '查看器适合专注看图；原图适合保存或交给浏览器自带的图片页',
              options: [
                { value: 'viewer', label: '打开深色查看器' },
                { value: 'original', label: '直接打开原图' },
              ],
            },
          ],
        },
      ],
    },
    {
      mode: 'draft',
      get: () => flatten(options.getSettings()),
      // 自定义地址只在选了“自定义”时显示。
      visible: (key, values) =>
        key !== 'customEngineUrl' || values.defaultEngine === CUSTOM_ENGINE_ID,
      // 空地址交给保存时校验，避免刚打开面板就红一片。
      validate: (key, value, values) =>
        key === 'customEngineUrl' && values.defaultEngine === CUSTOM_ENGINE_ID && value !== ''
          ? (validateCustomEngineUrl(String(value)) ?? undefined)
          : undefined,
      onSubmit: (values) => {
        const customEngineUrl = values.customEngineUrl.trim();
        if (values.defaultEngine === CUSTOM_ENGINE_ID) {
          const problem = validateCustomEngineUrl(customEngineUrl);
          if (problem) {
            const custom = form.fields['customEngineUrl'];
            const control: unknown = custom?.control;
            // 自定义地址是 input 控件：标红输入框并在字段下展示文案。
            if (isInvalidControl(control)) control.setInvalid(true);
            custom?.field.setError(problem);
            return false;
          }
        }
        options.save({
          dragKinds: { text: values.text, link: values.link, image: values.image },
          defaultEngine: values.defaultEngine,
          customEngineUrl,
          urlTextAction: values.urlTextAction === 'search' ? 'search' : 'open',
          linkOpenMode: values.linkOpenMode === 'foreground' ? 'foreground' : 'background',
          imageAction: values.imageAction === 'original' ? 'original' : 'viewer',
        });
      },
    },
  );

  // 恢复默认按钮：按钮型动作留脚本，不进 schema。
  const reset = createButton(options.ui, {
    label: '恢复默认',
    variant: 'ghost',
    onClick: () => {
      form.fill(flatten(defaultSettings()));
      refreshDerived();
    },
  });
  // draft 模式页脚已有取消/保存：恢复默认插到最前。
  form.panel.setFooter([reset.el, ...form.panel.footer.children]);

  /** 派生显示留脚本：引擎下拉选项与示例地址随存储变化，不进 schema。 */
  function refreshDerived(): void {
    const current = form.values();
    // 拍平值还原成 Settings，派生函数只认完整形状。
    const settings: Settings = {
      ...options.getSettings(),
      dragKinds: { text: current.text, link: current.link, image: current.image },
      defaultEngine: current.defaultEngine,
      customEngineUrl: current.customEngineUrl,
      urlTextAction: current.urlTextAction === 'search' ? 'search' : 'open',
      linkOpenMode: current.linkOpenMode === 'foreground' ? 'foreground' : 'background',
      imageAction: current.imageAction === 'original' ? 'original' : 'viewer',
    };
    const engine = form.fields['defaultEngine'];
    if (engine && isOptionsControl(engine.control)) {
      engine.control.setOptions(engineOptions(settings));
      engine.field.setDescription(`示例：${buildSearchUrl(settings, PREVIEW_KEYWORD)}`);
    }
  }

  // draft 模式不会在改动时回调脚本，示例文案只能直接监听控件。
  form.fields['defaultEngine']?.control.input.addEventListener('change', refreshDerived);
  form.fields['customEngineUrl']?.control.input.addEventListener('input', refreshDerived);

  return {
    open() {
      form.open();
      refreshDerived();
    },
    close: () => form.close(),
    isOpen: () => form.isOpen(),
    destroy: () => {
      reset.destroy();
      form.destroy();
    },
  };
}
