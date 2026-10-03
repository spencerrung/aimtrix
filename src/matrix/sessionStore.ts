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
  oauth?: { clientId: string; issuer: string; refreshToken: string };
}

export const SESSION_KEY = 'aimtrix.matrix-session.v1';

export interface StoredAccountSummary {
  id: string;
  userId: string;
  homeserver: string;
  serverName: string;
  active: boolean;
  recovery: boolean;
}

export interface AccountCredentialStore extends CredentialStore<StoredMatrixSession> {
  list(): Promise<StoredAccountSummary[]>;
  select(id: string | null): Promise<StoredMatrixSession | undefined>;
  remove(id: string): Promise<StoredMatrixSession | undefined>;
}

export function accountId(session: Pick<StoredMatrixSession, 'baseUrl' | 'userId'>): string {
  return JSON.stringify([session.baseUrl, session.userId]);
}

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
  if (candidate.oauth !== undefined) {
    if (candidate.recovery || !candidate.oauth || typeof candidate.oauth !== 'object') return undefined;
    const oauth = candidate.oauth;
    if (typeof oauth.clientId !== 'string' || !oauth.clientId || oauth.clientId.length > 512 ||
      typeof oauth.refreshToken !== 'string' || !oauth.refreshToken || oauth.refreshToken.length > 8192 ||
      typeof oauth.issuer !== 'string') return undefined;
    try {
      const issuer = new URL(oauth.issuer);
      if (issuer.username || issuer.password || issuer.search || issuer.hash ||
        !(issuer.protocol === 'https:' || issuer.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(issuer.hostname))) return undefined;
    } catch { return undefined; }
  }
  try {
    const url = new URL(candidate.baseUrl!);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return undefined;
    return {
      baseUrl: candidate.baseUrl!, serverName: candidate.serverName!, userId: candidate.userId!,
      deviceId: candidate.deviceId!, accessToken: candidate.accessToken,
      ...(candidate.recovery ? { recovery: candidate.recovery } : {}),
      ...(candidate.retainedDeviceIds?.length ? { retainedDeviceIds: [...new Set(candidate.retainedDeviceIds)] } : {}),
      ...(candidate.oauth ? { oauth: { ...candidate.oauth } } : {}),
    };
  } catch {
    return undefined;
  }
}

export function tokenFreeRecoverySession(session: StoredMatrixSession, recovery: 'soft' | 'hard'): StoredMatrixSession {
  const tokenFree = { ...session, accessToken: '', recovery };
  delete tokenFree.oauth;
  return tokenFree;
}

export function createBrowserCredentialStore(
  storage?: Storage,
): AccountCredentialStore {
  // Resolve browser storage during the operation, so construction still succeeds
  // when the browser denies access and the controller can present recovery UI.
  const target = () => storage ?? localStorage;
  return createAccountCredentialStore({
    load: async () => target().getItem(SESSION_KEY) ?? undefined,
    save: async (value) => { target().setItem(SESSION_KEY, value); },
    clear: async () => { target().removeItem(SESSION_KEY); },
  });
}

interface StoredVault { kind: 'aimtrix.account-vault.v1'; active: string | null; accounts: StoredMatrixSession[] }

function parseVault(value: unknown): StoredVault | undefined {
  const legacy = parseStoredMatrixSession(value);
  if (legacy) return { kind: 'aimtrix.account-vault.v1', active: accountId(legacy), accounts: [legacy] };
  if (!value || typeof value !== 'object') return;
  const candidate = value as Partial<StoredVault>;
  if (candidate.kind !== 'aimtrix.account-vault.v1' || !Array.isArray(candidate.accounts) || candidate.accounts.length > 16 ||
    !(candidate.active === null || typeof candidate.active === 'string')) return;
  const accounts = candidate.accounts.map(parseStoredMatrixSession);
  if (accounts.some((session) => !session)) return;
  const valid = accounts as StoredMatrixSession[];
  const ids = valid.map(accountId);
  if (new Set(ids).size !== ids.length || candidate.active !== null && !ids.includes(candidate.active!)) return;
  return { kind: 'aimtrix.account-vault.v1', active: candidate.active, accounts: valid };
}

export function createAccountCredentialStore(raw: CredentialStore<string>): AccountCredentialStore {
  let pending: Promise<unknown> = Promise.resolve();
  const read = async (): Promise<StoredVault> => {
    const serialized = await raw.load();
    if (!serialized) return { kind: 'aimtrix.account-vault.v1', active: null, accounts: [] };
    let vault: StoredVault | undefined;
    try {
      const value: unknown = JSON.parse(serialized);
      if (value && typeof value === 'object' && 'kind' in value && typeof value.kind === 'string' &&
        value.kind.startsWith('aimtrix.account-vault.') && value.kind !== 'aimtrix.account-vault.v1') {
        throw new Error('This saved account vault was written by a newer Aimtrix version. Update Aimtrix before opening these accounts.');
      }
      vault = parseVault(value);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('This saved account vault')) throw error;
      // Invalid records from this version can be removed.
    }
    if (vault) return vault;
    await raw.clear();
    return { kind: 'aimtrix.account-vault.v1', active: null, accounts: [] };
  };
  const write = async (vault: StoredVault): Promise<void> => {
    if (!vault.accounts.length) await raw.clear();
    else if (vault.accounts.length === 1 && vault.active === accountId(vault.accounts[0])) {
      // Keep existing single-account storage readable by older installed clients and live probes.
      await raw.save(JSON.stringify(vault.accounts[0]));
    }
    else await raw.save(JSON.stringify(vault));
  };
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = pending.then(operation, operation);
    pending = next.catch(() => undefined);
    return next;
  };
  return {
    load: () => serialized(async () => { const vault = await read(); return vault.accounts.find((session) => accountId(session) === vault.active); }),
    list: () => serialized(async () => { const vault = await read(); return vault.accounts.map((session) => ({
      id: accountId(session), userId: session.userId, homeserver: session.baseUrl, serverName: session.serverName,
      active: accountId(session) === vault.active, recovery: Boolean(session.recovery),
    })); }),
    save: (session) => serialized(async () => {
      const vault = await read();
      const id = accountId(session);
      const index = vault.accounts.findIndex((existing) => accountId(existing) === id);
      if (index < 0) {
        if (vault.accounts.length >= 16) throw new Error('This device already has the maximum of 16 saved Matrix accounts. Forget one before adding another.');
        vault.accounts.push(session);
      }
      else vault.accounts[index] = session;
      vault.active = id;
      await write(vault);
    }),
    clear: () => serialized(async () => {
      const vault = await read();
      vault.accounts = vault.accounts.filter((session) => accountId(session) !== vault.active);
      vault.active = null;
      await write(vault);
    }),
    select: (id) => serialized(async () => {
      const vault = await read();
      const selected = id === null ? undefined : vault.accounts.find((session) => accountId(session) === id);
      if (id !== null && !selected) throw new Error('Account is unavailable on this device.');
      vault.active = id;
      await write(vault);
      return selected;
    }),
    remove: (id) => serialized(async () => {
      const vault = await read();
      const removed = vault.accounts.find((session) => accountId(session) === id);
      if (!removed) return undefined;
      vault.accounts = vault.accounts.filter((session) => accountId(session) !== id);
      if (vault.active === id) vault.active = null;
      await write(vault);
      return removed;
    }),
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
