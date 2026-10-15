import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StartupScreen } from './StartupScreen';

describe('StartupScreen actions', () => {
  it('prevents overlapping actions and exposes only fixed error text on rejection', async () => {
    let reject!: (error: unknown) => void;
    const cancel = vi.fn(() => new Promise<void>((_, no) => { reject = no; }));
    const retry = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    render(<StartupScreen syncing issue="offline" onCancel={cancel} onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel loading' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel loading' }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeDisabled();
    await act(async () => reject(new Error('private SDK diagnostic')));
    expect(screen.getByRole('alert')).toHaveTextContent('The loading action could not finish. Try again.');
    expect(screen.queryByText('private SDK diagnostic')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeEnabled();
  });
});
