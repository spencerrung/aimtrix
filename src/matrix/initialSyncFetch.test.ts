import { describe, expect, it, vi } from 'vitest';
import { initialSyncFetch } from './initialSyncFetch';

const base = 'https://matrix.example.test/prefix';
const filter = JSON.stringify({ room: { timeline: { limit: 30 }, state: { lazy_load_members: true } } });
const sync = (value: string, extra = '') => `${base}/_matrix/client/v3/sync?filter=${encodeURIComponent(value)}&timeout=0&_cacheBuster=1${extra}`;

describe('initial-sync transport', () => {
  it('preserves the initial filter on retries without changing the deadline, credentials or response', async () => {
    const response = new Response('{}');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    const transport = initialSyncFetch(base, fetcher);
    const signal = AbortSignal.timeout(80000);
    const init = { method: 'GET', signal, headers: { Authorization: 'Bearer synthetic-only' }, credentials: 'omit' as const };
    await transport(sync(filter), init);
    expect(await transport(sync('1'), init)).toBe(response);
    const [request, options] = fetcher.mock.calls[1];
    const retry = new URL(String(request));
    expect(retry.searchParams.get('filter')).toBe(filter);
    expect(retry.searchParams.get('timeout')).toBe('0');
    expect(retry.searchParams.get('_cacheBuster')).toBe('1');
    expect(options).toBe(init);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('stops rewriting when incremental sync starts and never carries filters between clients', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    const first = initialSyncFetch(base, fetcher);
    const second = initialSyncFetch(base, fetcher);
    await first(sync(filter));
    await second(sync('1'));
    expect(fetcher).toHaveBeenLastCalledWith(sync('1'), undefined);
    await first(sync('1', '&since=synthetic-next-batch'));
    expect(fetcher).toHaveBeenLastCalledWith(sync('1', '&since=synthetic-next-batch'), undefined);
    await first(sync('2'));
    expect(fetcher).toHaveBeenLastCalledWith(sync('2'), undefined);
  });

  it('leaves unrelated origins, paths, methods and Request inputs untouched', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    const transport = initialSyncFetch(base, fetcher);
    await transport(sync(filter));
    for (const input of [sync('1').replace('matrix.example.test', 'other.example.test'), sync('1').replace('/prefix', '/other'), sync('1').replace('/sync?', '/filter?'), new Request(sync('1'))]) {
      await transport(input);
      expect(fetcher).toHaveBeenLastCalledWith(input, undefined);
    }
    const init = { method: 'POST' };
    await transport(sync('1'), init);
    expect(fetcher).toHaveBeenLastCalledWith(sync('1'), init);
  });

  it('propagates cancellation and failures without silently retrying the request', async () => {
    const error = new DOMException('Synthetic abort', 'AbortError');
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(error);
    const transport = initialSyncFetch(base, fetcher);
    await expect(transport(sync(filter))).rejects.toBe(error);
    await expect(transport(sync('1'))).rejects.toBe(error);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get('filter')).toBe(filter);
  });

  it('preserves an intentionally supplied new inline filter and resets to it for subsequent retries', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    const transport = initialSyncFetch(base, fetcher);
    await transport(sync(filter));
    const changed = JSON.stringify({ room: { timeline: { limit: 30 }, state: { lazy_load_members: true } }, presence: { types: [] } });
    await transport(sync(changed));
    expect(fetcher).toHaveBeenLastCalledWith(sync(changed), undefined);
    await transport(sync('2'));
    expect(new URL(String(fetcher.mock.calls.at(-1)![0])).searchParams.get('filter')).toBe(changed);
  });
});
