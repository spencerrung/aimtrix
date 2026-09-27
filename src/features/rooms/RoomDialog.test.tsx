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
