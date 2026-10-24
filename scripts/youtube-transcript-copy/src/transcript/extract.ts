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

/**
 * 面板里是否出现 cueGroup：直接按 key 找，比整块 JSON.stringify 快得多。
 * 面板响应可能很大，每份都序列化一次会拖慢每次复制。
 */
function hasCueGroup(value: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (Array.isArray(value)) return value.some((entry) => hasCueGroup(entry, depth + 1));
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if ('transcriptCueGroupRenderer' in record || 'cueGroup' in record) return true;
  return Object.values(record).some((entry) => hasCueGroup(entry, depth + 1));
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
    if (!/transcript/i.test(asString(panel.panelIdentifier)) && !hasCueGroup(panel)) {
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
        const cueRecord2 = asRecord(renderer?.cue) ?? asRecord(cueRecord.cue);
        // 新版把一行拆成 `runs[]`（每段一个对象），只读 simpleText 会整段丢掉。
        const runs = asArray(cueRecord2?.runs ?? renderer?.runs)
          .map((run) => asString(asRecord(run)?.text))
          .join('');
        const text =
          runs !== '' && clean(runs) !== ''
            ? clean(runs)
            : asString(renderer?.simpleText) ||
              asString(cueRecord2?.simpleText) ||
              asString(asRecord(renderer?.cue)?.simpleText);
        if (!text) continue;
        segments.push({
          start: numberOr(renderer?.startOffsetMs) ?? numberOr(cueRecord.startOffsetMs),
          text: clean(text),
        });
      }
    }
  }

  return segments.length > 0 ? segments : null;
}

/** 中日韩文字之间没有空格分隔：两边都是 CJK 字符时直接拼接，否则补一个空格。 */
function isCjk(char: string): boolean {
  return /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff]/.test(char);
}

function joinSegs(parts: string[]): string {
  let out = '';
  for (const part of parts) {
    if (part === '') continue;
    if (out === '') {
      out = part;
      continue;
    }
    const prev = out[out.length - 1] ?? '';
    const next = part[0] ?? '';
    out += isCjk(prev) && isCjk(next) ? part : ` ${part}`;
  }
  // 首段自带的前导空格（如英文 ' hello'）留给外层的 clean 处理。
  return out;
}

/** json3 字幕（captionTracks[0].baseUrl + `fmt=json3`）里的转写。 */
export function extractFromJson3(data: unknown): Segment[] | null {
  const root = asRecord(data);
  if (!root) return null;

  const segments: Segment[] = [];
  for (const event of asArray(root.events)) {
    const record = asRecord(event);
    if (!record) continue;
    // 中日文字幕的 segs 之间没有空格，用空格拼接会插进多余空格；
    // 按“两边都是 CJK 就不加空格”拼接，英文仍保留单词间空格。
    const text = clean(
      joinSegs(asArray(record.segs).map((part) => asString(asRecord(part)?.utf8))),
    );
    if (!text) continue;
    segments.push({ start: numberOr(record.tStartMs), text });
  }
  return segments.length > 0 ? segments : null;
}

/** 同一时间戳 + 同一文字的片段只保留一条：面板会同时挂一份隐藏副本，不去重会整篇翻倍。 */
function dedupeSegments(segments: Segment[]): Segment[] {
  const seen = new Set<string>();
  const unique: Segment[] = [];
  for (const segment of segments) {
    const key = `${segment.start}\t${segment.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(segment);
  }
  return unique;
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
      // 时间戳认不出时记 null：formatLines 会只印文字，不会伪造一个 `[0:00]`。
      const seconds = tsToSec(timestamp);
      segments.push({ start: seconds === null ? null : seconds * 1000, text });
    }
  }
  const fromNodes = dedupeSegments(segments);
  if (fromNodes.length > 0) return fromNodes;

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
      const seconds = tsToSec(timestamp);
      segments.push({ start: seconds === null ? null : seconds * 1000, text });
    }
  }
  const unique = dedupeSegments(segments);
  return unique.length > 0 ? unique : null;
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
    const seconds = tsToSec(match[1]);
    segments.push({ start: seconds === null ? null : seconds * 1000, text: clean(match[2]) });
  }
  // 面板同样会挂一份隐藏副本：不去重会让整篇台词翻倍。
  const unique = dedupeSegments(segments);
  return unique.length > 0 ? unique : null;
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
