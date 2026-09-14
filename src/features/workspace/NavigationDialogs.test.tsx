import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavigationDialogs } from './NavigationDialogs';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function enter(value: string) {
  const input = screen.getByRole('textbox', { name: 'Matrix link' });
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Open link' }));
  return input;
}

afterEach(() => vi.restoreAllMocks());

describe('open Matrix link dialog', () => {
  it('focuses the labeled input and rejects malformed event tails without navigation', () => {
    const open = vi.fn();
    const close = vi.fn();
    render(<NavigationDialogs kind="link" onOpenLink={open} onClose={close} />);
    expect(screen.getByRole('dialog', { name: 'Open Matrix link' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Matrix link' })).toHaveFocus();
    const input = enter('https://matrix.to/#/!synthetic:test/not-an-event');
    expect(open).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a complete');
    expect(input).toHaveValue('https://matrix.to/#/!synthetic:test/not-an-event');
  });

  it('prevents duplicate submissions and dismissal while pending, then closes only on success', async () => {
    const held = deferred();
    const open = vi.fn().mockReturnValue(held.promise);
    const close = vi.fn();
    render(<NavigationDialogs kind="link" onOpenLink={open} onClose={close} />);
    const input = enter('matrix:roomid/synthetic:test/e/event');
    fireEvent.click(screen.getByRole('button', { name: 'Open link' }));
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(open).toHaveBeenCalledExactlyOnceWith('matrix:roomid/synthetic:test/e/event');
    expect(close).not.toHaveBeenCalled();
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('readonly');
    expect(screen.getByRole('status')).toHaveTextContent('Opening conversation');
    await act(async () => held.resolve());
    expect(close).toHaveBeenCalledOnce();
  });

  it('preserves failed links, hides raw server errors, and lets the user retry', async () => {
    const open = vi.fn().mockRejectedValueOnce(new Error('Synthetic confidential server payload')).mockResolvedValue(undefined);
    const close = vi.fn();
    render(<NavigationDialogs kind="link" onOpenLink={open} onClose={close} />);
    const input = enter('https://matrix.to/#/!synthetic:test/$event');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Check that you have joined'));
    expect(input).toHaveValue('https://matrix.to/#/!synthetic:test/$event');
    expect(screen.queryByText(/confidential/)).not.toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open link' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('requires a separate explicit action before creating a DM and retains a failed start for retry', async () => {
    const open = vi.fn().mockRejectedValue(new Error('No joined conversation'));
    const start = vi.fn().mockRejectedValueOnce(new Error('Synthetic failure')).mockResolvedValue(undefined);
    const close = vi.fn();
    render(<NavigationDialogs kind="link" onOpenLink={open} onStartConversation={start} onClose={close} />);
    const input = enter('matrix:u/other:test?action=chat');
    await screen.findByRole('button', { name: 'Start conversation' });
    expect(start).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be started'));
    expect(input).toHaveValue('matrix:u/other:test?action=chat');
    fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(start).toHaveBeenNthCalledWith(1, '@other:test');
    expect(start).toHaveBeenNthCalledWith(2, '@other:test');
  });

  it('removes a previous user start action when the link changes', async () => {
    const start = vi.fn();
    render(<NavigationDialogs kind="link" onOpenLink={vi.fn().mockRejectedValue(new Error('Synthetic failure'))} onStartConversation={start} onClose={vi.fn()} />);
    const input = enter('matrix:u/other:test');
    await screen.findByRole('button', { name: 'Start conversation' });
    fireEvent.change(input, { target: { value: 'matrix:roomid/synthetic:test' } });
    expect(screen.queryByRole('button', { name: 'Start conversation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
  });

  it('does not offer an unsupported Start conversation action', async () => {
    render(<NavigationDialogs kind="link" onOpenLink={vi.fn().mockRejectedValue(new Error('Synthetic failure'))} onClose={vi.fn()} />);
    enter('matrix:u/other:test');
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Start conversation' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).not.toHaveTextContent('start a conversation');
  });

  it('lets Escape dismiss an idle dialog', () => {
    const close = vi.fn();
    render(<NavigationDialogs kind="link" onOpenLink={vi.fn()} onClose={close} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Matrix link' }), { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('navigation help', () => {
  it.each([['MacIntel', 'Command'], ['Linux x86_64', 'Ctrl']])('explains platform shortcuts and touch equivalents on %s', (platform, modifier) => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
    render(<NavigationDialogs kind="help" onOpenLink={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByText(`${modifier}+K`)).toBeInTheDocument();
    expect(screen.getByText(`${modifier}+/`)).toBeInTheDocument();
    expect(screen.getByText('Alt+Shift+↑')).toBeInTheDocument();
    expect(screen.getByText(/On touch screens/)).toHaveTextContent('footer');
  });
});
