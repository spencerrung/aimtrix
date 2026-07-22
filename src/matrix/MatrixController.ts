import type {
  MatrixClient,
  MatrixEvent,
  NotificationCountType,
  Room,
  SyncState,
} from 'matrix-js-sdk';
import type { RoomMessageEventContent } from 'matrix-js-sdk/lib/@types/events.js';
import type { SecretStorageKeyDescriptionAesV1 } from 'matrix-js-sdk/lib/secret-storage.js';
import {
  VerificationPhase,
  VerificationRequestEvent,
  VerifierEvent,
  type ShowSasCallbacks,
} from 'matrix-js-sdk/lib/crypto-api/verification.js';
import type {
  CallError,
  CallErrorCode,
  MatrixCall,
} from 'matrix-js-sdk/lib/webrtc/call.js';
import type { RuntimeConfig } from '../config/runtimeConfig';
import { parseUserPreferences, type UserPreferences } from '../settings/preferences';
import {
  parseProfilePersonalization,
  type ProfilePersonalization,
} from '../settings/profilePersonalization';
import { buildWorkspaceSnapshot, createWorkspaceSnapshotCache } from './buildWorkspaceSnapshot';
import { resolveHomeserver } from './discovery';
import {
  clearStoredSession,
  databaseNames,
  loadStoredSession,
  saveStoredSession,
  type StoredMatrixSession,
} from './sessionStore';
import type { EncryptedMediaInfo } from './mediaContext';
import type { SpaceHierarchyRoomData } from './spaceHierarchy';
import {
  DIRECT_BACKGROUNDS_EVENT,
  ROOM_BACKGROUND_EVENT,
  parseDirectBackgrounds,
  serializeDirectBackgrounds,
  serializeRoomBackground,
  thresholdForBackgroundPermission,
  type RoomBackground,
  type RoomBackgroundPermission,
} from './roomBackgrounds';
import type {
  DeviceRemovalResult,
  DeviceVerificationChallenge,
  MatrixSettingsSnapshot,
} from './settingsTypes';
import type {
  CallSummary,
  ConnectionState,
  PresenceState,
  SpaceSummary,
  WorkspaceSnapshot,
} from './viewModels';

export interface LoginCredentials {
  userId: string;
  password: string;
  homeserver: string;
}

export type MatrixControllerSnapshot =
  | { status: 'restoring'; message: string }
  | { status: 'authenticating'; message: string }
  | { status: 'signed-out'; error?: string }
  | { status: 'connecting'; message: string; error?: string }
  | { status: 'ready'; workspace: WorkspaceSnapshot }
  | { status: 'error'; error: string; canRetry: boolean };

type Subscriber = () => void;
type MatrixSdk = typeof import('matrix-js-sdk');
const SSO_PENDING_KEY = 'aimtrix.sso-pending.v1';
const PERSONALIZATION_EVENT = 'dev.alucard.aimtrix.preferences.v1';
const PROFILE_PERSONALIZATION_EVENT = 'dev.alucard.aimtrix.profile.v1';
const SPACE_ORDER_EVENT = 'dev.alucard.aimtrix.space_order.v1';

let matrixSdkPromise: Promise<MatrixSdk> | undefined;

function loadMatrixSdk(): Promise<MatrixSdk> {
  matrixSdkPromise ??= import('matrix-js-sdk');
  return matrixSdkPromise;
}

function friendlyError(error: unknown): string {
  const candidate = error as { errcode?: unknown; message?: unknown; name?: unknown };
  if (candidate.errcode === 'M_FORBIDDEN') return 'That Matrix ID or password was not accepted.';
  if (candidate.errcode === 'M_UNKNOWN_TOKEN') return 'Your Matrix session expired. Please sign in again.';
  if (candidate.errcode === 'M_LIMIT_EXCEEDED') return 'The homeserver is busy. Wait a moment and try again.';
  if (candidate.errcode === 'M_USER_DEACTIVATED') return 'This Matrix account has been deactivated.';
  if (candidate.errcode === 'M_CONSENT_NOT_GIVEN') return 'This homeserver requires account consent. Complete it in another Matrix client or the server account page, then retry.';
  if (candidate.name === 'AbortError') return 'The connection was cancelled.';
  if (typeof candidate.message === 'string' && /^(This homeserver|SSO )/.test(candidate.message)) {
    return candidate.message;
  }
  if (typeof candidate.message === 'string' && /indexeddb|crypto|wasm/i.test(candidate.message)) {
    return 'Aimtrix could not open encrypted local storage. Check private-browsing or storage settings.';
  }
  return 'Aimtrix could not connect to that homeserver. Check the address and try again.';
}

