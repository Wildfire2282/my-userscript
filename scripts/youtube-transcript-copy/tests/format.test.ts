import { describe, expect, it } from 'vitest';
import { clean, fmtTs, formatLines, tsToSec } from '../src/transcript/format';

describe('clean', () => {
  it('折叠空白并去掉首尾空格', () => {
    expect(clean('  第一句 \n  第二句  ')).toBe('第一句 第二句');
    expect(clean(null)).toBe('');
  });
});

describe('tsToSec', () => {
  it('分:秒 与 时:分:秒 都能换算', () => {
    expect(tsToSec('1:02')).toBe(62);
    expect(tsToSec('01:02:03')).toBe(3723);
  });

  it('认不出的格式返回 null，调用方跳过而不是印成 [0:00]', () => {
    expect(tsToSec('')).toBeNull();
    expect(tsToSec('abc')).toBeNull();
    expect(tsToSec('ab:cd')).toBeNull();
    expect(tsToSec('1:ab')).toBeNull();
  });
});

describe('fmtTs', () => {
  it('输出分:秒，秒补零', () => {
    expect(fmtTs(0)).toBe('0:00');
    expect(fmtTs(61_000)).toBe('1:01');
    expect(fmtTs(5_000)).toBe('0:05');
  });

  it('超过一小时带小时位，不再印成 90:00 这种分钟数', () => {
    expect(fmtTs(3_723_000)).toBe('1:02:03');
    expect(fmtTs(5_400_000)).toBe('1:30:00');
  });

  it('未知时间戳返回空串，负数按 0 处理', () => {
    expect(fmtTs(null)).toBe('');
    expect(fmtTs(Number.NaN)).toBe('');
    expect(fmtTs(-1_000)).toBe('0:00');
  });
});

describe('formatLines', () => {
  it('每条一行，有时间戳时加方括号前缀', () => {
    expect(
      formatLines([
        { start: 0, text: '第一句' },
        { start: 2_000, text: '第二句' },
        { start: null, text: '没有时间戳' },
      ]),
    ).toBe('[0:00] 第一句\n[0:02] 第二句\n没有时间戳');
  });

  it('一小时以上的片段带小时位', () => {
    expect(formatLines([{ start: 5_400_000, text: '后半段' }])).toBe('[1:30:00] 后半段');
  });

  it('没有片段时是空字符串', () => {
    expect(formatLines([])).toBe('');
  });
});
