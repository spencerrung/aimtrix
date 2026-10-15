import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientEvent, createClient } from 'matrix-js-sdk';
import type { Logger } from 'matrix-js-sdk/lib/logger.js';
import { initialSyncFetch } from './initialSyncFetch';

const silent: Logger = { trace() {}, debug() {}, info() {}, warn() {}, error() {}, getChild: () => silent };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('installed SDK initial-sync sequencing', () => {
  it('reuses slow initial work across the real SDK timeout/retry without extending its deadline', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const run = async (adapt: boolean) => {
      const started = Date.now();
      const computations = new Map<string, Promise<void>>();
      const attempts: Array<{ at: number; filter: string; timeout: string | null }> = [];
      const failures: number[] = [];
      let preparedAt = 0;
      const fetcher: typeof fetch = async (input, init) => {
        const url = new URL(String(input));
        const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
        if (url.pathname.endsWith('/versions')) return json({ versions: ['v1.11'], unstable_features: {} });
        if (url.pathname.endsWith('/filter')) return json({ filter_id: '1' });
        if (url.pathname.endsWith('/pushrules/')) return json({ global: { override: [], underride: [], sender: [], room: [], content: [] } });
        if (!url.pathname.endsWith('/sync')) return json({});
        const aborted = new Promise<never>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Synthetic timeout', 'AbortError')), { once: true });
        });
        if (url.searchParams.has('since')) return aborted;
        const filter = url.searchParams.get('filter')!;
        attempts.push({ at: Date.now() - started, filter, timeout: url.searchParams.get('timeout') });
        // Model Synapse's documented raw-filter response-cache key. Work keeps
        // running after a client disconnect; a matching retry shares it.
        if (!computations.has(filter)) computations.set(filter, new Promise((resolve) => setTimeout(resolve, 120000)));
        try { await Promise.race([computations.get(filter), aborted]); }
        catch (error) { failures.push(Date.now() - started); throw error; }
        return json({ next_batch: 'synthetic-next', rooms: {}, account_data: { events: [] }, to_device: { events: [] } });
      };
      const client = createClient({ baseUrl: 'https://matrix.example.test', userId: '@synthetic:example.test', deviceId: 'SYNTHETIC', accessToken: 'synthetic-only',
        fetchFn: adapt ? initialSyncFetch('https://matrix.example.test', fetcher) : fetcher, logger: silent });
      client.on(ClientEvent.Sync, (state) => { if (state === 'PREPARED') preparedAt = Date.now() - started; });
      try {
        await client.startClient({ initialSyncLimit: 30, lazyLoadMembers: true });
        for (let step = 0; step < 250 && !preparedAt; step++) await vi.advanceTimersByTimeAsync(1000);
        return { attempts, failures, preparedAt, computations: computations.size };
      } finally { client.stopClient(); await vi.advanceTimersByTimeAsync(0); }
    };
    const baseline = await run(false);
    const stable = await run(true);
    expect(baseline.computations).toBe(2);
    expect(stable.computations).toBe(1);
    expect(baseline.attempts[1].filter).toBe('1');
    expect(stable.attempts.every((attempt) => attempt.filter === stable.attempts[0].filter)).toBe(true);
    expect(JSON.parse(stable.attempts[0].filter).room).toMatchObject({ timeline: { limit: 30 }, state: { lazy_load_members: true } });
    expect(baseline.failures[0]).toBe(80000);
    expect(stable.failures[0]).toBe(80000);
    expect(stable.preparedAt).toBe(120000);
    expect(baseline.preparedAt).toBeGreaterThanOrEqual(200000);
    expect(stable.attempts.every((attempt) => attempt.timeout === '0')).toBe(true);
  });
});
