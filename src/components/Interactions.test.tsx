import { useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog, DialogClose } from './Dialog';
import { ConfirmDialog } from './ConfirmDialog';
import { Popover } from './Popover';

describe('interaction surfaces', () => {
  it('dismisses only the nested surface and restores its opener', async () => {
    function Example() {
      const [outer, setOuter] = useState(true); const [inner, setInner] = useState(false);
      return outer ? <Dialog className="outer" aria-label="Settings" onClose={() => setOuter(false)}>
        <button onClick={() => setInner(true)}>Verify</button><DialogClose>Close settings</DialogClose>
        {inner ? <Dialog className="inner" aria-label="Verification" onClose={() => setInner(false)}><DialogClose>Cancel verification</DialogClose></Dialog> : null}
      </Dialog> : null;
    }
    render(<Example />);
    screen.getByText('Verify').focus(); fireEvent.click(screen.getByText('Verify'));
    fireEvent.keyDown(screen.getByText('Cancel verification'), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Verification' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Verify')).toHaveFocus());
  });

  it('keeps a destructive confirmation open during work and lets a failed action retry', async () => {
    let reject!: (error: Error) => void;
    const action = vi.fn().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
    const close = vi.fn();
    render(<ConfirmDialog title="Remove member?" description="They will need another invitation." actionLabel="Remove" onConfirm={action} onClose={close} />);
    expect(screen.getByText('Cancel')).toHaveFocus();
    fireEvent.click(screen.getByText('Remove')); fireEvent.click(screen.getByText('Remove'));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(action).toHaveBeenCalledTimes(1); expect(close).not.toHaveBeenCalled();
    await act(async () => reject(new Error('synthetic failure')));
    expect(screen.getByRole('alert')).toHaveTextContent('could not be completed');
    fireEvent.click(screen.getByText('Remove'));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('navigates action menus with arrows, Home and End while skipping disabled items', () => {
    function Example() {
      const trigger = useRef<HTMLButtonElement>(null); const [open, setOpen] = useState(false);
      return <><button ref={trigger} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(true)}>Actions</button>
        {open ? <Popover menu label="Actions" trigger={trigger} onClose={() => setOpen(false)}><button role="menuitem">First</button><button role="menuitem" disabled>Unavailable</button><button role="menuitem" onClick={() => setOpen(false)}>Last</button></Popover> : null}</>;
    }
    render(<Example />); fireEvent.click(screen.getByText('Actions'));
    expect(screen.getByText('First')).toHaveFocus();
    fireEvent.keyDown(screen.getByText('First'), { key: 'ArrowDown' }); expect(screen.getByText('Last')).toHaveFocus();
    fireEvent.keyDown(screen.getByText('Last'), { key: 'Home' }); expect(screen.getByText('First')).toHaveFocus();
    fireEvent.keyDown(screen.getByText('First'), { key: 'End' }); expect(screen.getByText('Last')).toHaveFocus();
    fireEvent.keyDown(screen.getByText('Last'), { key: 'Escape' }); expect(screen.getByText('Actions')).toHaveFocus();
    fireEvent.click(screen.getByText('Actions')); fireEvent.click(within(screen.getByRole('menu')).getByText('Last'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
