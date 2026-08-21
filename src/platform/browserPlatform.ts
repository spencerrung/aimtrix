import {
  createBrowserCredentialStore,
} from '../matrix/sessionStore';
import type {
  AimtrixPlatform,
  AppLifecycle,
  DeepLinkService,
  DeviceMedia,
  InstallAndUpdate,
  NotificationRequest,
  NotificationService,
  PushService,
  PushSubscriptionData,
} from './platform';

function isStandalone(): boolean {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
}

function createBrowserNotifications(): NotificationService {
  const supported = typeof window !== 'undefined' && 'Notification' in window;

  return {
    supported,
    get permission() {
      return supported ? Notification.permission : 'unsupported';
    },
    async requestPermission() {
      if (!supported) return 'unsupported';
      return Notification.requestPermission();
    },
    show(request: NotificationRequest) {
      if (!supported || Notification.permission !== 'granted') return;
      const notification = new Notification(request.title, { body: request.body, tag: request.tag });
      if (request.onClick) notification.onclick = request.onClick;
    },
  };
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function serializePushSubscription(subscription: PushSubscription): PushSubscriptionData {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: {
      auth: json.keys?.auth,
      p256dh: json.keys?.p256dh,
    },
  };
}

function createBrowserPush(): PushService {
  const supported = typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window;

  return {
    supported,
    async getSubscription() {
      if (!supported) return undefined;
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      return subscription ? serializePushSubscription(subscription) : undefined;
    },
    async subscribe(applicationServerKey) {
      if (!supported) throw new Error('Background push is not supported by this browser.');
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeBase64Url(applicationServerKey),
      });
      return serializePushSubscription(subscription);
    },
    async unsubscribe() {
      if (!supported) return false;
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      return subscription ? subscription.unsubscribe() : false;
    },
  };
}

function createBrowserLifecycle(): AppLifecycle {
  return {
    isHidden: () => typeof document !== 'undefined' && document.hidden,
    subscribe(listener) {
      if (typeof document === 'undefined') return () => undefined;
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
  };
}

function createBrowserInstall(): InstallAndUpdate {
  return {
    displayMode: () => isStandalone() ? 'standalone' : 'browser',
  };
}

function createBrowserDeepLinks(): DeepLinkService {
  return {
    currentUrl: () => new URL(window.location.href),
    replacePath: (path) => window.history.replaceState({}, '', path),
    navigate: (url) => window.location.assign(url),
    focus: () => window.focus(),
  };
}

function createBrowserMedia(): DeviceMedia {
  return {
    enumerateDevices: () => navigator.mediaDevices.enumerateDevices(),
    requestUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  };
}

export function createBrowserPlatform(): AimtrixPlatform {
  return {
    capabilities: {
      notifications: typeof window !== 'undefined' && 'Notification' in window,
      push: typeof window !== 'undefined' && 'PushManager' in window,
      serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
      mediaDevices: typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices),
      standalone: isStandalone(),
      secureCredentialStorage: false,
    },
    credentials: createBrowserCredentialStore(),
    notifications: createBrowserNotifications(),
    push: createBrowserPush(),
    lifecycle: createBrowserLifecycle(),
    install: createBrowserInstall(),
    deepLinks: createBrowserDeepLinks(),
    media: createBrowserMedia(),
  };
}
