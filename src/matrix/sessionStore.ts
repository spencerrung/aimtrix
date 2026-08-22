import type { CredentialStore } from '../platform/platform';

export interface StoredMatrixSession {
  baseUrl: string;
  serverName: string;
  accessToken: string;
  userId: string;
  deviceId: string;
}

export const SESSION_KEY = 'aimtrix.matrix-session.v1';

export function parseStoredMatrixSession(value: unknown): StoredMatrixSession | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Partial<StoredMatrixSession>;
  if (
    !candidate.baseUrl ||
    !candidate.serverName ||
    !candidate.accessToken ||
    !candidate.userId ||
    !candidate.deviceId
  ) {
    return undefined;
  }

  try {
    const url = new URL(candidate.baseUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return candidate as StoredMatrixSession;
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
