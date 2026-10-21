import { describe, expect, it } from 'vitest';
import {
  decideDrag,
  resolveDropAction,
  shouldOpenInForeground,
  type DragCandidate,
} from '../src/features/drop-action';
import { defaultSettings } from '../src/search';
import type { Settings } from '../src/settings';

function candidate(patch: Partial<DragCandidate> = {}): DragCandidate {
  return { link: '', image: '', selection: '', selectionHit: false, ...patch };
}

function settings(patch: Partial<Settings> = {}): Settings {
  return { ...defaultSettings(), ...patch };
}

describe('decideDrag', () => {
  it('按在选区里优先当文字，即使压在链接上', () => {
    expect(
      decideDrag(candidate({ selection: '选中的字', selectionHit: true, link: 'https://a.test/' })),
    ).toEqual({ kind: 'text', data: '选中的字' });
  });

  it('没有选区时识别链接', () => {
    expect(decideDrag(candidate({ link: 'https://a.test/' }))).toEqual({
      kind: 'link',
      data: 'https://a.test/',
    });
  });

  it('链接优先于图片', () => {
    expect(
      decideDrag(candidate({ link: 'https://a.test/', image: 'https://a.test/i.png' })),
    ).toEqual({ kind: 'link', data: 'https://a.test/' });
  });

  it('只有图片时识别图片', () => {
    expect(decideDrag(candidate({ image: 'https://a.test/i.png' }))).toEqual({
      kind: 'image',
      data: 'https://a.test/i.png',
    });
  });

  it('拖拽元素上带着零散选区时按搜索处理', () => {
    expect(decideDrag(candidate({ selection: '零散选中' }))).toEqual({
      kind: 'text',
      data: '零散选中',
    });
  });

  it('什么都没有就不接管', () => {
    expect(decideDrag(candidate())).toBeNull();
  });
});

describe('shouldOpenInForeground', () => {
  it('按住 Shift 一律前台', () => {
    expect(shouldOpenInForeground('text', true, 'background')).toBe(true);
    expect(shouldOpenInForeground('image', true, 'background')).toBe(true);
  });

  it('链接按设置前台，其它类型不受设置影响', () => {
    expect(shouldOpenInForeground('link', false, 'foreground')).toBe(true);
    expect(shouldOpenInForeground('text', false, 'foreground')).toBe(false);
  });

  it('默认后台打开', () => {
    expect(shouldOpenInForeground('link', false, 'background')).toBe(false);
  });
});

describe('resolveDropAction', () => {
  const config = settings();

  it('链接直接打开', () => {
    expect(resolveDropAction('link', 'https://a.test/x', config)).toEqual({
      kind: 'url',
      url: 'https://a.test/x',
    });
  });

  it('图片交给查看器流程', () => {
    expect(resolveDropAction('image', 'https://a.test/i.png', config)).toEqual({
      kind: 'image',
      url: 'https://a.test/i.png',
    });
  });

  it('文本本身是网址时直接打开', () => {
    expect(resolveDropAction('text', 'https://a.test/x', config)).toEqual({
      kind: 'url',
      url: 'https://a.test/x',
    });
  });

  it('普通文本走搜索', () => {
    expect(resolveDropAction('text', '拖拽 测试', config)).toEqual({
      kind: 'search',
      url: 'https://www.google.com/search?q=%E6%8B%96%E6%8B%BD%20%E6%B5%8B%E8%AF%95',
    });
  });

  it('空内容不打开任何页面', () => {
    expect(resolveDropAction('text', '', config)).toBeNull();
    expect(resolveDropAction('link', '', config)).toBeNull();
  });
});
