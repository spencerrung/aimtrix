import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AttentionSettings, type AttentionSettingsActions, type AttentionSettingsSnapshot } from './AttentionSettings';
const snapshot: AttentionSettingsSnapshot = {
  rooms: [{ id: '!synthetic:example.test', name: 'Study group', mode: 'mentions' }, { id: '!custom:example.test', name: 'Custom room', mode: 'custom' }],
  keywords: [{ id: 'other-client', pattern: 'old*', enabled: true, editable: false }], doNotDisturb: false, threadRulesSupported: true,
  localPolicy: { pauseUntil: 0, quietHours: { enabled: false, startMinute: 1320, endMinute: 420 } },
  health: { permission: 'granted', background: 'Configured; delivery not verified', subscription: 'Present', pusher: 'Registered on homeserver' },
};
function actions(overrides: Partial<AttentionSettingsActions> = {}): AttentionSettingsActions {
  return { load: vi.fn().mockResolvedValue(snapshot), setRoom: vi.fn().mockResolvedValue(undefined), setDoNotDisturb: vi.fn().mockResolvedValue(undefined), addKeyword: vi.fn().mockResolvedValue(undefined), removeKeyword: vi.fn().mockResolvedValue(undefined), setLocalPolicy: vi.fn().mockResolvedValue(undefined), testNotification: vi.fn().mockResolvedValue(undefined), ...overrides };
}
it('reads server room modes, preserves custom rules, and refreshes rejected writes', async () => {
  const api = actions({ setRoom: vi.fn().mockRejectedValue(new Error('private server detail')) });
  render(<AttentionSettings actions={api} />);
  const mode = await screen.findByLabelText('Notifications for Study group');
  expect(mode).toHaveValue('mentions');
  expect(screen.getByLabelText('Notifications for Custom room')).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Remove keyword old*' })).not.toBeInTheDocument();
  fireEvent.change(mode, { target: { value: 'nothing' } });
  await screen.findByRole('alert');
  expect(api.setRoom).toHaveBeenCalledWith('!synthetic:example.test', 'nothing');
  expect(api.load).toHaveBeenCalledTimes(2);
  expect(mode).toHaveValue('mentions');
  expect(screen.queryByText('private server detail')).not.toBeInTheDocument();
});
it('keeps account DND distinct from saved local quiet hours', async () => {
  const api = actions(); render(<AttentionSettings actions={api} />);
  fireEvent.click(await screen.findByLabelText(/Do not disturb across devices/));
  await screen.findByText('Account notification rule saved.');
  expect(api.setDoNotDisturb).toHaveBeenCalledWith(true);
  expect(api.setLocalPolicy).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText(/Daily quiet hours/));
  fireEvent.change(screen.getByLabelText('Quiet hours start'), { target: { value: '23:30' } });
  expect(api.setLocalPolicy).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Save quiet hours'));
  await screen.findByText('Quiet hours saved on this device.');
  expect(api.setLocalPolicy).toHaveBeenCalledWith({ pauseUntil: 0, quietHours: { enabled: true, startMinute: 1410, endMinute: 420 } });
});
it('retries initial load failure and tests local delivery without claiming gateway success', async () => {
  const api = actions({ load: vi.fn().mockRejectedValueOnce(new Error('failure')).mockResolvedValue(snapshot) });
  render(<AttentionSettings actions={api} />);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByText('Refresh notification settings'));
  fireEvent.click(await screen.findByText('Test local notification'));
  await screen.findByText(/Local test requested/);
  expect(api.testNotification).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Configured; delivery not verified')).toBeInTheDocument();
});
it('ignores a settings response after changing the active actions', async () => {
  let resolve!: (snapshot: AttentionSettingsSnapshot) => void;
  const old = actions({ load: vi.fn(() => new Promise<AttentionSettingsSnapshot>((done) => { resolve = done; })) });
  const view = render(<AttentionSettings actions={old} />);
  const next = actions({ load: vi.fn().mockResolvedValue({ ...snapshot, rooms: [] }) });
  view.rerender(<AttentionSettings actions={next} />);
  await screen.findByText('Join a room to set its notification rules.');
  await act(async () => resolve(snapshot));
  expect(screen.queryByLabelText('Notifications for Study group')).not.toBeInTheDocument();
});
it('retains keyword input after rejection, clears it only after successful save', async () => {
  const api = actions({ addKeyword: vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined) });
  render(<AttentionSettings actions={api} />);
  const input = await screen.findByLabelText('New keyword pattern');
  fireEvent.change(input, { target: { value: 'release*' } });
  fireEvent.click(screen.getByText('Add keyword'));
  await screen.findByRole('alert');
  expect(input).toHaveValue('release*');
  fireEvent.click(screen.getByText('Add keyword'));
  await waitFor(() => expect(input).toHaveValue(''));
  expect(api.addKeyword).toHaveBeenLastCalledWith('release*');
});
