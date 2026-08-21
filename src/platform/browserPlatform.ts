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
      new Notification(request.title, { body: request.body, tag: request.tag });
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
      serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
      mediaDevices: typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices),
      standalone: isStandalone(),
      secureCredentialStorage: false,
    },
    credentials: createBrowserCredentialStore(),
    notifications: createBrowserNotifications(),
    lifecycle: createBrowserLifecycle(),
    install: createBrowserInstall(),
    deepLinks: createBrowserDeepLinks(),
    media: createBrowserMedia(),
  };
}
