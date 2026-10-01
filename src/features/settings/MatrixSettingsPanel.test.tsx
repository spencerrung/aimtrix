import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MatrixSettingsPanel, type MatrixSettingsActions } from './MatrixSettingsPanel';
import { defaultUserPreferences } from '../../settings/preferences';
import { Dialog, DialogClose } from '../../components/Dialog';
import type { MatrixSettingsSnapshot } from '../../matrix/settingsTypes';

const snapshot: MatrixSettingsSnapshot = {
  server: { userId: '@synthetic:example.test', homeserverUrl: 'https://example.test', serverName: 'example.test', deviceId: 'LOCAL', versions: ['v1.11'], rtcFoci: [] },
  security: { encryptionReady: true, crossSigningReady: true, secretStorageReady: true, keyBackupEnabled: true },
  devices: [{ id: 'OTHER', displayName: 'Test session', current: false, verified: false }], ignoredUsers: [],
};
function setup(overrides: Partial<MatrixSettingsActions>) {
  const actions = { load: vi.fn().mockResolvedValue(snapshot), ...overrides } as unknown as MatrixSettingsActions;
  const close = vi.fn();
  render(<Dialog className="settings" aria-label="Settings" onClose={close}><DialogClose>Close settings</DialogClose><MatrixSettingsPanel preferences={defaultUserPreferences} onPreferencesChange={vi.fn()} actions={actions} /></Dialog>);
  return close;
}

it('can cancel while waiting for a verification request', async () => {
  let signal!: AbortSignal;
  setup({ verifyDevice: vi.fn().mockImplementation((_, currentSignal: AbortSignal) => new Promise((_, reject) => {
    signal = currentSignal; signal.addEventListener('abort', () => reject(new Error('cancelled')));
  })) });
  fireEvent.click(await screen.findByText('Verify'));
  expect(screen.getByText('Close settings')).toBeEnabled();
  fireEvent.click(screen.getByText('Cancel verification'));
  expect(signal.aborted).toBe(true);
  await waitFor(() => expect(screen.queryByText('Cancel verification')).not.toBeInTheDocument());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('can cancel an outstanding SAS confirmation without reporting late success', async () => {
  let complete!: () => void;
  const cancel = vi.fn(); const confirm = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
  setup({ verifyDevice: vi.fn().mockResolvedValue({ emoji: [['🌱', 'Seedling']], confirm, cancel }) });
  fireEvent.click(await screen.findByText('Verify'));
  fireEvent.click(await screen.findByText('They match'));
  expect(screen.getByText('They match')).toBeDisabled();
  fireEvent.keyDown(screen.getByText('They do not match'), { key: 'Escape' });
  expect(cancel).toHaveBeenCalled();
  expect(screen.queryByRole('dialog', { name: 'Compare verification emoji' })).not.toBeInTheDocument();
  await act(async () => complete());
  expect(screen.queryByText('Device verified.')).not.toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
});

it('keeps failed device removal open and retains password-required UIA input', async () => {
  const remove = vi.fn().mockRejectedValueOnce(new Error('synthetic denial')).mockResolvedValueOnce('password-required').mockRejectedValueOnce(new Error('synthetic UIA denial'));
  setup({ removeDevice: remove });
  fireEvent.click(await screen.findByText('Sign out'));
  fireEvent.click(screen.getByText('Sign out device'));
  await screen.findByRole('alert');
  expect(screen.getByRole('dialog', { name: 'Sign out this device?' })).toBeInTheDocument();
  fireEvent.click(screen.getByText('Sign out device'));
  const password = await screen.findByLabelText('Matrix password');
  fireEvent.change(password, { target: { value: 'synthetic-test-only' } });
  fireEvent.click(screen.getByText('Confirm sign out'));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('did not accept'));
  expect(password).toHaveValue('synthetic-test-only');
});

it('loads notification rules only when the controls are opened', async () => {
  const loadAttention = vi.fn().mockResolvedValue({ rooms: [], keywords: [], doNotDisturb: false, threadRulesSupported: false, localPolicy: { pauseUntil: 0, quietHours: { enabled: false, startMinute: 1320, endMinute: 420 } }, health: { permission: 'denied', background: 'Not configured for this installation', subscription: 'Missing', pusher: 'No matching registration' } });
  setup({ attention: { load: loadAttention, setRoom: vi.fn(), setDoNotDisturb: vi.fn(), addKeyword: vi.fn(), removeKeyword: vi.fn(), setLocalPolicy: vi.fn(), testNotification: vi.fn() } });
  const button = await screen.findByRole('button', { name: 'Notification rules and delivery' });
  expect(loadAttention).not.toHaveBeenCalled();
  fireEvent.click(button);
  await screen.findByText('Join a room to set its notification rules.');
  expect(loadAttention).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Test local notification' })).toBeDisabled();
});

it('gives SSO users a supported recovery path when setup needs unsupported authorization', async () => {
  setup({
    load: vi.fn().mockResolvedValue({ ...snapshot, security: { ...snapshot.security, secretStorageConfigured: false, keyBackupEnabled: false } }),
    setupRecovery: vi.fn().mockRejectedValue(new Error('This homeserver requires interactive authentication that Aimtrix cannot complete here.')),
  });
  fireEvent.change(await screen.findByLabelText('New recovery passphrase'), { target: { value: 'synthetic passphrase only' } });
  fireEvent.click(screen.getByRole('button', { name: 'Set up new recovery' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('trusted Matrix client');
  expect(screen.getByLabelText('New recovery passphrase')).toHaveValue('synthetic passphrase only');
});

it('keeps recovery-reset failure visible after refreshing account health', async () => {
  const load = vi.fn().mockResolvedValue(snapshot);
  setup({ load, resetRecovery: vi.fn().mockRejectedValue(new Error('synthetic network failure')) });
  fireEvent.change(await screen.findByLabelText('New recovery passphrase'), { target: { value: 'synthetic passphrase only' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset recovery and backup' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Reset encryption recovery?' })).getByRole('button', { name: 'Reset recovery and backup' }));
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole('alert')).toHaveTextContent('previous backup may already have changed');
});
