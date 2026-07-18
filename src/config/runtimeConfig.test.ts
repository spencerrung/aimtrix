import { describe, expect, it, vi } from 'vitest';
import {
  defaultRuntimeConfig,
  loadRuntimeConfig,
  parseRuntimeConfig,
} from './runtimeConfig';

describe('parseRuntimeConfig', () => {
  it('merges valid values with defaults', () => {
    const result = parseRuntimeConfig({
      brandName: '  My Aimtrix  ',
      defaultHomeserver: {
        serverName: 'CHAT.EXAMPLE.COM',
        baseUrl: 'https://matrix.example.com/',
      },
      defaultTheme: 'midnight',
      features: { demoMode: false },
    });

    expect(result.config.brandName).toBe('My Aimtrix');
    expect(result.config.defaultHomeserver).toEqual({
      serverName: 'chat.example.com',
      baseUrl: 'https://matrix.example.com',
    });
    expect(result.config.defaultTheme).toBe('midnight');
    expect(result.config.features.demoMode).toBe(false);
    expect(result.config.features.stickers).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('accepts safe optional media catalogs without exposing provider assumptions', () => {
    const result = parseRuntimeConfig({
      features: { gifs: true },
      gifProvider: { searchEndpoint: 'https://gifs.example.test/search' },
      stickerPacks: [{ name: 'Friends', manifestUrl: 'https://stickers.example.test/pack.json' }],
    });

    expect(result.config.gifProvider?.searchEndpoint).toBe('https://gifs.example.test/search');
    expect(result.config.stickerPacks).toEqual([
      { name: 'Friends', manifestUrl: 'https://stickers.example.test/pack.json' },
    ]);
  });

  it('rejects unsafe URLs and clamps unreasonable upload limits', () => {
    const result = parseRuntimeConfig({
      defaultHomeserver: { baseUrl: 'javascript:alert(1)' },
      media: { maxUploadBytes: Number.MAX_SAFE_INTEGER },
      defaultTheme: 'platinum',
    });

    expect(result.config.defaultHomeserver.baseUrl).toBe(
      defaultRuntimeConfig.defaultHomeserver.baseUrl,
    );
    expect(result.config.media.maxUploadBytes).toBe(500 * 1024 * 1024);
    expect(result.config.defaultTheme).toBe('aqua');
    expect(result.warnings).toHaveLength(3);
  });
});

describe('loadRuntimeConfig', () => {
  it('falls back without throwing when config cannot be fetched', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    const result = await loadRuntimeConfig(fetcher);

    expect(result.config).toEqual(defaultRuntimeConfig);
    expect(result.warnings[0]).toMatch(/could not be loaded/i);
  });
});
