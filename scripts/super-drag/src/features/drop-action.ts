import { buildSearchUrl } from '../search';
import type { DragKinds, LinkOpenMode, Settings } from '../settings';
import { asDirectUrl } from './url';

/**
 * 拖拽决策：只做判断，不碰 DOM 与 GM，方便单测覆盖所有分支。
 */

export type DragKind = 'link' | 'text' | 'image';

/** dragstart 时收集到的候选信息。 */
export interface DragCandidate {
  /** 按下的位置最近的链接；`''` 表示没有 */
  link: string;
  /** 按下的位置最近的图片；`''` 表示没有 */
  image: string;
  /** 当前选中的文本；`''` 表示没有 */
  selection: string;
  /** 按下点是否落在选区上 */
  selectionHit: boolean;
}

export interface DragPayload {
  kind: DragKind;
  data: string;
}

/**
 * 决定这次拖拽归不归脚本处理。
 *
 * 规则与线上原版一致：选区优先（按在选区里拖连接也是搜索），其次链接，再次图片，
 * 最后才是“可拖拽元素上带着一段选区”的兜底。
 *
 * 按在选区里但文字拖拽被关掉时直接不接管：用户此刻想拖的是文字，交还给网页原生拖拽，
 * 而不是突然打开压在下面的链接。
 *
 * @param kinds 三类拖拽各自的开关
 * @returns 要接管的内容；`null` 表示交给浏览器原生拖拽
 */
export function decideDrag(candidate: DragCandidate, kinds: DragKinds): DragPayload | null {
  if (candidate.selection !== '' && candidate.selectionHit) {
    return kinds.text ? { kind: 'text', data: candidate.selection } : null;
  }
  if (kinds.link && candidate.link !== '') return { kind: 'link', data: candidate.link };
  if (kinds.image && candidate.image !== '') return { kind: 'image', data: candidate.image };
  // 按下的位置明明压在链接 / 图片上，只是这一类被关掉了：这一次要交还网页原生拖拽。
  // 不能再落进文字兜底，否则页面上残留的选区会把页面自己的拖拽抢成“搜索”。
  if (candidate.link !== '' || candidate.image !== '') return null;
  if (kinds.text && candidate.selection !== '') return { kind: 'text', data: candidate.selection };
  return null;
}

/** 本次打开是否切到前台：按住 Shift，或设置里选了前台打开。 */
export function shouldOpenInForeground(shiftKey: boolean, linkOpenMode: LinkOpenMode): boolean {
  return shiftKey || linkOpenMode === 'foreground';
}

export type DropActionKind = 'url' | 'image' | 'search';

export interface DropAction {
  kind: DropActionKind;
  url: string;
}

/**
 * 把拖拽内容转成“打开什么”。
 *
 * 文本：网址且设置为直接打开时打开它，否则拼搜索地址；链接：打开链接；
 * 图片：交给图片打开流程（可能是查看器页面）。
 */
export function resolveDropAction(
  kind: DragKind,
  data: string,
  settings: Settings,
): DropAction | null {
  if (data === '') return null;
  if (kind === 'link') return { kind: 'url', url: data };
  if (kind === 'image') return { kind: 'image', url: data };
  if (settings.urlTextAction === 'open') {
    const direct = asDirectUrl(data);
    if (direct !== '') return { kind: 'url', url: direct };
  }
  return { kind: 'search', url: buildSearchUrl(settings, data) };
}
