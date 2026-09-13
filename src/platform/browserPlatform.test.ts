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
