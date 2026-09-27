import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { demoWorkspace } from '../../demo/demoWorkspace';
import { HistorySearchPanel, type PrivateSearchActions } from './HistorySearchPanel';

const room = { ...demoWorkspace.rooms[0], id: '!private:test', encrypted: true, membership: 'join' as const };
const indexed = { roomId: room.id, indexed: 1, skipped: 2, complete: false, oldest: 1000, newest: 2000 };
const result = { roomId: room.id, eventId: '$old', senderId: '@friend:test', body: 'synthetic nebula', timestamp: 1000, kind: 'message' as const };

describe('private history search controls', () => {
  it('unlocks, indexes with coverage, searches local results, and confirms deletion', async () => {
    const actions: PrivateSearchActions = {
      status: vi.fn().mockResolvedValue({ unlocked: false, rooms: [], total: 0 }),
      unlock: vi.fn().mockResolvedValue({ unlocked: true, rooms: [], total: 0 }),
      index: vi.fn().mockImplementation(async (_roomId, progress) => { progress(indexed); return { unlocked: true, rooms: [indexed], total: 1 }; }),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const onSearch = vi.fn().mockResolvedValue({ hits: [], privateHits: [result], searchedRoomIds: [] });
    const onOpen = vi.fn().mockResolvedValue(undefined);
    render(<HistorySearchPanel open rooms={[room]} loadedMessages={[]} initialRoomId={room.id} onSearch={onSearch} privateSearch={actions} onOpen={onOpen} onClose={() => undefined} />);
    const panel = screen.getByRole('complementary', { name: 'Message search' });
    fireEvent.click(within(panel).getByText('Encrypted history on this device'));
    fireEvent.change(within(panel).getByLabelText('Local index passphrase'), { target: { value: 'a long local passphrase' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Create or unlock index' }));
    await waitFor(() => expect(actions.unlock).toHaveBeenCalledWith('a long local passphrase'));
    fireEvent.click(await within(panel).findByRole('button', { name: 'Index up to 1,000 older messages' }));
    await waitFor(() => expect(within(panel).getByText(/2 skipped without keys/)).toBeVisible());
    fireEvent.change(within(panel).getByLabelText('Search words'), { target: { value: 'nebula' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Search history' }));
    await within(panel).findByText('synthetic nebula');
    fireEvent.click(within(panel).getByRole('button', { name: /synthetic nebula/ }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(room.id, result.eventId));
    fireEvent.click(within(panel).getByRole('button', { name: 'Delete local index' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete private search index?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete local index' }));
    await waitFor(() => expect(actions.clear).toHaveBeenCalledOnce());
  });

  it('aborts indexing when the panel closes', async () => {
    let aborted = false;
    const actions: PrivateSearchActions = {
      status: vi.fn().mockResolvedValue({ unlocked: true, rooms: [], total: 0 }),
      unlock: vi.fn(), clear: vi.fn(),
      index: vi.fn().mockImplementation((_roomId, _progress, signal: AbortSignal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
      })),
    };
    const { rerender } = render(<HistorySearchPanel open rooms={[room]} loadedMessages={[]} initialRoomId={room.id} privateSearch={actions} onOpen={vi.fn()} onClose={() => undefined} />);
    const panel = screen.getByRole('complementary', { name: 'Message search' });
    fireEvent.click(within(panel).getByText('Encrypted history on this device'));
    fireEvent.click(await within(panel).findByRole('button', { name: 'Index up to 1,000 older messages' }));
    rerender(<HistorySearchPanel open={false} rooms={[room]} loadedMessages={[]} initialRoomId={room.id} privateSearch={actions} onOpen={vi.fn()} onClose={() => undefined} />);
    await waitFor(() => expect(aborted).toBe(true));
  });
});
