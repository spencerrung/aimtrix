import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { demoWorkspace } from './demo/demoWorkspace';
import { defaultProfilePersonalization, type ProfilePersonalization } from './settings/profilePersonalization';
import type { MatrixControllerSnapshot } from './matrix/MatrixController';

const harness = vi.hoisted(() => ({
  snapshot: {} as MatrixControllerSnapshot,
  listeners: new Set<() => void>(),
  remote: undefined as ProfilePersonalization | undefined,
  update: vi.fn<() => Promise<void>>(),
  forget: vi.fn<() => Promise<void>>(),
}));
vi.mock('./matrix/MatrixController', () => ({ MatrixController: class {
  constructor() { return new Proxy(this, { get: (target, key) => Reflect.get(target, key) ?? (() => undefined) }); }
  subscribe = (listener: () => void) => { harness.listeners.add(listener); return () => harness.listeners.delete(listener); };
  getSnapshot = () => harness.snapshot;
  loadProfilePersonalization = () => harness.remote;
  updateProfilePersonalization = () => harness.update();
  forgetSession = () => harness.forget();
} }));
vi.mock('./config/runtimeConfig', async (original) => {
  const actual = await original<typeof import('./config/runtimeConfig')>();
  return { ...actual, loadRuntimeConfig: async () => ({ config: actual.defaultRuntimeConfig, warnings: [] }) };
});
vi.mock('./features/workspace/Workspace', () => ({ Workspace: ({ workspace, profilePersonalization, onProfilePersonalizationChange }: {
  workspace: typeof demoWorkspace; profilePersonalization: ProfilePersonalization; onProfilePersonalizationChange: (next: ProfilePersonalization) => Promise<void>;
}) => <main><span>{workspace.user.id}</span><span data-testid="profile-bio">{profilePersonalization.bio}</span><button onClick={() => void onProfilePersonalizationChange({ ...profilePersonalization, bio: 'Old pending update' })}>Update profile</button></main> }));
import App from './App';

const ready = (userId = '@one:example.test'): MatrixControllerSnapshot => ({ status: 'ready', workspace: { ...demoWorkspace, mode: 'matrix', user: { ...demoWorkspace.user, id: userId } } });
function publish(snapshot: MatrixControllerSnapshot) { harness.snapshot = snapshot; harness.listeners.forEach((listener) => listener()); }
beforeEach(() => {
  harness.listeners.clear(); harness.snapshot = ready(); harness.remote = undefined;
  harness.update.mockReset().mockResolvedValue(undefined); harness.forget.mockReset().mockResolvedValue(undefined);
  localStorage.clear(); sessionStorage.clear();
});

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
