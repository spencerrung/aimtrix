import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageSummary } from '../../matrix/viewModels';
import { MessageActions } from './MessageActions';

const message: MessageSummary = { id: '$synthetic', roomId: '!synthetic:test', senderId: '@synthetic:test', senderName: 'Synthetic', body: 'Copy this synthetic text', kind: 'text', isOwn: true, timestamp: 1 };
const enabled = { reply: true, thread: true, react: true, pin: true, edit: true, redact: true };
beforeEach(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } }); });
const openMenu = () => { fireEvent.click(screen.getByRole('button', { name: 'More message actions' })); return screen.getByRole('menu', { name: 'Message actions' }); };

describe('shared message actions', () => {
  it('copies plaintext and a standard encoded permalink from a keyboard menu', async () => {
    render(<MessageActions message={message} />);
    let menu = openMenu();
    const copy = within(menu).getByRole('menuitem', { name: 'Copy text' });
    expect(copy).toHaveFocus();
    fireEvent.click(copy);
    await screen.findByText('Message text copied.');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(message.body);
    expect(screen.getByRole('button', { name: 'More message actions' })).toHaveFocus();
    menu = openMenu();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(within(menu).getByRole('menuitem', { name: 'Copy message link' })).toHaveFocus();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Copy message link' }));
    await screen.findByText('Message link copied.');
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('https://matrix.to/#/!synthetic%3Atest/%24synthetic');
  });

  it('reports denied clipboard access without reporting success', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('Sensitive synthetic failure detail'));
    render(<MessageActions message={message} />);
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Copy text' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Copy text failed. Try again.');
    expect(screen.queryByText(/Sensitive synthetic/)).not.toBeInTheDocument();
  });

  it('uses actual permissions rather than legacy ownership and pin heuristics', () => {
    const action = vi.fn();
    render(<MessageActions message={{ ...message, isOwn: false, kind: 'media', actions: { ...enabled, pin: false, edit: false, react: false } }} canPin onReply={action} onStartThread={action} onPin={action} onEdit={action} onDelete={action} onOpenReaction={action} />);
    expect(screen.getByRole('button', { name: 'Delete message' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Pin message' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit message' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add reaction' })).not.toBeInTheDocument();
    expect(within(openMenu()).queryByRole('menuitem', { name: 'Pin message' })).not.toBeInTheDocument();
  });

  it('retains quick reply/edit semantics and avoids nested thread controls on a root card', () => {
    const reply = vi.fn(), edit = vi.fn();
    render(<MessageActions message={{ ...message, actions: enabled, isThreadRoot: true }} hideThreadControls onReply={reply} onEdit={edit} onOpenThread={vi.fn()} onStartThread={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(reply).toHaveBeenCalledWith(expect.objectContaining(message));
    expect(screen.queryByRole('button', { name: 'Reply in thread' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open thread' })).not.toBeInTheDocument();
  });

  it('prevents duplicate asynchronous mutation and keeps failures next to the active message', async () => {
    let reject!: (error: Error) => void;
    const pin = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    render(<MessageActions message={{ ...message, actions: enabled }} onPin={pin} />);
    const button = screen.getByRole('button', { name: 'Pin message' });
    button.focus();
    fireEvent.click(button); fireEvent.click(button);
    expect(pin).toHaveBeenCalledTimes(1);
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await act(async () => reject(new Error('Untrusted homeserver text')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pin message failed. Try again.');
    expect(screen.queryByText(/Untrusted homeserver/)).not.toBeInTheDocument();
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'false'));
  });

  it('keeps confirmation ownership in the parent and exposes mark unread only with backing callback', async () => {
    const redact = vi.fn(), unread = vi.fn().mockResolvedValue(undefined);
    render(<MessageActions message={message} onDelete={redact} onMarkUnread={unread} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete message' }));
    expect(redact).toHaveBeenCalledWith(message);
    await waitFor(() => expect(screen.getByRole('button', { name: 'More message actions' })).toHaveAttribute('aria-disabled', 'false'));
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Mark unread' }));
    await screen.findByText('Conversation marked unread.');
    expect(unread).toHaveBeenCalledWith(message);
  });

  it('hides accepted-only controls for pending sends and avoids fake demo permalinks', () => {
    const { rerender } = render(<MessageActions message={{ ...message, delivery: 'failed' }} onReply={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<MessageActions message={{ ...message, roomId: 'demo', id: 'demo-message' }} />);
    expect(within(openMenu()).queryByRole('menuitem', { name: 'Copy message link' })).not.toBeInTheDocument();
  });
});
