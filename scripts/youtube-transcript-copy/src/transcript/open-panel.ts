import { clean } from './format';

/**
 * 打开转写面板。
 *
 * YouTube 没有稳定的按钮选择器，只能按行为信号找：描述区里的“Show transcript”、
 * 或任何 aria-label / 文字里带 transcript 的按钮。找不到就展开描述再找一次；
 * 面板节点出现且真的占据版面才算打开。
 */

function fireClick(element: Element, onScroll?: () => void): void {
  if (element instanceof HTMLElement && !isElementVisible(element)) {
    element.scrollIntoView({ block: 'center', behavior: 'instant' });
    // 回调在滚动之后：调用方借此记下“我们把页面滚到了哪里”，收尾时才知道要不要滚回去。
    onScroll?.();
  }
  (element as HTMLElement).click();
}

function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.offsetParent !== null;
}

function isElementVisible(element: Element | null): boolean {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && isVisible(element);
}

function ariaOrText(element: Element): string {
  return clean(element.getAttribute('aria-label')) || clean(element.textContent);
}

/** 各语言里“显示转写文稿”的说法；英文之外至少覆盖简中、日、韩、俄与拉丁语系。 */
const TRANSCRIPT_LABEL = /transcript|转写|转文字|文字起こし|스크립트|транскрип|transcri/i;

/** 按 aria-label 优先、按钮文字兜底的顺序找“显示转写文稿”。 */
export function findTranscriptTrigger(doc: Document = document): Element | null {
  // 固定的组件名比按钮文字可靠：描述区里的转写入口是独立组件，不随界面语言变。
  const section = doc.querySelector('ytd-video-description-transcript-section-renderer');
  if (section && section.getBoundingClientRect().width > 0) {
    const buttons = [
      ...section.querySelectorAll(
        'button, [role="button"], tp-yt-paper-button, yt-button-shape, button-view-model',
      ),
    ];
    const button =
      buttons.find(
        (candidate) =>
          candidate.tagName === 'BUTTON' || candidate.getAttribute('role') === 'button',
      ) ?? buttons[0];
    if (button) return button;
  }

  const expander = doc.querySelector('ytd-text-inline-expander');
  if (expander) {
    const buttons = [
      ...expander.querySelectorAll('button, [role="button"], yt-button-shape, button-view-model'),
    ].filter((button) => clean(button.getAttribute('aria-label')) !== '');

    const byAriaShow = buttons.find((button) =>
      /show\s+transcript/i.test(clean(button.getAttribute('aria-label'))),
    );
    if (byAriaShow) return byAriaShow;

    const byAria = buttons.find((button) =>
      TRANSCRIPT_LABEL.test(clean(button.getAttribute('aria-label'))),
    );
    if (byAria) return byAria;

    const byText = buttons.find((button) => TRANSCRIPT_LABEL.test(clean(button.textContent)));
    if (byText) return byText;
  }

  // 描述区之外：只认真正参与布局的按钮，避免点到模板里的隐藏副本。
  for (const button of doc.querySelectorAll(
    'button, [role="button"], yt-button-shape, button-view-model',
  )) {
    if (!(button instanceof HTMLElement) || !button.offsetParent) continue;
    if (
      TRANSCRIPT_LABEL.test(clean(button.getAttribute('aria-label')) + clean(button.textContent))
    ) {
      return button;
    }
  }
  return null;
}

/** 展开被折叠的视频描述，转写按钮通常藏在里面。 */
export function expandDescription(doc: Document = document, onScroll?: () => void): boolean {
  const expander = doc.querySelector(
    'ytd-text-inline-expander, ytd-expandable-video-description-body-renderer',
  );
  if (!expander) return false;

  const moreButton = [
    ...expander.querySelectorAll('button, [role="button"], tp-yt-paper-button, yt-button-shape'),
  ].find(
    (button) =>
      /(?:\.{3}\s*more|\.\.\.更多|展开更多|show more|展开)/i.test(ariaOrText(button)) ||
      button.id === 'expand',
  );
  if (!moreButton) return false;

  fireClick(moreButton, onScroll);
  return true;
}

/** 收起这次为找按钮而展开的描述；找不到“收起”入口就不动。 */
export function collapseDescription(doc: Document = document): boolean {
  const expander = doc.querySelector(
    'ytd-text-inline-expander, ytd-expandable-video-description-body-renderer',
  );
  if (!expander) return false;

  const lessButton = [
    ...expander.querySelectorAll('button, [role="button"], tp-yt-paper-button, yt-button-shape'),
  ].find((button) =>
    /(?:\.{3}\s*less|show less|收起|折りたたみ|접기|свернуть)/i.test(ariaOrText(button)),
  );
  if (!lessButton) return false;

  (lessButton as HTMLElement).click();
  return true;
}

