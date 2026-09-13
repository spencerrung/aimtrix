import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionBanner, SessionRecoveryScreen } from './SessionRecovery';
import { ConnectionError } from './ConnectionError';
const recovery = { userId: '@synthetic:example.test', homeserver: 'https://example.test', softLogout: true };

describe('session recovery surfaces', () => {
  it('shows no retained profile or account identity and starts same-session sign in', async () => {
    const onSignIn = vi.fn().mockResolvedValue(undefined);
    render(<SessionRecoveryScreen recovery={recovery} onSignIn={onSignIn} onForget={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Your Matrix session expired' })).toHaveFocus();
    expect(screen.queryByText(recovery.userId)).not.toBeInTheDocument();
    expect(screen.getByText(/encryption keys are still on this device/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    await waitFor(() => expect(onSignIn).toHaveBeenCalledOnce());
  });
  it('requires a cancellable key-loss confirmation before forgetting', async () => {
    const onForget = vi.fn().mockResolvedValue(undefined);
    render(<ConnectionError message="Connection interrupted." onRetry={vi.fn()} onForget={onForget} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget this session' }));
    expect(onForget).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent(/encryption keys and unsent drafts/);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onForget).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Forget this session' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forget session and keys' }));
    await waitFor(() => expect(onForget).toHaveBeenCalledOnce());
  });
  it('explains hard logout recovery and handles retry errors without raw diagnostics', async () => {
    render(<SessionRecoveryScreen recovery={{ ...recovery, softLogout: false }} onSignIn={vi.fn().mockRejectedValue(new Error('private detail'))} onForget={vi.fn()} />);
    expect(screen.getByText(/another verified device/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in could not be opened');
    expect(screen.queryByText(/private detail/)).not.toBeInTheDocument();
  });
  it('keeps retry feedback inline and distinguishes consent from offline', async () => {
    const onRetry = vi.fn().mockRejectedValue(new Error('private detail'));
    render(<ConnectionBanner issue="consent" onRetry={onRetry} />);
    expect(screen.getByRole('status')).toHaveTextContent('Review its terms through your account page');
    fireEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Reconnection did not finish'));
    expect(screen.queryByText(/private detail/)).not.toBeInTheDocument();
  });
});
