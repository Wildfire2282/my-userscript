import { mountUI, type UI } from '../core/mount';
import { ZH_LABELS } from '../core/labels';

/**
 * 界面宿主：整页只 `mountUI()` 一次，面板懒建。
 *
 * 只收各脚本 `ui/app.ts` 里逐字同形的两行：mountUI 单例与 destroy 置空。
 * Toast 不在这里建：super-drag / selection-copy 不用 Toast，
 * 统一引用会把 toast 全套拉进它们的产物（+11KB raw）。需要 Toast 的脚本
 *（capture-links / youtube）各自 `createToast(host.ensure())` 单例即可。
 * 面板类型各异，懒建留在脚本，只从这里拿 `ui`。
 */

export interface UiHostOptions {
  /** 主题；默认跟随系统。 */
  theme?: 'light' | 'dark' | 'system';
}

export interface UiHost {
  /** 取（必要时创建）共享 UI；整页只挂载一次。 */
  ensure: () => UI;
  /** 销毁 UI 并置空，下次 `ensure` 重建。幂等。 */
  destroy: () => void;
}

/**
 * 创建界面宿主。
 *
 * @param options 主题选项
 */
export function createUiHost(options: UiHostOptions = {}): UiHost {
  let ui: UI | null = null;

  return {
    ensure: () => (ui ??= mountUI({ theme: options.theme ?? 'system', labels: ZH_LABELS })),
    destroy: () => {
      ui?.destroy();
      ui = null;
    },
  };
}
