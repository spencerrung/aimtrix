import { normalizeManifestUrl, type InstalledStickerPack, type ProfileSticker } from '../../settings/profilePersonalization';

export interface StickerPackDefinition extends InstalledStickerPack {
  description?: string;
  source: 'built-in' | 'operator' | 'personal';
}

export const builtInStickerPacks: StickerPackDefinition[] = [
  {
    id: 'aqua-starter',
    name: 'Aqua Starter',
    manifestUrl: '/stickers/aqua/manifest.json',
    description: 'Glossy buddy-list classics.',
    source: 'built-in',
  },
  {
    id: 'aero-days',
    name: 'Aero Days',
    manifestUrl: '/stickers/aero/manifest.json',
    description: 'Sunshine, bubbles, water, and green things.',
    source: 'built-in',
  },
  {
    id: 'web-garden',
    name: 'Web Garden',
    manifestUrl: '/stickers/garden/manifest.json',
    description: 'A tiny optimistic garden for your profile.',
    source: 'built-in',
  },
];

export function mergeStickerPacks(
  operator: Array<{ name: string; manifestUrl: string }>,
  personal: InstalledStickerPack[],
): StickerPackDefinition[] {
  const packs: StickerPackDefinition[] = [
    ...builtInStickerPacks,
    ...operator.map((pack) => ({
      id: `operator:${pack.manifestUrl}`,
      name: pack.name,
      manifestUrl: pack.manifestUrl,
      source: 'operator' as const,
    })),
    ...personal.map((pack) => ({ ...pack, source: 'personal' as const })),
  ];
  const seen = new Set<string>();
  return packs.filter((pack) => {
    const normalized = normalizeManifestUrl(pack.manifestUrl);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function safeStickerSource(value: unknown, manifestUrl: string): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  if (value.startsWith('mxc://')) return value;
  try {
    const url = new URL(value, manifestUrl);
    if (url.protocol !== 'https:' && url.origin !== window.location.origin) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function parseStickerManifest(value: unknown, manifestUrl: string): ProfileSticker[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const stickers = (value as { stickers?: unknown }).stickers;
  if (!Array.isArray(stickers)) return [];
  const seen = new Set<string>();
  return stickers.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const sticker = item as Partial<ProfileSticker>;
    const src = safeStickerSource(sticker.src, manifestUrl);
    if (typeof sticker.id !== 'string' || typeof sticker.name !== 'string' || !src) return [];
    const id = sticker.id.trim().slice(0, 80);
    const name = sticker.name.trim().slice(0, 80);
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    return [{ id, name, src }];
  }).slice(0, 48);
}

export async function loadStickerPack(
  manifestUrl: string,
  signal?: AbortSignal,
): Promise<ProfileSticker[]> {
  const safeUrl = normalizeManifestUrl(manifestUrl);
  if (!safeUrl) throw new Error('Sticker manifests must use HTTPS or the Aimtrix origin.');
  const response = await fetch(safeUrl, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(`Sticker manifest returned HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > 128 * 1024) throw new Error('Sticker manifest is too large.');
  const stickers = parseStickerManifest(await response.json(), safeUrl);
  if (!stickers.length) throw new Error('Sticker manifest has no valid stickers.');
  return stickers;
}
