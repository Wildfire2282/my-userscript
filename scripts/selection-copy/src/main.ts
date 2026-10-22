import { createClipboard } from '@shared';
import { createCopyAction } from './features/copy-action';
import { installCopySensor } from './features/sensor';
import { createIndicatorApp } from './ui/app';

/**
 * 入口：安装选中传感器，第一次复制成功时才创建 UI。
 *
 * 每个 frame 独立注入：父文档收不到 iframe 内的鼠标事件，加 `@noframes` 会丢掉
 * iframe 内的复制能力。同一文档只装一份，用 DOM 属性兜底——不同管理器的沙箱之间
 * window 不一定共享，DOM 一定共享。
 */

const INSTALL_LOCK_ATTRIBUTE = 'data-selection-auto-copy-installed';

function start(): void {
  const root = document.documentElement;
  if (!root || root.hasAttribute(INSTALL_LOCK_ATTRIBUTE)) return;
  root.setAttribute(INSTALL_LOCK_ATTRIBUTE, '');

  const indicator = createIndicatorApp();
  const copy = createCopyAction({
    clipboard: createClipboard(),
    showIndicator: indicator.show,
  });

  installCopySensor({ onCopy: (target) => void copy(target) });
}

try {
  start();
} catch (error) {
  console.error('[selection-copy] 启动失败', error);
}
