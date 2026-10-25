import { createButton } from '../components/button';
import { createField, type FieldHandle } from '../components/field';
import { createInput, type InputHandle, type InputType } from '../components/input';
import { createPanel, type PanelHandle } from '../components/panel';
import { createSection } from '../components/section';
import { createSelect, type SelectHandle, type SelectOption } from '../components/select';
import { createSwitch, type SwitchHandle } from '../components/switch';
import type { FormControl } from '../core/form';
import type { UI } from '../core/mount';

/**
 * 声明式设置表单：三个脚本的设置面板（capture-links / selection-copy / super-drag）
 * 都是“Section + Field + 控件 + 页脚按钮”的同形装配。
 *
 * 硬边界（见 docs/kit.md）：
 * - 字段只有 `switch | select | input`；布局只有 `inline | stacked`。
 * - 动态能力只有两个回调：`visible(key, values)` 与 `validate(key, value, values)`。
 * - 派生文案、动态选项表、按钮型动作（恢复默认、清空记忆）不进 schema，留在脚本。
 * - 两种提交：`immediate`（改动即保存）与 `draft`（保存按钮；`onSubmit` 返回
 *   `false` 时留在面板，常用于校验失败）。
 */

export type SettingsFieldType = 'switch' | 'select' | 'input';

export interface SettingsFieldSchema {
  /** 字段键；`get`/`set` 与提交值都按此键。 */
  key: string;
  type: SettingsFieldType;
  label: string;
  description?: string;
  /** `switch` 默认 inline 行，`select` 与 `input` 默认 stacked 行。 */
  layout?: 'inline' | 'stacked';
  /** select 选项；input 的 type/placeholder。 */
  options?: SelectOption[];
  inputType?: InputType;
  placeholder?: string;
}

export interface SettingsSectionSchema {
  title: string;
  description?: string;
  fields: SettingsFieldSchema[];
}

export interface SettingsFormSchema {
  title: string;
  description?: string;
  sections: SettingsSectionSchema[];
}

export interface SettingsFormOptions<T extends object> {
  /** 当前值；每次 `open` 都重读，保证与存储一致。 */
  get: () => T;
  /**
   * 动态显隐；返回 false 的字段隐藏。`refresh`（任何控件变化后）与 `open` 时重跑。
   * 默认全部显示。
   */
  visible?: (key: string, values: T) => boolean;
  /**
   * 校验单个字段；返回错误文案。保存时全量跑，不通过则标红并留在面板；
   * `immediate` 每次改动后同样跑，只展示错误、不阻止保存。
   */
  validate?: (key: string, value: unknown, values: T) => string | undefined;
  /** `immediate` 模式：每次改动后调用。 */
  onChange?: (patch: Partial<T>) => void;
  /**
   * `draft` 模式：点保存时调用。返回 `false` 时留在面板
   * （脚本内部校验失败也可用此机制）。
   */
  onSubmit?: (values: T) => boolean | void;
  mode: 'immediate' | 'draft';
}

export interface SettingsFormField {
  control: FormControl;
  field: FieldHandle;
}

type FieldControl = SwitchHandle | SelectHandle | InputHandle;

function isSwitch(control: FormControl): control is SwitchHandle {
  return 'setChecked' in control;
}

function isValued(control: FormControl): control is SelectHandle | InputHandle {
  return 'setValue' in control;
}

function isInvalid(control: FormControl): control is SelectHandle | InputHandle {
  return 'setInvalid' in control;
}

export interface SettingsFormHandle<T extends object> {
  panel: PanelHandle;
  /** 字段句柄；派生文案、动态选项表由脚本通过它操作。 */
  fields: Record<string, SettingsFormField>;
  /** 当前表单值（未提交的 draft 含在内）。 */
  values: () => T;
  /** 用给定值回填并重跑显隐。 */
  fill: (next: T) => void;
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
  destroy: () => void;
}

/**
 * 创建声明式设置表单面板。
 *
 * @param ui 共享界面宿主
 * @param schema 面板结构
 * @param options 取值、显隐、校验与提交
 */
