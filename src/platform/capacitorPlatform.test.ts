import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appListeners: new Map<string, (value: any) => void>(),
  pushListeners: new Map<string, (value: any) => void>(),
  localListeners: new Map<string, (value: any) => void>(),
  storage: new Map<string, string>(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'android',
    isNativePlatform: () => true,
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (event: string, listener: (value: any) => void) => {
      mocks.appListeners.set(event, listener);
      return { remove: vi.fn() };
    }),
    getLaunchUrl: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: vi.fn(async (event: string, listener: (value: any) => void) => {
      mocks.pushListeners.set(event, listener);
      return { remove: vi.fn() };
    }),
    checkPermissions: vi.fn().mockResolvedValue({ receive: 'granted' }),
    requestPermissions: vi.fn().mockResolvedValue({ receive: 'granted' }),
    register: vi.fn().mockResolvedValue(undefined),
    unregister: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    addListener: vi.fn(async (event: string, listener: (value: any) => void) => {
      mocks.localListeners.set(event, listener);
      return { remove: vi.fn() };
    }),
    requestPermissions: vi.fn().mockResolvedValue({ display: 'granted' }),
    schedule: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@aparajita/capacitor-secure-storage', () => ({
  KeychainAccess: { whenUnlockedThisDeviceOnly: 'whenUnlockedThisDeviceOnly' },
  SecureStorage: {
    setKeyPrefix: vi.fn().mockResolvedValue(undefined),
    setDefaultKeychainAccess: vi.fn().mockResolvedValue(undefined),
    getItem: vi.fn(async (key: string) => mocks.storage.get(key)),
    setItem: vi.fn(async (key: string, value: string) => {
      mocks.storage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      mocks.storage.delete(key);
    }),
  },
}));

import { createCapacitorPlatform } from './capacitorPlatform';

describe('Capacitor platform', () => {
  beforeEach(() => {
    mocks.appListeners.clear();
    mocks.pushListeners.clear();
    mocks.localListeners.clear();
    mocks.storage.clear();
  });

  it('persists native credentials and SSO state in secure storage', async () => {
    const platform = createCapacitorPlatform();
    const session = {
      baseUrl: 'https://matrix.example.com',
      serverName: 'example.com',
      accessToken: 'token',
      userId: '@alex:example.com',
      deviceId: 'DEVICE',
    };

    await platform.credentials.save(session);
    await platform.sso.save({ baseUrl: session.baseUrl, serverName: session.serverName });

    expect(await platform.credentials.load()).toEqual(session);
    expect(await platform.sso.load()).toEqual({ baseUrl: session.baseUrl, serverName: session.serverName });
    expect(mocks.storage.size).toBe(2);
  });

  it('registers native push, persists the token, and reports later token rotation', async () => {
    const platform = createCapacitorPlatform();
    const refresh = vi.fn();
    platform.push.onTokenRefresh(refresh);
    const registration = platform.push.subscribe();
    mocks.pushListeners.get('registration')?.({ value: 'token-a' });

    expect(await registration).toMatchObject({ provider: 'native', pushKey: 'token-a' });
    expect(await platform.push.getSubscription()).toMatchObject({ pushKey: 'token-a' });

    mocks.pushListeners.get('registration')?.({ value: 'token-b' });
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledOnce();
    expect(await platform.push.getSubscription()).toMatchObject({ pushKey: 'token-b' });
  });

  it('routes native notification taps with opaque identifiers only', () => {
    const platform = createCapacitorPlatform();
    expect(platform.capabilities.platform).toBe('android');
    mocks.pushListeners.get('pushNotificationActionPerformed')?.({
      notification: { data: { room_id: '!room:example.com', event_id: '$event' } },
    });

    expect(window.location.search).toBe('?room=%21room%3Aexample.com&event=%24event');
  });
});
