import { describe, expect, it } from 'vitest';
import { createBrowserPlatform } from './browserPlatform';

describe('browser platform', () => {
  it('treats unavailable browser capabilities as unsupported', () => {
    const platform = createBrowserPlatform();

    expect(platform.install.displayMode()).toBe('browser');
    expect(platform.capabilities.standalone).toBe(false);
    expect(platform.capabilities.secureCredentialStorage).toBe(false);
    expect(platform.push.provider).toBe('web');
    expect(platform.deepLinks.ssoRedirectUrl()).toContain(window.location.pathname);
  });

  it('keeps SSO state in the browser session until the callback completes', async () => {
    const platform = createBrowserPlatform();
    const pending = { baseUrl: 'https://matrix.example.com', serverName: 'example.com' };

    await platform.sso.save(pending);
    expect(await platform.sso.load()).toEqual(pending);
    await platform.sso.clear();
    expect(await platform.sso.load()).toBeUndefined();
  });
});
