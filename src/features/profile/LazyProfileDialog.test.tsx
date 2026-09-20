import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { demoWorkspace } from '../../demo/demoWorkspace';
import { defaultProfilePersonalization } from '../../settings/profilePersonalization';
import { LazyProfileDialog } from './LazyProfileDialog';

const props = { user: demoWorkspace.user, personalization: defaultProfilePersonalization, stickerPacks: [], canUpload: false, dataSaver: true, onChange: vi.fn(), onSignOut: vi.fn(), onClose: vi.fn() };
describe('optional profile editor loader', () => {
  it('shows a recoverable loading failure and retries without losing its open request', async () => {
    const loaded = () => <div>Loaded profile editor</div>;
    const load = vi.fn().mockRejectedValueOnce(new Error('Synthetic asset failure')).mockResolvedValueOnce(loaded);
    render(<LazyProfileDialog {...props} load={load} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading profile editor');
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading profile' }));
    await screen.findByText('Loaded profile editor'); expect(load).toHaveBeenCalledTimes(2);
  });
  it('allows closing while loading and ignores completion after unmount', async () => {
    let resolve!: (value: () => React.ReactNode) => void;
    const load = () => new Promise<() => React.ReactNode>((accept) => { resolve = accept; });
    const onClose = vi.fn();
    const view = render(<LazyProfileDialog {...props} onClose={onClose} load={load} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close profile page' })); expect(onClose).toHaveBeenCalledOnce();
    view.unmount(); resolve(() => <div>Closed editor must stay closed</div>);
    await waitFor(() => expect(screen.queryByText('Closed editor must stay closed')).not.toBeInTheDocument());
  });
});
