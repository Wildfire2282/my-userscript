import { describe, expect, it, vi } from 'vitest';
import type { GmApi } from '../src/host/gm';
import { createUserscript, installOnce, siteKey } from '../src/runtime/boot';

function fakeGm(): GmApi & { registered: Array<[string, () => void]> } {
  const registered: Array<[string, () => void]> = [];
  return {
    registered,
    getValue: (_key: string, fallback: unknown) => fallback,
    setValue: () => true,
    registerMenuCommand: (label: string, run: () => void) => {
      registered.push([label, run]);
      return true;
    },
  };
}

describe('installOnce', () => {
  it('同一属性第二次返回 false', () => {
    const attribute = 'data-kit-test-lock';
    document.documentElement.removeAttribute(attribute);
    expect(installOnce(attribute)).toBe(true);
    expect(installOnce(attribute)).toBe(false);
    document.documentElement.removeAttribute(attribute);
  });
});

describe('siteKey', () => {
  it('顶层用自己的主机名', () => {
    const win = {
      location: { hostname: 'Example.COM', protocol: 'https:' },
    } as unknown as Window;
    Object.defineProperty(win, 'top', { value: win });
    expect(siteKey(win)).toBe('example.com');
  });

  it('跨域回退 ancestorOrigins，取顶层', () => {
    const win = {
      get top(): never {
        throw new Error('denied');
      },
      location: {
        hostname: 'frame.example',
        protocol: 'https:',
        ancestorOrigins: { 0: 'https://inner.example/', 1: 'https://top.example/', length: 2 },
      },
    } as unknown as Window;
    expect(siteKey(win)).toBe('top.example');
  });

  it('没有主机名用协议名，全空回 unknown', () => {
    const file = {
      location: { hostname: '', protocol: 'file:' },
    } as unknown as Window;
    Object.defineProperty(file, 'top', { value: file });
    expect(siteKey(file)).toBe('file');
    const empty = {
      location: { hostname: '', protocol: ':' },
    } as unknown as Window;
    Object.defineProperty(empty, 'top', { value: empty });
    expect(siteKey(empty)).toBe('unknown');
  });
});

describe('createUserscript', () => {
  it('DOM 就绪时同步跑 onReady，菜单注册带错误边界', () => {
    const gm = fakeGm();
    const ready = vi.fn();
    const boom = vi.fn(() => {
      throw new Error('panel boom');
    });
    const { destroy } = createUserscript(gm, {
      slug: 'kit-test',
      installLock: false,
      onReady: ready,
      menus: [{ label: '功能设置', run: boom }],
    });
    expect(ready).toHaveBeenCalledTimes(1);
    expect(gm.registered.map(([label]) => label)).toEqual(['功能设置']);
    // 管理器调的就是包裹后的回调：抛错不冒出。
    expect(() => gm.registered[0]?.[1]()).not.toThrow();
    expect(boom).toHaveBeenCalledTimes(1);
    // destroy 幂等。
    destroy();
    destroy();
  });

  it('安装锁命中时 onStart/onReady 都不跑', () => {
    const attribute = 'data-kit-test-lock-2';
    document.documentElement.setAttribute(attribute, '');
    try {
      const gm = fakeGm();
      const started = vi.fn();
      const ready = vi.fn();
      createUserscript(gm, {
        slug: 'kit-test',
        installLock: attribute,
        onStart: started,
        onReady: ready,
      });
      expect(started).not.toHaveBeenCalled();
      expect(ready).not.toHaveBeenCalled();
      expect(gm.registered).toEqual([]);
    } finally {
      document.documentElement.removeAttribute(attribute);
    }
  });

  it('启动异常只记日志，不抛给宿主页面', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const gm = fakeGm();
      expect(() =>
        createUserscript(gm, {
          slug: 'kit-test',
          installLock: false,
          onStart: () => {
            throw new Error('hook boom');
          },
        }),
      ).not.toThrow();
      expect(error).toHaveBeenCalledWith('[kit-test] 启动失败', expect.any(Error));
    } finally {
      error.mockRestore();
    }
  });

  it('pagehide 非 persisted 时自动 destroy', () => {
    const gm = fakeGm();
    const cleanup = vi.fn();
    const { destroy } = createUserscript(gm, {
      slug: 'kit-test',
      installLock: false,
      onReady: () => cleanup,
    });
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    expect(cleanup).toHaveBeenCalledTimes(1);
    destroy();
  });
});
