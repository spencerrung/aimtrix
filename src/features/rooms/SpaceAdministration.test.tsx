import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { RoomSummary, SpaceSummary, WorkspaceSnapshot } from '../../matrix/viewModels';
import { SpaceAdministration } from './SpaceAdministration';

it('adds a recommended child and confirms explicit removal', async () => {
  const space = {
    id: '!space:example.test', name: 'Community', kind: 'matrix', membership: 'join',
    canManage: true, childIds: ['!existing:example.test'], suggestedChildIds: [], parentSpaceIds: [],
  } as unknown as SpaceSummary;
  const workspace = {
    rooms: [
      { id: '!existing:example.test', name: 'Existing', membership: 'join' },
      { id: '!new:example.test', name: 'Newcomers', membership: 'join' },
    ] as RoomSummary[],
    spaces: [space], spaceRoomPreviews: {},
  } as WorkspaceSnapshot;
  const addChild = vi.fn().mockResolvedValue(undefined);
  const removeChild = vi.fn().mockResolvedValue(undefined);
  render(<SpaceAdministration space={space} workspace={workspace} actions={{
    addChild, removeChild, setSuggested: vi.fn(), setCanonicalParent: vi.fn(),
  }} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Newcomers' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Recommend to new members' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add to space' }));
  await waitFor(() => expect(addChild).toHaveBeenCalledWith('!space:example.test', '!new:example.test', true));
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(removeChild).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove from space' }));
  await waitFor(() => expect(removeChild).toHaveBeenCalledWith('!space:example.test', '!existing:example.test'));
});
