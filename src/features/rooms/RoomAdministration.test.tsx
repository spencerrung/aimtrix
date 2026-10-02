import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { RoomSummary } from '../../matrix/viewModels';
import type { RoomAdministrationActions, RoomAdministrationState } from '../../matrix/roomAdministration';
import { RoomAdministration } from './RoomAdministration';

const room = {
  id: '!room:example.test', name: 'Welcome',
  access: {
    joinRule: 'invite', historyVisibility: 'shared', guestAccess: 'forbidden',
    canChangeJoinRule: true, canChangeHistoryVisibility: false, canChangeGuestAccess: false,
    canChangeCanonicalAlias: true, canChangeServerAcl: false, canUpgrade: true,
  },
} as RoomSummary;

it('confirms an access change and refreshes the setting from the homeserver', async () => {
  let joinRule = 'invite';
  const state = (): RoomAdministrationState => ({
    localServerName: 'example.test', access: { joinRule, historyVisibility: 'shared', guestAccess: 'forbidden' },
    localAliases: [], aliasesAvailable: true, directoryVisibility: 'private', directoryAvailable: true,
    serverAcl: { allow: ['*'], deny: [], allowIpLiterals: true }, roomVersion: '10',
  });
  const load = vi.fn().mockImplementation(async () => state());
  const setAccess = vi.fn().mockImplementation(async () => { joinRule = 'knock'; });
  const actions = { load, setAccess } as unknown as RoomAdministrationActions;
  render(<RoomAdministration room={room} actions={actions} onOpenReplacement={vi.fn()} />);
  const rule = await screen.findByRole('combobox', { name: 'Who may join' });
  fireEvent.change(rule, { target: { value: 'knock' } });
  expect(setAccess).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save join rule' }));
  await waitFor(() => expect(setAccess).toHaveBeenCalledWith('!room:example.test', 'joinRule', 'knock'));
  await waitFor(() => expect(rule).toHaveValue('knock'));
  expect(load).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('combobox', { name: 'Who may see history' })).toBeDisabled();
});

it('retries a partial directory read without losing the room settings', async () => {
  const state = (available: boolean): RoomAdministrationState => ({
    localServerName: 'example.test', access: { joinRule: 'invite', historyVisibility: 'shared', guestAccess: 'forbidden' },
    localAliases: [], aliasesAvailable: true, directoryVisibility: 'private', directoryAvailable: available,
    serverAcl: { allow: ['*'], deny: [], allowIpLiterals: true }, roomVersion: '10',
  });
  const load = vi.fn().mockResolvedValueOnce(state(false)).mockResolvedValue(state(true));
  render(<RoomAdministration room={room} actions={{ load } as unknown as RoomAdministrationActions} onOpenReplacement={vi.fn()} />);

  expect(await screen.findByText('Directory visibility could not be read from the homeserver.')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Public directory' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry room administration state' }));
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Public directory' })).toBeEnabled());
  expect(load).toHaveBeenCalledTimes(2);
});
