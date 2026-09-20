import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttachmentTray } from './AttachmentTray';
import { StagedAttachments } from './stagedAttachments';

const context = { roomId: '!synthetic:test', threadRootId: '$thread' };
const makeQueue = (send: ConstructorParameters<typeof StagedAttachments>[0]['send'] = async () => {}) => new StagedAttachments({ maxBytes: 1024, send, persist: vi.fn() });
const file = (name: string, type = 'text/plain') => new File(['synthetic'], name, { type });
afterEach(() => vi.restoreAllMocks());

describe('attachment review tray', () => {
  it('keeps preview opt-in, revokes object URLs on removal and never displays an SVG as an image', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const queue = makeQueue(); queue.stage(context, [file('image.png', 'image/png'), file('vector.svg', 'image/svg+xml')]);
    render(<AttachmentTray queue={queue} context={context} />);
    expect(create).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Preview vector.svg' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Preview image.png' }));
    expect(screen.getByAltText('Preview of image.png')).toHaveAttribute('src', 'blob:synthetic');
    fireEvent.click(screen.getByRole('button', { name: 'Remove image.png' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:synthetic'));
  });

  it('offers truthful interrupted restoration, preserves caption, and reports invalid reattachment locally', () => {
    const queue = makeQueue(); queue.restore(context, [{ id: 'saved', name: 'saved.txt', type: 'text/plain', size: 9, lastModified: 1, caption: 'Saved caption', interrupted: true }]);
    const { rerender } = render(<AttachmentTray queue={queue} context={context} />);
    expect(screen.getByText(/Check the conversation before reattaching/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send thread attachments' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Caption for saved.txt' })).toHaveValue('Saved caption');
    fireEvent.change(screen.getByLabelText('Reattach saved.txt'), { target: { files: [file('wrong.txt')] } });
    expect(screen.getByRole('alert')).toHaveTextContent('Choose the original file');
    const other = { roomId: '!other:test' }; act(() => { queue.stage(other, [file('other.txt')]); });
    rerender(<AttachmentTray queue={queue} context={other} />); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    rerender(<AttachmentTray queue={queue} context={context} />);
    fireEvent.change(screen.getByLabelText('Reattach saved.txt'), { target: { files: [file('saved.txt')] } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Send thread attachments' })).toBeEnabled();
  });

  it('keeps ordered captions and failed-only retry accessible while retaining successful feedback', async () => {
    let fail = true;
    const send = vi.fn<ConstructorParameters<typeof StagedAttachments>[0]['send']>(async (_context, input) => { if (input.name === 'second.txt' && fail) { fail = false; throw new Error('private'); } });
    const queue = makeQueue(send); queue.stage(context, [file('first.txt'), file('second.txt')]);
    render(<AttachmentTray queue={queue} context={context} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Caption for second.txt' }), { target: { value: 'Caption two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move second.txt earlier' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send thread attachments' }));
    await screen.findByRole('button', { name: 'Retry second.txt' });
    expect(screen.getAllByRole('status').map((row) => row.textContent)).toEqual(['Not confirmed', 'Sent']);
    expect(send.mock.calls[0][4].caption).toBe('Caption two');
    fireEvent.click(screen.getByRole('button', { name: 'Retry second.txt' }));
    await waitFor(() => expect(screen.getAllByRole('status').map((row) => row.textContent)).toEqual(['Sent', 'Sent']));
    expect(send.mock.calls.filter((call) => call[1].name === 'first.txt')).toHaveLength(1);
  });
});
