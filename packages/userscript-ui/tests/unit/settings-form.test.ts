import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSettingsForm, mountUI, type UI } from '../../src/index';

interface Values {
  enabled: boolean;
  name: string;
}

let ui: UI | undefined;

afterEach(() => {
  ui?.destroy();
  ui = undefined;
});

function setup(): UI {
  document.body.replaceChildren();
  ui = mountUI({});
  return ui;
}

describe('createSettingsForm', () => {
  it('immediate 模式：改动即保存', () => {
    const host = setup();
    const onChange = vi.fn();
    const form = createSettingsForm<Values>(
      host,
      {
        title: '功能设置',
        sections: [
          {
            title: '常规',
            fields: [
              { key: 'enabled', type: 'switch', label: '启用' },
              { key: 'name', type: 'input', label: '名称' },
            ],
          },
        ],
      },
      { mode: 'immediate', get: () => ({ enabled: true, name: 'a' }), onChange },
    );
    form.open();
    expect(form.isOpen()).toBe(true);
    // 开关切一次触发 change → onChange。
    const input = form.fields['enabled']?.control.input;
    if (!(input instanceof HTMLInputElement)) throw new Error('switch 控件应为 checkbox');
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onChange).toHaveBeenCalledWith({ enabled: false });
    form.destroy();
  });

  it('draft 模式：保存提交，取消回填', () => {
    const host = setup();
    const onSubmit = vi.fn();
    const form = createSettingsForm<Values>(
      host,
      {
        title: '功能设置',
        sections: [
          {
            title: '常规',
            fields: [
              { key: 'enabled', type: 'switch', label: '启用' },
              { key: 'name', type: 'input', label: '名称' },
            ],
          },
        ],
      },
      { mode: 'draft', get: () => ({ enabled: true, name: 'a' }), onSubmit },
    );
    form.open();
    // draft 点保存才提交。
    const buttons = [...form.panel.footer.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual(['取消', '保存']);
    buttons[1]?.click();
    expect(onSubmit).toHaveBeenCalledWith({ enabled: true, name: 'a' });
    expect(form.isOpen()).toBe(false);
    form.destroy();
  });

  it('draft 校验失败留在面板', () => {
    const host = setup();
    const onSubmit = vi.fn();
    const form = createSettingsForm<Values>(
      host,
      {
        title: '功能设置',
        sections: [
          {
            title: '常规',
            fields: [{ key: 'name', type: 'input', label: '名称' }],
          },
        ],
      },
      {
        mode: 'draft',
        get: () => ({ enabled: true, name: '' }),
        validate: (key, value) => (key === 'name' && value === '' ? '不能为空' : undefined),
        onSubmit,
      },
    );
    form.open();
    const buttons = [...form.panel.footer.querySelectorAll('button')];
    buttons[1]?.click();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(form.isOpen()).toBe(true);
    expect(form.fields['name']?.field.el.textContent).toContain('不能为空');
    form.destroy();
  });

  it('onSubmit 返回 false 留在面板', () => {
    const host = setup();
    const form = createSettingsForm<Values>(
      host,
      {
        title: '功能设置',
        sections: [
          {
            title: '常规',
            fields: [{ key: 'name', type: 'input', label: '名称' }],
          },
        ],
      },
      { mode: 'draft', get: () => ({ enabled: true, name: 'x' }), onSubmit: () => false },
    );
    form.open();
    const buttons = [...form.panel.footer.querySelectorAll('button')];
    buttons[1]?.click();
    expect(form.isOpen()).toBe(true);
    form.destroy();
  });

  it('visible 控制显隐，open 时回填最新值', () => {
    const host = setup();
    let name = 'first';
    const form = createSettingsForm<Values>(
      host,
      {
        title: '功能设置',
        sections: [
          {
            title: '常规',
            fields: [
              { key: 'enabled', type: 'switch', label: '启用' },
              { key: 'name', type: 'input', label: '名称' },
            ],
          },
        ],
      },
      {
        mode: 'immediate',
        get: () => ({ enabled: name === 'first', name }),
        visible: (key, values) => key !== 'name' || values.enabled,
      },
    );
    form.open();
    expect(form.fields['name']?.field.el.hidden).toBe(false);
    name = 'second';
    form.open();
    const nameInput = form.fields['name']?.control.input as HTMLInputElement;
    expect(nameInput.value).toBe('second');
    expect(form.fields['name']?.field.el.hidden).toBe(true);
    form.destroy();
  });

  it('visible=false 隐藏整个字段，且不参与保存校验', () => {
    const host = setup();
    const onSubmit = vi.fn();
    const form = createSettingsForm<Values>(
      host,
      {
        title: '功能设置',
        sections: [
          {
            title: '常规',
            fields: [
              { key: 'enabled', type: 'switch', label: '启用' },
              { key: 'name', type: 'input', label: '名称', description: '只在启用时出现' },
            ],
          },
        ],
      },
      {
        mode: 'draft',
        get: () => ({ enabled: false, name: '' }),
        visible: (key) => key !== 'name',
        validate: (key) => (key === 'name' ? '不能为空' : undefined),
        onSubmit,
      },
    );
    form.open();
    expect(form.fields['name']?.field.el.hidden).toBe(true);
    const buttons = [...form.panel.footer.querySelectorAll('button')];
    buttons[1]?.click();
    expect(onSubmit).toHaveBeenCalledWith({ enabled: false, name: '' });
    form.destroy();
  });

  it('form.destroy() 后控件变化不再触发回调', () => {
    const host = setup();
    const onChange = vi.fn();
    const form = createSettingsForm<Values>(
      host,
      {
        title: '功能设置',
        sections: [
          {
            title: '常规',
            fields: [{ key: 'enabled', type: 'switch', label: '启用' }],
          },
        ],
      },
      { mode: 'immediate', get: () => ({ enabled: true, name: 'a' }), onChange },
    );
    form.open();
    const input = form.fields['enabled']?.control.input;
    if (!(input instanceof HTMLInputElement)) throw new Error('switch 控件应为 checkbox');
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onChange).toHaveBeenCalledTimes(1);

    form.destroy();
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('字段隐藏后重新显示时清掉控件红框', () => {
    const host = setup();
    const form = createSettingsForm<Values>(
      host,
      {
        title: '功能设置',
        sections: [
          {
            title: '常规',
            fields: [
              { key: 'enabled', type: 'switch', label: '启用' },
              { key: 'name', type: 'input', label: '名称' },
            ],
          },
        ],
      },
      {
        mode: 'draft',
        get: () => ({ enabled: true, name: '' }),
        visible: (key, values) => key !== 'name' || values.enabled,
        validate: (key) => (key === 'name' ? '不能为空' : undefined),
        onSubmit: () => false,
      },
    );
    form.open();
    const nameInput = form.fields['name']?.control.input;
    const enabledInput = form.fields['enabled']?.control.input;
    if (!(nameInput instanceof HTMLInputElement) || !(enabledInput instanceof HTMLInputElement)) {
      throw new Error('控件类型不对');
    }

    const buttons = [...form.panel.footer.querySelectorAll('button')];
    buttons[1]?.click();
    expect(nameInput.getAttribute('data-ds-invalid')).toBe('');

    enabledInput.checked = false;
    enabledInput.dispatchEvent(new Event('change', { bubbles: true }));
    enabledInput.checked = true;
    enabledInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(nameInput.hasAttribute('data-ds-invalid')).toBe(false);
    expect(nameInput.hasAttribute('aria-invalid')).toBe(false);
  });
});
