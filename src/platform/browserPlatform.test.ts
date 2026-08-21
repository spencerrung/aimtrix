import { describe, expect, it } from 'vitest';
import { createBrowserPlatform } from './browserPlatform';

describe('browser platform', () => {
  it('treats unavailable browser capabilities as unsupported', () => {
    const platform = createBrowserPlatform();

    expect(platform.install.displayMode()).toBe('browser');
    expect(platform.capabilities.standalone).toBe(false);
    expect(platform.capabilities.secureCredentialStorage).toBe(false);
  });
});
