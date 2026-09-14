import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultUserPreferences } from './settings/preferences';
import { defaultRuntimeConfig } from './config/runtimeConfig';
import { demoWorkspace } from './demo/demoWorkspace';
import { defaultProfilePersonalization, type ProfilePersonalization } from './settings/profilePersonalization';
import type { MatrixControllerSnapshot } from './matrix/MatrixController';
import type { MatrixNavigationTarget } from './matrix/matrixLinks';
import type { PushRoute } from './pwa/pushRouting';

const harness = vi.hoisted(() => ({
  snapshot: {} as MatrixControllerSnapshot,
  listeners: new Set<() => void>(),
  remote: undefined as ProfilePersonalization | undefined,
  update: vi.fn<() => Promise<void>>(),
  forget: vi.fn<() => Promise<void>>(),
  markRead: vi.fn(),
  markThreadRead: vi.fn(),
  markUnread: vi.fn(),
  notificationPreferences: vi.fn(),
  favorite: vi.fn(),
  resolveNavigation: vi.fn(),
}));
vi.mock('./matrix/MatrixController', () => ({ MatrixController: class {
  constructor() { return new Proxy(this, { get: (target, key) => Reflect.get(target, key) ?? (() => undefined) }); }
  subscribe = (listener: () => void) => { harness.listeners.add(listener); return () => harness.listeners.delete(listener); };
  getSnapshot = () => harness.snapshot;
  loadProfilePersonalization = () => harness.remote;
  updateProfilePersonalization = () => harness.update();
  forgetSession = () => harness.forget();
  markRoomRead = (...args: unknown[]) => harness.markRead(...args);
  markThreadRead = (...args: unknown[]) => harness.markThreadRead(...args);
  markRoomUnread = (...args: unknown[]) => harness.markUnread(...args);
  setNotificationPreferences = (preferences: unknown) => harness.notificationPreferences(preferences);
  setRoomFavorite = (...args: unknown[]) => harness.favorite(...args);
  resolveNavigationTarget = (...args: unknown[]) => harness.resolveNavigation(...args);
} }));
vi.mock('./config/runtimeConfig', async (original) => {
  const actual = await original<typeof import('./config/runtimeConfig')>();
  return { ...actual, loadRuntimeConfig: async () => ({ config: actual.defaultRuntimeConfig, warnings: [] }) };
});
vi.mock('./features/workspace/Workspace', () => ({ Workspace: ({ workspace, profilePersonalization, onProfilePersonalizationChange, onMarkRoomRead, onMarkThreadRead, onMarkRoomUnread, onSetRoomFavorite, onResolveNavigationTarget, pushRoute }: {
  workspace: typeof demoWorkspace; profilePersonalization: ProfilePersonalization; onProfilePersonalizationChange: (next: ProfilePersonalization) => Promise<void>;
  onMarkRoomRead: (roomId: string, options: { eventId: string; explicit: boolean }) => Promise<void>;
  onMarkThreadRead: (roomId: string, rootId: string, options: { eventId: string }) => Promise<void>;
  onMarkRoomUnread: (roomId: string, eventId: string) => Promise<void>;
  onSetRoomFavorite: (roomId: string, favorite: boolean) => Promise<void>;
  onResolveNavigationTarget: (target: MatrixNavigationTarget) => Promise<{ roomId: string; eventId?: string }>;
  pushRoute?: PushRoute;
}) => <main><span>{workspace.user.id}</span><span data-testid="profile-bio">{profilePersonalization.bio}</span><button onClick={() => void onProfilePersonalizationChange({ ...profilePersonalization, bio: 'Old pending update' })}>Update profile</button>
  <button onClick={() => void onMarkRoomRead('synthetic-room', { eventId: '$viewed', explicit: true })}>Read main</button>
  <button onClick={() => void onMarkThreadRead('synthetic-room', '$root', { eventId: '$reply' })}>Read thread</button>
  <button onClick={() => void onMarkRoomUnread('synthetic-room', '$return')}>Unread reminder</button>
  <button onClick={() => void onSetRoomFavorite('synthetic-room', true)}>Favorite room</button>
  <button onClick={() => void onResolveNavigationTarget({ roomAlias: '#lounge:test', eventId: '$event', via: ['test'] })}>Resolve destination</button>
  <span data-testid="incoming-route">{JSON.stringify(pushRoute)}</span>
</main> }));
import App from './App';

const ready = (userId = '@one:example.test'): MatrixControllerSnapshot => ({ status: 'ready', workspace: { ...demoWorkspace, mode: 'matrix', user: { ...demoWorkspace.user, id: userId } } });
function publish(snapshot: MatrixControllerSnapshot) { harness.snapshot = snapshot; harness.listeners.forEach((listener) => listener()); }
beforeEach(() => {
  harness.listeners.clear(); harness.snapshot = ready(); harness.remote = undefined;
  harness.update.mockReset().mockResolvedValue(undefined); harness.forget.mockReset().mockResolvedValue(undefined);
  harness.notificationPreferences.mockReset();
  harness.favorite.mockReset().mockResolvedValue(undefined);
  harness.resolveNavigation.mockReset().mockResolvedValue({ roomId: '!lounge:test', eventId: '$event' });
  window.history.replaceState({}, '', '/');
  harness.markRead.mockReset().mockResolvedValue(undefined); harness.markThreadRead.mockReset().mockResolvedValue(undefined); harness.markUnread.mockReset().mockResolvedValue(undefined);
  localStorage.clear(); sessionStorage.clear();
});

afterEach(() => { vi.restoreAllMocks(); });

