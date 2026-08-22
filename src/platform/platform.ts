import type { StoredMatrixSession } from '../matrix/sessionStore';
import type { PushRoute } from '../pwa/pushRouting';

export interface SsoPendingState {
  baseUrl: string;
  serverName: string;
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
  silent?: boolean;
  onClick?: () => void;
}

export interface NotificationService {
  readonly supported: boolean;
  readonly permission: NotificationPermission | 'unsupported';
  requestPermission(): Promise<NotificationPermission | 'unsupported'>;
  show(request: NotificationRequest): void;
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

export interface InstallAndUpdate {
  displayMode(): 'browser' | 'standalone';
}

export interface DeepLinkService {
  prepare(): Promise<void>;
  ssoRedirectUrl(): string;
  currentUrl(): URL;
  replacePath(path: string): void;
  openRoute(route: PushRoute): void;
  navigate(url: string): void;
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
