// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { isWatchPage, watchWatchPage } from '../src/features/spa';

function docWithPath(pathname: string): Document {
  return { location: { pathname } } as unknown as Document;
}

describe('isWatchPage', () => {
  it('普通观看页返回真', () => {
    expect(isWatchPage(docWithPath('/watch'))).toBe(true);
  });

  it('首页、搜索页、频道页返回假', () => {
    expect(isWatchPage(docWithPath('/'))).toBe(false);
    expect(isWatchPage(docWithPath('/results'))).toBe(false);
    expect(isWatchPage(docWithPath('/@somechannel'))).toBe(false);
    expect(isWatchPage(docWithPath('/shorts/abc'))).toBe(false);
    expect(isWatchPage(docWithPath('/embed/abc'))).toBe(false);
  });

  it('离线夹具 watch.html 视为播放页', () => {
    expect(isWatchPage(docWithPath('/E:/repo/watch.html'))).toBe(true);
  });
});

describe('watchWatchPage', () => {
  it('直接打开播放页时启动一次', () => {
    const onEnterWatch = vi.fn();
    const onLeaveWatch = vi.fn();
    const holder: { tick: () => void } = { tick: () => undefined };
    const stop = watchWatchPage({
      isWatchPage: () => true,
      onEnterWatch,
      onLeaveWatch,
      watchNavigate: (onTick) => {
        holder.tick = onTick;
        return () => undefined;
      },
    });

    expect(onEnterWatch).toHaveBeenCalledTimes(1);
    holder.tick();
    expect(onEnterWatch).toHaveBeenCalledTimes(1);
    expect(onLeaveWatch).not.toHaveBeenCalled();
    stop();
    expect(onLeaveWatch).toHaveBeenCalledTimes(1);
  });

  it('直接打开非播放页时不启动，切进来补启动，切出去收掉', () => {
    let watch = false;
    const onEnterWatch = vi.fn();
    const onLeaveWatch = vi.fn();
    const holder: { tick: () => void } = { tick: () => undefined };
    const stopNavigate = vi.fn();
    const stop = watchWatchPage({
      isWatchPage: () => watch,
      onEnterWatch,
      onLeaveWatch,
      watchNavigate: (onTick) => {
        holder.tick = onTick;
        return stopNavigate;
      },
    });

    expect(onEnterWatch).not.toHaveBeenCalled();

    watch = true;
    holder.tick();
    expect(onEnterWatch).toHaveBeenCalledTimes(1);

    watch = false;
    holder.tick();
    expect(onLeaveWatch).toHaveBeenCalledTimes(1);

    stop();
    expect(stopNavigate).toHaveBeenCalledTimes(1);
    // 已经离开，销毁时不再重复调用离开。
    expect(onLeaveWatch).toHaveBeenCalledTimes(1);
  });
});
