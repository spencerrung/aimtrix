import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appListeners: new Map<string, (value: any) => void>(),
  pushListeners: new Map<string, (value: any) => void>(),
  localListeners: new Map<string, (value: any) => void>(),
  storage: new Map<string, string>(),
  getLaunchUrl: vi.fn(async () => undefined as { url: string } | undefined),
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
    getLaunchUrl: mocks.getLaunchUrl,
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
    mocks.getLaunchUrl.mockReset().mockResolvedValue(undefined);
    window.history.replaceState({}, '', '/');
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


describe('Capacitor Matrix destinations', () => {
  it('preserves aliases, event IDs and via on cold start', async () => {
    const platform = createCapacitorPlatform();
    mocks.getLaunchUrl.mockResolvedValue({ url: 'https://matrix.to/#/%23lounge:test/$event?via=test&via=other.test' });
    await platform.deepLinks.prepare();
    expect(window.location.search).toBe('?alias=%23lounge%3Atest&event=%24event&via=test&via=other.test');
  });

  it('routes standard user links without treating their query as an SSO callback', () => {
    const state = { __aimtrixShell: { session: 'synthetic', entry: 2 } };
    window.history.replaceState(state, '', '/client/?demo=1&room=!old:test');
    createCapacitorPlatform();
    mocks.appListeners.get('appUrlOpen')?.({ url: 'matrix:u/alice:test?loginToken=synthetic-ignored-value' });
    expect(window.location.pathname).toBe('/client/');
    expect(window.location.search).toBe('?demo=1&user=%40alice%3Atest');
    expect(window.history.state).toEqual(state);
  });

  it.each(['broken', '', null])('rejects malformed explicit native event %j without opening the room', (event_id) => {
    createCapacitorPlatform();
    window.history.replaceState({}, '', '/?room=%21original%3Atest');
    mocks.pushListeners.get('pushNotificationActionPerformed')?.({ notification: { data: { room_id: '!other:test', event_id } } });
    expect(window.location.search).toBe('?room=%21original%3Atest');
  });

  it('dispatches another explicit open even when shell navigation left the previous URL in place', () => {
    createCapacitorPlatform();
    const listener = vi.fn();
    window.addEventListener('aimtrix-push-route', listener);
    try {
      const receive = mocks.appListeners.get('appUrlOpen')!;
      receive({ url: 'matrix:u/alice:test' });
      receive({ url: 'matrix:u/alice:test' });
      expect(listener).toHaveBeenCalledTimes(2);
      expect((listener.mock.calls[1][0] as CustomEvent).detail).toMatchObject({ userId: '@alice:test' });
    } finally { window.removeEventListener('aimtrix-push-route', listener); }
  });

  it('ignores malformed launch URLs without preventing startup', async () => {
    const platform = createCapacitorPlatform();
    mocks.getLaunchUrl.mockResolvedValue({ url: 'not a URL' });
    await expect(platform.deepLinks.prepare()).resolves.toBeUndefined();
  });
});
