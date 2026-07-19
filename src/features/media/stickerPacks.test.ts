import { describe, expect, it } from 'vitest';
import { builtInStickerPacks, mergeStickerPacks, parseStickerManifest } from './stickerPacks';

describe('sticker packs', () => {
  it('includes original built-in packs and deduplicates configured manifests', () => {
    const packs = mergeStickerPacks(
      [{ name: 'Duplicate Aqua', manifestUrl: '/stickers/aqua/manifest.json' }],
      [{ id: 'mine', name: 'Mine', manifestUrl: 'https://stickers.example/pack.json' }],
    );

    expect(builtInStickerPacks.map((pack) => pack.name)).toEqual(['Aqua Starter', 'Aero Days', 'Web Garden']);
    expect(packs.filter((pack) => pack.manifestUrl.includes('/stickers/aqua/manifest.json'))).toHaveLength(1);
    expect(packs.at(-1)).toMatchObject({ name: 'Mine', source: 'personal' });
  });

  it('normalizes safe sticker URLs, rejects unsafe items, and deduplicates IDs', () => {
    const stickers = parseStickerManifest({
      stickers: [
        { id: 'sun', name: 'Sun', src: './sun.svg' },
        { id: 'sun', name: 'Duplicate', src: './again.svg' },
        { id: 'tracker', name: 'Tracker', src: 'http://tracking.example/sticker.svg' },
        { id: 'matrix', name: 'Matrix media', src: 'mxc://example/media' },
      ],
    }, 'https://stickers.example/packs/aero/manifest.json');

    expect(stickers).toEqual([
      { id: 'sun', name: 'Sun', src: 'https://stickers.example/packs/aero/sun.svg' },
      { id: 'matrix', name: 'Matrix media', src: 'mxc://example/media' },
    ]);
  });
});
