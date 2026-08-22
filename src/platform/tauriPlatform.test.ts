import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_KEY } from '../matrix/sessionStore';
import { createTauriPlatform } from './tauriPlatform';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  getCurrent: vi.fn(async () => null as string[] | null),
  onOpenUrl: vi.fn(async () => () => undefined),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => undefined) }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isFocused: vi.fn(async () => true),
    show: vi.fn(async () => undefined),
    setFocus: vi.fn(async () => undefined),
  }),
}));
vi.mock('@tauri-apps/plugin-deep-link', () => ({ getCurrent: mocks.getCurrent, onOpenUrl: mocks.onOpenUrl }));
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(async () => true),
  onAction: vi.fn(async () => () => undefined),
  registerActionTypes: vi.fn(async () => undefined),
  requestPermission: vi.fn(async () => 'granted'),
  sendNotification: vi.fn(),
}));

describe('Tauri platform', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.getCurrent.mockReset();
    mocks.getCurrent.mockResolvedValue(null);
  });

  it('exposes secure desktop capabilities and allowlisted credentials', async () => {
    const platform = createTauriPlatform();
    mocks.invoke.mockResolvedValue(JSON.stringify({
      baseUrl: 'https://matrix.example',
      serverName: 'example',
      accessToken: 'fixture-value',
      userId: '@spencer:example',
      deviceId: 'DEVICE',
    }));

    expect(platform.capabilities.platform).toBe('desktop');
    expect(platform.capabilities.secureCredentialStorage).toBe(true);
    expect(platform.capabilities.push).toBe(false);
    await expect(platform.credentials.load()).resolves.toMatchObject({ userId: '@spencer:example' });
    expect(mocks.invoke).toHaveBeenCalledWith('secure_credential_load', { key: SESSION_KEY });
  });

  it('prepares cold-start deep links without accepting arbitrary URLs', async () => {
    const platform = createTauriPlatform();
    mocks.getCurrent.mockResolvedValue(['aimtrix://open?room=!room:example&event=$event']);
    const routeEvent = vi.fn();
    window.addEventListener('aimtrix-push-route', routeEvent);

    await platform.deepLinks.prepare();

    expect(window.location.search).toContain('room=%21room%3Aexample');
    expect(routeEvent).toHaveBeenCalledOnce();
    window.removeEventListener('aimtrix-push-route', routeEvent);
  });
});