function isUnknownToken(error: unknown): boolean {
  return (error as { errcode?: unknown }).errcode === 'M_UNKNOWN_TOKEN';
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

async function deleteAccountDatabases(session: StoredMatrixSession): Promise<void> {
  const names = databaseNames(session);
  await Promise.all([
    deleteDatabase(names.sync),
    deleteDatabase(`${names.crypto}::matrix-sdk-crypto`),
    deleteDatabase(`${names.crypto}::matrix-sdk-crypto-meta`),
  ]);
}

export class MatrixController {
  private snapshot: MatrixControllerSnapshot = {
    status: 'restoring',
    message: 'Looking for your saved session…',
  };
  private readonly subscribers = new Set<Subscriber>();
  private client?: MatrixClient;
  private sdk?: MatrixSdk;
  private activeSession?: StoredMatrixSession;
  private initialized = false;
  private publishFrame?: number;
  private connection: ConnectionState = 'connecting';
  private readonly snapshotCache = createWorkspaceSnapshotCache();
  private readonly mediaRequests = new Map<string, Promise<string | undefined>>();
  private readonly mediaObjectUrls = new Set<string>();
  private readonly pendingDeviceAuth = new Map<string, string>();
  private readonly stickerUploads = new Map<string, Promise<{
    url?: string;
    file?: Record<string, unknown>;
    mimetype: string;
    size: number;
  }>>();
  private activeCall?: MatrixCall;
  private callSummary?: CallSummary;
  private callDevices = { microphoneId: '', cameraId: '' };
  private uploadAbortController?: AbortController;
  private inMemoryRecoveryKey?: Uint8Array<ArrayBuffer>;
  private personalizationLoaded = false;
  private personalizationSaveTimer?: number;
  private profilePersonalizationLoaded = false;
  private profilePersonalizationSaveTimer?: number;
  private readonly spaceHierarchies = new Map<string, SpaceHierarchyRoomData[]>();
  private readonly spaceHierarchyRequests = new Map<string, Promise<void>>();
  private readonly lastReadReceiptByRoom = new Map<string, string>();
  private rootSpaceOrderOverride?: string[];
  private notificationPreferences = {
    desktopNotifications: false,
    notificationSounds: true,
    soundVolume: 0.55,
  };

  public constructor(private readonly config: RuntimeConfig) {}

  public getSnapshot = (): MatrixControllerSnapshot => this.snapshot;

  public setNotificationPreferences(preferences: {
    desktopNotifications: boolean;
    notificationSounds: boolean;
    soundVolume: number;
  }): void {
    this.notificationPreferences = preferences;
  }

  public subscribe = (subscriber: Subscriber): (() => void) => {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  };

  private setSnapshot(snapshot: MatrixControllerSnapshot): void {
    this.snapshot = snapshot;
    for (const subscriber of this.subscribers) subscriber();
  }

  private bumpRoomVersion(roomId?: string): void {
    if (!roomId) return;
    this.snapshotCache.roomVersions.set(roomId, (this.snapshotCache.roomVersions.get(roomId) ?? 0) + 1);
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const loginToken = new URL(window.location.href).searchParams.get('loginToken');
    if (loginToken) {
      this.setSnapshot({ status: 'connecting', message: 'Completing Matrix SSO…' });
      try {
        await this.completeSso(loginToken);
        return;
      } catch (error) {
        this.setSnapshot({ status: 'signed-out', error: friendlyError(error) });
        return;
      }
    }
    const session = loadStoredSession();
    if (!session) {
      this.setSnapshot({ status: 'signed-out' });
      return;
    }

    this.setSnapshot({ status: 'connecting', message: 'Restoring your encrypted Matrix session…' });
    try {
      await this.connect(session);
    } catch (error) {
      if (isUnknownToken(error)) {
        await deleteAccountDatabases(session);
        clearStoredSession();
        this.setSnapshot({ status: 'signed-out', error: friendlyError(error) });
      } else {
        this.setSnapshot({ status: 'error', error: friendlyError(error), canRetry: true });
      }
    }
  }

  public async startSso(credentials: Pick<LoginCredentials, 'userId' | 'homeserver'>): Promise<void> {
    this.setSnapshot({ status: 'authenticating', message: 'Checking SSO providers…' });
    try {
      const target = await resolveHomeserver({
        homeserverInput: credentials.homeserver,
        userId: credentials.userId,
        configuredServerName: this.config.defaultHomeserver.serverName,
        configuredBaseUrl: this.config.defaultHomeserver.baseUrl,
      });
      const sdk = await loadMatrixSdk();
      const ssoClient = sdk.createClient({ baseUrl: target.baseUrl });
      const flows = await ssoClient.loginFlows();
      const loginType = flows.flows.some((flow) => flow.type === 'm.login.sso')
        ? 'sso'
        : flows.flows.some((flow) => flow.type === 'm.login.cas')
          ? 'cas'
          : undefined;
      if (!loginType) throw new Error('This homeserver does not advertise SSO.');
      sessionStorage.setItem(SSO_PENDING_KEY, JSON.stringify(target));
      const redirectUrl = `${window.location.origin}${window.location.pathname}`;
      window.location.assign(ssoClient.getSsoLoginUrl(redirectUrl, loginType));
    } catch (error) {
      this.setSnapshot({ status: 'signed-out', error: friendlyError(error) });
    }
  }

  private async completeSso(loginToken: string): Promise<void> {
    const serialized = sessionStorage.getItem(SSO_PENDING_KEY);
    if (!serialized) throw new Error('SSO homeserver information is missing.');
    const target = JSON.parse(serialized) as { baseUrl: string; serverName: string };
    const sdk = await loadMatrixSdk();
    const loginClient = sdk.createClient({ baseUrl: target.baseUrl });
    const response = await loginClient.login('m.login.token', {
      token: loginToken,
      initial_device_display_name: 'Aimtrix Web',
    });
    const session: StoredMatrixSession = {
      baseUrl: target.baseUrl,
      serverName: target.serverName,
      accessToken: response.access_token,
      userId: response.user_id,
      deviceId: response.device_id,
    };
    sessionStorage.removeItem(SSO_PENDING_KEY);
    window.history.replaceState({}, '', window.location.pathname);
    saveStoredSession(session);
    await this.connect(session);
  }

  public async login(credentials: LoginCredentials): Promise<void> {
    if (!credentials.userId.trim() || !credentials.password) {
      this.setSnapshot({ status: 'signed-out', error: 'Enter your Matrix ID and password.' });
      return;
    }

    this.setSnapshot({ status: 'authenticating', message: 'Contacting your homeserver…' });
    try {
      const target = await resolveHomeserver({
        homeserverInput: credentials.homeserver,
        userId: credentials.userId,
        configuredServerName: this.config.defaultHomeserver.serverName,
        configuredBaseUrl: this.config.defaultHomeserver.baseUrl,
      });
      const sdk = await loadMatrixSdk();
      const loginClient = sdk.createClient({ baseUrl: target.baseUrl });
      const response = await loginClient.login('m.login.password', {
        identifier: { type: 'm.id.user', user: credentials.userId.trim() },
        password: credentials.password,
        initial_device_display_name: 'Aimtrix Web',
      });
      const session: StoredMatrixSession = {
        baseUrl: target.baseUrl,
        serverName: target.serverName,
        accessToken: response.access_token,
        userId: response.user_id,
        deviceId: response.device_id,
      };
      saveStoredSession(session);
      this.setSnapshot({ status: 'connecting', message: 'Opening encrypted message storage…' });
      await this.connect(session);
    } catch (error) {
      this.setSnapshot({ status: 'signed-out', error: friendlyError(error) });
    }
  }

  public async retry(): Promise<void> {
    const session = loadStoredSession();
    if (!session) {
      this.setSnapshot({ status: 'signed-out' });
      return;
    }
    this.setSnapshot({ status: 'connecting', message: 'Trying your homeserver again…' });
    try {
      await this.connect(session);
    } catch (error) {
      this.setSnapshot({ status: 'error', error: friendlyError(error), canRetry: true });
    }
  }

  public async forgetSession(): Promise<void> {
    const client = this.client;
    const session = this.activeSession ?? loadStoredSession();
    this.detachClientListeners();
    client?.stopClient();
    this.client = undefined;
    this.activeSession = undefined;
    this.clearMediaCache();

    if (client) {
      try {
        await client.clearStores({
          cryptoDatabasePrefix: session ? databaseNames(session).crypto : undefined,
        });
      } catch {
        if (session) await deleteAccountDatabases(session);
      }
    } else if (session) {
      await deleteAccountDatabases(session);
    }

    clearStoredSession();
    this.setSnapshot({ status: 'signed-out' });
  }

  public async logout(): Promise<void> {
    const client = this.client;
    const session = this.activeSession;
    this.setSnapshot({ status: 'connecting', message: 'Signing off…' });
    this.detachClientListeners();
    this.client = undefined;
    this.activeSession = undefined;
    this.clearMediaCache();

    if (client) {
      try {
        await client.logout(false);
      } catch {
        // Local logout must still succeed when the homeserver is unavailable.
      }
      client.stopClient();
      try {
        await client.clearStores({
          cryptoDatabasePrefix: session ? databaseNames(session).crypto : undefined,
        });
      } catch {
        // Stale cache can be safely ignored after the access token is removed.
      }
    }

    clearStoredSession();
    this.setSnapshot({ status: 'signed-out' });
  }

  public resolveMedia = (
    source: string,
    requestedSize: number,
    encryptedFile?: EncryptedMediaInfo,
    mimeType?: string,
  ): Promise<string | undefined> => {
    if (!source.startsWith('mxc://')) return Promise.resolve(source);
    const size = Math.min(1024, Math.max(32, Math.round(requestedSize)));
    const key = `${source}|${size}|${encryptedFile?.hashes?.sha256 ?? ''}`;
    const existing = this.mediaRequests.get(key);
    if (existing) return existing;

    const request = this.fetchMatrixMedia(source, size, encryptedFile, mimeType).catch(
      () => undefined,
    );
    this.mediaRequests.set(key, request);
    return request;
  };

  private async fetchMatrixMedia(
    source: string,
    size: number,
    encryptedFile?: EncryptedMediaInfo,
    mimeType?: string,
  ): Promise<string | undefined> {
    const client = this.client;
    const accessToken = client?.getAccessToken();
    if (!client || !accessToken) return undefined;
    const useOriginal = Boolean(
      encryptedFile ||
      mimeType === 'image/svg+xml' ||
      (mimeType && !mimeType.startsWith('image/')),
    );
    const url = useOriginal
      ? client.mxcUrlToHttp(source, undefined, undefined, undefined, false, true, true)
      : client.mxcUrlToHttp(source, size, size, 'crop', false, true, true);
    if (!url) return undefined;

    const response = await fetch(url, {
      headers: {
        Accept: mimeType || 'image/*',
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) return undefined;
    const maxBytes = this.config.media.maxUploadBytes;
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > maxBytes) return undefined;
    let blob: Blob;
    if (encryptedFile) {
      const encrypted = await response.arrayBuffer();
      if (!encrypted.byteLength || encrypted.byteLength > maxBytes) return undefined;
      const { decryptAttachment } = await import('matrix-encrypt-attachment');
      const decrypted = await decryptAttachment(encrypted, encryptedFile);
      blob = new Blob([decrypted], { type: mimeType || 'application/octet-stream' });
    } else {
      blob = await response.blob();
    }
    if (!blob.size || blob.size > maxBytes) return undefined;
    const objectUrl = URL.createObjectURL(blob);
    this.mediaObjectUrls.add(objectUrl);
    return objectUrl;
  }

  private clearMediaCache(): void {
    for (const objectUrl of this.mediaObjectUrls) URL.revokeObjectURL(objectUrl);
    this.mediaObjectUrls.clear();
    this.mediaRequests.clear();
    this.stickerUploads.clear();
  }

  public async loadSettings(): Promise<MatrixSettingsSnapshot> {
    const client = this.client;
    const session = this.activeSession;
    if (!client || !session) throw new Error('Matrix is not connected.');
    const crypto = client.getCrypto();
    const [deviceResponse, versions, crossSigningReady, secretStorageReady, backupInfo] =
      await Promise.all([
        client.getDevices(),
        client.getVersions(),
        crypto?.isCrossSigningReady() ?? Promise.resolve(false),
        crypto?.isSecretStorageReady() ?? Promise.resolve(false),
        crypto?.getKeyBackupInfo() ?? Promise.resolve(null),
      ]);
    const devices = await Promise.all(
      deviceResponse.devices.map(async (device) => ({
        id: device.device_id,
        displayName: device.display_name || 'Unnamed Matrix session',
        lastSeenAt: device.last_seen_ts,
        lastSeenIp: device.last_seen_ip,
        userAgent:
          device['org.matrix.msc3852.last_seen_user_agent'] || device.last_seen_user_agent,
        current: device.device_id === session.deviceId,
        verified:
          (await crypto?.getDeviceVerificationStatus(session.userId, device.device_id))?.isVerified() ??
          false,
      })),
    );

    const wellKnown = client.getClientWellKnown() as Record<string, unknown> | undefined;
    const rawFoci = wellKnown?.['org.matrix.msc4143.rtc_foci'];
    const rtcFoci = Array.isArray(rawFoci)
      ? rawFoci.flatMap((focus) => {
          if (!focus || typeof focus !== 'object') return [];
          const candidate = focus as Record<string, unknown>;
          const type = typeof candidate.type === 'string' ? candidate.type : 'RTC focus';
          const url = typeof candidate.livekit_service_url === 'string'
            ? candidate.livekit_service_url
            : typeof candidate.url === 'string'
              ? candidate.url
              : undefined;
          return [`${type}${url ? ` — ${url}` : ''}`];
        })
      : [];

    return {
      server: {
        userId: session.userId,
        homeserverUrl: session.baseUrl,
        serverName: session.serverName,
        deviceId: session.deviceId,
        versions: versions.versions,
        rtcFoci,
      },
      security: {
        encryptionReady: Boolean(crypto),
        crossSigningReady,
        secretStorageReady,
        keyBackupEnabled: Boolean(backupInfo),
        keyBackupVersion: backupInfo?.version,
      },
      devices: devices.sort((left, right) => {
        if (left.current !== right.current) return left.current ? -1 : 1;
        return (right.lastSeenAt ?? 0) - (left.lastSeenAt ?? 0);
      }),
      ignoredUsers: client.getIgnoredUsers(),
    };
  }

  public async verifyDevice(deviceId: string): Promise<DeviceVerificationChallenge> {
    const client = this.client;
    const crypto = client?.getCrypto();
    if (!client || !crypto) throw new Error('Encryption is not available.');
    const request = await crypto.requestDeviceVerification(client.getSafeUserId(), deviceId);
    if (request.phase < VerificationPhase.Ready) {
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          window.clearTimeout(timeout);
          request.off(VerificationRequestEvent.Change, handleChange);
          if (error) reject(error);
          else resolve();
        };
        const handleChange = () => {
          if (request.phase === VerificationPhase.Cancelled) {
            finish(new Error('Verification was cancelled.'));
          } else if (request.phase >= VerificationPhase.Ready) {
            finish();
          }
        };
        const timeout = window.setTimeout(
          () => finish(new Error('Verification request timed out.')),
          120000,
        );
        request.on(VerificationRequestEvent.Change, handleChange);
      });
    }
    const verifier = request.verifier ?? await request.startVerification('m.sas.v1');
    let rejectSas: (reason?: unknown) => void = () => undefined;
    const sasPromise = new Promise<ShowSasCallbacks>((resolve, reject) => {
      rejectSas = reject;
      const timeout = window.setTimeout(() => reject(new Error('Verification timed out.')), 120000);
      verifier.once(VerifierEvent.ShowSas, (callbacks: ShowSasCallbacks) => {
        window.clearTimeout(timeout);
        resolve(callbacks);
      });
    });
    const completion = verifier.verify();
    void completion.catch(rejectSas);
    const sas = await sasPromise;
    const emoji = sas.sas.emoji ?? [];
    if (!emoji.length) {
      sas.cancel();
      throw new Error('The other device did not provide emoji verification.');
    }
    return {
      emoji,
      confirm: async () => {
        await sas.confirm();
        await completion;
      },
      cancel: () => sas.cancel(),
    };
  }

  public async renameDevice(deviceId: string, displayName: string): Promise<void> {
    const client = this.client;
    if (!client) throw new Error('Matrix is not connected.');
    await client.setDeviceDetails(deviceId, { display_name: displayName.trim() });
  }

  public async changePassword(
    currentPassword: string,
    newPassword: string,
    logoutOtherDevices: boolean,
  ): Promise<void> {
    const client = this.client;
    if (!client) throw new Error('Matrix is not connected.');
    await client.setPassword(
      {
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: client.getSafeUserId() },
        password: currentPassword,
      },
      newPassword,
      logoutOtherDevices,
    );
  }

  public async deactivateAccount(password: string, erase: boolean): Promise<void> {
    const client = this.client;
    if (!client) throw new Error('Matrix is not connected.');
    await client.deactivateAccount(
      {
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: client.getSafeUserId() },
        password,
      },
      erase,
    );
    await this.stopCurrentClient();
    clearStoredSession();
    this.setSnapshot({ status: 'signed-out' });
  }

  public async removeDevice(deviceId: string, password?: string): Promise<DeviceRemovalResult> {
    const client = this.client;
    const session = this.activeSession;
    if (!client || !session) throw new Error('Matrix is not connected.');
    if (deviceId === session.deviceId) throw new Error('Use Sign out for the current session.');
    const pendingSession = this.pendingDeviceAuth.get(deviceId);
    const auth = password
      ? {
          type: 'm.login.password',
          identifier: { type: 'm.id.user', user: session.userId },
          password,
          session: pendingSession,
        }
      : undefined;
    try {
      await client.deleteDevice(deviceId, auth);
      this.pendingDeviceAuth.delete(deviceId);
      return 'removed';
    } catch (error) {
      const candidate = error as { errcode?: string; data?: { session?: string }; httpStatus?: number };
      const authSession = candidate.data?.session;
      if ((candidate.errcode === 'M_UNAUTHORIZED' || candidate.httpStatus === 401) && authSession) {
        this.pendingDeviceAuth.set(deviceId, authSession);
        return 'password-required';
      }
      throw error;
    }
  }

  public async setIgnoredUsers(userIds: string[]): Promise<void> {
    const client = this.client;
    if (!client) throw new Error('Matrix is not connected.');
    await client.setIgnoredUsers([...new Set(userIds.map((userId) => userId.trim()).filter(Boolean))]);
    this.scheduleWorkspacePublish();
  }

  public async uploadProfileAvatar(file: File): Promise<void> {
    const client = this.client;
    if (!client) throw new Error('Matrix is not connected.');
    const contentUri = await this.uploadProfileImage(file);
    await client.setAvatarUrl(contentUri);
    this.scheduleWorkspacePublish();
  }

  public async uploadProfileBanner(file: File): Promise<string> {
    return this.uploadProfileImage(file);
  }

  public async uploadRoomBackground(file: File): Promise<string> {
    return this.uploadProfileImage(file);
  }

  private async uploadProfileImage(file: File): Promise<string> {
    const client = this.client;
    if (!client) throw new Error('Matrix is not connected.');
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      throw new Error('Choose a PNG, JPEG, WebP, or GIF smaller than 10 MiB.');
    }
    const uploaded = await client.uploadContent(file, {
      name: file.name,
      type: file.type,
      includeFilename: false,
    });
    return uploaded.content_uri;
  }

  public async restoreRecovery(recoveryKey: string): Promise<number> {
    const crypto = this.client?.getCrypto();
    if (!crypto) throw new Error('Encryption is not ready.');
    const { decodeRecoveryKey } = await import(
      'matrix-js-sdk/lib/crypto-api/recovery-key.js'
    );
    this.inMemoryRecoveryKey = decodeRecoveryKey(recoveryKey.trim());
    try {
      await crypto.bootstrapCrossSigning({});
      await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
      await crypto.checkKeyBackupAndEnable();
      const restored = await crypto.restoreKeyBackup();
      return restored.imported;
    } catch (error) {
      this.inMemoryRecoveryKey = undefined;
      throw error;
    }
  }

  public async setupRecovery(passphrase: string, accountPassword: string): Promise<string> {
    const client = this.client;
    const session = this.activeSession;
    const crypto = client?.getCrypto();
    if (!client || !session || !crypto) throw new Error('Encryption is not ready.');
    if (!passphrase.trim() || !accountPassword) throw new Error('Both passwords are required.');

    if (!(await crypto.isCrossSigningReady())) {
      await crypto.bootstrapCrossSigning({
        authUploadDeviceSigningKeys: async (makeRequest) => {
          try {
            return await makeRequest(null);
          } catch (error) {
            const authSession = (error as { data?: { session?: string } }).data?.session;
            return makeRequest({
              type: 'm.login.password',
              identifier: { type: 'm.id.user', user: session.userId },
              password: accountPassword,
              session: authSession,
            });
          }
        },
      });
    }

    const recoveryKey = await crypto.createRecoveryKeyFromPassphrase(passphrase);
    await crypto.bootstrapSecretStorage({
      createSecretStorageKey: async () => recoveryKey,
      setupNewSecretStorage: true,
      setupNewKeyBackup: true,
    });
    if (!recoveryKey.encodedPrivateKey) throw new Error('Recovery key was not generated.');
    return recoveryKey.encodedPrivateKey;
  }

  public async updateProfile(update: {
    displayName: string;
    presence: PresenceState;
    statusMessage: string;
  }): Promise<void> {
    const client = this.client;
    if (!client) throw new Error('Matrix is not connected.');
    const displayName = update.displayName.trim();
    if (!displayName) throw new Error('Display name is required.');
    if (client.getUser(client.getSafeUserId())?.displayName !== displayName) {
      await client.setDisplayName(displayName);
    }
    await client.setPresence({
      presence: update.presence === 'away' || update.presence === 'busy' ? 'unavailable' : update.presence,
      status_msg: update.statusMessage.trim() || undefined,
    });
    this.scheduleWorkspacePublish();
  }

  public async loadSpaceHierarchy(spaceId: string): Promise<void> {
    const client = this.client;
    if (!client || spaceId === 'home' || this.spaceHierarchies.has(spaceId)) return;
    const existing = this.spaceHierarchyRequests.get(spaceId);
    if (existing) return existing;

    const request = (async () => {
      const hierarchyRooms = new Map<string, SpaceHierarchyRoomData>();
      const seenTokens = new Set<string>();
      let fromToken: string | undefined;
      do {
        const response = await client.getRoomHierarchy(spaceId, 100, 20, false, fromToken);
        for (const room of response.rooms) {
          const children = room.children_state
            .filter((event) => {
              const via = event.content?.via;
              return (
                event.type === 'm.space.child' &&
                Boolean(event.state_key) &&
                Array.isArray(via) &&
                via.some((server) => typeof server === 'string' && server.length > 0)
              );
            })
            .sort((left, right) => {
              const leftOrder =
                typeof left.content.order === 'string' && /^[\x20-\x7E]{1,50}$/.test(left.content.order)
                  ? left.content.order
                  : undefined;
              const rightOrder =
                typeof right.content.order === 'string' && /^[\x20-\x7E]{1,50}$/.test(right.content.order)
                  ? right.content.order
                  : undefined;
              if (leftOrder && rightOrder) {
                return leftOrder.localeCompare(rightOrder) || left.origin_server_ts - right.origin_server_ts;
              }
              if (leftOrder) return -1;
              if (rightOrder) return 1;
              return left.origin_server_ts - right.origin_server_ts;
            })
            .flatMap((event) => event.state_key ? [event.state_key] : []);
          hierarchyRooms.set(room.room_id, {
            id: room.room_id,
            name: room.name || room.canonical_alias || room.room_id,
            avatarUrl: room.avatar_url,
            topic: room.topic,
            roomType: room.room_type,
            membership: client.getRoom(room.room_id)?.getMyMembership() ?? 'leave',
            childIds: children,
          });
        }
        const nextToken = response.next_batch;
        if (!nextToken || seenTokens.has(nextToken)) break;
        seenTokens.add(nextToken);
        fromToken = nextToken;
      } while (fromToken);
      if (this.client !== client) return;
      this.spaceHierarchies.set(spaceId, [...hierarchyRooms.values()]);
      this.scheduleWorkspacePublish();
    })().finally(() => {
      this.spaceHierarchyRequests.delete(spaceId);
    });

    this.spaceHierarchyRequests.set(spaceId, request);
    return request;
  }

  private spaceViaServers(roomId: string): string[] {
    const serverName = roomId.includes(':') ? roomId.slice(roomId.indexOf(':') + 1) : undefined;
    return [...new Set([serverName, this.activeSession?.serverName].filter((value): value is string => Boolean(value)))];
  }

  private async writeSpaceChildOrder(
    spaceId: string,
    childIds: string[],
    movedChildId?: string,
    movedContent?: Record<string, unknown>,
  ): Promise<void> {
    const client = this.client;
    const sdk = this.sdk;
    const space = client?.getRoom(spaceId);
    if (!client || !sdk || !space) throw new Error('The Matrix space is not available.');
    for (const [index, childId] of childIds.entries()) {
      const existing = space.currentState
        .getStateEvents(sdk.EventType.SpaceChild, childId)
        ?.getContent<Record<string, unknown>>();
      const base = existing && Array.isArray(existing.via)
        ? existing
        : childId === movedChildId && movedContent
          ? movedContent
          : {};
      const via = Array.isArray(base.via)
        ? base.via.filter((server): server is string => typeof server === 'string' && server.length > 0)
        : this.spaceViaServers(childId);
      await client.sendStateEvent(
        spaceId,
        sdk.EventType.SpaceChild,
        { ...base, via: via.length ? via : this.spaceViaServers(spaceId), order: String(index).padStart(6, '0') },
        childId,
      );
    }
  }

  public async reorganizeSpaceChildren(update: {
    childId: string;
    sourceSpaceId: string;
    targetSpaceId: string;
    sourceChildIds: string[];
    targetChildIds: string[];
  }): Promise<void> {
    const client = this.client;
    const sdk = this.sdk;
    if (!client || !sdk) throw new Error('Matrix is not connected.');
    const source = client.getRoom(update.sourceSpaceId);
    const target = client.getRoom(update.targetSpaceId);
    const userId = client.getSafeUserId();
    if (!source || source.getType() !== 'm.space' || !target || target.getType() !== 'm.space') {
      throw new Error('Both the source and destination must be joined Matrix spaces.');
    }
    if (
      !source.currentState.maySendStateEvent(sdk.EventType.SpaceChild, userId) ||
      !target.currentState.maySendStateEvent(sdk.EventType.SpaceChild, userId)
    ) {
      throw new Error('You do not have permission to reorganize one of those spaces.');
    }
    const validList = (values: string[]) =>
      values.length <= 1000 &&
      values.every((value) => typeof value === 'string' && value.length > 0) &&
      new Set(values).size === values.length;
    if (
      !validList(update.sourceChildIds) ||
      !validList(update.targetChildIds) ||
      !update.targetChildIds.includes(update.childId) ||
      (update.sourceSpaceId !== update.targetSpaceId && update.sourceChildIds.includes(update.childId))
    ) {
      throw new Error('The requested space order is invalid.');
    }

    const hierarchyMarksChildAsSpace = [...this.spaceHierarchies.values()]
      .flat()
      .some((room) => room.id === update.childId && room.roomType === 'm.space');
    if (client.getRoom(update.childId)?.getType() === 'm.space' || hierarchyMarksChildAsSpace) {
      const currentWorkspace = buildWorkspaceSnapshot(
        client,
        this.connection,
        [...this.spaceHierarchies.values()].flat(),
        this.readRootSpaceOrder(),
      );
      const movedSpace = currentWorkspace.spaces.find((space) => space.id === update.childId);
      const containsSpace = (space: SpaceSummary, targetId: string, seen = new Set<string>()): boolean => {
        if (seen.has(space.id)) return false;
        seen.add(space.id);
        return space.childSpaceIds.some((childId) => {
          if (childId === targetId) return true;
          const child = currentWorkspace.spaces.find((candidate) => candidate.id === childId);
          return child ? containsSpace(child, targetId, seen) : false;
        });
      };
      if (
        update.childId === update.targetSpaceId ||
        (movedSpace && containsSpace(movedSpace, update.targetSpaceId))
      ) {
        throw new Error('A space cannot be moved into itself or one of its descendants.');
      }
    }

    const movedEvent = source.currentState.getStateEvents(sdk.EventType.SpaceChild, update.childId);
    const movedContent = movedEvent?.getContent<Record<string, unknown>>() ?? {
      via: this.spaceViaServers(update.childId),
    };

    if (update.sourceSpaceId === update.targetSpaceId) {
      await this.writeSpaceChildOrder(update.sourceSpaceId, update.targetChildIds);
    } else {
      await this.writeSpaceChildOrder(
        update.targetSpaceId,
        update.targetChildIds,
        update.childId,
        movedContent,
      );
      await this.writeSpaceChildOrder(update.sourceSpaceId, update.sourceChildIds);
      await client.sendStateEvent(
        update.sourceSpaceId,
        sdk.EventType.SpaceChild,
        {},
        update.childId,
      );

      const movedRoom = client.getRoom(update.childId);
      if (
        movedRoom?.getType() === 'm.space' &&
        movedRoom.currentState.maySendStateEvent(sdk.EventType.SpaceParent, userId)
      ) {
        try {
          await client.sendStateEvent(
            update.childId,
            sdk.EventType.SpaceParent,
            {},
            update.sourceSpaceId,
          );
        } catch {
          // The authoritative parent child relation succeeded; some spaces restrict child-side state.
        }
        try {
          await client.sendStateEvent(
            update.childId,
            sdk.EventType.SpaceParent,
            { via: this.spaceViaServers(update.targetSpaceId) },
            update.targetSpaceId,
          );
        } catch {
          // The parent-side relation still makes the moved subspace navigable.
        }
      }
    }
    this.spaceHierarchies.clear();
    this.scheduleWorkspacePublish();
  }

  private readRootSpaceOrder(): string[] {
    if (this.rootSpaceOrderOverride) return this.rootSpaceOrderOverride;
    const event = (
      this.client as unknown as { getAccountData: (type: string) => MatrixEvent | undefined }
    )?.getAccountData(SPACE_ORDER_EVENT);
    const order = event?.getContent<{ order?: unknown }>().order;
    return Array.isArray(order)
      ? order.filter((spaceId): spaceId is string => typeof spaceId === 'string')
      : [];
  }

  public async reorderRootSpaces(spaceIds: string[]): Promise<void> {
    const client = this.client;
    if (!client || new Set(spaceIds).size !== spaceIds.length) {
      throw new Error('The requested top-level space order is invalid.');
    }
    const joinedRoots = buildWorkspaceSnapshot(
      client,
      this.connection,
      [...this.spaceHierarchies.values()].flat(),
      this.readRootSpaceOrder(),
    ).spaces.filter(
      (space) => space.kind === 'matrix' && space.membership === 'join' && space.parentSpaceIds.length === 0,
    );
    if (
      spaceIds.length !== joinedRoots.length ||
      spaceIds.some((spaceId) => !joinedRoots.some((space) => space.id === spaceId))
    ) {
      throw new Error('Only joined top-level spaces can be reordered.');
    }
    this.rootSpaceOrderOverride = [...spaceIds];
    const accountClient = client as unknown as {
      setAccountData: (type: string, content: Record<string, unknown>) => Promise<unknown>;
    };
    try {
      await accountClient.setAccountData(SPACE_ORDER_EVENT, { order: spaceIds });
      this.scheduleWorkspacePublish();
    } catch (error) {
      this.rootSpaceOrderOverride = undefined;
      throw error;
    }
  }

  public async loadRoomHistory(roomId: string): Promise<void> {
    const client = this.client;
    const room = client?.getRoom(roomId);
    if (!client || !room) return;
    await client.scrollback(room, 50);
    this.scheduleWorkspacePublish();
  }

  public loadPersonalization(): UserPreferences | undefined {
    const event = (
      this.client as unknown as { getAccountData: (type: string) => MatrixEvent | undefined }
    )?.getAccountData(PERSONALIZATION_EVENT);
    this.personalizationLoaded = true;
    return event ? parseUserPreferences(event.getContent()) : undefined;
  }

  public savePersonalization(preferences: UserPreferences): void {
    if (!this.client || !this.personalizationLoaded) return;
    if (this.personalizationSaveTimer !== undefined) {
      window.clearTimeout(this.personalizationSaveTimer);
    }
    this.personalizationSaveTimer = window.setTimeout(() => {
      const client = this.client;
      if (!client) return;
      const {
        microphoneId: _microphoneId,
        cameraId: _cameraId,
        speakerId: _speakerId,
        ...portable
      } = preferences;
      void _microphoneId;
      void _cameraId;
      void _speakerId;
      const accountClient = client as unknown as {
        setAccountData: (type: string, content: Record<string, unknown>) => Promise<unknown>;
      };
      void accountClient.setAccountData(PERSONALIZATION_EVENT, portable).catch(() => undefined);
    }, 500);
  }

  public loadProfilePersonalization(): ProfilePersonalization | undefined {
    const event = (
      this.client as unknown as { getAccountData: (type: string) => MatrixEvent | undefined }
    )?.getAccountData(PROFILE_PERSONALIZATION_EVENT);
    this.profilePersonalizationLoaded = true;
    return event ? parseProfilePersonalization(event.getContent()) : undefined;
  }

  public saveProfilePersonalization(personalization: ProfilePersonalization): void {
    if (!this.client || !this.profilePersonalizationLoaded) return;
    if (this.profilePersonalizationSaveTimer !== undefined) {
      window.clearTimeout(this.profilePersonalizationSaveTimer);
    }
    this.profilePersonalizationSaveTimer = window.setTimeout(() => {
      const client = this.client;
      if (!client) return;
      const accountClient = client as unknown as {
        setAccountData: (type: string, content: Record<string, unknown>) => Promise<unknown>;
      };
      const portable = parseProfilePersonalization(personalization) as unknown as Record<string, unknown>;
      void accountClient.setAccountData(PROFILE_PERSONALIZATION_EVENT, portable).catch(() => undefined);
    }, 500);
  }

  public setCallDevices(devices: { microphoneId: string; cameraId: string }): void {
    this.callDevices = devices;
  }

  public async startCall(roomId: string, video: boolean): Promise<void> {
    if (!this.config.features.calls) throw new Error('Calling is disabled by this Aimtrix host.');
    const client = this.client;
    const sdk = this.sdk;
    if (!client || !sdk) throw new Error('Matrix is not connected.');
    if (this.activeCall) throw new Error('Another call is already active.');
    const call = sdk.createNewMatrixCall(client, roomId);
    if (!call) throw new Error('Calling is not supported in this browser.');
    this.attachCall(call);
    this.activeCall = call;
    this.updateCallSummary();
    try {
      if (video) await call.placeVideoCall();
      else await call.placeVoiceCall();
      if (this.callDevices.microphoneId || (video && this.callDevices.cameraId)) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: this.callDevices.microphoneId
            ? { deviceId: { exact: this.callDevices.microphoneId } }
            : true,
          video: video
            ? this.callDevices.cameraId
              ? { deviceId: { exact: this.callDevices.cameraId } }
              : true
            : false,
        });
        await call.updateLocalUsermediaStream(stream, true, video);
      }
    } catch (error) {
      this.callSummary = {
        ...(this.callSummary ?? {
          roomId,
          state: 'ended',
          incoming: false,
          video,
          microphoneMuted: false,
          videoMuted: !video,
          screensharing: false,
        }),
        error: error instanceof Error ? error.message : 'The call could not start.',
      };
      this.scheduleWorkspacePublish();
      throw error;
    }
  }

  public async answerCall(video: boolean): Promise<void> {
    if (!this.activeCall) return;
    await this.activeCall.answer(true, video);
    this.updateCallSummary();
  }

  public rejectCall(): void {
    this.activeCall?.reject();
    this.endCallState();
  }

  public hangupCall(): void {
    this.activeCall?.hangup('user_hangup' as CallErrorCode, false);
    this.endCallState();
  }

  public async setCallMicrophoneMuted(muted: boolean): Promise<void> {
    await this.activeCall?.setMicrophoneMuted(muted);
    this.updateCallSummary();
  }

  public async setCallVideoMuted(muted: boolean): Promise<void> {
    await this.activeCall?.setLocalVideoMuted(muted);
    this.updateCallSummary();
  }

  public async setScreensharing(enabled: boolean): Promise<void> {
    await this.activeCall?.setScreensharingEnabled(enabled);
    this.updateCallSummary();
  }

  public async updateRoomDetails(
    roomId: string,
    update: { name?: string; topic?: string },
  ): Promise<void> {
    if (!this.client) throw new Error('Matrix is not connected.');
    if (update.name !== undefined) await this.client.setRoomName(roomId, update.name.trim());
    if (update.topic !== undefined) await this.client.setRoomTopic(roomId, update.topic.trim());
    this.scheduleWorkspacePublish();
  }

  public async updateRoomAvatar(roomId: string, file: File): Promise<void> {
    if (!this.client || !this.sdk) throw new Error('Matrix is not connected.');
    if (!file.type.startsWith('image/') || file.size > this.config.media.maxUploadBytes) {
      throw new Error('Choose an image within the configured upload limit.');
    }
    const uploaded = await this.client.uploadContent(file, {
      name: file.name,
      type: file.type,
    });
    await this.client.sendStateEvent(
      roomId,
      this.sdk.EventType.RoomAvatar,
      { url: uploaded.content_uri, info: { mimetype: file.type, size: file.size } },
      '',
    );
    this.scheduleWorkspacePublish();
  }

  public async setRoomBackground(
    roomId: string,
    background: RoomBackground,
    personal: boolean,
  ): Promise<void> {
    const client = this.client;
    if (!client || !this.sdk) throw new Error('Matrix is not connected.');
    if (personal) {
      const accountClient = client as unknown as {
        getAccountData: (type: string) => MatrixEvent | undefined;
        setAccountData: (type: string, content: Record<string, unknown>) => Promise<unknown>;
      };
      const backgrounds = parseDirectBackgrounds(
        accountClient.getAccountData(DIRECT_BACKGROUNDS_EVENT)?.getContent(),
      );
      const serialized = serializeRoomBackground(background);
      if (serialized.preset === 'none' && !serialized.mxc_url) delete backgrounds[roomId];
      else backgrounds[roomId] = background;
      await accountClient.setAccountData(
        DIRECT_BACKGROUNDS_EVENT,
        serializeDirectBackgrounds(backgrounds),
      );
    } else {
      const room = client.getRoom(roomId);
      const userId = client.getSafeUserId();
      if (!room?.currentState.maySendStateEvent(ROOM_BACKGROUND_EVENT, userId)) {
        throw new Error('Your room role cannot change the shared background.');
      }
      const stateClient = client as unknown as {
        sendStateEvent: (roomId: string, type: string, content: Record<string, string | boolean>, stateKey: string) => Promise<unknown>;
      };
      await stateClient.sendStateEvent(
        roomId,
        ROOM_BACKGROUND_EVENT,
        serializeRoomBackground(background),
        '',
      );
    }
    this.scheduleWorkspacePublish();
  }

  public async setRoomBackgroundPolicy(
    roomId: string,
    permission: RoomBackgroundPermission,
  ): Promise<void> {
    const client = this.client;
    const sdk = this.sdk;
    if (!client || !sdk) throw new Error('Matrix is not connected.');
    const room = client.getRoom(roomId);
    const userId = client.getSafeUserId();
    if (!room?.currentState.maySendStateEvent(sdk.EventType.RoomPowerLevels, userId)) {
      throw new Error('Only a room administrator can change backdrop permissions.');
    }
    const powerEvent = room.currentState.getStateEvents(sdk.EventType.RoomPowerLevels, '');
    const content = powerEvent?.getContent<Record<string, unknown>>() ?? {};
    const events = content.events && typeof content.events === 'object' && !Array.isArray(content.events)
      ? content.events as Record<string, unknown>
      : {};
    await client.sendStateEvent(
      roomId,
      sdk.EventType.RoomPowerLevels,
      {
        ...content,
        events: {
          ...events,
          [ROOM_BACKGROUND_EVENT]: thresholdForBackgroundPermission(permission),
        },
      },
      '',
    );
    this.scheduleWorkspacePublish();
  }

  public async enableRoomEncryption(roomId: string): Promise<void> {
    if (!this.client || !this.sdk) throw new Error('Matrix is not connected.');
    const room = this.client.getRoom(roomId);
    if (!room) throw new Error('Room is not available.');
    if (room.hasEncryptionStateEvent()) return;
    await this.client.sendStateEvent(
      roomId,
      this.sdk.EventType.RoomEncryption,
      { algorithm: 'm.megolm.v1.aes-sha2' },
      '',
    );
    this.scheduleWorkspacePublish();
  }

  public async inviteToRoom(roomId: string, userId: string): Promise<void> {
    if (!this.client) throw new Error('Matrix is not connected.');
    await this.client.invite(roomId, userId.trim());
  }

  public async removeRoomMember(
    roomId: string,
    userId: string,
    action: 'kick' | 'ban' | 'unban',
  ): Promise<void> {
    if (!this.client) throw new Error('Matrix is not connected.');
    if (action === 'ban') await this.client.ban(roomId, userId, 'Banned by a room moderator');
    else if (action === 'unban') await this.client.unban(roomId, userId);
    else await this.client.kick(roomId, userId, 'Removed by a room moderator');
    this.scheduleWorkspacePublish();
  }

  public async searchPublicRooms(query: string): Promise<Array<{
    roomId: string;
    name: string;
    topic?: string;
    alias?: string;
    memberCount: number;
  }>> {
    if (!this.client) throw new Error('Matrix is not connected.');
    const response = await this.client.publicRooms({
      limit: 20,
      filter: { generic_search_term: query.trim() },
    });
    return response.chunk.map((room) => ({
      roomId: room.room_id,
      name: room.name || room.canonical_alias || room.room_id,
      topic: room.topic || undefined,
      alias: room.canonical_alias || undefined,
      memberCount: room.num_joined_members,
    }));
  }

  public async setRoomMemberPower(roomId: string, userId: string, level: number): Promise<void> {
    if (!this.client) throw new Error('Matrix is not connected.');
    await this.client.setPowerLevel(roomId, userId, level);
    this.scheduleWorkspacePublish();
  }

  public async joinRoom(roomIdOrAlias: string): Promise<void> {
    const client = this.client;
    if (!client) throw new Error('Matrix is not connected.');
    await client.joinRoom(roomIdOrAlias.trim());
    this.scheduleWorkspacePublish();
  }

  public async createDirectRoom(userId: string): Promise<string> {
    const client = this.client;
    const sdk = this.sdk;
    if (!client || !sdk) throw new Error('Matrix is not connected.');
    const invitee = userId.trim();
    if (!/^@[^:]+:.+$/.test(invitee)) throw new Error('Enter a full Matrix ID.');
    const response = await client.createRoom({
      is_direct: true,
      invite: [invitee],
      preset: sdk.Preset.TrustedPrivateChat,
      visibility: sdk.Visibility.Private,
      initial_state: [
        {
          type: sdk.EventType.RoomEncryption,
          state_key: '',
          content: { algorithm: 'm.megolm.v1.aes-sha2' },
        },
      ],
    });
    const accountClient = client as unknown as {
      getAccountData: (type: string) => MatrixEvent | undefined;
      setAccountData: (type: string, content: Record<string, string[]>) => Promise<unknown>;
    };
    const current = accountClient.getAccountData('m.direct')?.getContent<Record<string, string[]>>() ?? {};
    await accountClient.setAccountData('m.direct', {
      ...current,
      [invitee]: [...new Set([...(current[invitee] ?? []), response.room_id])],
    });
    this.scheduleWorkspacePublish();
    return response.room_id;
  }

  public async createRoom(options: {
    name: string;
    topic?: string;
    public: boolean;
    encrypted: boolean;
    space?: boolean;
  }): Promise<string> {
    const client = this.client;
    const sdk = this.sdk;
    if (!client || !sdk) throw new Error('Matrix is not connected.');
    const response = await client.createRoom({
      name: options.name.trim(),
      topic: options.topic?.trim() || undefined,
      visibility: options.public ? sdk.Visibility.Public : sdk.Visibility.Private,
      preset: options.public ? sdk.Preset.PublicChat : sdk.Preset.PrivateChat,
      creation_content: options.space ? { type: 'm.space' } : undefined,
      initial_state: options.encrypted && !options.space
        ? [
            {
              type: sdk.EventType.RoomEncryption,
              state_key: '',
              content: { algorithm: 'm.megolm.v1.aes-sha2' },
            },
          ]
        : undefined,
    });
    this.scheduleWorkspacePublish();
    return response.room_id;
  }

  public async rejectInvite(roomId: string): Promise<void> {
    const client = this.client;
    if (!client) throw new Error('Matrix is not connected.');
    await client.leave(roomId);
    this.scheduleWorkspacePublish();
  }

  public async leaveRoom(roomId: string): Promise<void> {
    await this.rejectInvite(roomId);
  }

  public async sendGif(
    roomId: string,
    gif: { title: string; mediaUrl: string },
  ): Promise<void> {
    const url = new URL(gif.mediaUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('The GIF provider returned an unsupported URL.');
    }
    const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('The GIF could not be downloaded from the provider.');
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > this.config.media.maxUploadBytes) {
      throw new Error('The GIF exceeds the configured upload limit.');
    }
    const blob = await response.blob();
    if (!blob.type.startsWith('image/') || blob.size > this.config.media.maxUploadBytes) {
      throw new Error('The GIF provider returned unsupported media.');
    }
    const extension = blob.type === 'image/webp' ? 'webp' : 'gif';
    const filename = `${gif.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 50) || 'aimtrix-gif'}.${extension}`;
    await this.uploadAttachment(roomId, new File([blob], filename, { type: blob.type }));
  }

  public cancelUpload(): void {
    this.uploadAbortController?.abort();
  }

  public async uploadAttachment(
    roomId: string,
    file: File,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    const client = this.client;
    const sdk = this.sdk;
    const room = client?.getRoom(roomId);
    if (!client || !sdk || !room) throw new Error('Room is not available.');
    if (!file.size || file.size > this.config.media.maxUploadBytes) {
      throw new Error('The attachment exceeds this Aimtrix upload limit.');
    }
    const msgtype = file.type.startsWith('image/')
      ? sdk.MsgType.Image
      : file.type.startsWith('video/')
        ? sdk.MsgType.Video
        : file.type.startsWith('audio/')
          ? sdk.MsgType.Audio
          : sdk.MsgType.File;
    const info = { mimetype: file.type || 'application/octet-stream', size: file.size };
    const abortController = new AbortController();
    this.uploadAbortController = abortController;
    const uploadOptions = {
      abortController,
      progressHandler: (progress: { loaded: number; total: number }) =>
        onProgress?.(progress.loaded, progress.total || file.size),
    };

    try {
      if (room.hasEncryptionStateEvent()) {
        const { encryptAttachment } = await import('matrix-encrypt-attachment');
        const encrypted = await encryptAttachment(await file.arrayBuffer());
        const uploaded = await client.uploadContent(new Blob([encrypted.data]), {
          ...uploadOptions,
          type: 'application/octet-stream',
          includeFilename: false,
        });
        await client.sendMessage(roomId, {
          msgtype,
          body: file.name,
          info,
          file: {
            ...encrypted.info,
            hashes: encrypted.info.hashes ?? {},
            url: uploaded.content_uri,
          },
        } as RoomMessageEventContent);
      } else {
        const uploaded = await client.uploadContent(file, {
          ...uploadOptions,
          name: file.name,
          type: file.type,
        });
        await client.sendMessage(roomId, {
          msgtype,
          body: file.name,
          info,
          url: uploaded.content_uri,
        } as RoomMessageEventContent);
      }
      this.scheduleWorkspacePublish();
    } finally {
      if (this.uploadAbortController === abortController) this.uploadAbortController = undefined;
    }
  }

  public async sendSticker(
    roomId: string,
    sticker: { id: string; name: string; src: string },
  ): Promise<void> {
    const client = this.client;
    const sdk = this.sdk;
    if (!client || !sdk) throw new Error('Matrix is not connected.');
    const room = client.getRoom(roomId);
    if (!room) throw new Error('Room is not available.');
    const encrypt = room.hasEncryptionStateEvent();
    const cacheKey = `${this.activeSession?.userId}|${roomId}|${encrypt ? 'encrypted' : 'plain'}|${sticker.id}|${sticker.src}`;
    let uploaded = this.stickerUploads.get(cacheKey);
    if (!uploaded) {
      uploaded = (async () => {
        const response = await fetch(sticker.src);
        if (!response.ok) throw new Error('Sticker asset could not be loaded.');
        const blob = await response.blob();
        const mimetype = blob.type || 'image/svg+xml';
        if (encrypt) {
          const { encryptAttachment } = await import('matrix-encrypt-attachment');
          const encrypted = await encryptAttachment(await blob.arrayBuffer());
          const result = await client.uploadContent(new Blob([encrypted.data]), {
            type: 'application/octet-stream',
            includeFilename: false,
          });
          return {
            mimetype,
            size: blob.size,
            file: {
              ...encrypted.info,
              hashes: encrypted.info.hashes ?? {},
              url: result.content_uri,
            },
          };
        }
        const result = await client.uploadContent(blob, {
          name: `${sticker.id}.svg`,
          type: mimetype,
          includeFilename: false,
        });
        return { mimetype, size: blob.size, url: result.content_uri };
      })();
      this.stickerUploads.set(cacheKey, uploaded);
    }
    try {
      const asset = await uploaded;
      const eventClient = client as unknown as {
        sendEvent: (roomId: string, type: string, content: Record<string, unknown>) => Promise<unknown>;
      };
      await eventClient.sendEvent(roomId, sdk.EventType.Sticker, {
        body: sticker.name,
        info: {
          mimetype: asset.mimetype,
          size: asset.size,
          w: 180,
          h: 180,
        },
        ...(asset.file ? { file: asset.file } : { url: asset.url }),
      });
      this.scheduleWorkspacePublish();
    } catch (error) {
      this.stickerUploads.delete(cacheKey);
      throw error;
    }
  }

  public async sendTyping(roomId: string, typing: boolean): Promise<void> {
    const client = this.client;
    if (!client) return;
    await client.sendTyping(roomId, typing, typing ? 30_000 : 0);
  }

  public async markRoomRead(roomId: string): Promise<void> {
    const client = this.client;
    const room = client?.getRoom(roomId);
    const timelineEvents = room?.getLiveTimeline().getEvents() ?? [];
    const inMainTimeline = this.sdk?.inMainTimelineForReceipt;
    let lastEvent: MatrixEvent | undefined;
    if (inMainTimeline) {
      for (let index = timelineEvents.length - 1; index >= 0; index -= 1) {
        const candidate = timelineEvents[index];
        if (inMainTimeline(candidate)) {
          lastEvent = candidate;
          break;
        }
      }
    } else {
      lastEvent = timelineEvents.at(-1);
    }
    const lastEventId = lastEvent?.getId() ?? null;
    if (!client || !room || !lastEvent || !lastEventId) return;
    const previousTotal = room.getRoomUnreadNotificationCount(
      'total' as NotificationCountType,
    );
    const previousHighlight = room.getRoomUnreadNotificationCount(
      'highlight' as NotificationCountType,
    );
    const currentReceiptId = room.getReadReceiptForUserId(client.getSafeUserId(), true)?.eventId;
    const alreadyRead =
      currentReceiptId === lastEventId || this.lastReadReceiptByRoom.get(roomId) === lastEventId;
    if (previousTotal > 0 || previousHighlight > 0) {
      room.setUnreadNotificationCount('total' as NotificationCountType, 0);
      room.setUnreadNotificationCount('highlight' as NotificationCountType, 0);
      this.bumpRoomVersion(roomId);
      this.scheduleWorkspacePublish();
    }
    if (alreadyRead) return;

    this.lastReadReceiptByRoom.set(roomId, lastEventId);
    try {
      await client.sendReadReceipt(lastEvent);
    } catch (error) {
      if (this.lastReadReceiptByRoom.get(roomId) === lastEventId) {
        this.lastReadReceiptByRoom.delete(roomId);
        const currentLastEventId = room.getLiveTimeline().getEvents().at(-1)?.getId();
        if (currentLastEventId === lastEventId) {
          room.setUnreadNotificationCount(
            'total' as NotificationCountType,
            previousTotal,
          );
          room.setUnreadNotificationCount(
            'highlight' as NotificationCountType,
            previousHighlight,
          );
          this.bumpRoomVersion(roomId);
          this.scheduleWorkspacePublish();
        }
      }
      throw error;
    }
  }

  public async sendReply(
    roomId: string,
    body: string,
    target: { id: string; senderId: string; body: string },
  ): Promise<void> {
    const client = this.client;
    const sdk = this.sdk;
    const message = body.trim();
    if (!client || !sdk || !message) return;
    const quoted = target.body.split('\n').map((line) => `> <${target.senderId}> ${line}`).join('\n');
    await client.sendEvent(roomId, sdk.EventType.RoomMessage, {
      msgtype: sdk.MsgType.Text,
      body: `${quoted}\n\n${message}`,
      'm.relates_to': { 'm.in_reply_to': { event_id: target.id } },
    });
    this.scheduleWorkspacePublish();
  }

  public async togglePinnedMessage(roomId: string, eventId: string, pinned: boolean): Promise<void> {
    const client = this.client;
    const sdk = this.sdk;
    if (!client || !sdk) throw new Error('Matrix is not connected.');
    const room = client.getRoom(roomId);
    if (!room) throw new Error('Room is not available.');
    const state = room.currentState.getStateEvents(sdk.EventType.RoomPinnedEvents, '');
    const existing = state?.getContent<{ pinned?: unknown }>().pinned;
    const current = Array.isArray(existing)
      ? existing.filter((candidate): candidate is string => typeof candidate === 'string')
      : [];
    const next = pinned
      ? [...new Set([...current, eventId])]
      : current.filter((candidate) => candidate !== eventId);
    await client.sendStateEvent(roomId, sdk.EventType.RoomPinnedEvents, { pinned: next }, '');
    this.scheduleWorkspacePublish();
  }

  public async redactMessage(roomId: string, eventId: string): Promise<void> {
    if (!this.client) throw new Error('Matrix is not connected.');
    await this.client.redactEvent(roomId, eventId, undefined, { reason: 'Removed in Aimtrix' });
    this.scheduleWorkspacePublish();
  }

  public async editMessage(roomId: string, eventId: string, body: string): Promise<void> {
    const client = this.client;
    const sdk = this.sdk;
    const message = body.trim();
    if (!client || !sdk || !message) return;
    await client.sendEvent(roomId, sdk.EventType.RoomMessage, {
      msgtype: sdk.MsgType.Text,
      body: `* ${message}`,
      'm.new_content': { msgtype: sdk.MsgType.Text, body: message },
      'm.relates_to': { rel_type: sdk.RelationType.Replace, event_id: eventId },
    });
    this.scheduleWorkspacePublish();
  }

  public async toggleReaction(
    roomId: string,
    eventId: string,
    key: string,
    ownReactionEventId?: string,
  ): Promise<void> {
    const client = this.client;
    const sdk = this.sdk;
    if (!client || !sdk) return;
    if (ownReactionEventId) {
      await client.redactEvent(roomId, ownReactionEventId);
    } else {
      await client.sendEvent(roomId, sdk.EventType.Reaction, {
        'm.relates_to': {
          rel_type: sdk.RelationType.Annotation,
          event_id: eventId,
          key,
        },
      });
    }
    this.scheduleWorkspacePublish();
  }

  public async setRoomMuted(roomId: string, muted: boolean): Promise<void> {
    const result = this.client?.setRoomMutePushRule('global', roomId, muted);
    await result;
  }

  public async sendMessage(roomId: string, body: string): Promise<void> {
    const message = body.trim();
    const client = this.client;
    if (!client || !message) return;
    const room = client.getRoom(roomId);
    if (!room) throw new Error('Room is not available.');
    if (room.hasEncryptionStateEvent() && !client.getCrypto()) {
      throw new Error('Encryption is not ready for this room.');
    }
    await client.sendTextMessage(roomId, message);
    if (this.notificationPreferences.notificationSounds) this.playSendTone();
    this.scheduleWorkspacePublish();
  }

  private async connect(session: StoredMatrixSession): Promise<void> {
    await this.stopCurrentClient();
    const names = databaseNames(session);
    const sdk = await loadMatrixSdk();
    const client = sdk.createClient({
      baseUrl: session.baseUrl,
      accessToken: session.accessToken,
      userId: session.userId,
      deviceId: session.deviceId,
      timelineSupport: true,
      cryptoCallbacks: {
        getSecretStorageKey: async ({ keys }) => {
          const recoveryKey = this.inMemoryRecoveryKey;
          const activeClient = this.client;
          if (!recoveryKey || !activeClient) return null;
          const defaultKeyId = await activeClient.secretStorage.getDefaultKeyId();
          const candidates = defaultKeyId && keys[defaultKeyId]
            ? [defaultKeyId]
            : Object.keys(keys);
          for (const keyId of candidates) {
            try {
              if (
                await activeClient.secretStorage.checkKey(
                  recoveryKey,
                  keys[keyId] as SecretStorageKeyDescriptionAesV1,
                )
              ) {
                return [keyId, recoveryKey];
              }
            } catch {
              // Try another active secret-storage key if the account has more than one.
            }
          }
          return null;
        },
        cacheSecretStorageKey: (_keyId, _keyInfo, key) => {
          this.inMemoryRecoveryKey = key;
        },
      },
    });

    this.client = client;
    this.sdk = sdk;
    this.activeSession = session;
    this.connection = 'connecting';
    this.attachClientListeners();

    try {
      await client.initRustCrypto({
        useIndexedDB: true,
        cryptoDatabasePrefix: names.crypto,
      });
      await client.startClient({
        initialSyncLimit: 30,
        lazyLoadMembers: true,
        pendingEventOrdering: sdk.PendingEventOrdering.Chronological,
      });
    } catch (error) {
      this.detachClientListeners();
      client.stopClient();
      this.client = undefined;
      this.activeSession = undefined;
      throw error;
    }
  }

  private async stopCurrentClient(): Promise<void> {
    if (!this.client) return;
    this.uploadAbortController?.abort();
    this.activeCall?.hangup('user_hangup' as CallErrorCode, false);
    this.activeCall = undefined;
    this.callSummary = undefined;
    const client = this.client;
    this.detachClientListeners();
    client.stopClient();
    this.client = undefined;
    this.activeSession = undefined;
    this.inMemoryRecoveryKey = undefined;
    this.personalizationLoaded = false;
    if (this.personalizationSaveTimer !== undefined) window.clearTimeout(this.personalizationSaveTimer);
    this.personalizationSaveTimer = undefined;
    this.spaceHierarchies.clear();
    this.spaceHierarchyRequests.clear();
    this.lastReadReceiptByRoom.clear();
    this.rootSpaceOrderOverride = undefined;
    this.signOnTonePlayed = false;
    this.liveEncryptedMessages.clear();
    this.snapshotCache.roomVersions.clear();
    this.snapshotCache.messages.clear();
    this.snapshotCache.members.clear();
    this.clearMediaCache();
  }

  private readonly handleIncomingCall = (call: MatrixCall): void => {
    if (!this.config.features.calls || this.activeCall) {
      call.reject();
      return;
    }
    this.activeCall = call;
    this.attachCall(call);
    this.updateCallSummary();
    if (
      this.notificationPreferences.desktopNotifications &&
      document.hidden &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      const notification = new Notification('Incoming Aimtrix call', {
        body: call.getOpponentMember()?.name || 'A Matrix contact is calling.',
        tag: `call-${call.callId}`,
      });
      notification.onclick = () => window.focus();
    }
    if (this.notificationPreferences.notificationSounds) this.playMessageTone();
  };

  private attachCall(call: MatrixCall): void {
    const callEvent = this.sdk?.CallEvent;
    if (!callEvent) return;
    call.on(callEvent.State, () => {
      if (call.state === 'ended') this.endCallState();
      else this.updateCallSummary();
    });
    call.on(callEvent.FeedsChanged, () => this.updateCallSummary());
    call.on(callEvent.Error, (error: CallError) => {
      this.updateCallSummary(error.message);
    });
    call.on(callEvent.Hangup, () => this.endCallState());
  }

  private updateCallSummary(error?: string): void {
    const call = this.activeCall;
    if (!call) return;
    this.callSummary = {
      roomId: call.roomId,
      state: call.state,
      incoming: call.direction === 'inbound',
      video: call.type === 'video',
      microphoneMuted: call.isMicrophoneMuted(),
      videoMuted: call.isLocalVideoMuted(),
      screensharing: call.isScreensharing(),
      localStream: call.localUsermediaStream,
      remoteStream: call.remoteUsermediaStream,
      error,
    };
    this.scheduleWorkspacePublish();
  }

  private endCallState(): void {
    this.activeCall = undefined;
    this.callSummary = undefined;
    this.scheduleWorkspacePublish();
  }

  private signOnTonePlayed = false;

  private readonly handleSync = (syncState: SyncState): void => {
    switch (syncState) {
      case 'PREPARED':
      case 'SYNCING':
        this.connection = 'online';
        if (!this.signOnTonePlayed) {
          this.signOnTonePlayed = true;
          if (this.notificationPreferences.notificationSounds) this.playSignOnTone();
        }
        this.scheduleWorkspacePublish();
        break;
      case 'CATCHUP':
      case 'RECONNECTING':
        this.connection = 'catching-up';
        this.scheduleWorkspacePublish();
        break;
      case 'ERROR':
      case 'STOPPED':
        this.connection = 'offline';
        this.scheduleWorkspacePublish();
        break;
    }
  };

  private readonly handleTimeline = (
    event: MatrixEvent,
    room: Room | undefined,
    toStartOfTimeline: boolean | undefined,
    _removed: boolean,
    data?: { liveEvent?: boolean },
  ): void => {
    this.bumpRoomVersion(room?.roomId ?? event.getRoomId());
    if (!toStartOfTimeline) this.scheduleWorkspacePublish();
    if (!data?.liveEvent || !room || event.getSender() === this.client?.getUserId()) return;
    if (event.getType() === 'm.room.encrypted') {
      const eventId = event.getId();
      if (eventId) {
        if (this.liveEncryptedMessages.size > 300) {
          const oldest = this.liveEncryptedMessages.values().next().value;
          if (oldest) this.liveEncryptedMessages.delete(oldest);
        }
        this.liveEncryptedMessages.add(eventId);
      }
      return;
    }
    this.notifyForMessage(event, room);
  };

  private readonly liveEncryptedMessages = new Set<string>();

  private notifyForMessage(event: MatrixEvent, room: Room): void {
    if (event.getType() !== 'm.room.message') return;
    const muted = this.client
      ?.getRoomPushRule('global', room.roomId)
      ?.actions.some((action) => action === 'dont_notify');
    if (muted) return;
    if (this.notificationPreferences.notificationSounds && this.connection === 'online') {
      this.playMessageTone();
    }
    if (
      this.notificationPreferences.desktopNotifications &&
      document.hidden &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      const content = event.getContent<{ body?: string }>();
      const body = typeof content.body === 'string' ? content.body : 'New Matrix message';
      const notification = new Notification(room.name || 'Aimtrix', {
        body: body.slice(0, 240),
        tag: room.roomId,
      });
      notification.onclick = () => window.focus();
    }
  }

  private audioContext?: AudioContext;

  private ensureAudioContext(): AudioContext | undefined {
    try {
      this.audioContext ??= new window.AudioContext();
      if (this.audioContext.state === 'suspended') void this.audioContext.resume();
      return this.audioContext;
    } catch {
      return undefined;
    }
  }

  private playTone(
    notes: Array<{ frequency: number; start: number; duration: number }>,
    volumeScale: number,
  ): void {
    const context = this.ensureAudioContext();
    if (!context) return;
    try {
      const now = context.currentTime;
      const peak = Math.max(0.0001, this.notificationPreferences.soundVolume * volumeScale);
      for (const note of notes) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = now + note.start;
        const end = start + note.duration;
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(note.frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(end + 0.02);
      }
    } catch {
      // Audio is optional and browsers may block it until a user gesture.
    }
  }

  private lastMessageToneAt = 0;

  private playMessageTone(): void {
    const now = Date.now();
    if (now - this.lastMessageToneAt < 600) return;
    this.lastMessageToneAt = now;
    this.playTone(
      [
        { frequency: 1174.66, start: 0, duration: 0.07 },
        { frequency: 987.77, start: 0.075, duration: 0.11 },
      ],
      0.16,
    );
  }

  private playSignOnTone(): void {
    const context = this.ensureAudioContext();
    if (!context) return;
    try {
      const now = context.currentTime;
      const gain = context.createGain();
      const first = context.createOscillator();
      const second = context.createOscillator();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.0001, this.notificationPreferences.soundVolume * 0.12),
        now + 0.01,
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
      first.frequency.value = 660;
      second.frequency.value = 880;
      first.connect(gain);
      second.connect(gain);
      gain.connect(context.destination);
      first.start(now);
      second.start(now + 0.06);
      first.stop(now + 0.16);
      second.stop(now + 0.24);
    } catch {
      // Audio is optional and browsers may block it until a user gesture.
    }
  }

  private playSendTone(): void {
    this.playTone(
      [
        { frequency: 987.77, start: 0, duration: 0.05 },
        { frequency: 1318.51, start: 0.05, duration: 0.08 },
      ],
      0.1,
    );
  }

  public previewMessageTone(): void {
    this.lastMessageToneAt = 0;
    this.playMessageTone();
  }

  private readonly handleDecrypted = (event: MatrixEvent): void => {
    const roomId = event.getRoomId();
    this.bumpRoomVersion(roomId);
    this.scheduleWorkspacePublish();
    const eventId = event.getId();
    if (eventId && roomId && this.liveEncryptedMessages.delete(eventId)) {
      const room = this.client?.getRoom(roomId);
      if (room) this.notifyForMessage(event, room);
    }
  };

  private readonly handleReceipt = (_event: MatrixEvent, room?: Room): void => {
    this.bumpRoomVersion(room?.roomId);
    this.scheduleWorkspacePublish();
  };

  private readonly handleLocalEcho = (event: MatrixEvent, room?: Room): void => {
    this.bumpRoomVersion(room?.roomId ?? event.getRoomId());
    this.scheduleWorkspacePublish();
  };

  private readonly handleRoomState = (event: MatrixEvent): void => {
    this.bumpRoomVersion(event.getRoomId());
    this.scheduleWorkspacePublish();
  };

  private readonly handleAccountData = (): void => {
    this.scheduleWorkspacePublish();
  };

  private attachClientListeners(): void {
    if (!this.client || !this.sdk) return;
    this.client.on(this.sdk.ClientEvent.Sync, this.handleSync);
    this.client.on(this.sdk.ClientEvent.AccountData, this.handleAccountData);
    this.client.on(this.sdk.RoomEvent.Timeline, this.handleTimeline);
    this.client.on(this.sdk.RoomEvent.Receipt, this.handleReceipt);
    this.client.on(this.sdk.RoomEvent.LocalEchoUpdated, this.handleLocalEcho);
    this.client.on(this.sdk.RoomStateEvent.Events, this.handleRoomState);
    this.client.on(this.sdk.RoomStateEvent.Members, this.handleRoomState);
    this.client.on(this.sdk.MatrixEventEvent.Decrypted, this.handleDecrypted);
    this.client.on('Call.incoming' as any, this.handleIncomingCall as any);
  }

  private detachClientListeners(): void {
    if (!this.client || !this.sdk) return;
    this.client.removeListener(this.sdk.ClientEvent.Sync, this.handleSync);
    this.client.removeListener(this.sdk.ClientEvent.AccountData, this.handleAccountData);
    this.client.removeListener(this.sdk.RoomEvent.Timeline, this.handleTimeline);
    this.client.removeListener(this.sdk.RoomEvent.Receipt, this.handleReceipt);
    this.client.removeListener(this.sdk.RoomEvent.LocalEchoUpdated, this.handleLocalEcho);
    this.client.removeListener(this.sdk.RoomStateEvent.Events, this.handleRoomState);
    this.client.removeListener(this.sdk.RoomStateEvent.Members, this.handleRoomState);
    this.client.removeListener(this.sdk.MatrixEventEvent.Decrypted, this.handleDecrypted);
    this.client.removeListener('Call.incoming' as any, this.handleIncomingCall as any);
    if (this.publishFrame !== undefined) cancelAnimationFrame(this.publishFrame);
    this.publishFrame = undefined;
  }

  private scheduleWorkspacePublish(): void {
    if (!this.client || this.publishFrame !== undefined) return;
    this.publishFrame = requestAnimationFrame(() => {
      this.publishFrame = undefined;
      if (!this.client) return;
      try {
        const workspace = buildWorkspaceSnapshot(
          this.client,
          this.connection,
          [...this.spaceHierarchies.values()].flat(),
          this.readRootSpaceOrder(),
          this.snapshotCache,
        );
        this.setSnapshot({
          status: 'ready',
          workspace: { ...workspace, call: this.callSummary },
        });
      } catch {
        this.setSnapshot({
          status: 'error',
          error: 'Aimtrix received Matrix room data that it could not render.',
          canRetry: true,
        });
      }
    });
  }
}
