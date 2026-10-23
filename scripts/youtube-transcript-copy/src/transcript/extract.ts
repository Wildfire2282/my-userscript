import { clean, tsToSec } from './format';
import type { Segment } from './types';

/**
 * 从 YouTube 的几种数据形状里提取转写片段。
 *
 * YouTube 改版频繁，同一份文稿可能出现在 `get_panel` 响应、json3 字幕、面板 DOM 的
 * view-model 或纯文本行里。每个提取器都只认一种形状、拿不到就返回 `null`，
 * 由 `service.ts` 按顺序降级——这样改版时坏掉的只有其中一个策略。
 */

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberOr(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `engagementPanels[*]...cueGroups` 里的转写；返回 null 表示这份响应没有文稿。 */
export function extractFromPanelResponse(data: unknown): Segment[] | null {
  const root = asRecord(data);
  if (!root) return null;

  const segments: Segment[] = [];
  for (const entry of asArray(root.engagementPanels)) {
    const wrapper = asRecord(entry);
    if (!wrapper) continue;
    const panel =
      asRecord(wrapper.engagementPanelSectionListRenderer) ??
      asRecord(wrapper.engagementPanel) ??
      wrapper;
    // 2025+ 起面板标识为 engagement-panel-searchable-transcript；更早的版本可能没有标识，
    // 只能按内容里是否出现 cueGroup 判断。
    if (
      !/transcript/i.test(asString(panel.panelIdentifier)) &&
      !/cueGroup/i.test(JSON.stringify(panel))
    ) {
      continue;
    }

    const bodyRenderer = asRecord(
      asRecord(asRecord(asRecord(panel.content)?.transcriptRenderer)?.body)?.transcriptBodyRenderer,
    );
    for (const group of asArray(bodyRenderer?.cueGroups)) {
      const groupRecord = asRecord(group);
      if (!groupRecord) continue;
      const cueGroup = asRecord(groupRecord.transcriptCueGroupRenderer);
      const cues = asArray(cueGroup?.cues).length
        ? asArray(cueGroup?.cues)
        : asArray(groupRecord.cues);
      for (const cue of cues) {
        const cueRecord = asRecord(cue);
        if (!cueRecord) continue;
        const renderer = asRecord(cueRecord.transcriptCueRenderer);
        const text =
          asString(renderer?.simpleText) || asString(asRecord(renderer?.cue)?.simpleText);
        if (!text) continue;
        segments.push({
          start: numberOr(renderer?.startOffsetMs) ?? numberOr(cueRecord.startOffsetMs) ?? 0,
          text: clean(text),
        });
      }
    }
  }

  return segments.length > 0 ? segments : null;
}

/** json3 字幕（captionTracks[0].baseUrl + `fmt=json3`）里的转写。 */
export function extractFromJson3(data: unknown): Segment[] | null {
  const root = asRecord(data);
  if (!root) return null;

  const segments: Segment[] = [];
  for (const event of asArray(root.events)) {
    const record = asRecord(event);
    if (!record) continue;
    const text = clean(
      asArray(record.segs)
        .map((part) => asString(asRecord(part)?.utf8))
        .join(' '),
    );
    if (!text) continue;
    segments.push({ start: numberOr(record.tStartMs) ?? 0, text });
  }
  return segments.length > 0 ? segments : null;
}

/** 面板里新的 view-model 结构：每个片段一个节点，时间戳与文字分开。 */
export function extractFromViewModel(root: ParentNode): Segment[] | null {
  const segments: Segment[] = [];
  for (const host of root.querySelectorAll(
    'transcript-segment-view-model, ytd-transcript-segment-renderer',
  )) {
    const timestampNode = host.querySelector(
      '.ytwTranscriptSegmentViewModelTimestamp, #timestamp, .segment-timestamp, [aria-hidden="true"]',
    );
    const timestamp = (timestampNode?.textContent ?? '').trim();
    const textNode =
      host.querySelector('span[role="text"], #segment-text, .segment-text') ??
      findLeafWithText(host);
    const text = clean(textNode?.textContent);
    if (text && text !== timestamp) {
      segments.push({ start: tsToSec(timestamp) * 1000, text });
    }
  }
  if (segments.length > 0) return segments;

  // 兜底：新版把时间戳与文字拆成了相邻的 span，找不到片段容器时按“时间戳 + 同块文字”配对。
  // 只扫转写面板容器，不扫整个 body：YouTube 首页有几千个节点，全页扫每次复制都卡一下。
  const scope = scopeRoot(root);
  const timestampPattern = /^\d{1,2}(:\d{2}){1,2}$/;
  const seen = new WeakSet<Element>();
  const candidates = [...scope.querySelectorAll('span, div')].filter(
    (node) => node.children.length === 0 && timestampPattern.test((node.textContent ?? '').trim()),
  );
  for (const node of candidates) {
    let block: Element | null =
      node.closest(
        '[role="button"], button, ytd-transcript-segment-renderer, transcript-segment-view-model',
      ) ?? node.parentElement;
    while (block && seen.has(block)) block = block.parentElement;
    if (!block || seen.has(block)) continue;
    seen.add(block);

    const timestamp = clean(node.textContent);
    const blockText = clean(block.textContent);
    if (timestampPattern.test(blockText) && blockText.length < 30) continue;
    const text = blockText.replace(/^\d{1,2}(:\d{2}){1,2}/, '').trim();
    // 不要求英文字母：纯中文转写（“你好世界”）也要收进来。
    if (text.length > 1) {
      segments.push({ start: tsToSec(timestamp) * 1000, text });
    }
  }
  return segments.length > 0 ? segments : null;
}

/** 最老的结构：每个时间戳与文字在同一行文本里（`0:05 你好`）。 */
export function extractFromPanelDump(root: ParentNode): Segment[] | null {
  const linePattern = /^\d{1,2}(?::\d{2}){1,2}\s+/;
  const segments: Segment[] = [];
  for (const node of scopeRoot(root).querySelectorAll('div, span, p')) {
    if (node.children.length !== 0) continue;
    const content = node.textContent ?? '';
    if (!linePattern.test(content)) continue;
    const match = /^(\d{1,2}(?::\d{2}){1,2})\s+(.*)$/.exec(content);
    if (!match?.[1] || match[2] === undefined) continue;
    segments.push({ start: tsToSec(match[1]) * 1000, text: clean(match[2]) });
  }
  return segments.length > 0 ? segments : null;
}

/** 转写面板容器：兜底扫描只在这里面找，找不到才退回全页。
 *
 * 只认转写特有的容器：通用的 engagement-panel 也长这样（评论区、简介区都是），
 * 写进去的话，改版后兜底会去扫评论区，把“0:05 这里好笑”当成字幕抄回来。 */
function scopeRoot(root: ParentNode): ParentNode {
  const doc = root as Document;
  if (typeof doc.querySelector !== 'function') return root;
  const panel = doc.querySelector('ytd-transcript-renderer, [target-id*="transcript"]');
  return panel ?? root;
}

/** 片段容器里第一个有文字的叶子节点；不要求英文字母，中文也能命中。 */
function findLeafWithText(root: ParentNode): Element | null {
  for (const node of root.querySelectorAll('*')) {
    if (node.children.length === 0 && clean(node.textContent) !== '') return node;
  }
  return null;
}
