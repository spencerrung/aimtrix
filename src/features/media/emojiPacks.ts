export interface EmojiPackEntry {
  id: string;
  name: string;
  emoji?: string;
  aliases?: string[];
  src?: string;
  category?: string;
  subcategory?: string;
}

export interface EmojiPackDefinition {
  id: string;
  name: string;
  manifestUrl: string;
  description?: string;
  source: 'built-in' | 'operator';
}

export interface EmojiPackConfig {
  enabled: boolean;
  standard: boolean;
  bufo: boolean;
  assetBaseUrl?: string;
  packs: Array<{ name: string; manifestUrl: string }>;
}

export const builtInEmojiPacks: EmojiPackDefinition[] = [
  {
    id: 'standard',
    name: 'Standard Emoji',
    manifestUrl: '/emoji/packs/standard/manifest.json',
    description: 'Unicode emoji coverage used by common chat clients.',
    source: 'built-in',
  },
  {
    id: 'bufo',
    name: 'Bufo',
    manifestUrl: '/emoji/packs/bufo/manifest.json',
    description: 'The imported Bufo reaction collection.',
    source: 'built-in',
  },
];

export function normalizeEmojiPackUrl(value: string): string | undefined {
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol !== 'https:' && url.origin !== window.location.origin) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function resolveEmojiPackUrl(manifestUrl: string, assetBaseUrl?: string): string | undefined {
  const safeManifestUrl = normalizeEmojiPackUrl(manifestUrl);
  if (!safeManifestUrl || !assetBaseUrl) return safeManifestUrl;
  const safeBaseUrl = normalizeEmojiPackUrl(assetBaseUrl);
  if (!safeBaseUrl) return safeManifestUrl;
  const path = new URL(safeManifestUrl).pathname.replace(/^\//, '');
  return new URL(path, safeBaseUrl.endsWith('/') ? safeBaseUrl : `${safeBaseUrl}/`).toString();
}

export function selectEmojiPacks(config: EmojiPackConfig): EmojiPackDefinition[] {
  if (!config.enabled) return [];
  const builtIns = builtInEmojiPacks.filter((pack) =>
    pack.id === 'standard' ? config.standard : config.bufo,
  );
  const operator = config.packs.map((pack) => ({
    id: `operator:${pack.manifestUrl}`,
    name: pack.name,
    manifestUrl: pack.manifestUrl,
    source: 'operator' as const,
  }));
  const seen = new Set<string>();
  return [...builtIns, ...operator].filter((pack) => {
    const normalized = normalizeEmojiPackUrl(pack.manifestUrl);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function safeEmojiSource(value: unknown, manifestUrl: string): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    return normalizeEmojiPackUrl(new URL(value, manifestUrl).toString());
  } catch {
    return undefined;
  }
}

export function parseEmojiManifest(value: unknown, manifestUrl: string): EmojiPackEntry[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const entries = (value as { entries?: unknown; emojis?: unknown }).entries ??
    (value as { entries?: unknown; emojis?: unknown }).emojis;
  if (!Array.isArray(entries)) return [];
  const seen = new Set<string>();
  return entries.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<EmojiPackEntry>;
    if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return [];
    const id = candidate.id.trim().slice(0, 120);
    const name = candidate.name.trim().slice(0, 120);
    const emoji = typeof candidate.emoji === 'string' && candidate.emoji.length <= 32
      ? candidate.emoji
      : undefined;
    const src = candidate.src === undefined ? undefined : safeEmojiSource(candidate.src, manifestUrl);
    const aliases = Array.isArray(candidate.aliases)
      ? candidate.aliases.flatMap((alias) => typeof alias === 'string' ? [alias.trim().slice(0, 80)] : []).filter(Boolean).slice(0, 24)
      : [];
    if (!id || !name || seen.has(id) || (!emoji && !src)) return [];
    seen.add(id);
    return [{
      id,
      name,
      ...(emoji ? { emoji } : {}),
      ...(src ? { src } : {}),
      ...(aliases.length ? { aliases } : {}),
      ...(typeof candidate.category === 'string' ? { category: candidate.category.slice(0, 80) } : {}),
      ...(typeof candidate.subcategory === 'string' ? { subcategory: candidate.subcategory.slice(0, 80) } : {}),
    }];
  }).slice(0, 6000);
}

export function emojiReactionKey(entry: Pick<EmojiPackEntry, 'id' | 'emoji'>): string {
  return entry.emoji ?? `:${entry.id}:`;
}

export async function loadEmojiPacks(
  packs: EmojiPackDefinition[],
  assetBaseUrl?: string,
  fetcher: typeof fetch = fetch,
): Promise<EmojiPackEntry[]> {
  const entries: EmojiPackEntry[] = [];
  const seenIds = new Set<string>();
  for (const pack of packs) {
    const manifestUrl = pack.source === 'built-in'
      ? resolveEmojiPackUrl(pack.manifestUrl, assetBaseUrl)
      : normalizeEmojiPackUrl(pack.manifestUrl);
    if (!manifestUrl) continue;
    try {
      const response = await fetcher(manifestUrl, { credentials: 'omit' });
      if (!response.ok) continue;
      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (contentLength > 4 * 1024 * 1024) continue;
      const packEntries = parseEmojiManifest(await response.json(), manifestUrl);
      for (const entry of packEntries) {
        if (seenIds.has(entry.id)) continue;
        seenIds.add(entry.id);
        entries.push(entry);
      }
    } catch {
      continue;
    }
  }
  if (!entries.length) throw new Error('No valid emoji packs were loaded.');
  return entries;
}
