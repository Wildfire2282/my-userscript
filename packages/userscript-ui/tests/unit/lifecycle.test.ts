import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createButton,
  createCheckbox,
  createField,
  createInput,
  createPanel,
  createSection,
  createSelect,
  createSwitch,
  createTextarea,
  createToast,
  mountUI,
  type UI,
} from '../../src/index';

let ui: UI;

beforeEach(() => {
  ui = mountUI();
});

afterEach(() => {
  ui.destroy();
  vi.useRealTimers();
});

describe('component lifecycle', () => {
  const control = (
    name: string,
    create: (onEvent: () => void) => {
      el: HTMLElement;
      target: HTMLElement;
      event: string;
      destroy(): void;
    },
  ) => ({ name, create });

  const controls = [
    control('button', (onClick) => {
      const handle = createButton(ui, { label: '保存', onClick });
      return { el: handle.el, target: handle.el, event: 'click', destroy: handle.destroy };
    }),
    control('input', (onChange) => {
      const handle = createInput(ui, { onChange });
      return { el: handle.el, target: handle.input, event: 'change', destroy: handle.destroy };
    }),
    control('textarea', (onChange) => {
      const handle = createTextarea(ui, { onChange });
      return { el: handle.el, target: handle.input, event: 'change', destroy: handle.destroy };
    }),
    control('select', (onChange) => {
      const handle = createSelect(ui, {
        options: [{ value: 'a', label: 'A' }],
        onChange: (value: string, event: Event) => {
          void value;
          onChange();
          void event;
        },
      });
      return { el: handle.el, target: handle.input, event: 'change', destroy: handle.destroy };
    }),
    control('switch', (onChange) => {
      const handle = createSwitch(ui, {
        onChange: (checked: boolean, event: Event) => {
          void checked;
          onChange();
          void event;
        },
      });
      return { el: handle.el, target: handle.input, event: 'change', destroy: handle.destroy };
    }),
    control('checkbox', (onChange) => {
      const handle = createCheckbox(ui, {
        onChange: (checked: boolean, event: Event) => {
          void checked;
          onChange();
          void event;
        },
      });
      return { el: handle.el, target: handle.input, event: 'change', destroy: handle.destroy };
    }),
  ];

  it.each(controls)('$name can be torn down on its own', ({ create }) => {
    const handler = vi.fn();
    const built = create(handler);
    ui.layers.base.appendChild(built.el);

    built.destroy();
    expect(built.el.isConnected).toBe(false);

    built.target.dispatchEvent(new Event(built.event));
    expect(handler).not.toHaveBeenCalled();
  });

  it('detaches rebuilt nodes instead of keeping them until ui.destroy()', () => {
    const section = createSection(ui, { title: '常规' });
    const first = createInput(ui, {});
    section.body.append(first.el);

    section.body.replaceChildren();
    first.el.remove();
    first.destroy();

    expect(ui.layers.base.contains(section.el)).toBe(false);
    expect(first.el.isConnected).toBe(false);

    section.destroy();
    expect(section.el.isConnected).toBe(false);
  });

  it('cascades a field teardown to its wrapper', () => {
    const input = createInput(ui, {});
    const field = createField(ui, { label: '名称', control: input });
    ui.layers.base.appendChild(field.el);

    field.destroy();

    expect(field.el.isConnected).toBe(false);
    expect(input.el.isConnected).toBe(false);
  });

  it('rejects components created after ui.destroy()', () => {
    ui.destroy();

    expect(() => createButton(ui, { label: '保存' })).toThrow(/ui\.destroy\(\)/);
    expect(() => createInput(ui)).toThrow(/ui\.destroy\(\)/);
    expect(() => createPanel(ui, { title: '设置' })).toThrow(/ui\.destroy\(\)/);
    expect(() => createSection(ui)).toThrow(/ui\.destroy\(\)/);
    expect(() => createToast(ui)).toThrow(/ui\.destroy\(\)/);
  });

  it('keeps toast errors after its own controller was destroyed', () => {
    const toast = createToast(ui);
    toast.destroy();
    expect(() => toast.info('迟到的提示')).toThrow(/destroyed/);
    // The UI is still alive, so a fresh controller works.
    const next = createToast(ui);
    expect(next.info('提示').el.isConnected).toBe(true);
  });
});

