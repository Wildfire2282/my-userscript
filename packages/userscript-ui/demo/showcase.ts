import {
  confirmDialog,
  createAlert,
  createButton,
  createCheckbox,
  createField,
  createInput,
  createLauncher,
  createPanel,
  createSection,
  createSelect,
  createSwitch,
  createToast,
  createTooltip,
  mountUI,
  type PanelHandle,
  type Theme,
  type ToastController,
  type UI,
} from '../src/index';

const ui: UI = mountUI({
  theme: 'light',
  labels: {
    close: '关闭',
    settings: '设置',
    operation: '操作',
    notifications: '通知',
    dismissNotification: '关闭通知',
    closeSettings: '关闭设置',
    scrollHint: '向下滚动查看更多内容',
    cancel: '取消',
    confirm: '确定',
  },
});
const toast = createToast(ui);

ui.useStyles(`
  .demo-status {
    min-height: 18px;
    margin: 0;
    color: var(--ds-muted-foreground);
    font-size: var(--ds-text-xs);
  }

  .demo-action {
    align-self: flex-start;
  }

  /* The operation panel is wide enough for two independent working columns. */
  .demo-op-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
    gap: var(--ds-space-4);
    align-items: start;
  }

  .demo-op-column {
    display: flex;
    flex-direction: column;
    gap: var(--ds-space-3);
    min-width: 0;
  }

  .demo-op-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ds-space-2);
  }
`);

const panel = createPanel(ui, {
  title: '页面增强设置',
  description: '修改后保存生效，设置仅保存在本机。',
  closeLabel: '关闭设置',
  open: true,
});

// The second size preset: a wider working surface for the script's functions.
const operationPanel = createPanel(ui, {
  size: 'operation',
  title: '页面操作',
  description: '扫描、导出等页面功能在操作面板中完成，参数仍在设置面板中调整。',
  closeLabel: '关闭操作面板',
  open: false,
});

const launcher = createLauncher(ui, {
  panel,
  label: '打开设置',
  closeLabel: '关闭设置',
  position: 'bottom-right',
  // Settings and operations share one corner, so opening settings wins.
  onClick: () => operationPanel.close(),
});

const status = document.createElement('p');
status.className = 'demo-status';
status.setAttribute('aria-live', 'polite');
status.textContent = '就绪';

const appearance = createSection(ui, {
  title: '外观',
  description: '只影响脚本界面，不修改宿主页面。',
});

const themeSelect = createSelect(ui, {
  options: [
    { value: 'light', label: '浅色' },
    { value: 'dark', label: '深色' },
  ],
  value: 'light',
  onChange: (value) => {
    ui.setTheme(value as Theme);
    status.textContent = `主题已切换为${value === 'dark' ? '深色' : '浅色'}`;
  },
});

appearance.body.append(
  createField(ui, {
    label: '主题',
    description: '主题通过 CSS Variables 切换。',
    control: themeSelect,
  }).el,
);

const general = createSection(ui, {
  title: '常规',
  description: '控制脚本在页面中的行为。',
});

const enabled = createSwitch(ui, { checked: true });
general.body.append(
  createField(ui, {
    label: '启用页面增强',
    description: '关闭后恢复页面的原始行为。',
    control: enabled,
    inline: true,
  }).el,
);

const modeSelect = createSelect(ui, {
  options: [
    { value: 'standard', label: '标准模式' },
    { value: 'quiet', label: '静默模式' },
    { value: 'debug', label: '调试模式' },
  ],
  value: 'standard',
  onChange: (value) => {
    status.textContent = `模式：${value}`;
  },
});

general.body.append(
  createField(ui, {
    label: '运行模式',
    description: '标准模式适合大多数页面。',
    control: modeSelect,
  }).el,
);

const data = createSection(ui, {
  title: '数据',
  description: '可选的数据源与导出参数。',
});

const apiInput = createInput(ui, {
  type: 'url',
  placeholder: 'https://example.com/api',
  autocomplete: 'off',
});