/** 面板容器里是否装着转写文稿；通用面板（评论、简介）不能误关。 */
function panelHoldsTranscript(panel: Element): boolean {
  if (/transcript/i.test(panel.getAttribute('target-id') ?? '')) return true;
  return (
    panel.querySelector(
      'ytd-transcript-renderer, transcript-segment-view-model, ytd-transcript-segment-renderer',
    ) !== null
  );
}

/**
 * 关掉转写面板。
 *
 * 优先点面板自己的关闭按钮：不同语言下按钮文字会变，但 `#visibility-button` /
 * `#close-button` 是组件自带的 id。
 */
export function closeTranscriptPanel(doc: Document = document): boolean {
  for (const panel of doc.querySelectorAll('ytd-engagement-panel-section-list-renderer')) {
    if (!panelHoldsTranscript(panel)) continue;
    const closeButton = panel.querySelector(
      '#visibility-button button, #close-button button, button[aria-label*="close" i], button[aria-label*="关闭"]',
    );
    if (closeButton instanceof HTMLElement) {
      closeButton.click();
      return true;
    }
  }
  return false;
}

/** 面板里已经有可见的片段节点。 */
export function isPanelOpen(doc: Document = document): boolean {
  for (const node of doc.querySelectorAll(
    'transcript-segment-view-model, ytd-transcript-segment-renderer',
  )) {
    if (node.getBoundingClientRect().width > 0) return true;
  }
  return false;
}

export interface OpenPanelOptions {
  doc?: Document;
  sleep?: (ms: number) => Promise<void>;
  /** 最多重试几轮（每轮会展开描述、点一次按钮）。 */
  attempts?: number;
}

export interface OpenPanelResult {
  /** 面板是否真的打开。 */
  opened: boolean;
  /** 把这次为打开面板而动过的页面恢复原状；没动过就是空操作，可重复调用。 */
  restore: () => void;
}

/**
 * 打开转写面板。
 *
 * 每轮：展开描述 → 等界面稳定 → 点一次按钮 → 等面板渲染。
 * 只点一次：click() 与合成 MouseEvent 会各触发一次面板切换，连点两次等于又关上。
 * 第一轮给足 3.6 秒（面板首次展开最慢）；之后每轮只等 1.2 秒，避免打不开时
 * 每次点击都卡十几秒。
 *
 * 返回值带一个收尾函数：只有本次真的展开了描述、滚动了页面或打开了面板时才会恢复，
 * 打开前就已经存在的面板与用户自己滚到的位置一律不动。
 *
 * @returns 面板是否打开，以及恢复页面的收尾函数
 */
export async function openTranscriptPanel(
  options: OpenPanelOptions = {},
): Promise<OpenPanelResult> {
  const doc = options.doc ?? document;
  const win = doc.defaultView;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = options.attempts ?? 4;
  const wasOpen = isPanelOpen(doc);
  const before = { x: win?.scrollX ?? 0, y: win?.scrollY ?? 0 };
  let expanded = false;
  let scrolledTo: { x: number; y: number } | null = null;
  const noteScroll = (): void => {
    if (win) scrolledTo = { x: win.scrollX, y: win.scrollY };
  };

  for (let attempt = 0; attempt < attempts && !isPanelOpen(doc); attempt += 1) {
    const waits = attempt === 0 ? 12 : 4;
    if (expandDescription(doc, noteScroll)) expanded = true;
    await sleep(400);
    const candidate = findTranscriptTrigger(doc);
    if (!candidate) continue;
    const trigger =
      candidate.querySelector('button, [role="button"], tp-yt-paper-button') ?? candidate;

    // 只有 click() 抛错才尝试事件方式；普通自定义包装元素应点击其内部按钮。
    let clicked = false;
    try {
      fireClick(trigger, noteScroll);
      clicked = true;
    } catch {
      // 继续尝试事件方式
    }
    if (clicked) {
      for (let wait = 0; wait < waits; wait += 1) {
        await sleep(300);
        if (isPanelOpen(doc)) break;
      }
      continue;
    }
    try {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } catch {
      // 按钮已不可点击：下一轮再试
    }

    for (let wait = 0; wait < waits; wait += 1) {
      await sleep(300);
      if (isPanelOpen(doc)) break;
    }
  }

  const opened = isPanelOpen(doc);
  let restored = false;
  return {
    opened,
    restore() {
      if (restored) return;
      restored = true;
      // 先把“用户是否还在我们滚到的位置”定下来：关面板会让布局变化，之后再判断就晚了。
      const scrollBack =
        scrolledTo !== null &&
        win !== null &&
        Math.abs(win.scrollX - scrolledTo.x) <= 2 &&
        Math.abs(win.scrollY - scrolledTo.y) <= 2;
      if (!wasOpen && opened) closeTranscriptPanel(doc);
      if (expanded) collapseDescription(doc);
      if (scrollBack && win) {
        win.scrollTo({ left: before.x, top: before.y, behavior: 'instant' });
      }
    },
  };
}
