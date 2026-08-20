import { describe, expect, it, vi } from 'vitest';
import {
  builtInEmojiPacks,
  emojiReactionKey,
  loadEmojiPacks,
  parseEmojiManifest,
  resolveEmojiPackUrl,
  selectEmojiPacks,
} from './emojiPacks';

describe('emoji packs', () => {
  it('parses standard and image-backed entries while rejecting unsafe or duplicate items', () => {
    const entries = parseEmojiManifest({
      entries: [
        { id: 'smile', name: 'Smile', emoji: '😄', aliases: ['happy'] },
        { id: 'bufo', name: 'Bufo', src: './bufo.png' },
        { id: 'bufo', name: 'Duplicate', src: './duplicate.png' },
        { id: 'unsafe', name: 'Unsafe', src: 'javascript:alert(1)' },
        { id: 'empty', name: 'Empty' },
      ],
    }, 'https://assets.example.test/emoji/manifest.json');

    expect(entries).toEqual([
      { id: 'smile', name: 'Smile', emoji: '😄', aliases: ['happy'] },
      { id: 'bufo', name: 'Bufo', src: 'https://assets.example.test/emoji/bufo.png' },
    ]);
    expect(emojiReactionKey(entries[0])).toBe('😄');
    expect(emojiReactionKey(entries[1])).toBe(':bufo:');
  });

  it('selects built-in packs, operator packs, and a complete opt-out', () => {
    expect(selectEmojiPacks({ enabled: false, standard: true, bufo: true, packs: [] })).toEqual([]);
    expect(selectEmojiPacks({
      enabled: true,
      standard: false,
      bufo: true,
      packs: [{ name: 'Team', manifestUrl: 'https://assets.example.test/team.json' }],
    }).map((pack) => pack.id)).toEqual([
      'bufo',
      'operator:https://assets.example.test/team.json',
    ]);
  });

  it('resolves built-in manifests against an optional external asset base', () => {
    expect(resolveEmojiPackUrl(builtInEmojiPacks[0].manifestUrl)).toBe(
      'http://localhost:3000/emoji/packs/standard/manifest.json',
    );
    expect(resolveEmojiPackUrl(builtInEmojiPacks[0].manifestUrl, 'https://cdn.example.test/aimtrix/')).toBe(
      'https://cdn.example.test/aimtrix/emoji/packs/standard/manifest.json',
    );
  });

  it('loads manifests lazily and combines valid entries', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: () => Promise.resolve({ entries: [{ id: 'bufo-wave', name: 'Wave', src: './wave.png' }] }),
    }) as unknown as typeof fetch;

    const entries = await loadEmojiPacks([
      { id: 'bufo', name: 'Bufo', manifestUrl: '/emoji/bufo.json', source: 'built-in' },
    ], undefined, fetcher);

    expect(fetcher).toHaveBeenCalledWith('http://localhost:3000/emoji/bufo.json', { credentials: 'omit' });
    expect(entries[0].src).toBe('http://localhost:3000/emoji/wave.png');
  });
});
