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

  it('认不出的格式按 0 处理', () => {
    expect(tsToSec('')).toBe(0);
    expect(tsToSec('abc')).toBe(0);
  });
});

describe('fmtTs', () => {
  it('输出分:秒，秒补零', () => {
    expect(fmtTs(0)).toBe('0:00');
    expect(fmtTs(61_000)).toBe('1:01');
    expect(fmtTs(5_000)).toBe('0:05');
  });

  it('旧版没有小时位，超过一小时按分钟累加', () => {
    expect(fmtTs(3_723_000)).toBe('62:03');
  });

  it('未知时间戳返回空串，负数按 0 处理', () => {
    expect(fmtTs(null)).toBe('');
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

  it('没有片段时是空字符串', () => {
    expect(formatLines([])).toBe('');
  });
});
