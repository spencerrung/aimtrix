import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
