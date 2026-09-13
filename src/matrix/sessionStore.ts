import type { CredentialStore } from '../platform/platform';

export interface StoredMatrixSession {
  baseUrl: string;
  serverName: string;
  accessToken: string;
  userId: string;
  deviceId: string;
  /** A token-free recovery record must never be used to construct an SDK client. */
  recovery?: 'soft' | 'hard';
  retainedDeviceIds?: string[];
}

export const SESSION_KEY = 'aimtrix.matrix-session.v1';

export function parseStoredMatrixSession(value: unknown): StoredMatrixSession | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Partial<StoredMatrixSession>;
  if (![candidate.baseUrl, candidate.serverName, candidate.userId, candidate.deviceId].every(
    (field) => typeof field === 'string' && field.length > 0,
  )) return undefined;
  if (candidate.recovery !== undefined && candidate.recovery !== 'soft' && candidate.recovery !== 'hard') return undefined;
  if (typeof candidate.accessToken !== 'string' || (candidate.recovery ? candidate.accessToken !== '' : !candidate.accessToken)) return undefined;
  if (candidate.retainedDeviceIds !== undefined && (!Array.isArray(candidate.retainedDeviceIds) ||
    !candidate.retainedDeviceIds.every((id) => typeof id === 'string' && id.length > 0))) return undefined;
  try {
    const url = new URL(candidate.baseUrl!);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return undefined;
    return {
      baseUrl: candidate.baseUrl!, serverName: candidate.serverName!, userId: candidate.userId!,
      deviceId: candidate.deviceId!, accessToken: candidate.accessToken,
      ...(candidate.recovery ? { recovery: candidate.recovery } : {}),
      ...(candidate.retainedDeviceIds?.length ? { retainedDeviceIds: [...new Set(candidate.retainedDeviceIds)] } : {}),
    };
  } catch {
    return undefined;
  }
}

export function createBrowserCredentialStore(
  storage: Storage = localStorage,
): CredentialStore<StoredMatrixSession> {
  return {
    async load() {
      try {
        const serialized = storage.getItem(SESSION_KEY);
        if (!serialized) return undefined;
        const parsed: unknown = JSON.parse(serialized);
        const session = parseStoredMatrixSession(parsed);
        if (session) return session;
        storage.removeItem(SESSION_KEY);
      } catch {
        storage.removeItem(SESSION_KEY);
      }
      return undefined;
    },
    async save(session) {
      storage.setItem(SESSION_KEY, JSON.stringify(session));
    },
    async clear() {
      storage.removeItem(SESSION_KEY);
    },
  };
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function databaseNames(session: StoredMatrixSession): {
  sync: string;
  crypto: string;
} {
  const account = stableHash(`${session.baseUrl}|${session.userId}|${session.deviceId}`);
  return {
    sync: `aimtrix-sync-${account}`,
    crypto: `aimtrix-crypto-${account}`,
  };
}
