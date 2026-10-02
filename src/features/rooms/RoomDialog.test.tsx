import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RoomDialog } from './RoomDialog';

it('preserves failed room input, announces errors and prevents duplicate pending submissions', async () => {
  let reject!: (error: Error) => void;
  const join = vi.fn().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
  const close = vi.fn(); render(<RoomDialog onJoin={join} onClose={close} />);
  const address = screen.getByRole('textbox');
  fireEvent.change(address, { target: { value: '#synthetic:example.test' } });
  const submit = screen.getAllByText('Join room').at(-1)!;
  fireEvent.click(submit); fireEvent.click(submit);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(join).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
  await act(async () => reject(new Error('synthetic failure')));
  expect(address).toHaveValue('#synthetic:example.test'); expect(screen.getByRole('alert')).toHaveTextContent('could not join');
  fireEvent.click(submit); await waitFor(() => expect(close).toHaveBeenCalledOnce());
});

it('announces an empty public directory search', async () => {
  render(<RoomDialog onSearch={vi.fn().mockResolvedValue([])} onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'synthetic' } });
  fireEvent.click(screen.getByText('Search public rooms'));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No public rooms found'));
});

it.each(['knock', 'knock_restricted'])('requests entry to a %s directory room instead of attempting a join', async (joinRule) => {
  const join = vi.fn();
  const knock = vi.fn().mockResolvedValue(undefined);
  const complete = vi.fn();
  render(<RoomDialog onJoin={join} onKnock={knock} onSearch={vi.fn().mockResolvedValue([
    { roomId: '!knock:example.test', name: 'Welcome', memberCount: 3, joinRule },
  ])} onComplete={complete} onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Welcome' } });
  fireEvent.click(screen.getByText('Search public rooms'));
  fireEvent.click(await screen.findByRole('button', { name: /Welcome/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Request to join' }));
  await waitFor(() => expect(knock).toHaveBeenCalledWith('!knock:example.test'));
  expect(join).not.toHaveBeenCalled();
  expect(complete).toHaveBeenCalledWith(expect.stringContaining('Join request sent'));
});

it('opens the newly created direct conversation after the dialog closes', async () => {
  const create = vi.fn().mockResolvedValue('!new-direct:example.test');
  const close = vi.fn();
  const opened = vi.fn();
  render(<RoomDialog initialMode="direct" onCreateDirect={create} onClose={close} onConversationCreated={opened} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Matrix ID' }), { target: { value: '@friend:example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start direct chat' }));
  await waitFor(() => expect(opened).toHaveBeenCalledWith('!new-direct:example.test'));
  expect(create).toHaveBeenCalledOnce();
  expect(close.mock.invocationCallOrder[0]).toBeLessThan(opened.mock.invocationCallOrder[0]);
});

it('opens a new room conversation but does not treat a new space as a conversation', async () => {
  const create = vi.fn().mockResolvedValue('!new:example.test');
  const opened = vi.fn();
  const { unmount } = render(<RoomDialog initialMode="create" onCreate={create} onClose={vi.fn()} onConversationCreated={opened} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Room name' }), { target: { value: 'Synthetic lounge' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Create room' }).at(-1)!);
  await waitFor(() => expect(opened).toHaveBeenCalledWith('!new:example.test'));
  unmount(); opened.mockClear();
  render(<RoomDialog initialMode="create" onCreate={create} onClose={vi.fn()} onConversationCreated={opened} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Room name' }), { target: { value: 'Synthetic space' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Create a space for organizing rooms' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Create room' }).at(-1)!);
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(opened).not.toHaveBeenCalled();
});
