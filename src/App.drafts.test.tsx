import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixControllerSnapshot } from './matrix/MatrixController';
import { demoWorkspace } from './demo/demoWorkspace';
import { StructuredDraftStore, draftStorageKey, type DraftScope, type DraftSession, type DraftStateSummary } from './features/workspace/structuredDrafts';

const harness = vi.hoisted(() => ({ snapshot: {} as MatrixControllerSnapshot, scope: undefined as DraftScope | undefined, listeners: new Set<() => void>(), session: undefined as DraftSession | undefined, signOut: undefined as (() => void) | undefined, report: undefined as ((state: DraftStateSummary) => void) | undefined, logout: vi.fn() }));
vi.mock('./matrix/MatrixController', () => ({ MatrixController: class {
  constructor() { return new Proxy(this, { get: (target, key) => Reflect.get(target, key) ?? (() => undefined) }); }
  getSnapshot = () => harness.snapshot;
  getDraftScope = () => harness.scope;
  subscribe = (callback: () => void) => { harness.listeners.add(callback); return () => harness.listeners.delete(callback); };
  logout = () => harness.logout();
} }));
vi.mock('./config/runtimeConfig', async (original) => { const actual = await original<typeof import('./config/runtimeConfig')>(); return { ...actual, loadRuntimeConfig: async () => ({ config: actual.defaultRuntimeConfig, warnings: [] }) }; });
vi.mock('./features/workspace/Workspace', () => ({ Workspace: ({ structuredDraftStore, draftScope, onSignOut, onDraftStateChange }: { structuredDraftStore?: StructuredDraftStore; draftScope?: DraftScope; onSignOut: () => void; onDraftStateChange: (state: DraftStateSummary) => void }) => {
  harness.signOut = onSignOut;
  harness.report = onDraftStateChange;
  const [session] = useState(() => draftScope ? structuredDraftStore?.open(draftScope) : undefined);
  harness.session = session;
  return <main>Draft workspace</main>;
} }));
import App from './App';

const scope = { userId: '@synthetic:example.test', homeserver: 'https://matrix.example.test' };
const context = { roomId: '!synthetic:example.test' };
const ready = (): MatrixControllerSnapshot => ({ status: 'ready', workspace: { ...demoWorkspace, mode: 'matrix', user: { ...demoWorkspace.user, id: scope.userId } } });
function publish(snapshot: MatrixControllerSnapshot) { harness.snapshot = snapshot; harness.listeners.forEach((listener) => listener()); }
beforeEach(() => { localStorage.clear(); harness.listeners.clear(); harness.snapshot = ready(); harness.scope = scope; harness.session = undefined; harness.signOut = undefined; harness.logout.mockReset().mockResolvedValue(undefined); window.history.replaceState({}, '', '/'); });

describe('App draft lifecycle', () => {
  it('suspends old callbacks on expiry and restores durable composition after same-account recovery', async () => {
    render(<App />); await screen.findByText('Draft workspace');
    const before = harness.session!;
    before.write(context, { body: 'Synthetic private draft' }, undefined);
    await act(async () => publish({ status: 'reauthentication-required', recovery: { ...scope, softLogout: true } }));
    expect(before.isActive()).toBe(false);
    expect(localStorage.getItem(draftStorageKey(scope))).toContain('Synthetic private draft');
    await act(async () => publish(ready()));
    expect(harness.session?.read(context)?.value.body).toBe('Synthetic private draft');
    expect(before.write(context, { body: 'Stale callback' }, undefined)).toMatchObject({ ok: false, reason: 'stale-session' });
  });

  it('deletes account drafts and revokes callbacks before waiting for logout', async () => {
    harness.logout.mockReturnValue(new Promise(() => undefined));
    render(<App />); await screen.findByText('Draft workspace');
    const session = harness.session!; session.write(context, { body: 'Synthetic private draft' }, undefined);
    act(() => harness.signOut?.());
    expect(harness.logout).toHaveBeenCalledOnce();
    expect(session.isActive()).toBe(false);
    expect(localStorage.getItem(draftStorageKey(scope))).toBeNull();
  });

  it('does not delete dormant account drafts on an initial signed-out screen', async () => {
    const stored = new StructuredDraftStore().open(scope); stored.write(context, { body: 'Dormant draft' }, undefined);
    harness.scope = undefined; harness.snapshot = { status: 'signed-out' };
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument());
    expect(localStorage.getItem(draftStorageKey(scope))).toContain('Dormant draft');
  });

  it('reports a denied deletion after logout instead of claiming local drafts were removed', async () => {
    render(<App />); await screen.findByText('Draft workspace');
    harness.session!.write(context, { body: 'Synthetic private draft' }, undefined);
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Synthetic denied removal'); });
    act(() => harness.signOut?.());
    await act(async () => { harness.scope = undefined; publish({ status: 'signed-out' }); });
    expect(screen.getByRole('alert')).toHaveTextContent('could not remove saved drafts');
    remove.mockRestore();
  });
});


describe('App update draft protection', () => {
  async function readyUpdate(state: DraftStateSummary) {
    render(<App />); await screen.findByText('Draft workspace');
    const postMessage = vi.fn();
    act(() => { harness.report?.(state); window.dispatchEvent(new CustomEvent('aimtrix-update-ready', { detail: { postMessage } })); });
    return postMessage;
  }
  it('requires explicit confirmation for saved drafts and attachment reattachment', async () => {
    const post = await readyUpdate({ hasDrafts: true, volatile: false, hasAttachments: true, sending: false });
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    const dialog = screen.getByRole('dialog', { name: 'Reload Aimtrix?' });
    expect(dialog).toHaveTextContent('Drafts saved on this device will return');
    expect(dialog).toHaveTextContent('Reattach files');
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reload now' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('SKIP_WAITING'));
  });
  it('warns about volatile changes and blocks reload while any send is pending', async () => {
    const post = await readyUpdate({ hasDrafts: true, volatile: true, hasAttachments: false, sending: true });
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
    act(() => harness.report?.({ hasDrafts: true, volatile: true, hasAttachments: false, sending: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Reloading will lose unsaved changes');
    act(() => harness.report?.({ hasDrafts: true, volatile: true, hasAttachments: false, sending: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Reload now' }));
    await screen.findByRole('alert');
    expect(post).not.toHaveBeenCalled();
  });
});