const apiField = createField(ui, {
  label: 'API 地址',
  description: '留空时使用脚本内置地址。',
  control: apiInput,
});

const maxInput = createInput(ui, {
  type: 'number',
  value: '50',
  min: 1,
  max: 200,
  step: 1,
  inputMode: 'numeric',
});

const maxField = createField(ui, {
  label: '最大条目数',
  description: '允许范围 1–200。',
  control: maxInput,
});

const copyToClipboard = createCheckbox(ui, { checked: true });
const copyField = createField(ui, {
  label: '导出后复制到剪贴板',
  description: '只复制本次导出的内容。',
  control: copyToClipboard,
  inline: true,
});

data.body.append(apiField.el, maxField.el, copyField.el);

const danger = createSection(ui, {
  title: '危险操作',
  description: '清空后需要重新配置。',
});

const dangerAlert = createAlert(ui, {
  variant: 'warning',
  title: '此操作不可撤销',
  description: '确认后会删除当前脚本的全部本地配置。',
});

const clearSettings = async () => {
  const confirmed = await confirmDialog(ui, {
    title: '清空本地设置？',
    description: '这会删除当前脚本的全部配置，且无法撤销。',
    confirmLabel: '清空',
    cancelLabel: '取消',
    destructive: true,
  });

  if (!confirmed) {
    status.textContent = '已取消清空';
    return;
  }

  status.textContent = '已清空本地设置（演示，不会写入存储）';
  toast.success('本地设置已清空', {
    description: '演示环境不会写入存储。',
  });
};

const clearButton = createButton(ui, {
  label: '清空本地设置',
  variant: 'destructive',
  // Buttons take a void handler; keep the async flow explicit.
  onClick: () => {
    void clearSettings();
  },
});
clearButton.el.classList.add('demo-action');
danger.body.append(dangerAlert.el, clearButton.el);

const workspace = createSection(ui, {
  title: '批量功能',
  description: '扫描、导出等操作在更宽的操作面板中完成。',
});

const openOperationButton = createButton(ui, {
  label: '打开操作面板',
  variant: 'secondary',
  onClick: () => {
    panel.close();
    // Opening from settings should return focus to the shared entry point.
    launcher.el.focus();
    operationPanel.open();
  },
});
openOperationButton.el.classList.add('demo-action');
workspace.body.append(openOperationButton.el);

panel.body.append(appearance.el, general.el, data.el, workspace.el, danger.el, status);

const resetButton = createButton(ui, {
  label: '重置',
  variant: 'secondary',
  onClick: () => {
    enabled.setChecked(true);
    themeSelect.setValue('light');
    ui.setTheme('light');
    modeSelect.setValue('standard');
    apiInput.setValue('');
    maxInput.setValue('50');
    copyToClipboard.setChecked(true);
    apiField.setError(undefined);
    maxField.setError(undefined);
    status.textContent = '已恢复默认设置';
    toast.info('已恢复默认设置');
  },
});

let saveTimer: number | undefined;

const saveButton = createButton(ui, {
  label: '保存设置',
  variant: 'primary',
  onClick: () => {
    const apiValue = apiInput.getValue().trim();
    if (apiValue && !isHttpUrl(apiValue)) {
      apiField.setError('请输入有效的 http(s) 地址。');
      apiInput.el.focus();
      status.textContent = '请检查输入';
      return;
    }

    apiField.setError(undefined);
    if (!maxInput.getValue().trim() || !maxInput.input.validity.valid) {
      maxField.setError('请输入 1–200 之间的整数。');
      maxInput.el.focus();
      status.textContent = '请检查输入';
      return;
    }

    maxField.setError(undefined);
    saveButton.setLoading(true);
    saveTimer = window.setTimeout(() => {
      saveTimer = undefined;
      saveButton.setLoading(false);
      status.textContent = '设置已保存（演示）';
      toast.success('设置已保存', {
        description: '演示环境不会写入存储。',
      });
    }, 450);
  },
});

ui.onDestroy(() => window.clearTimeout(saveTimer));