describe('App account privacy', () => {
  it('uses account data and never seeds another account from the old global profile cache', async () => {
    localStorage.setItem('aimtrix.profile.v1', JSON.stringify({ ...defaultProfilePersonalization, bio: 'Legacy account profile' }));
    harness.remote = { ...defaultProfilePersonalization, bio: 'First account profile' };
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('profile-bio')).toHaveTextContent('First account profile'));
    await act(async () => { harness.remote = undefined; publish(ready('@two:example.test')); });
    expect(screen.getByTestId('profile-bio')).toHaveTextContent('');
    expect(screen.queryByText('Legacy account profile')).not.toBeInTheDocument();
    expect(screen.queryByText('First account profile')).not.toBeInTheDocument();
  });
  it('discards a profile update that completes after same-account reauthentication', async () => {
    let resolveUpdate!: () => void;
    harness.update.mockReturnValue(new Promise<void>((resolve) => { resolveUpdate = resolve; }));
    harness.remote = { ...defaultProfilePersonalization, bio: 'Original profile' };
    render(<App />);
    await screen.findByText('Original profile');
    fireEvent.click(screen.getByRole('button', { name: 'Update profile' }));
    await act(async () => publish({ status: 'reauthentication-required', recovery: { userId: '@one:example.test', homeserver: 'https://example.test', softLogout: true } }));
    expect(screen.queryByText('Original profile')).not.toBeInTheDocument();
    expect(screen.queryByText('@one:example.test')).not.toBeInTheDocument();
    await act(async () => { harness.remote = { ...defaultProfilePersonalization, bio: 'Restored profile' }; publish(ready()); });
    await act(async () => resolveUpdate());
    expect(screen.getByTestId('profile-bio')).toHaveTextContent('Restored profile');
    expect(screen.queryByText('Old pending update')).not.toBeInTheDocument();
  });
});


describe('App optional appearance storage', () => {
  it.each(['methods', 'getter'])('keeps the controller storage error reachable when storage %s are denied', async (denied) => {
    harness.snapshot = { status: 'error', issue: 'storage', canRetry: true, error: 'Encrypted storage is unavailable. Check browser permissions and try again.' };
    const reject = () => { throw new DOMException('Synthetic denied storage', 'SecurityError'); };
    if (denied === 'getter') vi.spyOn(window, 'localStorage', 'get').mockImplementation(reject);
    else {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(reject);
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(reject);
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(reject);
    }
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Encrypted storage needs attention' })).toBeVisible();
    expect(screen.getByText('Encrypted storage is unavailable. Check browser permissions and try again.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(screen.queryByTestId('profile-bio')).not.toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe(defaultRuntimeConfig.defaultTheme);
    expect(document.documentElement.dataset.accent).toBe(defaultUserPreferences.accent);
    expect(document.documentElement.dataset.density).toBe(defaultUserPreferences.density);
  });
});


describe('App receipt privacy', () => {
  it.each([true, false])('passes public-receipt preference %s to both read paths and keeps reminder event IDs', async (publicReceipt) => {
    localStorage.setItem('aimtrix.preferences.v1', JSON.stringify({ ...defaultUserPreferences, sendReadReceipts: publicReceipt }));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Read main' }));
    fireEvent.click(screen.getByRole('button', { name: 'Read thread' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unread reminder' }));
    await waitFor(() => expect(harness.notificationPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ sendReadReceipts: publicReceipt })));
    expect(harness.markRead).toHaveBeenCalledWith('synthetic-room', { eventId: '$viewed', explicit: true, publicReceipt });
    expect(harness.markThreadRead).toHaveBeenCalledWith('synthetic-room', '$root', { eventId: '$reply', publicReceipt });
    expect(harness.markUnread).toHaveBeenCalledWith('synthetic-room', '$return');
  });
});


describe('App Matrix navigation', () => {
  it('connects favorite and complete navigation targets to controller operations', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Favorite room' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resolve destination' }));
    expect(harness.favorite).toHaveBeenCalledWith('synthetic-room', true);
    expect(harness.resolveNavigation).toHaveBeenCalledWith({ roomAlias: '#lounge:test', eventId: '$event', via: ['test'] });
  });

  it('replaces stale route fields without losing application URL or history state', async () => {
    window.history.replaceState({ preserved: true }, '', '/client/?appearance=aqua&room=!old:test&event=$old');
    render(<App />);
    await screen.findByRole('button', { name: 'Resolve destination' });
    fireEvent(window, new CustomEvent('aimtrix-push-route', { detail: { roomAlias: '#lounge:test', eventId: '$event', via: ['test'] } }));
    expect(JSON.parse(screen.getByTestId('incoming-route').textContent!)).toEqual({ roomAlias: '#lounge:test', eventId: '$event', via: ['test'] });
    expect(window.location.pathname + window.location.search).toBe('/client/?appearance=aqua&alias=%23lounge%3Atest&event=%24event&via=test');
    expect(window.history.state).toEqual({ preserved: true });
    fireEvent(window, new CustomEvent('aimtrix-push-route', { detail: { userId: '@alice:test' } }));
    expect(window.location.search).toBe('?appearance=aqua&user=%40alice%3Atest');
    fireEvent(window, new CustomEvent('aimtrix-push-route', { detail: { eventId: '$event-only' } }));
    expect(window.location.search).toBe('?appearance=aqua&event=%24event-only');
    const previous = screen.getByTestId('incoming-route').textContent;
    fireEvent(window, new CustomEvent('aimtrix-push-route', { detail: { roomId: '!other:test', eventId: '' } }));
    expect(screen.getByTestId('incoming-route')).toHaveTextContent(previous!);
    expect(window.location.search).toBe('?appearance=aqua&event=%24event-only');
  });
});
