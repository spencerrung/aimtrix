import { describe, expect, it, vi } from 'vitest';
import { resolveHomeserver } from './discovery';

const defaults = {
  configuredServerName: 'example.com',
  configuredBaseUrl: 'https://matrix.example.com',
};

describe('resolveHomeserver', () => {
  it('uses configured delegation for the configured server name', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const result = await resolveHomeserver({
      ...defaults,
      homeserverInput: '',
      userId: '@alex:example.com',
      fetcher,
    });

    expect(result.baseUrl).toBe('https://matrix.example.com');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('discovers a custom server through well-known', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ 'm.homeserver': { base_url: 'https://synapse.chat.test/' } }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const result = await resolveHomeserver({
      ...defaults,
      homeserverInput: 'chat.test',
      userId: '@alex:chat.test',
      fetcher,
    });

    expect(result).toEqual({
      serverName: 'chat.test',
      baseUrl: 'https://synapse.chat.test',
      discovered: true,
    });
  });

  it('accepts an explicit homeserver URL', async () => {
    const result = await resolveHomeserver({
      ...defaults,
      homeserverInput: 'https://matrix.custom.test/',
      userId: '@alex:custom.test',
    });

    expect(result.baseUrl).toBe('https://matrix.custom.test');
  });

  it('rejects insecure remote homeserver URLs before sending credentials', async () => {
    await expect(
      resolveHomeserver({
        ...defaults,
        homeserverInput: 'http://matrix.custom.test',
        userId: '@alex:custom.test',
      }),
    ).rejects.toThrow(/valid homeserver/i);
  });
});
