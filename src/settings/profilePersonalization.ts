export const bannerPresetNames = ['sky', 'lagoon', 'meadow', 'citrus', 'twilight'] as const;
export const avatarFrameNames = ['chrome', 'bubble', 'leaf', 'candy'] as const;
export const profileCardNames = ['glass', 'lagoon', 'meadow', 'citrus'] as const;
export const profileEffectNames = ['bubbles', 'sparkles', 'none'] as const;

export type BannerPreset = (typeof bannerPresetNames)[number];
export type AvatarFrame = (typeof avatarFrameNames)[number];
export type ProfileCard = (typeof profileCardNames)[number];
export type ProfileEffect = (typeof profileEffectNames)[number];

export interface ProfileSticker {
  id: string;
  name: string;
  src: string;
}

export interface InstalledStickerPack {
  id: string;
  name: string;
  manifestUrl: string;
}

export interface ProfilePersonalization {
  bannerPreset: BannerPreset;
  bannerMxc?: string;
  avatarFrame: AvatarFrame;
  card: ProfileCard;
  effect: ProfileEffect;
  bio: string;
  stickers: ProfileSticker[];
  installedStickerPacks: InstalledStickerPack[];
}

export const defaultProfilePersonalization: ProfilePersonalization = {
  bannerPreset: 'sky',
  avatarFrame: 'chrome',
  card: 'glass',
  effect: 'bubbles',
  bio: '',
  stickers: [],
  installedStickerPacks: [],
};

const PROFILE_KEY = 'aimtrix.profile.v1';
const MAX_PROFILE_STICKERS = 3;
const MAX_INSTALLED_PACKS = 12;

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function safeImageSource(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  if (value.startsWith('mxc://')) return true;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === 'https:' || url.origin === window.location.origin;
  } catch {
    return false;
  }
}

export function normalizeManifestUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim(), window.location.origin);
    if (url.protocol !== 'https:' && url.origin !== window.location.origin) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function parseProfilePersonalization(value: unknown): ProfilePersonalization {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return structuredClone(defaultProfilePersonalization);
  }
  const candidate = value as Partial<ProfilePersonalization>;
  const stickers = Array.isArray(candidate.stickers)
    ? candidate.stickers.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const sticker = item as Partial<ProfileSticker>;
        if (
          typeof sticker.id !== 'string' ||
          typeof sticker.name !== 'string' ||
          !safeImageSource(sticker.src)
        ) return [];
        return [{
          id: sticker.id.slice(0, 80),
          name: sticker.name.trim().slice(0, 80),
          src: sticker.src,
        }];
      }).filter((item) => item.id && item.name).slice(0, MAX_PROFILE_STICKERS)
    : [];
  const installedStickerPacks = Array.isArray(candidate.installedStickerPacks)
    ? candidate.installedStickerPacks.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const pack = item as Partial<InstalledStickerPack>;
        if (typeof pack.id !== 'string' || typeof pack.name !== 'string' || typeof pack.manifestUrl !== 'string') return [];
        const manifestUrl = normalizeManifestUrl(pack.manifestUrl);
        if (!manifestUrl) return [];
        return [{ id: pack.id.slice(0, 80), name: pack.name.trim().slice(0, 40), manifestUrl }];
      }).filter((pack) => pack.id && pack.name).slice(0, MAX_INSTALLED_PACKS)
    : [];

  return {
    bannerPreset: includes(bannerPresetNames, candidate.bannerPreset) ? candidate.bannerPreset : defaultProfilePersonalization.bannerPreset,
    bannerMxc: typeof candidate.bannerMxc === 'string' && candidate.bannerMxc.startsWith('mxc://') ? candidate.bannerMxc : undefined,
    avatarFrame: includes(avatarFrameNames, candidate.avatarFrame) ? candidate.avatarFrame : defaultProfilePersonalization.avatarFrame,
    card: includes(profileCardNames, candidate.card) ? candidate.card : defaultProfilePersonalization.card,
    effect: includes(profileEffectNames, candidate.effect) ? candidate.effect : defaultProfilePersonalization.effect,
    bio: typeof candidate.bio === 'string' ? candidate.bio.trim().slice(0, 180) : '',
    stickers,
    installedStickerPacks,
  };
}

export function loadProfilePersonalization(storage: Storage = localStorage): ProfilePersonalization {
  try {
    const serialized = storage.getItem(PROFILE_KEY);
    return serialized ? parseProfilePersonalization(JSON.parse(serialized)) : structuredClone(defaultProfilePersonalization);
  } catch {
    return structuredClone(defaultProfilePersonalization);
  }
}

export function saveProfilePersonalization(
  personalization: ProfilePersonalization,
  storage: Storage = localStorage,
): void {
  storage.setItem(PROFILE_KEY, JSON.stringify(parseProfilePersonalization(personalization)));
}