describe('panel footer', () => {
  it('shows the footer only when it has content', () => {
    const panel = createPanel(ui, { title: '设置' });
    expect(panel.footer.hidden).toBe(true);

    const save = createButton(ui, { label: '保存' });
    panel.setFooter(save.el);

    expect(panel.footer.hidden).toBe(false);
    expect(panel.footer.contains(save.el)).toBe(true);

    panel.setFooter();
    expect(panel.footer.hidden).toBe(true);
    expect(panel.footer.childElementCount).toBe(0);
  });

  it('accepts footer content up front', () => {
    const panel = createPanel(ui, {
      title: '设置',
      footer: [document.createElement('span')],
    });
    expect(panel.footer.hidden).toBe(false);
    expect(panel.footer.childElementCount).toBe(1);
  });

  it('can skip moving focus when it opens', () => {
    const outside = createButton(ui, { label: '其他操作' });
    ui.mount(outside.el);
    outside.el.focus();

    const panel = createPanel(ui, { title: '设置', open: false, autoFocus: false });
    const control = createButton(ui, { label: '编辑' });
    panel.body.append(control.el);

    panel.open();

    expect(panel.isOpen()).toBe(true);
    expect(ui.root.activeElement).toBe(outside.el);
  });
});

describe('labels', () => {
  it('applies one label set to every component', () => {
    ui.destroy();
    ui = mountUI({
      labels: {
        close: '关闭',
        settings: '设置',
        operation: '操作',
        notifications: '通知',
        dismissNotification: '关闭通知',
        closeSettings: '关闭设置',
        scrollHint: '继续下滑',
        cancel: '取消',
        confirm: '确定',
      },
    });

    const panel = createPanel(ui, { title: '标题' });
    expect(panel.el.querySelector('.ds-panel-close')?.getAttribute('aria-label')).toBe('关闭');
    expect(panel.el.querySelector('.ds-scroll-hint')?.textContent).toContain('继续下滑');

    const untitled = createPanel(ui, {});
    expect(untitled.el.getAttribute('aria-label')).toBe('设置');

    const operations = createPanel(ui, { size: 'operation' });
    expect(operations.el.getAttribute('aria-label')).toBe('操作');

    const toast = createToast(ui);
    expect(toast.info('提示').el.querySelector('.ds-toast-close')?.getAttribute('aria-label')).toBe(
      '关闭通知',
    );
    expect(ui.layers.toast.querySelector('.ds-toast-viewport')?.getAttribute('aria-label')).toBe(
      '通知',
    );
  });
});

describe('field invalid ownership', () => {
  it('keeps an invalid state the control sets after the field exists', () => {
    const input = createInput(ui, {});
    const field = createField(ui, { label: '地址', control: input });

    input.setInvalid(true);
    field.setError('必填');
    expect(input.input.getAttribute('aria-invalid')).toBe('true');

    field.setError();
    expect(input.input.getAttribute('aria-invalid')).toBe('true');

    input.setInvalid(false);
    expect(input.input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('keeps an invalid state that was set before the field existed', () => {
    const input = createInput(ui, {});
    input.input.setAttribute('aria-invalid', 'true');
    const field = createField(ui, { label: '地址', control: input });

    field.setError('必填');
    field.setError();

    expect(input.input.getAttribute('aria-invalid')).toBe('true');
  });

  it('keeps a visible field error when the control clears its own invalid state', () => {
    const input = createInput(ui, {});
    const field = createField(ui, { label: '地址', control: input });

    field.setError('必填');
    input.setInvalid(false);

    expect(field.el.querySelector('.ds-field-error')?.hasAttribute('hidden')).toBe(false);
    expect(input.input.getAttribute('aria-invalid')).toBe('true');

    field.setError();
    expect(input.input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('removes only its own invalid and description contributions on destroy', () => {
    const input = createInput(ui, {});
    input.input.setAttribute('aria-describedby', 'external-help');
    const field = createField(ui, { label: '地址', control: input, description: '说明' });
    field.setError('必填');

    const errorId = field.el.querySelector('.ds-field-error')?.id;
    expect(input.input.getAttribute('aria-describedby')).toContain(errorId);
    expect(input.input.getAttribute('aria-invalid')).toBe('true');

    field.destroy();

    expect(input.input.getAttribute('aria-describedby')).toBe('external-help');
    expect(input.input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.input.hasAttribute('data-ds-field-invalid')).toBe(false);
  });

  it('does not let an old field clear or replace a reused control state', () => {
    const input = createInput(ui);
    const first = createField(ui, { control: input, error: '旧错误' });
    first.destroy();
    const next = createField(ui, { control: input, error: '新错误', description: '新说明' });
    const describedBy = input.input.getAttribute('aria-describedby');

    first.destroy();
    first.setError('迟到的错误');
    first.setDescription('迟到的说明');

    expect(input.input.getAttribute('aria-invalid')).toBe('true');
    expect(input.input.getAttribute('aria-describedby')).toBe(describedBy);
    expect(next.el.querySelector('.ds-field-error')?.textContent).toBe('新错误');
  });

  it('cleans field contributions during UI destruction even for an adopted control', () => {
    const input = document.createElement('input');
    input.setAttribute('aria-describedby', 'external-help');
    const field = createField(ui, {
      control: { el: input, input },
      description: '说明',
      error: '必填',
    });
    ui.mount(field.el);

    ui.destroy();

    expect(input.getAttribute('aria-describedby')).toBe('external-help');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.parentElement?.isConnected).toBe(false);
  });
});
