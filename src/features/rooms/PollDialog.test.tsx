import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PollDialog } from './PollDialog';

it('validates answers and sends only after an explicit previewed submit', async () => {
  const send = vi.fn().mockResolvedValue(undefined);
  render(<PollDialog roomName="Welcome" onSend={send} onClose={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Create poll' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'Lunch?' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Answer 1' }), { target: { value: 'Soup' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Answer 2' }), { target: { value: 'Salad' } });
  expect(screen.getByText('Live results visible')).toBeVisible();
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Create poll' }));
  await waitFor(() => expect(send).toHaveBeenCalledWith('Lunch?', ['Soup', 'Salad'], true));
});
