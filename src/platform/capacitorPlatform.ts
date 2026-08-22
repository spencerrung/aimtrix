import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import {
  parseStoredMatrixSession,
  SESSION_KEY,
  type StoredMatrixSession,
} from '../matrix/sessionStore';
import { parsePushRoute, pushRouteFromMessage, routeUrl, type PushRoute } from '../pwa/pushRouting';
import type {
  AimtrixPlatform,
  AppLifecycle,
  CredentialStore,
  DeepLinkService,
  DeviceMedia,
  InstallAndUpdate,
  NotificationRequest,
  NotificationService,
  PushService,
  SsoPendingState,
} from './platform';

const NATIVE_PUSH_KEY = 'aimtrix.native-push-token.v1';
const NATIVE_SSO_KEY = 'aimtrix.sso-pending.v1';

function permissionState(value: string): NotificationPermission {
  if (value === 'granted') return 'granted';
  if (value === 'denied') return 'denied';
  return 'default';
}

function routeFromNativeData(value: unknown): PushRoute | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Record<string, unknown>;
  return pushRouteFromMessage({
    roomId: data.room_id ?? data.roomId,
    eventId: data.event_id ?? data.eventId,
  });
}

function createNativeCredentials(): CredentialStore<StoredMatrixSession> {
  return {
    async load() {
      try {
        await prepareNativeSecureStorage();
        const serialized = await SecureStorage.getItem(SESSION_KEY);
        if (!serialized) return undefined;
        const session = parseStoredMatrixSession(JSON.parse(serialized));
        if (session) return session;
        await SecureStorage.removeItem(SESSION_KEY);
      } catch {
        await SecureStorage.removeItem(SESSION_KEY).catch(() => undefined);
      }
      return undefined;
    },
    async save(session) {
      await prepareNativeSecureStorage();
      await SecureStorage.setItem(SESSION_KEY, JSON.stringify(session));
    },
    async clear() {
      await prepareNativeSecureStorage();
      await SecureStorage.removeItem(SESSION_KEY);
    },
  };
}

async function prepareNativeSecureStorage(): Promise<void> {
  await SecureStorage.setKeyPrefix('aimtrix_');
  await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);
}

function createNativeSsoState(): CredentialStore<SsoPendingState> {
  return {
    async load() {
      try {
        await prepareNativeSecureStorage();
        const serialized = await SecureStorage.getItem(NATIVE_SSO_KEY);
        if (!serialized) return undefined;
        const value = JSON.parse(serialized) as Partial<SsoPendingState>;
        if (typeof value.baseUrl === 'string' && typeof value.serverName === 'string') return value as SsoPendingState;
        await SecureStorage.removeItem(NATIVE_SSO_KEY);
      } catch {
        await SecureStorage.removeItem(NATIVE_SSO_KEY).catch(() => undefined);
      }
      return undefined;
    },
    async save(value) {
      await prepareNativeSecureStorage();
      await SecureStorage.setItem(NATIVE_SSO_KEY, JSON.stringify(value));
    },
    async clear() {
      await prepareNativeSecureStorage();
      await SecureStorage.removeItem(NATIVE_SSO_KEY);
    },
  };
}

function createNativeNotifications(): NotificationService {
  let permission: NotificationPermission = 'default';
  const clickHandlers = new Map<number, () => void>();
  let nextNotificationId = 1;

  void PushNotifications.checkPermissions().then((result) => {
    permission = permissionState(result.receive);
  }).catch(() => undefined);
  void LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
    const handler = clickHandlers.get(notification.id);
    clickHandlers.delete(notification.id);
    handler?.();
  });

  return {
    supported: true,
    get permission() {
      return permission;
    },
    async requestPermission() {
      try {
        const push = await PushNotifications.requestPermissions();
        permission = permissionState(push.receive);
        if (permission === 'granted') {
          await LocalNotifications.requestPermissions();
        }
      } catch {
        permission = 'denied';
      }
      return permission;
    },
    show(request: NotificationRequest) {
      if (permission !== 'granted') return;
      const id = nextNotificationId++;
      if (request.onClick) clickHandlers.set(id, request.onClick);
      void LocalNotifications.schedule({
        notifications: [{
          id,
          title: request.title,
          body: request.body,
          silent: request.silent,
          extra: request.tag ? { tag: request.tag } : undefined,
        }],
      }).catch(() => clickHandlers.delete(id));
    },
  };
}

