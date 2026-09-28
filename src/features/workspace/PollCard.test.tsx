import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { MessageSummary } from '../../matrix/viewModels';
import { PollCard } from './PollCard';
import { PollActionsContext } from './pollContext';

it('loads results, votes, refreshes, and confirms ending a poll', async () => {
  const message = { id: '$poll', roomId: '!room:test', isOwn: true, kind: 'poll',
    poll: { question: 'Lunch?', answers: [{ id: 'a', text: 'Soup' }, { id: 'b', text: 'Salad' }], disclosed: true, maxSelections: 1 },
  } as MessageSummary;
  let ownAnswers: string[] = [];
  let closed = false;
  const load = vi.fn().mockImplementation(async () => ({ definition: message.poll, results: {
    counts: { a: ownAnswers.length ? 1 : 0, b: 0 }, totalVotes: ownAnswers.length, ownAnswers, closed, incomplete: false,
  }, canEnd: true }));
  const vote = vi.fn().mockImplementation(async () => { ownAnswers = ['a']; });
  const end = vi.fn().mockImplementation(async () => { closed = true; });
  render(<PollActionsContext.Provider value={{ load, vote, end }}><PollCard message={message} /></PollActionsContext.Provider>);
  fireEvent.click(await screen.findByRole('button', { name: /Soup/ }));
  await waitFor(() => expect(vote).toHaveBeenCalledWith('!room:test', '$poll', ['a']));
  await waitFor(() => expect(screen.getByRole('button', { name: /Soup/ })).toHaveAttribute('aria-pressed', 'true'));
  fireEvent.click(screen.getByRole('button', { name: 'End poll' }));
  expect(end).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole('button', { name: 'End poll' }).at(-1)!);
  await waitFor(() => expect(end).toHaveBeenCalledWith('!room:test', '$poll'));
  await waitFor(() => expect(screen.getByText('Poll ended')).toBeVisible());
});

it('lets members select and submit multiple answers on interoperable polls', async () => {
  const message = { id: '$multi', roomId: '!room:test', kind: 'poll',
    poll: { question: 'Lunch?', answers: [{ id: 'a', text: 'Soup' }, { id: 'b', text: 'Salad' }], disclosed: true, maxSelections: 2 },
  } as MessageSummary;
  const load = vi.fn().mockResolvedValue({ definition: message.poll, canEnd: false, results: {
    counts: { a: 0, b: 0 }, totalVotes: 0, ownAnswers: [], closed: false, incomplete: false,
  } });
  const vote = vi.fn().mockResolvedValue(undefined);
  render(<PollActionsContext.Provider value={{ load, vote, end: vi.fn() }}><PollCard message={message} /></PollActionsContext.Provider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Soup' }));
  fireEvent.click(screen.getByRole('button', { name: /Salad/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Save vote' }));
  await waitFor(() => expect(vote).toHaveBeenCalledWith('!room:test', '$multi', ['a', 'b']));
  expect(screen.queryByRole('button', { name: 'End poll' })).not.toBeInTheDocument();
});
