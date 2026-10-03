import type { NotificationContext } from '../pwa/notificationPolicy';
import type { StoredMatrixSession } from '../matrix/sessionStore';
import type { PushRoute } from '../pwa/pushRouting';

interface SsoTarget {
  baseUrl: string;
  serverName: string;
}

export type SsoPendingState = (SsoTarget & { kind?: 'legacy' }) | (SsoTarget & {
  kind: 'oauth';
  clientId: string;
  codeVerifier: string;
  deviceId: string;
  issuer: string;
  redirectUri: string;
  state: string;
});

export function parseSsoPendingState(value: unknown): SsoPendingState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  const validUrl = (input: unknown, native = false): input is string => {
    if (typeof input !== 'string' || input.length > 2048) return false;
    try {
      const url = new URL(input);
      if (url.username || url.password || url.hash || url.search) return false;
      if (native && url.href === 'aimtrix://sso') return true;
      return url.protocol === 'https:' || url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    } catch { return false; }
  };
  if (!validUrl(candidate.baseUrl) || typeof candidate.serverName !== 'string' ||
    !candidate.serverName || candidate.serverName.length > 255) return undefined;
  if (candidate.kind === undefined || candidate.kind === 'legacy') {
    return { baseUrl: candidate.baseUrl, serverName: candidate.serverName };
  }
  if (candidate.kind !== 'oauth') return undefined;
  for (const key of ['clientId', 'codeVerifier', 'deviceId', 'issuer', 'redirectUri', 'state']) {
    if (typeof candidate[key] !== 'string' || !candidate[key] || candidate[key].length > 1024) return undefined;
  }
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(candidate.codeVerifier as string) ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(candidate.state as string)) return undefined;
  if (!validUrl(candidate.issuer) || !validUrl(candidate.redirectUri, true)) return undefined;
  return {
    kind: 'oauth', baseUrl: candidate.baseUrl, serverName: candidate.serverName,
    clientId: candidate.clientId as string, codeVerifier: candidate.codeVerifier as string,
    deviceId: candidate.deviceId as string, issuer: candidate.issuer as string,
    redirectUri: candidate.redirectUri as string, state: candidate.state as string,
  };
}

export function nativeSsoCallbackPath(url: URL): string | undefined {
  if (url.protocol !== 'aimtrix:' || url.hostname !== 'sso' || url.pathname && url.pathname !== '/') return undefined;
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  const keys = ['loginToken', 'code', 'error', 'state'];
  const hasAuth = (params: URLSearchParams) => keys.some((key) => params.has(key));
  if (hasAuth(url.searchParams) && hasAuth(fragment)) return undefined;
  const params = hasAuth(fragment) ? fragment : url.searchParams;
  const loginToken = params.get('loginToken');
  const code = params.get('code');
  const error = params.get('error');
  const state = params.get('state');
  if (loginToken && !code && !error && !state && loginToken.length <= 4096) {
    return `/?loginToken=${encodeURIComponent(loginToken)}`;
  }
  if (!state || !/^[A-Za-z0-9_-]{16,128}$/.test(state) || Boolean(code) === Boolean(error)) return undefined;
  if (code && code.length <= 4096) return `/?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
  if (error && /^[A-Za-z0-9_]{1,80}$/.test(error)) return `/?error=${encodeURIComponent(error)}&state=${encodeURIComponent(state)}`;
  return undefined;
}

export interface CredentialStore<T> {
  load(): Promise<T | undefined>;
  save(value: T): Promise<void>;
  clear(): Promise<void>;
}

export interface PlatformCapabilities {
  platform?: 'browser' | 'desktop' | 'ios' | 'android';
  notifications: boolean;
  push: boolean;
  serviceWorker: boolean;
  mediaDevices: boolean;
  standalone: boolean;
  secureCredentialStorage: boolean;
}

export interface NotificationRequest {
  title: string;
  body: string;
  tag?: string;
  eventId?: string;
  silent?: boolean;
  onClick?: () => void;
}

export interface NotificationService {
  readonly supported: boolean;
  readonly permission: NotificationPermission | 'unsupported';
  requestPermission(): Promise<NotificationPermission | 'unsupported'>;
  show(request: NotificationRequest): void;
  setContext?(context: NotificationContext): void | Promise<void>;
  clearContext?(owner: string): void | Promise<void>;
}

export interface PushSubscriptionData {
  endpoint: string;
  provider?: 'web' | 'native';
  pushKey?: string;
  expirationTime?: number | null;
  keys: {
    auth?: string;
    p256dh?: string;
  };
}

export interface PushService {
  readonly supported: boolean;
  readonly provider?: 'web' | 'native';
  getSubscription(): Promise<PushSubscriptionData | undefined>;
  subscribe(applicationServerKey?: string): Promise<PushSubscriptionData>;
  onTokenRefresh(listener: () => void): () => void;
  unsubscribe(): Promise<boolean>;
}

export interface AppLifecycle {
  isHidden(): boolean;
  subscribe(listener: () => void): () => void;
  subscribeShutdown(listener: () => void): () => void;
}

export type UpdateCheckResult =
  | { status: 'available'; version: string; date?: string; notes?: string; install(): Promise<void> }
  | { status: 'current' }
  | { status: 'unsupported' }
  | { status: 'unavailable' };

export interface InstallAndUpdate {
  displayMode(): 'browser' | 'standalone';
  checkForUpdate(): Promise<UpdateCheckResult>;
}

export interface DeepLinkService {
  prepare(): Promise<void>;
  ssoRedirectUrl(): string;
  currentUrl(): URL;
  replacePath(path: string): void;
  openRoute(route: PushRoute): void;
  navigate(url: string): void | Promise<void>;
  focus(): void;
}

export interface DeviceMedia {
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
  requestUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
}

export interface AimtrixPlatform {
  capabilities: PlatformCapabilities;
  credentials: CredentialStore<StoredMatrixSession>;
  sso: CredentialStore<SsoPendingState>;
  notifications: NotificationService;
  push: PushService;
  lifecycle: AppLifecycle;
  install: InstallAndUpdate;
  deepLinks: DeepLinkService;
  media: DeviceMedia;
}
