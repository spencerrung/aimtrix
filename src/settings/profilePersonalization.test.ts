import { describe, expect, it } from 'vitest';
import {
  defaultProfilePersonalization,
  loadProfilePersonalization,
  parseProfilePersonalization,
  saveProfilePersonalization,
} from './profilePersonalization';

describe('profile personalization', () => {
  it('falls back safely for unknown decoration values', () => {
    expect(parseProfilePersonalization({
      bannerPreset: 'unsafe',
      bannerMxc: 'https://public.example/banner.png',
      avatarFrame: '<script>',
      card: 'glass',
      effect: 'none',
      bio: 'x'.repeat(220),
    })).toEqual({
      ...defaultProfilePersonalization,
      card: 'glass',
      effect: 'none',
      bio: 'x'.repeat(180),
    });
  });

  it('bounds stickers and rejects unsafe image sources and manifests', () => {
    const parsed = parseProfilePersonalization({
      stickers: [
        { id: 'one', name: 'One', src: '/one.svg' },
        { id: 'bad', name: 'Bad', src: 'http://tracking.example/bad.svg' },
        { id: 'two', name: 'Two', src: 'mxc://example/two' },
        { id: 'three', name: 'Three', src: 'https://stickers.example/three.svg' },
        { id: 'four', name: 'Four', src: '/four.svg' },
      ],
      installedStickerPacks: [
        { id: 'safe', name: 'Safe', manifestUrl: 'https://stickers.example/manifest.json' },
        { id: 'bad', name: 'Bad', manifestUrl: 'http://tracking.example/manifest.json' },
      ],
    });

    expect(parsed.stickers.map((sticker) => sticker.id)).toEqual(['one', 'two', 'three']);
    expect(parsed.installedStickerPacks).toHaveLength(1);
  });

  it('round-trips through local storage', () => {
    const storage = window.localStorage;
    storage.clear();
    saveProfilePersonalization({
      ...defaultProfilePersonalization,
      bannerPreset: 'lagoon',
      bio: 'Welcome to my tiny web garden.',
    }, storage);

    expect(loadProfilePersonalization(storage)).toMatchObject({
      bannerPreset: 'lagoon',
      bio: 'Welcome to my tiny web garden.',
    });
  });
});
