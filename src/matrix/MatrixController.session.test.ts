import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient, SyncState } from 'matrix-js-sdk';
import { defaultRuntimeConfig } from '../config/runtimeConfig';
import type { AimtrixPlatform } from '../platform/platform';
import { MatrixController } from './MatrixController';
import { databaseNames, type StoredMatrixSession } from './sessionStore';

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('matrix-js-sdk', async (importOriginal) => ({
  ...await importOriginal<typeof import('matrix-js-sdk')>(), createClient,
}));
vi.mock('./discovery', () => ({
  resolveHomeserver: vi.fn().mockResolvedValue({ baseUrl: 'https://matrix.example.test', serverName: 'example.test' }),
}));

const session: StoredMatrixSession = {
  baseUrl: 'https://matrix.example.test', serverName: 'example.test',
  userId: '@synthetic:example.test', deviceId: 'SYNTHETIC', accessToken: 'synthetic-token',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fakeClient() {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  return {
    listeners,
    on: vi.fn((name: string, callback: (...args: any[]) => void) => {
      const callbacks = listeners.get(name) ?? new Set(); callbacks.add(callback); listeners.set(name, callbacks);
    }),
    removeListener: vi.fn((name: string, callback: (...args: any[]) => void) => listeners.get(name)?.delete(callback)),
    emit: (name: string, ...args: unknown[]) => [...(listeners.get(name) ?? [])].forEach((callback) => callback(...args)),
    getRooms: () => [],
    getAccountData: () => undefined,
    getAccessToken: () => session.accessToken,
    mxcUrlToHttp: () => 'https://matrix.example.test/_matrix/client/v1/media/download/example.test/synthetic',
    initRustCrypto: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    startClient: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    stopClient: vi.fn(),
    clearStores: vi.fn(),
    retryImmediately: vi.fn(),
    doesServerSupportThread: vi.fn().mockResolvedValue({ threads: 0 }),
  };
}

function platformFixture(stored: StoredMatrixSession | undefined = session) {
  let value: StoredMatrixSession | undefined = stored;
  const credentials = {
    load: vi.fn(async () => value),
    save: vi.fn(async (next: StoredMatrixSession) => { value = next; }),
    clear: vi.fn(async () => { value = undefined; }),
  };
  const platform = {
    capabilities: { platform: 'browser' }, credentials,
    push: { unsubscribe: vi.fn().mockResolvedValue(true) },
    sso: { load: vi.fn(), save: vi.fn(), clear: vi.fn() },
  } as unknown as AimtrixPlatform;
  return { platform, credentials };
}

type Internals = {
  client?: MatrixClient;
  lifecycleRevision: number;
  connection: string;
  currentIssue?: string;
  connect: (session: StoredMatrixSession, revision?: number) => Promise<void>;
  scheduleWorkspacePublish: () => void;
};

const controllers: MatrixController[] = [];
function controllerFixture(stored: StoredMatrixSession | undefined = session) {
  const platform = platformFixture(stored);
  const controller = new MatrixController(structuredClone(defaultRuntimeConfig), platform.platform);
  controller.setNotificationPreferences({ desktopNotifications: false, notificationSounds: false, soundVolume: 0 });
  controllers.push(controller);
  return { ...platform, controller, internals: controller as unknown as Internals };
}

beforeEach(() => {
  createClient.mockReset();
  window.history.replaceState({}, '', '/');
});
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.shutdown());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MatrixController session lifecycle', () => {
  it('hides an expired active session immediately and stores one token-free recovery record', async () => {
    const client = fakeClient(); createClient.mockReturnValue(client);
    const { controller, credentials, internals } = controllerFixture();
    await controller.initialize();
    const pendingSave = deferred<void>(); credentials.save.mockImplementation(() => pendingSave.promise);
    const oldSyncListener = [...client.listeners.get('sync')!][0];
    client.emit('Session.logged_out', { errcode: 'M_UNKNOWN_TOKEN', data: { soft_logout: true }, message: 'private server diagnostic' });
    oldSyncListener('ERROR', 'SYNCING', { error: { errcode: 'M_UNKNOWN_TOKEN' } });
    expect(controller.getSnapshot()).toEqual({ status: 'reauthentication-required', recovery: {
      userId: session.userId, homeserver: session.baseUrl, softLogout: true,
    } });
    expect(internals.client).toBeUndefined();
    expect(client.stopClient).toHaveBeenCalledOnce();
    expect([...client.listeners.values()].every((callbacks) => callbacks.size === 0)).toBe(true);
    expect(client.clearStores).not.toHaveBeenCalled();
    expect(credentials.clear).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(credentials.save).toHaveBeenCalledExactlyOnceWith({ ...session, accessToken: '', recovery: 'soft' }));
    pendingSave.resolve();
  });

  it.each(['soft', 'hard'] as const)('restores %s recovery metadata without constructing an authenticated client', async (recovery) => {
    const { controller, credentials } = controllerFixture({ ...session, accessToken: '', recovery });
    await controller.initialize();
    expect(controller.getSnapshot()).toMatchObject({ status: 'reauthentication-required', recovery: { softLogout: recovery === 'soft' } });
    expect(createClient).not.toHaveBeenCalled();
    expect(credentials.clear).not.toHaveBeenCalled();
    await controller.reauthenticate();
    expect(controller.getSnapshot()).toMatchObject({ status: 'signed-out', recovery: { userId: session.userId } });
  });

  it('reports rejected-token storage failure without reopening content or exposing the underlying diagnostic', async () => {
    const client = fakeClient(); createClient.mockReturnValue(client);
    const { controller, credentials, internals } = controllerFixture();
    await controller.initialize();
    credentials.save.mockRejectedValue(new Error('private secure-storage diagnostic synthetic-token'));
    client.emit('Session.logged_out', { errcode: 'M_UNKNOWN_TOKEN', message: 'private server diagnostic' });
    await vi.waitFor(() => expect(controller.getSnapshot()).toMatchObject({ status: 'reauthentication-required',
      error: 'The rejected token could not be removed from device storage. Check storage access before continuing.',
    }));
    expect(JSON.stringify(controller.getSnapshot())).not.toMatch(/private|synthetic-token/);
    expect(internals.client).toBeUndefined();
    expect(client.clearStores).not.toHaveBeenCalled();
    expect(credentials.clear).not.toHaveBeenCalled();
  });

  it.each(['soft', 'hard'] as const)('reauthenticates a %s session with the appropriate device and retained crypto ownership', async (recovery) => {
    const deviceId = recovery === 'soft' ? session.deviceId : 'FRESH-SYNTHETIC';
    const login = vi.fn().mockResolvedValue({ user_id: session.userId, device_id: deviceId, access_token: 'fresh-synthetic-token' });
    const client = fakeClient(); createClient.mockReturnValueOnce({ login }).mockReturnValueOnce(client);
    const { controller, credentials } = controllerFixture({ ...session, accessToken: '', recovery, retainedDeviceIds: ['OLDER'] });
    await controller.initialize();
    await controller.reauthenticate();
    await controller.login({ userId: session.userId, homeserver: session.baseUrl, password: 'synthetic-password' });
    const request = login.mock.calls[0][1];
    if (recovery === 'soft') expect(request.device_id).toBe(session.deviceId);
    else expect(request).not.toHaveProperty('device_id');
    expect(credentials.save).toHaveBeenCalledWith({ ...session, deviceId, accessToken: 'fresh-synthetic-token',
      retainedDeviceIds: recovery === 'soft' ? ['OLDER'] : ['OLDER', session.deviceId],
    });
    expect(client.initRustCrypto).toHaveBeenCalledOnce();
    expect(client.clearStores).not.toHaveBeenCalled();
  });

  it('refuses another account returned by authentication without overwriting recovery metadata', async () => {
    const login = vi.fn().mockResolvedValue({ user_id: '@another:example.test', device_id: 'OTHER', access_token: 'other-synthetic-token' });
    createClient.mockReturnValue({ login });
    const { controller, credentials } = controllerFixture({ ...session, accessToken: '', recovery: 'hard' });
    await controller.initialize();
    await controller.login({ userId: session.userId, homeserver: session.baseUrl, password: 'synthetic-password' });
    expect(controller.getSnapshot()).toMatchObject({ status: 'signed-out', recovery: { userId: session.userId } });
    expect(credentials.save).not.toHaveBeenCalled();
    expect(createClient).toHaveBeenCalledOnce();
  });

  it('removes an SSO callback token before credential storage can fail', async () => {
    window.history.replaceState({}, '', '/?loginToken=synthetic-callback');
    const { controller, credentials } = controllerFixture();
    credentials.load.mockRejectedValue(new Error('Synthetic storage rejection'));
    const restoring = controller.initialize();
    expect(new URL(window.location.href).searchParams.has('loginToken')).toBe(false);
    await restoring;
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', issue: 'storage' });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('classifies unavailable credential storage without discarding the stored account', async () => {
    const { controller, credentials } = controllerFixture();
    credentials.load.mockRejectedValue(new DOMException('Synthetic storage failure', 'SecurityError'));
    await controller.initialize();
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', issue: 'storage', canRetry: true });
    expect(credentials.clear).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each(['M_FORBIDDEN', 'M_UNKNOWN_TOKEN'])('returns an invalid SSO callback to sign-in after %s without retaining URL credentials', async (errcode) => {
    const callbackToken = 'synthetic-callback-token';
    window.history.replaceState({}, '', `/?loginToken=${callbackToken}`);
    const login = vi.fn()
      .mockImplementationOnce(async () => {
        expect(new URL(window.location.href).searchParams.has('loginToken')).toBe(false);
        throw { errcode, message: 'private callback diagnostic', data: { access_token: 'private response token' } };
      })
      .mockResolvedValue({ user_id: session.userId, device_id: session.deviceId, access_token: 'fresh-synthetic-token' });
    const client = fakeClient();
    createClient.mockReturnValueOnce({ login }).mockReturnValueOnce({ login }).mockReturnValueOnce(client);
    const { controller, platform, credentials } = controllerFixture();
    credentials.load.mockResolvedValue(undefined);
    vi.mocked(platform.sso.load).mockResolvedValue({ baseUrl: session.baseUrl, serverName: session.serverName });
    await controller.initialize();
    expect(controller.getSnapshot()).toMatchObject({ status: 'signed-out', error: expect.any(String) });
    expect(JSON.stringify(controller.getSnapshot())).not.toMatch(/private callback|private response|synthetic-callback-token/);
    expect(window.location.search).toBe('');
    expect(credentials.save).not.toHaveBeenCalled();
    await controller.login({ userId: session.userId, homeserver: session.baseUrl, password: 'synthetic-password' });
    expect(client.startClient).toHaveBeenCalledOnce();
    expect(credentials.save).toHaveBeenCalledWith({ ...session, accessToken: 'fresh-synthetic-token' });
  });

  it.each(['emitted', 'thrown'] as const)('handles %s rejection during restoration without clearing crypto', async (mode) => {
    const client = fakeClient(); createClient.mockReturnValue(client);
    const error = { errcode: 'M_UNKNOWN_TOKEN', data: { soft_logout: false } };
    if (mode === 'emitted') client.startClient.mockImplementation(async () => { client.emit('Session.logged_out', error); });
    else client.initRustCrypto.mockRejectedValue(error);
    const { controller, credentials } = controllerFixture();
    await controller.initialize();
    expect(controller.getSnapshot()).toMatchObject({ status: 'reauthentication-required', recovery: { softLogout: false } });
    expect(client.clearStores).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(credentials.save).toHaveBeenCalledWith({ ...session, accessToken: '', recovery: 'hard' }));
  });

  it('keeps the same client and crypto through a temporary sync failure and recovery', async () => {
    const client = fakeClient(); createClient.mockReturnValue(client);
    const { controller, credentials, internals } = controllerFixture();
    vi.spyOn(internals, 'scheduleWorkspacePublish').mockImplementation(() => undefined);
    await controller.initialize();
    client.emit('sync', 'ERROR' satisfies `${SyncState}`, 'SYNCING', { error: new TypeError('Failed to fetch synthetic endpoint') });
    expect(internals.connection).toBe('offline');
    expect(internals.currentIssue).toBe('offline');
    client.emit('sync', 'SYNCING', 'ERROR');
    expect(internals.connection).toBe('online');
    expect(internals.currentIssue).toBeUndefined();
    expect(internals.client).toBe(client);
    expect(client.stopClient).not.toHaveBeenCalled();
    expect(client.initRustCrypto).toHaveBeenCalledOnce();
    expect(credentials.save).not.toHaveBeenCalled();
    expect(credentials.clear).not.toHaveBeenCalled();
  });

  it('recognizes a rejected token carried only by sync error data', async () => {
    const client = fakeClient(); createClient.mockReturnValue(client);
    const { controller } = controllerFixture();
    await controller.initialize();
    client.emit('sync', 'ERROR', 'SYNCING', { error: { errcode: 'M_MISSING_TOKEN' } });
    expect(controller.getSnapshot()).toMatchObject({ status: 'reauthentication-required' });
    expect(client.stopClient).toHaveBeenCalledOnce();
  });

  it('reports consent separately without destroying the session or echoing consent diagnostics', async () => {
    const client = fakeClient(); createClient.mockReturnValue(client);
    const { controller, internals, credentials } = controllerFixture();
    vi.spyOn(internals, 'scheduleWorkspacePublish').mockImplementation(() => undefined);
    await controller.initialize();
    client.emit('no_consent', 'private diagnostic', 'https://matrix.example.test/private-account-path');
    expect(internals.currentIssue).toBe('consent');
    expect(internals.client).toBe(client);
    expect(client.stopClient).not.toHaveBeenCalled();
    expect(credentials.clear).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('ignores a superseded crypto initialization that later %ss', async (outcome) => {
    const oldClient = fakeClient(); const nextClient = fakeClient();
    const initialization = deferred<void>(); oldClient.initRustCrypto.mockReturnValue(initialization.promise);
    createClient.mockReturnValueOnce(oldClient).mockReturnValueOnce(nextClient);
    const { controller, internals } = controllerFixture();
    const restoring = controller.initialize();
    await vi.waitFor(() => expect(oldClient.initRustCrypto).toHaveBeenCalled());
    const revision = ++internals.lifecycleRevision;
    await internals.connect({ ...session, accessToken: 'new-synthetic-token', deviceId: 'NEXT' }, revision);
    if (outcome === 'resolve') initialization.resolve();
    else initialization.reject(new Error('Old crypto failed'));
    await restoring;
    expect(internals.client).toBe(nextClient);
    expect(oldClient.startClient).not.toHaveBeenCalled();
    expect(nextClient.stopClient).not.toHaveBeenCalled();
    expect(nextClient.listeners.get('Session.logged_out')?.size).toBe(1);
  });

  it('does not restart a superseded client when its startClient promise completes', async () => {
    const oldClient = fakeClient(); const nextClient = fakeClient();
    const starting = deferred<void>(); oldClient.startClient.mockReturnValue(starting.promise);
    createClient.mockReturnValueOnce(oldClient).mockReturnValueOnce(nextClient);
    const { controller, internals } = controllerFixture();
    const restoring = controller.initialize();
    await vi.waitFor(() => expect(oldClient.startClient).toHaveBeenCalled());
    await internals.connect({ ...session, accessToken: 'new-synthetic-token', deviceId: 'NEXT' }, ++internals.lifecycleRevision);
    starting.resolve(); await restoring;
    expect(internals.client).toBe(nextClient);
    expect(nextClient.stopClient).not.toHaveBeenCalled();
    expect(oldClient.doesServerSupportThread).not.toHaveBeenCalled();
  });

  it('does not create an object URL for media that finishes after expiry', async () => {
    const client = fakeClient(); createClient.mockReturnValue(client);
    const { controller } = controllerFixture();
    await controller.initialize();
    const download = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(download.promise));
    const createObjectURL = vi.fn(); vi.stubGlobal('URL', class extends URL { static createObjectURL = createObjectURL; });
    const media = controller.resolveMedia('mxc://example.test/synthetic', 64);
    client.emit('Session.logged_out', { errcode: 'M_UNKNOWN_TOKEN' });
    download.resolve(new Response('synthetic bytes', { headers: { 'content-type': 'image/png' } }));
    await expect(media).resolves.toBeUndefined();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('keeps cleanup retryable when an account database is blocked and then deletes retained device stores', async () => {
    const { controller, credentials } = controllerFixture({ ...session, accessToken: '', recovery: 'hard', retainedDeviceIds: ['OLDER'] });
    let blocked = true;
    const deleteDatabase = vi.fn(() => {
      const request = { onsuccess: undefined as (() => void) | undefined, onblocked: undefined as (() => void) | undefined };
      queueMicrotask(() => { if (blocked) request.onblocked?.(); else request.onsuccess?.(); });
      return request;
    });
    vi.stubGlobal('indexedDB', { deleteDatabase });
    await controller.initialize();
    await controller.forgetSession();
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', issue: 'storage' });
    expect(credentials.clear).not.toHaveBeenCalled();
    blocked = false; deleteDatabase.mockClear();
    await controller.retry();
    for (const deviceId of [session.deviceId, 'OLDER']) {
      const names = databaseNames({ ...session, deviceId });
      for (const name of [names.sync, `${names.crypto}::matrix-sdk-crypto`, `${names.crypto}::matrix-sdk-crypto-meta`]) {
        expect(deleteDatabase).toHaveBeenCalledWith(name);
      }
    }
    expect(deleteDatabase).toHaveBeenCalledTimes(6);
    expect(credentials.clear).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toEqual({ status: 'signed-out' });
  });

  it('does not clear a newer account when an earlier sign-out resumes after a provider wait', async () => {
    const oldClient = fakeClient(); const nextClient = fakeClient();
    const login = vi.fn().mockResolvedValue({ user_id: session.userId, device_id: 'NEXT', access_token: 'fresh-synthetic-token' });
    createClient.mockReturnValueOnce(oldClient).mockReturnValueOnce({ login }).mockReturnValueOnce(nextClient);
    const { controller, platform, credentials, internals } = controllerFixture();
    await controller.initialize();
    const unsubscribe = deferred<boolean>();
    vi.mocked(platform.push.unsubscribe).mockReturnValue(unsubscribe.promise);
    const deleteDatabase = vi.fn(); vi.stubGlobal('indexedDB', { deleteDatabase });
    const signingOut = controller.forgetSession();
    await vi.waitFor(() => expect(platform.push.unsubscribe).toHaveBeenCalled());
    await controller.login({ userId: session.userId, homeserver: session.baseUrl, password: 'synthetic-password' });
    unsubscribe.resolve(true); await signingOut;
    expect(internals.client).toBe(nextClient);
    expect(credentials.clear).not.toHaveBeenCalled();
    expect(deleteDatabase).not.toHaveBeenCalled();
    expect(await credentials.load()).toMatchObject({ accessToken: 'fresh-synthetic-token', deviceId: 'NEXT' });
  });

  it('removes the usable token before sign-out waits and clears recovery metadata only after database deletion', async () => {
    const client = { ...fakeClient(), logout: vi.fn().mockResolvedValue(undefined) }; createClient.mockReturnValue(client);
    const { controller, platform, credentials } = controllerFixture();
    await controller.initialize();
    const unsubscribe = deferred<boolean>();
    vi.mocked(platform.push.unsubscribe).mockReturnValue(unsubscribe.promise);
    const deletionRequests: { onsuccess?: () => void }[] = [];
    const deleteDatabase = vi.fn(() => {
      const request: { onsuccess?: () => void } = {}; deletionRequests.push(request); return request;
    });
    vi.stubGlobal('indexedDB', { deleteDatabase });
    client.logout.mockImplementation(async () => {
      expect(await credentials.load()).toEqual({ ...session, accessToken: '', recovery: 'hard' });
    });
    const signingOut = controller.logout();
    await vi.waitFor(() => expect(platform.push.unsubscribe).toHaveBeenCalled());
    expect(await credentials.load()).toEqual({ ...session, accessToken: '', recovery: 'hard' });
    expect(client.logout).toHaveBeenCalledOnce();
    expect(credentials.clear).not.toHaveBeenCalled();
    expect(deleteDatabase).not.toHaveBeenCalled();
    unsubscribe.resolve(true);
    await vi.waitFor(() => expect(deleteDatabase).toHaveBeenCalledTimes(3));
    expect(credentials.clear).not.toHaveBeenCalled();
    deletionRequests.forEach((request) => request.onsuccess?.());
    await signingOut;
    expect(credentials.clear).toHaveBeenCalledOnce();
    expect(await credentials.load()).toBeUndefined();
    expect(controller.getSnapshot()).toEqual({ status: 'signed-out' });
  });

  it('stops sign-out before network and destructive cleanup if the token-free marker cannot be saved', async () => {
    const client = { ...fakeClient(), logout: vi.fn().mockResolvedValue(undefined) }; createClient.mockReturnValue(client);
    const { controller, platform, credentials, internals } = controllerFixture();
    await controller.initialize();
    credentials.save.mockRejectedValue(new DOMException('Private secure-storage diagnostic', 'SecurityError'));
    const deleteDatabase = vi.fn(); vi.stubGlobal('indexedDB', { deleteDatabase });
    await controller.logout();
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', issue: 'storage', canRetry: true });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('Private secure-storage diagnostic');
    expect(internals.client).toBeUndefined();
    expect(client.stopClient).toHaveBeenCalledOnce();
    expect(client.logout).not.toHaveBeenCalled();
    expect(platform.push.unsubscribe).not.toHaveBeenCalled();
    expect(deleteDatabase).not.toHaveBeenCalled();
    expect(credentials.clear).not.toHaveBeenCalled();
  });

  it('does not reopen an expired account after reauthentication was superseded during a credential write', async () => {
    const client = fakeClient(); createClient.mockReturnValue(client);
    const { controller, credentials } = controllerFixture();
    await controller.initialize();
    const saving = deferred<void>(); credentials.save.mockReturnValue(saving.promise);
    client.emit('Session.logged_out', { errcode: 'M_UNKNOWN_TOKEN' });
    const reauthenticating = controller.reauthenticate();
    controller.shutdown(); saving.resolve(); await reauthenticating;
    expect(controller.getSnapshot()).toEqual({ status: 'signed-out' });
  });
});
