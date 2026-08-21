import type { EmojiPackConfig } from '../features/media/emojiPacks';

export const themeNames = ['aqua', 'graphite', 'midnight'] as const;

export type ThemeName = (typeof themeNames)[number];

export interface RuntimeConfig {
  brandName: string;
  defaultHomeserver: {
    serverName: string;
    baseUrl: string;
  };
  allowCustomHomeservers: boolean;
  defaultTheme: ThemeName;
  features: {
    demoMode: boolean;
    calls: boolean;
    gifs: boolean;
    stickers: boolean;
  };
  media: {
    maxUploadBytes: number;
    autoplayAnimations: boolean;
  };
  gifProvider?: {
    searchEndpoint: string;
  };
  push?: {
    gatewayUrl: string;
    appId: string;
    webPush?: {
      applicationServerKey: string;
    };
  };
  stickerPacks: Array<{
    name: string;
    manifestUrl: string;
  }>;
  emojiPacks: EmojiPackConfig;
}

export interface RuntimeConfigResult {
  config: RuntimeConfig;
  warnings: string[];
}

export const defaultRuntimeConfig: RuntimeConfig = {
  brandName: 'Aimtrix',
  defaultHomeserver: {
    serverName: 'matrix.org',
    baseUrl: 'https://matrix-client.matrix.org',
  },
  allowCustomHomeservers: true,
  defaultTheme: 'aqua',
  features: {
    demoMode: true,
    calls: false,
    gifs: false,
    stickers: true,
  },
  media: {
    maxUploadBytes: 50 * 1024 * 1024,
    autoplayAnimations: true,
  },
  stickerPacks: [],
  emojiPacks: {
    enabled: true,
    standard: true,
    bufo: true,
    assetBaseUrl: undefined,
    packs: [],
  },
};

const MIN_UPLOAD_BYTES = 1024 * 1024;
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeBaseUrl(value: unknown, warnings: string[]): string {
  if (typeof value !== 'string') return defaultRuntimeConfig.defaultHomeserver.baseUrl;

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported protocol');
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      warnings.push('The configured homeserver uses insecure HTTP. HTTPS is strongly recommended.');
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    warnings.push('defaultHomeserver.baseUrl is invalid; the Matrix.org default was used.');
    return defaultRuntimeConfig.defaultHomeserver.baseUrl;
  }
}

