import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserPlatform } from './browserPlatform';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('browser platform', () => {
  it('treats unavailable browser capabilities as unsupported', () => {
    const platform = createBrowserPlatform();

    expect(platform.install.displayMode()).toBe('browser');
    expect(platform.capabilities.standalone).toBe(false);
    expect(platform.capabilities.secureCredentialStorage).toBe(false);
    expect(platform.push.provider).toBe('web');
    expect(platform.deepLinks.ssoRedirectUrl()).toContain(window.location.pathname);
  });

  it('constructs without browser storage access so credential errors can reach recovery UI', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('Synthetic denial', 'SecurityError'); });
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => { throw new DOMException('Synthetic denial', 'SecurityError'); });
    const platform = createBrowserPlatform();
    await expect(platform.credentials.load()).rejects.toMatchObject({ name: 'SecurityError' });
    await expect(platform.sso.load()).rejects.toMatchObject({ name: 'SecurityError' });
  });

  it('passes explicit silence to the operating-system notification', async () => {
    const notices: NotificationOptions[] = [];
    vi.stubGlobal('Notification', class { static permission = 'granted'; constructor(_title: string, options: NotificationOptions) { notices.push(options); } });
    const platform = createBrowserPlatform();
    await expect(Promise.resolve(platform.notifications.setContext?.({ owner: 'synthetic-owner-001', policy: { pauseUntil: 0, quietHours: { enabled: false, startMinute: 0, endMinute: 0 } } }))).rejects.toThrow('Notification metadata storage unavailable');
    platform.notifications.show({ title: 'Synthetic notification', body: 'Synthetic activity', silent: true });
    await vi.waitFor(() => expect(notices).toHaveLength(1));
    expect(notices).toEqual([{ body: 'Synthetic activity', tag: undefined, silent: true }]);
  });

  it('deduplicates accepted events and rejects clicks after the account changes', async () => {
    const notices: { onclick?: () => void }[] = [];
    vi.stubGlobal('Notification', class { static permission = 'granted'; constructor() { notices.push(this); } });
    const platform = createBrowserPlatform(); const clicked = vi.fn();
    const policy = { pauseUntil: 0, quietHours: { enabled: false, startMinute: 0, endMinute: 0 } };
    await expect(Promise.resolve(platform.notifications.setContext?.({ owner: 'synthetic-owner-001', policy }))).rejects.toThrow('Notification metadata storage unavailable');
    platform.notifications.show({ title: 'Synthetic', body: 'Activity', eventId: '$event', onClick: clicked });
    platform.notifications.show({ title: 'Synthetic', body: 'Activity', eventId: '$event', onClick: clicked });
    await vi.waitFor(() => expect(notices).toHaveLength(1));
    await expect(Promise.resolve(platform.notifications.setContext?.({ owner: 'synthetic-owner-002', policy }))).rejects.toThrow('Notification metadata storage unavailable');
    notices[0].onclick?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(clicked).not.toHaveBeenCalled();
    await platform.notifications.clearContext?.('synthetic-owner-001');
    platform.notifications.show({ title: 'Synthetic', body: 'New account', eventId: '$event' });
    await vi.waitFor(() => expect(notices).toHaveLength(2));
    await expect(Promise.resolve(platform.notifications.clearContext?.('synthetic-owner-002'))).rejects.toThrow('Notification metadata storage unavailable');
    platform.notifications.show({ title: 'Synthetic', body: 'Logged out', eventId: '$other' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notices).toHaveLength(2);
  });

  it('keeps SSO state in the browser session until the callback completes', async () => {
    const platform = createBrowserPlatform();
    const pending = { baseUrl: 'https://matrix.example.com', serverName: 'example.com' };

    await platform.sso.save(pending);
    expect(await platform.sso.load()).toEqual(pending);
    await platform.sso.clear();
    expect(await platform.sso.load()).toBeUndefined();
  });

  it('finishes push reads and local sign-out when no service worker is registered', async () => {
    const ready = vi.fn(() => { throw new Error('Reading ready would wait for a registration that does not exist'); });
    const serviceWorker = { getRegistration: vi.fn().mockResolvedValue(undefined), get ready() { return ready(); } };
    vi.stubGlobal('navigator', { serviceWorker });
    vi.stubGlobal('PushManager', class {});
    const platform = createBrowserPlatform();
    expect(platform.push.supported).toBe(true);
    await expect(platform.push.getSubscription()).resolves.toBeUndefined();
    await expect(platform.push.unsubscribe()).resolves.toBe(false);
    expect(serviceWorker.getRegistration).toHaveBeenCalledTimes(2);
    expect(ready).not.toHaveBeenCalled();
  });

  it('reads and removes an existing push subscription through its registered service worker', async () => {
    const subscription = {
      endpoint: 'https://push.example.test/synthetic', expirationTime: null,
      toJSON: () => ({ keys: { auth: 'synthetic-auth', p256dh: 'synthetic-key' } }),
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
    const getSubscription = vi.fn().mockResolvedValue(subscription);
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: vi.fn().mockResolvedValue({ pushManager: { getSubscription } }) } });
    vi.stubGlobal('PushManager', class {});
    const platform = createBrowserPlatform();
    await expect(platform.push.getSubscription()).resolves.toEqual({
      endpoint: subscription.endpoint, expirationTime: null,
      keys: { auth: 'synthetic-auth', p256dh: 'synthetic-key' },
    });
    await expect(platform.push.unsubscribe()).resolves.toBe(true);
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });
});


describe('browser Matrix destinations', () => {
  it('preserves complete alias targets when opening a route', () => {
    const state = { __aimtrixShell: { session: 'synthetic', entry: 2 } };
    window.history.replaceState(state, '', '/client/?demo=1&room=!old:test');
    const listener = vi.fn();
    window.addEventListener('aimtrix-push-route', listener);
    try {
      createBrowserPlatform().deepLinks.openRoute({ roomAlias: '#lounge:test', eventId: '$event', via: ['test'] });
      expect(window.location.pathname).toBe('/client/');
      expect(window.location.search).toBe('?demo=1&alias=%23lounge%3Atest&event=%24event&via=test');
      expect(window.history.state).toEqual(state);
      expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ roomAlias: '#lounge:test', eventId: '$event', via: ['test'] });
    } finally { window.removeEventListener('aimtrix-push-route', listener); }
  });

  it('rejects invalid explicit events before changing the current route', () => {
    window.history.replaceState({}, '', '/?event=%24original');
    expect(() => createBrowserPlatform().deepLinks.openRoute({ roomId: '!room:test', eventId: 'broken' })).toThrow('invalid');
    expect(window.location.search).toBe('?event=%24original');
  });
});
