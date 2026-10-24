import { clean } from './format';

/**
 * 打开转写面板。
 *
 * YouTube 没有稳定的按钮选择器，只能按行为信号找：描述区里的“Show transcript”、
 * 或任何 aria-label / 文字里带 transcript 的按钮。找不到就展开描述再找一次；
 * 面板节点出现且真的占据版面才算打开。
 */

function fireClick(element: Element): void {
  if (element instanceof HTMLElement && !isElementVisible(element)) {
    element.scrollIntoView({ block: 'center', behavior: 'instant' });
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
export function expandDescription(doc: Document = document): boolean {
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

  fireClick(moreButton);
  return true;
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

/**
 * 打开转写面板。
 *
 * 每轮：展开描述 → 等界面稳定 → 点一次按钮 → 等面板渲染。
 * 只点一次：click() 与合成 MouseEvent 会各触发一次面板切换，连点两次等于又关上。
 * 第一轮给足 3.6 秒（面板首次展开最慢）；之后每轮只等 1.2 秒，避免打不开时
 * 每次点击都卡十几秒。
 *
 * @returns 面板是否真的打开
 */
export async function openTranscriptPanel(options: OpenPanelOptions = {}): Promise<boolean> {
  const doc = options.doc ?? document;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = options.attempts ?? 4;

  for (let attempt = 0; attempt < attempts && !isPanelOpen(doc); attempt += 1) {
    const waits = attempt === 0 ? 12 : 4;
    expandDescription(doc);
    await sleep(400);
    const candidate = findTranscriptTrigger(doc);
    if (!candidate) continue;
    const trigger =
      candidate.querySelector('button, [role="button"], tp-yt-paper-button') ?? candidate;

    // 只有 click() 抛错才尝试事件方式；普通自定义包装元素应点击其内部按钮。
    let clicked = false;
    try {
      (trigger as HTMLElement).click();
      clicked = true;
    } catch {
      // 继续尝试事件方式
    }
    if (clicked) {
      for (let wait = 0; wait < waits; wait += 1) {
        await sleep(300);
        if (isPanelOpen(doc)) return true;
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
      if (isPanelOpen(doc)) return true;
    }
  }

  return isPanelOpen(doc);
}