export function parseRuntimeConfig(value: unknown): RuntimeConfigResult {
  const warnings: string[] = [];
  const root = optionalRecord(value);
  const homeserver = optionalRecord(root.defaultHomeserver);
  const features = optionalRecord(root.features);
  const media = optionalRecord(root.media);
  const gifProvider = optionalRecord(root.gifProvider);
  const push = optionalRecord(root.push);
  const emojiPacks = optionalRecord(root.emojiPacks);

  const brandName =
    typeof root.brandName === 'string' && root.brandName.trim().length > 0
      ? root.brandName.trim().slice(0, 40)
      : defaultRuntimeConfig.brandName;

  const serverName =
    typeof homeserver.serverName === 'string' && homeserver.serverName.trim().length > 0
      ? homeserver.serverName.trim().toLowerCase()
      : defaultRuntimeConfig.defaultHomeserver.serverName;

  const requestedUploadBytes =
    typeof media.maxUploadBytes === 'number' && Number.isFinite(media.maxUploadBytes)
      ? Math.floor(media.maxUploadBytes)
      : defaultRuntimeConfig.media.maxUploadBytes;
  const maxUploadBytes = Math.min(MAX_UPLOAD_BYTES, Math.max(MIN_UPLOAD_BYTES, requestedUploadBytes));
  if (maxUploadBytes !== requestedUploadBytes) {
    warnings.push('media.maxUploadBytes was clamped to the supported 1 MiB–500 MiB range.');
  }

  const requestedTheme = root.defaultTheme;
  const defaultTheme = themeNames.includes(requestedTheme as ThemeName)
    ? (requestedTheme as ThemeName)
    : defaultRuntimeConfig.defaultTheme;
  if (requestedTheme !== undefined && requestedTheme !== defaultTheme) {
    warnings.push('defaultTheme is unknown; Aqua was used.');
  }

  let parsedGifProvider: RuntimeConfig['gifProvider'];
  if (typeof gifProvider.searchEndpoint === 'string') {
    try {
      const endpoint = new URL(gifProvider.searchEndpoint);
      if (
        endpoint.protocol !== 'https:' &&
        !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))
      ) {
        throw new Error('insecure GIF endpoint');
      }
      parsedGifProvider = { searchEndpoint: endpoint.toString() };
    } catch {
      warnings.push('gifProvider.searchEndpoint is invalid; GIF search was disabled.');
    }
  }

  let parsedPush: RuntimeConfig['push'];
  if (root.push !== undefined && typeof push.gatewayUrl === 'string' && typeof push.appId === 'string') {
    try {
      const gatewayUrl = new URL(push.gatewayUrl);
      if (gatewayUrl.protocol !== 'https:' && !(gatewayUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(gatewayUrl.hostname))) {
        throw new Error('insecure push gateway');
      }
      const appId = push.appId.trim().slice(0, 100);
      if (!appId) throw new Error('empty push app id');
      const webPush = optionalRecord(push.webPush);
      const applicationServerKey = typeof webPush.applicationServerKey === 'string'
        ? webPush.applicationServerKey.trim()
        : undefined;
      parsedPush = {
        gatewayUrl: gatewayUrl.toString().replace(/\/$/, ''),
        appId,
        ...(applicationServerKey ? { webPush: { applicationServerKey } } : {}),
      };
    } catch {
      warnings.push('push configuration is invalid; background notifications were disabled.');
    }
  } else if (root.push !== undefined) {
    warnings.push('push configuration is invalid; background notifications were disabled.');
  }

  const stickerPacks = Array.isArray(root.stickerPacks)
    ? root.stickerPacks.flatMap((value) => {
        if (!isRecord(value) || typeof value.name !== 'string' || typeof value.manifestUrl !== 'string') return [];
        try {
          const url = new URL(value.manifestUrl, window.location.origin);
          if (url.protocol !== 'https:' && url.origin !== window.location.origin) return [];
          return [{ name: value.name.trim().slice(0, 40), manifestUrl: url.toString() }];
        } catch {
          return [];
        }
      }).filter((pack) => pack.name)
    : [];

  let assetBaseUrl: string | undefined;
  if (typeof emojiPacks.assetBaseUrl === 'string') {
    try {
      const url = new URL(emojiPacks.assetBaseUrl, window.location.origin);
      if (url.protocol !== 'https:' && url.origin !== window.location.origin) throw new Error('insecure emoji asset base');
      assetBaseUrl = url.toString();
    } catch {
      warnings.push('emojiPacks.assetBaseUrl is invalid; project-local emoji assets will be used.');
    }
  }
  const configuredEmojiPacks = Array.isArray(emojiPacks.packs)
    ? emojiPacks.packs.flatMap((value) => {
        if (!isRecord(value) || typeof value.name !== 'string' || typeof value.manifestUrl !== 'string') return [];
        try {
          const url = new URL(value.manifestUrl, window.location.origin);
          if (url.protocol !== 'https:' && url.origin !== window.location.origin) return [];
          const name = value.name.trim().slice(0, 40);
          return name ? [{ name, manifestUrl: url.toString() }] : [];
        } catch {
          return [];
        }
      })
    : [];

  return {
    config: {
      brandName,
      defaultHomeserver: {
        serverName,
        baseUrl: normalizeBaseUrl(homeserver.baseUrl, warnings),
      },
      allowCustomHomeservers: readBoolean(
        root.allowCustomHomeservers,
        defaultRuntimeConfig.allowCustomHomeservers,
      ),
      defaultTheme,
      features: {
        demoMode: readBoolean(features.demoMode, defaultRuntimeConfig.features.demoMode),
        calls: readBoolean(features.calls, defaultRuntimeConfig.features.calls),
        gifs: readBoolean(features.gifs, defaultRuntimeConfig.features.gifs),
        stickers: readBoolean(features.stickers, defaultRuntimeConfig.features.stickers),
      },
      media: {
        maxUploadBytes,
        autoplayAnimations: readBoolean(
          media.autoplayAnimations,
          defaultRuntimeConfig.media.autoplayAnimations,
        ),
      },
      gifProvider: parsedGifProvider,
      push: parsedPush,
      stickerPacks,
      emojiPacks: {
        enabled: readBoolean(emojiPacks.enabled, defaultRuntimeConfig.emojiPacks.enabled),
        standard: readBoolean(emojiPacks.standard, defaultRuntimeConfig.emojiPacks.standard),
        bufo: readBoolean(emojiPacks.bufo, defaultRuntimeConfig.emojiPacks.bufo),
        assetBaseUrl,
        packs: configuredEmojiPacks,
      },
    },
    warnings,
  };
}

export async function loadRuntimeConfig(
  fetcher: typeof fetch = fetch,
): Promise<RuntimeConfigResult> {
  try {
    const response = await fetcher('/config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseRuntimeConfig(await response.json());
  } catch {
    return {
      config: structuredClone(defaultRuntimeConfig),
      warnings: ['Runtime configuration could not be loaded; safe defaults were used.'],
    };
  }
}
