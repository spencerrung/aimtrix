import type { StoredMatrixSession } from '../matrix/sessionStore';

export interface CredentialStore<T> {
  load(): Promise<T | undefined>;
  save(value: T): Promise<void>;
  clear(): Promise<void>;
}

export interface PlatformCapabilities {
  notifications: boolean;
  serviceWorker: boolean;
  mediaDevices: boolean;
  standalone: boolean;
  secureCredentialStorage: boolean;
}

export interface NotificationRequest {
  title: string;
  body: string;
  tag?: string;
}

export interface NotificationService {
  readonly supported: boolean;
  readonly permission: NotificationPermission | 'unsupported';
  requestPermission(): Promise<NotificationPermission | 'unsupported'>;
  show(request: NotificationRequest): void;
}

export interface AppLifecycle {
  isHidden(): boolean;
  subscribe(listener: () => void): () => void;
}

export interface InstallAndUpdate {
  displayMode(): 'browser' | 'standalone';
}

export interface DeepLinkService {
  currentUrl(): URL;
  replacePath(path: string): void;
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
  notifications: NotificationService;
  lifecycle: AppLifecycle;
  install: InstallAndUpdate;
  deepLinks: DeepLinkService;
  media: DeviceMedia;
}
