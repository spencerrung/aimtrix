export interface StoredMatrixSession {
  baseUrl: string;
  serverName: string;
  accessToken: string;
  userId: string;
  deviceId: string;
}

const SESSION_KEY = 'aimtrix.matrix-session.v1';

function isStoredSession(value: unknown): value is StoredMatrixSession {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StoredMatrixSession>;
  if (
    !candidate.baseUrl ||
    !candidate.serverName ||
    !candidate.accessToken ||
    !candidate.userId ||
    !candidate.deviceId
  ) {
    return false;
  }

  try {
    const url = new URL(candidate.baseUrl);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function loadStoredSession(storage: Storage = localStorage): StoredMatrixSession | undefined {
  try {
    const serialized = storage.getItem(SESSION_KEY);
    if (!serialized) return undefined;
    const parsed: unknown = JSON.parse(serialized);
    if (isStoredSession(parsed)) return parsed;
    storage.removeItem(SESSION_KEY);
  } catch {
    storage.removeItem(SESSION_KEY);
  }
  return undefined;
}

export function saveStoredSession(
  session: StoredMatrixSession,
  storage: Storage = localStorage,
): void {
  storage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearStoredSession(storage: Storage = localStorage): void {
  storage.removeItem(SESSION_KEY);
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