panel.setFooter([resetButton.el, saveButton.el]);

const operationStatus = document.createElement('p');
operationStatus.className = 'demo-status';
operationStatus.setAttribute('aria-live', 'polite');
operationStatus.textContent = '等待操作';

const filters = createSection(ui, {
  title: '筛选条件',
  description: '只处理匹配的元素。',
});

const keywordInput = createInput(ui, {
  placeholder: '标题或选择器',
  autocomplete: 'off',
});

filters.body.append(
  createField(ui, {
    label: '关键词',
    description: '留空表示匹配页面上的全部元素。',
    control: keywordInput,
  }).el,
);

const scopeSelect = createSelect(ui, {
  options: [
    { value: 'page', label: '当前页面' },
    { value: 'selection', label: '当前选区' },
    { value: 'frames', label: '全部框架' },
  ],
  value: 'page',
});

filters.body.append(
  createField(ui, {
    label: '处理范围',
    description: '只读操作不会修改页面内容。',
    control: scopeSelect,
  }).el,
);

const includeHidden = createCheckbox(ui, { checked: false });
filters.body.append(
  createField(ui, {
    label: '包含隐藏元素',
    description: '隐藏元素只在导出摘要时使用。',
    control: includeHidden,
    inline: true,
  }).el,
);

const actions = createSection(ui, {
  title: '可用操作',
  description: '所有操作都在本地完成。',
});

const scanButton = createButton(ui, {
  label: '扫描页面',
  variant: 'secondary',
  onClick: () => {
    operationStatus.textContent = '已扫描 42 个可操作元素';
    toast.success('扫描完成', { description: '演示数据，不会修改页面。' });
  },
});

const exportButton = createButton(ui, {
  label: '导出摘要',
  variant: 'outline',
  onClick: () => {
    operationStatus.textContent = '摘要已生成（演示）';
    toast.info('摘要已生成');
  },
});

const resetOperationButton = createButton(ui, {
  label: '重置筛选',
  variant: 'outline',
  onClick: () => {
    keywordInput.setValue('');
    scopeSelect.setValue('page');
    includeHidden.setChecked(false);
    operationStatus.textContent = '筛选条件已重置';
    toast.info('筛选条件已重置');
  },
});

const actionRow = document.createElement('div');
actionRow.className = 'demo-op-actions';
actionRow.append(scanButton.el, exportButton.el, resetOperationButton.el);
actions.body.append(actionRow);

const actionColumn = document.createElement('div');
actionColumn.className = 'demo-op-column';
actionColumn.appendChild(actions.el);

const filterColumn = document.createElement('div');
filterColumn.className = 'demo-op-column';
filterColumn.appendChild(filters.el);

const operationGrid = document.createElement('div');
operationGrid.className = 'demo-op-grid';
operationGrid.append(actionColumn, filterColumn);

operationPanel.body.append(operationGrid, operationStatus);

const openSettingsButton = createButton(ui, {
  label: '打开设置面板',
  variant: 'secondary',
  onClick: () => {
    operationPanel.close();
    panel.open();
  },
});

const runButton = createButton(ui, {
  label: '执行操作',
  variant: 'primary',
  onClick: () => {
    const keyword = keywordInput.getValue().trim();
    operationStatus.textContent = keyword
      ? `已对「${keyword}」执行操作（演示）`
      : '已对全部元素执行操作（演示）';
    toast.success('操作已执行', { description: '演示环境不会修改页面。' });
  },
});

operationPanel.setFooter([openSettingsButton.el, runButton.el]);

createTooltip(ui, launcher.el, {
  content: '打开或关闭设置面板',
  placement: 'left',
});

declare global {
  interface Window {
    __dsDemoReady?: boolean;
    __dsDemo?: {
      ui: UI;
      panel: PanelHandle;
      operationPanel: PanelHandle;
      toast: ToastController;
    };
  }
}

window.__dsDemo = { ui, panel, operationPanel, toast };
window.__dsDemoReady = true;

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
