import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import {
  isPermissionGranted,
  onAction,
  registerActionTypes,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import {
  parseStoredMatrixSession,
  SESSION_KEY,
  type StoredMatrixSession,
} from '../matrix/sessionStore';
import { parsePushRoute, routeUrl, type PushRoute } from '../pwa/pushRouting';
import type {
  AimtrixPlatform,
  AppLifecycle,
  CredentialStore,
  DeepLinkService,
  DeviceMedia,
  NotificationRequest,
  NotificationService,
  PushService,
  SsoPendingState,
} from './platform';

const SSO_KEY = 'aimtrix.sso-pending.v1';
const PUSH_KEY = 'aimtrix.native-push-token.v1';
const ALLOWED_SECRET_KEYS = new Set([SESSION_KEY, SSO_KEY, PUSH_KEY]);

function secretStore(key: string): CredentialStore<string> {
  return {
    async load() {
      if (!ALLOWED_SECRET_KEYS.has(key)) return undefined;
      const value = await invoke<string | null>('secure_credential_load', { key });
      return value ?? undefined;
    },
    async save(value) {
      if (!ALLOWED_SECRET_KEYS.has(key)) throw new Error('Unsupported secure storage key.');
      await invoke('secure_credential_save', { key, value });
    },
    async clear() {
      if (!ALLOWED_SECRET_KEYS.has(key)) return;
      await invoke('secure_credential_clear', { key });
    },
  };
}

function createTauriCredentials(): CredentialStore<StoredMatrixSession> {
  const store = secretStore(SESSION_KEY);
  return {
    async load() {
      try {
        const serialized = await store.load();
        if (!serialized) return undefined;
        const session = parseStoredMatrixSession(JSON.parse(serialized));
        if (session) return session;
        await store.clear();
      } catch {
        await store.clear().catch(() => undefined);
      }
      return undefined;
    },
    save: async (session) => store.save(JSON.stringify(session)),
    clear: () => store.clear(),
  };
}

function createTauriSsoState(): CredentialStore<SsoPendingState> {
  const store = secretStore(SSO_KEY);
  return {
    async load() {
      try {
        const serialized = await store.load();
        if (!serialized) return undefined;
        const value = JSON.parse(serialized) as Partial<SsoPendingState>;
        if (typeof value.baseUrl === 'string' && typeof value.serverName === 'string') {
          return value as SsoPendingState;
        }
        await store.clear();
      } catch {
        await store.clear().catch(() => undefined);
      }
      return undefined;
    },
    save: async (value) => store.save(JSON.stringify(value)),
    clear: () => store.clear(),
  };
}

function createTauriNotifications(): NotificationService {
  let permission: NotificationPermission = 'default';
  const clickHandlers = new Map<string, () => void>();
  let nextActionId = 0;

  void isPermissionGranted().then((granted) => {
    permission = granted ? 'granted' : 'default';
  }).catch(() => undefined);
  void onAction((notification) => {
    const actionTypeId = (notification as { actionTypeId?: unknown }).actionTypeId;
    if (typeof actionTypeId !== 'string') return;
    const handler = clickHandlers.get(actionTypeId);
    clickHandlers.delete(actionTypeId);
    handler?.();
  }).catch(() => undefined);

  return {
    supported: true,
    get permission() {
      return permission;
    },
    async requestPermission() {
      try {
        permission = (await requestPermission()) === 'granted' ? 'granted' : 'denied';
      } catch {
        permission = 'denied';
      }
      return permission;
    },
    show(request: NotificationRequest) {
      if (permission !== 'granted') return;
      const actionTypeId = `aimtrix-open-${nextActionId++}`;
      if (request.onClick) clickHandlers.set(actionTypeId, request.onClick);
      void registerActionTypes([{
        id: actionTypeId,
        actions: [{ id: 'open', title: 'Open Aimtrix', foreground: true }],
      }]).then(() => sendNotification({
        title: request.title,
        body: request.body,
        actionTypeId,
      })).catch(() => clickHandlers.delete(actionTypeId));
      if (clickHandlers.size > 100) {
        const oldest = clickHandlers.keys().next().value;
        if (oldest) clickHandlers.delete(oldest);
      }
    },
  };
}

function createTauriPush(): PushService {
  return {
    supported: false,
    provider: 'native',
    getSubscription: async () => undefined,
    subscribe: async () => {
      throw new Error('Desktop background push is not configured yet.');
    },
    onTokenRefresh: () => () => undefined,
    unsubscribe: async () => false,
  };
}

function createTauriLifecycle(): AppLifecycle {
  const appWindow = getCurrentWindow();
  let hidden = true;
  const listeners = new Set<() => void>();
  const shutdownListeners = new Set<() => void>();
  void appWindow.isFocused().then((focused) => {
    hidden = !focused;
    listeners.forEach((listener) => listener());
  }).catch(() => undefined);
  void listen('tauri://focus', () => {
    hidden = false;
    listeners.forEach((listener) => listener());
  });
  void listen('tauri://blur', () => {
    hidden = true;
    listeners.forEach((listener) => listener());
  });
  void listen('tauri://close-requested', () => shutdownListeners.forEach((listener) => listener()));

  return {
    isHidden: () => hidden,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeShutdown(listener) {
      shutdownListeners.add(listener);
      return () => shutdownListeners.delete(listener);
    },
  };
}

function createTauriDeepLinks(): DeepLinkService {
  let prepared = false;
  const applySsoCallback = (url: URL): boolean => {
    const loginToken = url.searchParams.get('loginToken');
    if (!loginToken) return false;
    window.history.replaceState({}, '', `/?loginToken=${encodeURIComponent(loginToken)}`);
    window.location.reload();
    return true;
  };
  const applyRoute = (route: PushRoute) => {
    window.history.replaceState({}, '', routeUrl(route));
    window.dispatchEvent(new CustomEvent('aimtrix-push-route', { detail: route }));
  };
  const applyUrl = (value: string) => {
    try {
      const url = new URL(value);
      if (applySsoCallback(url)) return;
      const route = parsePushRoute(url);
      if (route) applyRoute(route);
    } catch {
      return;
    }
  };

  return {
    async prepare() {
      if (prepared) return;
      prepared = true;
      const startUrls = await getCurrent();
      startUrls?.forEach(applyUrl);
      await onOpenUrl((urls) => urls.forEach(applyUrl));
    },
    ssoRedirectUrl: () => 'aimtrix://sso',
    currentUrl: () => new URL(window.location.href),
    replacePath: (path) => window.history.replaceState({}, '', path),
    openRoute: applyRoute,
    navigate: (url) => window.location.assign(url),
    focus: () => void getCurrentWindow().show().then(() => getCurrentWindow().setFocus()),
  };
}

function createTauriMedia(): DeviceMedia {
  return {
    enumerateDevices: () => navigator.mediaDevices.enumerateDevices(),
    requestUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  };
}

export function createTauriPlatform(): AimtrixPlatform {
  return {
    capabilities: {
      platform: 'desktop',
      notifications: true,
      push: false,
      serviceWorker: false,
      mediaDevices: typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices),
      standalone: true,
      secureCredentialStorage: true,
    },
    credentials: createTauriCredentials(),
    sso: createTauriSsoState(),
    notifications: createTauriNotifications(),
    push: createTauriPush(),
    lifecycle: createTauriLifecycle(),
    install: { displayMode: () => 'standalone' },
    deepLinks: createTauriDeepLinks(),
    media: createTauriMedia(),
  };
}
