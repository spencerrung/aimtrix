import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserPlatform } from './browserPlatform';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('persistent browser notification presentation', () => {
  async function setup(showNotification = vi.fn().mockResolvedValue(undefined)) {
    const construct = vi.fn(() => { throw new TypeError('Synthetic Android constructor restriction'); });
    vi.stubGlobal('Notification', class { static permission = 'granted'; constructor() { construct(); } });
    const registration = { active: {}, showNotification };
    const getRegistration = vi.fn().mockResolvedValue(registration);
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration, get ready() { throw new Error('Must not await indefinite registration readiness'); } } });
    let state: import('../pwa/notificationPolicy').NotificationMetadata | undefined;
    // The shared implementation is frozen, so install a scoped transaction facade.
    const implementation = globalThis.aimtrixNotificationPolicy;
    vi.stubGlobal('aimtrixNotificationPolicy', { ...implementation, transaction: async (change: (value: typeof state) => { state: typeof state; result: unknown }) => {
      const next = change(state); state = next.state; return next.result;
    } });
    const platform = createBrowserPlatform();
    await platform.notifications.setContext?.({ owner: 'synthetic-owner-001', policy: { pauseUntil: 0, quietHours: { enabled: false, startMinute: 0, endMinute: 0 } } });
    return { platform, registration, getRegistration, construct, showNotification };
  }

  it('uses an active service worker when Android rejects Notification construction', async () => {
    const f = await setup();
    await f.platform.notifications.show({ title: 'Synthetic local alert', body: 'Synthetic activity', eventId: '$event' });
    await vi.waitFor(() => expect(f.showNotification).toHaveBeenCalledOnce());
    expect(f.construct).not.toHaveBeenCalled();
  });

  it('reports failed presentation and releases the event claim for a same-event retry', async () => {
    const show = vi.fn().mockRejectedValueOnce(new Error('Synthetic private platform diagnostic')).mockResolvedValue(undefined);
    const f = await setup(show);
    const request = { title: 'Synthetic alert', body: 'Synthetic activity', eventId: '$retry' };
    await expect(Promise.resolve(f.platform.notifications.show(request))).rejects.toThrow('could not be shown');
    await f.platform.notifications.show(request);
    expect(show).toHaveBeenCalledTimes(2);
    await f.platform.notifications.show(request);
    expect(show).toHaveBeenCalledTimes(2);
  });

  it('does not wait forever when no registration exists and reports an unsupported constructor', async () => {
    const f = await setup();
    f.getRegistration.mockResolvedValue(undefined);
    await expect(Promise.resolve(f.platform.notifications.show({ title: 'Synthetic alert', body: 'Synthetic activity' }))).rejects.toThrow('could not be shown');
    expect(f.construct).toHaveBeenCalledOnce();
  });

  it('rechecks the account after registration lookup and keeps only validated local routing data', async () => {
    const f = await setup();
    const route = { roomId: '!room:example.test', eventId: '$event', accountId: '["https://matrix.example.test","@synthetic:example.test"]' };
    await f.platform.notifications.show({ title: 'Synthetic alert', body: 'Synthetic activity', route, onClick: vi.fn() });
    expect(f.showNotification).toHaveBeenLastCalledWith('Synthetic alert', expect.objectContaining({ data: { owner: 'synthetic-owner-001', local: true, route } }));
    let resolve!: (value: typeof f.registration) => void;
    f.getRegistration.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = f.platform.notifications.show({ title: 'Old owner', body: 'Synthetic activity', eventId: '$old' });
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    await f.platform.notifications.setContext?.({ owner: 'synthetic-owner-002', policy: { pauseUntil: 0, quietHours: { enabled: false, startMinute: 0, endMinute: 0 } } });
    resolve(f.registration);
    await pending;
    expect(f.showNotification).toHaveBeenCalledOnce();
  });

  it('keeps the new owner claim when an old presentation rejects after an account switch', async () => {
    let reject!: (reason: Error) => void;
    const show = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; })).mockResolvedValue(undefined);
    const f = await setup(show);
    const request = { title: 'Synthetic alert', body: 'Synthetic activity', eventId: '$same' };
    const old = Promise.resolve(f.platform.notifications.show(request));
    const rejected = expect(old).rejects.toThrow('could not be shown');
    await vi.waitFor(() => expect(reject).toBeTypeOf('function'));
    await f.platform.notifications.setContext?.({ owner: 'synthetic-owner-002', policy: { pauseUntil: 0, quietHours: { enabled: false, startMinute: 0, endMinute: 0 } } });
    await f.platform.notifications.show(request);
    reject(new Error('Synthetic old failure')); await rejected;
    await f.platform.notifications.show(request);
    expect(show).toHaveBeenCalledTimes(2);
  });
});

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
