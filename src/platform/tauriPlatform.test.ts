import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onAction, registerActionTypes, sendNotification } from '@tauri-apps/plugin-notification';
import { SESSION_KEY } from '../matrix/sessionStore';
import { createTauriPlatform } from './tauriPlatform';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  getCurrent: vi.fn(async () => null as string[] | null),
  onOpenUrl: vi.fn<(listener: (urls: string[]) => void) => Promise<() => undefined>>(async () => () => undefined),
  check: vi.fn(),
  relaunch: vi.fn(),
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
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: mocks.relaunch }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: mocks.check }));

describe('Tauri platform', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.getCurrent.mockReset();
    mocks.getCurrent.mockResolvedValue(null);
    mocks.check.mockReset();
    mocks.relaunch.mockReset();
  });

  it('rejects queued local notifications after account changes or a new local pause', async () => {
    const platform = createTauriPlatform();
    const policy = { pauseUntil: 0, quietHours: { enabled: false, startMinute: 0, endMinute: 0 } };
    await platform.notifications.requestPermission();
    for (const change of ['account', 'pause']) {
      await platform.notifications.setContext?.({ owner: 'synthetic-owner-001', policy });
      let finish!: () => void;
      vi.mocked(registerActionTypes).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
      vi.mocked(sendNotification).mockClear();
      platform.notifications.show({ title: 'Synthetic', body: 'Activity', eventId: `$${change}` });
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      await platform.notifications.setContext?.({ owner: change === 'account' ? 'synthetic-owner-002' : 'synthetic-owner-001', policy: change === 'pause' ? { ...policy, pauseUntil: Date.now() + 60000 } : policy });
      finish();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(sendNotification).not.toHaveBeenCalled();
    }
  });

  it('deduplicates desktop events and rejects clicks after logout', async () => {
    const platform = createTauriPlatform(); const clicked = vi.fn();
    await platform.notifications.requestPermission();
    await platform.notifications.setContext?.({ owner: 'synthetic-owner-001', policy: { pauseUntil: 0, quietHours: { enabled: false, startMinute: 0, endMinute: 0 } } });
    vi.mocked(sendNotification).mockClear();
    platform.notifications.show({ title: 'Synthetic', body: 'Activity', eventId: '$event', silent: true, onClick: clicked });
    platform.notifications.show({ title: 'Synthetic', body: 'Activity', eventId: '$event' });
    await vi.waitFor(() => expect(sendNotification).toHaveBeenCalledOnce());
    const notice = vi.mocked(sendNotification).mock.calls[0][0];
    expect(notice).toMatchObject({ silent: true });
    platform.notifications.clearContext?.('synthetic-owner-001');
    vi.mocked(onAction).mock.calls.at(-1)![0](notice as Parameters<Parameters<typeof onAction>[0]>[0]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(clicked).not.toHaveBeenCalled();
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

  it('reports the current desktop version when the signed channel has no update', async () => {
    mocks.check.mockResolvedValue(null);

    await expect(createTauriPlatform().install.checkForUpdate()).resolves.toEqual({ status: 'current' });
  });

  it('downloads and relaunches a signed desktop update only after an explicit install call', async () => {
    const downloadAndInstall = vi.fn(async () => undefined);
    mocks.check.mockResolvedValue({
      version: '0.2.0',
      date: '2026-08-22T00:00:00Z',
      body: 'Release notes',
      downloadAndInstall,
    });
    const result = await createTauriPlatform().install.checkForUpdate();

    expect(result).toMatchObject({ status: 'available', version: '0.2.0', notes: 'Release notes' });
    expect(downloadAndInstall).not.toHaveBeenCalled();
    if (result.status === 'available') await result.install();
    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(mocks.relaunch).toHaveBeenCalledOnce();
  });
});


describe('Tauri Matrix destinations', () => {
  it('preserves standard room-alias events and routing hints during cold start', async () => {
    window.history.replaceState({}, '', '/');
    const platform = createTauriPlatform();
    mocks.getCurrent.mockResolvedValue(['matrix:r/lounge:test/e/event?via=test']);
    await platform.deepLinks.prepare();
    expect(window.location.search).toBe('?alias=%23lounge%3Atest&event=%24event&via=test');
  });

  it('preserves user targets on subsequent opens and rejects malformed event links', async () => {
    const state = { __aimtrixShell: { session: 'synthetic', entry: 2 } };
    window.history.replaceState(state, '', '/client/?demo=1&room=!old:test');
    const platform = createTauriPlatform();
    mocks.getCurrent.mockResolvedValue(null);
    await platform.deepLinks.prepare();
    const receive = mocks.onOpenUrl.mock.calls.at(-1)![0];
    receive(['matrix:u/alice:test?loginToken=synthetic-ignored-value']);
    expect(window.location.pathname).toBe('/client/');
    expect(window.location.search).toBe('?demo=1&user=%40alice%3Atest');
    expect(window.history.state).toEqual(state);
    receive(['aimtrix://open?room=!other:test&event=broken']);
    expect(window.location.search).toBe('?demo=1&user=%40alice%3Atest');
  });
});
