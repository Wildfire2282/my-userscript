import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPageClientVersion, requestPanel } from '../src/transcript/api';

type FetchLike = (url: string, init?: RequestInit) => Promise<{ json: () => Promise<unknown> }>;

function fetchOk() {
  return vi.fn<FetchLike>(() =>
    Promise.resolve({ json: () => Promise.resolve({ engagementPanels: [] }) }),
  );
}

function sentVersion(fetchImpl: ReturnType<typeof fetchOk>): string {
  const init = fetchImpl.mock.calls[0]?.[1];
  const body = JSON.parse((init?.body ?? '{}') as string) as {
    context: { client: { clientVersion: string } };
  };
  return body.context.client.clientVersion;
}

describe('readPageClientVersion', () => {
  it('没有页面配置时返回 null', () => {
    expect(readPageClientVersion({})).toBeNull();
  });

  it('读到页面版本就用页面的', () => {
    expect(readPageClientVersion({ ytcfg: { get: () => '9.9.9' } })).toBe('9.9.9');
  });

  it('页面配置异常时返回 null', () => {
    expect(
      readPageClientVersion({
        ytcfg: {
          get: () => {
            throw new Error('boom');
          },
        },
      }),
    ).toBeNull();
  });
});

describe('requestPanel', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>)['ytcfg'];
  });

  it('空视频 ID 不发请求', async () => {
    const fetchImpl = fetchOk();
    await expect(requestPanel('', fetchImpl as unknown as typeof fetch)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('优先用页面配置的版本，读不到用写死兜底', async () => {
    (globalThis as Record<string, unknown>)['ytcfg'] = { get: () => 'page-version' };
    const fetchImpl = fetchOk();
    await requestPanel('vid', fetchImpl as unknown as typeof fetch);
    expect(sentVersion(fetchImpl)).toBe('page-version');

    delete (globalThis as Record<string, unknown>)['ytcfg'];
    const fetchFallback = fetchOk();
    await requestPanel('vid', fetchFallback as unknown as typeof fetch);
    expect(sentVersion(fetchFallback)).toBe('2.20260710.06.00');
  });
});