function createNativePush(onRoute: (route: PushRoute) => void): PushService {
  let token: string | undefined;
  let registrationError: string | undefined;
  let registrationPromise: Promise<string> | undefined;
  const tokenRefreshListeners = new Set<() => void>();
  let resolveRegistration: ((value: string) => void) | undefined;
  let rejectRegistration: ((reason: Error) => void) | undefined;

  void PushNotifications.addListener('registration', (result) => {
    const previousToken = token;
    token = result.value;
    registrationError = undefined;
    void prepareNativeSecureStorage()
      .then(() => SecureStorage.setItem(NATIVE_PUSH_KEY, result.value))
      .catch(() => undefined);
    resolveRegistration?.(result.value);
    resolveRegistration = undefined;
    rejectRegistration = undefined;
    if (previousToken !== undefined && previousToken !== result.value) {
      queueMicrotask(() => tokenRefreshListeners.forEach((listener) => listener()));
    }
  });
  void PushNotifications.addListener('registrationError', (result) => {
    registrationError = result.error;
    rejectRegistration?.(new Error(result.error));
    resolveRegistration = undefined;
    rejectRegistration = undefined;
  });
  void PushNotifications.addListener('pushNotificationActionPerformed', (result) => {
    const route = routeFromNativeData(result.notification.data);
    if (route) onRoute(route);
  });

  return {
    supported: true,
    provider: 'native',
    async getSubscription() {
      if (!token) {
        try {
          await prepareNativeSecureStorage();
          const stored = await SecureStorage.getItem(NATIVE_PUSH_KEY);
          if (stored) token = stored;
        } catch {
          return undefined;
        }
      }
      return token ? { endpoint: '', provider: 'native', pushKey: token, keys: {} } : undefined;
    },
    async subscribe() {
      const stored = await this.getSubscription();
      if (stored) return stored;
      if (!registrationPromise) {
        registrationError = undefined;
        let timeout: number | undefined;
        registrationPromise = new Promise<string>((resolve, reject) => {
          resolveRegistration = resolve;
          rejectRegistration = reject;
          void PushNotifications.register().catch(reject);
          timeout = window.setTimeout(() => reject(new Error('Native push registration timed out.')), 15000);
        }).finally(() => {
          if (timeout !== undefined) window.clearTimeout(timeout);
          registrationPromise = undefined;
          resolveRegistration = undefined;
          rejectRegistration = undefined;
        });
      }
      try {
        const pushKey = await registrationPromise;
        return { endpoint: '', provider: 'native', pushKey, keys: {} };
      } catch (error) {
        throw new Error(
          registrationError || (error instanceof Error ? error.message : 'Native push registration failed.'),
          { cause: error },
        );
      }
    },
    onTokenRefresh(listener) {
      tokenRefreshListeners.add(listener);
      return () => tokenRefreshListeners.delete(listener);
    },
    async unsubscribe() {
      await PushNotifications.unregister();
      token = undefined;
      await prepareNativeSecureStorage();
      await SecureStorage.removeItem(NATIVE_PUSH_KEY);
      return true;
    },
  };
}

function createNativeLifecycle(): AppLifecycle {
  let hidden = false;
  const listeners = new Set<() => void>();
  void App.addListener('appStateChange', ({ isActive }) => {
    hidden = !isActive;
    listeners.forEach((listener) => listener());
  });

  return {
    isHidden: () => hidden,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeShutdown: () => () => undefined,
  };
}

function createNativeDeepLinks(onRoute: (route: PushRoute) => void): DeepLinkService {
  const applySsoCallback = (url: URL): boolean => {
    const loginToken = url.searchParams.get('loginToken');
    if (!loginToken) return false;
    window.history.replaceState({}, '', `/?loginToken=${encodeURIComponent(loginToken)}`);
    window.location.reload();
    return true;
  };
  const applyRoute = (route: PushRoute) => {
    const path = routeUrl(route);
    if (`${window.location.pathname}${window.location.search}` === path) return;
    window.history.replaceState({}, '', path);
    window.dispatchEvent(new CustomEvent('aimtrix-push-route', { detail: route }));
    onRoute(route);
  };

  void App.addListener('appUrlOpen', ({ url }) => {
    try {
      const parsed = new URL(url);
      if (applySsoCallback(parsed)) return;
      const route = parsePushRoute(parsed);
      if (route) applyRoute(route);
    } catch {
      return;
    }
  });

  return {
    async prepare() {
      const launch = await App.getLaunchUrl();
      if (!launch) return;
      const parsed = new URL(launch.url);
      if (applySsoCallback(parsed)) return;
      try {
        const route = parsePushRoute(parsed);
        if (route) window.history.replaceState({}, '', routeUrl(route));
      } catch {
        return;
      }
    },
    ssoRedirectUrl: () => 'aimtrix://sso',
    currentUrl: () => new URL(window.location.href),
    replacePath: (path) => window.history.replaceState({}, '', path),
    openRoute: applyRoute,
    navigate: (url) => window.location.assign(url),
    focus: () => window.focus(),
  };
}

function createNativeMedia(): DeviceMedia {
  return {
    enumerateDevices: () => navigator.mediaDevices.enumerateDevices(),
    requestUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  };
}

function createNativeInstall(): InstallAndUpdate {
  return { displayMode: () => 'standalone' };
}

export function createCapacitorPlatform(): AimtrixPlatform {
  const deepLinks = createNativeDeepLinks(() => undefined);

  return {
    capabilities: {
      platform: Capacitor.getPlatform() === 'ios' ? 'ios' : 'android',
      notifications: true,
      push: true,
      serviceWorker: false,
      mediaDevices: typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices),
      standalone: true,
      secureCredentialStorage: true,
    },
    credentials: createNativeCredentials(),
    sso: createNativeSsoState(),
    notifications: createNativeNotifications(),
    push: createNativePush((route) => {
      deepLinks.openRoute(route);
    }),
    lifecycle: createNativeLifecycle(),
    install: createNativeInstall(),
    deepLinks,
    media: createNativeMedia(),
  };
}