export function createSettingsForm<T extends object>(
  ui: UI,
  schema: SettingsFormSchema,
  options: SettingsFormOptions<T>,
): SettingsFormHandle<T> {
  const panel = createPanel(ui, {
    title: schema.title,
    description: schema.description,
    open: false,
    position: 'center',
    closeLabel: `关闭${schema.title}`,
  });

  const fields: Record<string, SettingsFormField> = {};
  // 只为“隐藏 → 显示”跳变清一次旧错误；每次刷新都清会让保存失败的提示一碰别的控件就消失。
  const shownBefore: Record<string, boolean> = {};

  for (const sectionSchema of schema.sections) {
    const section = createSection(ui, {
      title: sectionSchema.title,
      description: sectionSchema.description,
    });
    for (const fieldSchema of sectionSchema.fields) {
      const initial = (options.get() as Record<string, unknown>)[fieldSchema.key];
      const control: FieldControl =
        fieldSchema.type === 'switch'
          ? createSwitch(ui, { checked: initial === true })
          : fieldSchema.type === 'select'
            ? createSelect(ui, {
                options: fieldSchema.options ?? [],
                value: typeof initial === 'string' ? initial : '',
              })
            : createInput(ui, {
                type: fieldSchema.inputType ?? 'text',
                placeholder: fieldSchema.placeholder,
              });
      // switch 已按 checked 建好；select/input 在这里回填初始值。
      if (!isSwitch(control) && typeof initial === 'string') {
        control.setValue(initial);
      }
      const field = createField(ui, {
        label: fieldSchema.label,
        description: fieldSchema.description,
        control,
        inline:
          (fieldSchema.layout ?? (fieldSchema.type === 'switch' ? 'inline' : 'stacked')) ===
          'inline',
      });
      fields[fieldSchema.key] = { control, field };
      section.body.append(field.el);
    }
    panel.body.append(section.el);
  }

  const readValues = (): T => {
    const base: Record<string, unknown> = { ...(options.get() as Record<string, unknown>) };
    for (const [key, { control }] of Object.entries(fields)) {
      const input = control.input as HTMLInputElement | HTMLSelectElement;
      base[key] =
        input instanceof HTMLInputElement && input.type === 'checkbox'
          ? input.checked
          : input.value;
    }
    return base as T;
  };

  /** 重跑显隐；切回显示的字段清掉隐藏期间的旧错误。 */
  const refresh = (): void => {
    if (!options.visible) return;
    const values = readValues();
    for (const [key, { field }] of Object.entries(fields)) {
      const shown = options.visible(key, values);
      // 隐藏整个字段：只藏控件会把标签与说明留在面板里。
      field.el.hidden = !shown;
      if (shown && shownBefore[key] === false) field.setError(undefined);
      shownBefore[key] = shown;
    }
  };

  // 控件变化：immediate 直接保存，draft 只重跑显隐。
  for (const [key, { control }] of Object.entries(fields)) {
    control.input.addEventListener('change', () => {
      if (options.mode === 'immediate') {
        options.onChange?.({ [key]: (readValues() as Record<string, unknown>)[key] } as Partial<T>);
      }
      refresh();
    });
    if (control.input instanceof HTMLInputElement && control.input.type !== 'checkbox') {
      control.input.addEventListener('input', () => refresh());
    }
  }

  const setError = (key: string, problem: string | undefined): void => {
    const entry = fields[key];
    if (!entry) return;
    const { control, field } = entry;
    if (isInvalid(control)) {
      control.setInvalid(problem !== undefined);
    }
    field.setError(problem);
  };

  const fill = (next: T): void => {
    const record = next as Record<string, unknown>;
    for (const [key, { control }] of Object.entries(fields)) {
      const value = record[key];
      if (isSwitch(control) && typeof value === 'boolean') {
        control.setChecked(value);
      } else if (isValued(control) && typeof value === 'string') {
        control.setValue(value);
      }
      setError(key, undefined);
    }
    refresh();
  };

  if (options.mode === 'draft') {
    const save = createButton(ui, {
      label: '保存',
      variant: 'primary',
      onClick: () => {
        const values = readValues();
        let ok = true;
        if (options.validate) {
          for (const key of Object.keys(fields)) {
            // 看不见的字段不参与保存校验：错误文案没有地方显示。
            if (fields[key]?.field.el.hidden) continue;
            const problem = options.validate(key, (values as Record<string, unknown>)[key], values);
            setError(key, problem);
            if (problem) ok = false;
          }
        }
        if (!ok) return;
        // 脚本内部校验（如跨字段）失败返回 false 时同样留在面板。
        if (options.onSubmit?.(values) === false) return;
        panel.close();
      },
    });
    const cancel = createButton(ui, {
      label: '取消',
      variant: 'secondary',
      onClick: () => {
        fill(options.get());
        panel.close();
      },
    });
    panel.setFooter([cancel.el, save.el]);
  } else {
    const closeButton = createButton(ui, {
      label: '关闭',
      variant: 'secondary',
      onClick: () => panel.close(),
    });
    panel.setFooter([closeButton.el]);
  }

  return {
    panel,
    fields,
    values: readValues,
    fill,
    open: () => {
      fill(options.get());
      panel.open();
    },
    close: () => panel.close(),
    isOpen: () => panel.isOpen(),
    destroy: () => panel.destroy(),
  };
}
