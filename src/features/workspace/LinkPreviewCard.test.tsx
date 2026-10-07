import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MediaResolverContext } from '../../matrix/mediaContext';
import type { MessageSummary } from '../../matrix/viewModels';
import { LinkPreviewCard } from './MessageContent';

const message: MessageSummary = { id: '$preview:test', roomId: '!room:test', senderId: '@buddy:test',
  senderName: 'Buddy', timestamp: 1, kind: 'text', isOwn: false, body: 'https://example.test/article' };
const preview = { title: 'Synthetic article', description: 'Preview description', imageUrl: 'mxc://media.test/preview' };

describe('authenticated link-preview images', () => {
  it('resolves an MXC thumbnail through the account resolver and renders only its object URL', async () => {
    const resolve = vi.fn().mockResolvedValue('blob:synthetic-preview');
    const { container } = render(<MediaResolverContext.Provider value={resolve}>
      <LinkPreviewCard message={message} onLoad={async () => preview} />
    </MediaResolverContext.Provider>);
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', 'blob:synthetic-preview'));
    expect(resolve).toHaveBeenCalledWith(preview.imageUrl, 640, undefined, undefined);
    expect(screen.getByRole('link', { name: preview.title })).toHaveAttribute('href', message.body);
  });

  it('keeps a text preview when authenticated retrieval fails', async () => {
    const resolve = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<MediaResolverContext.Provider value={resolve}>
      <LinkPreviewCard message={message} onLoad={async () => preview} />
    </MediaResolverContext.Provider>);
    expect(await screen.findByRole('link', { name: preview.title })).toBeVisible();
    await waitFor(() => expect(resolve).toHaveBeenCalled());
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(preview.description)).toBeVisible();
  });

  it('waits for an explicit image request in data saver', async () => {
    const resolve = vi.fn().mockResolvedValue('blob:synthetic-preview');
    render(<MediaResolverContext.Provider value={resolve}>
      <LinkPreviewCard message={message} dataSaver onLoad={async () => preview} />
    </MediaResolverContext.Provider>);
    const load = await screen.findByRole('button', { name: 'Load preview image' });
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.click(load);
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
  });

  it('rejects direct remote image URLs and keeps the preview text', async () => {
    const resolve = vi.fn();
    const { container } = render(<MediaResolverContext.Provider value={resolve}>
      <LinkPreviewCard message={message} onLoad={async () => ({ ...preview, imageUrl: 'https://untrusted.test/tracker' })} />
    </MediaResolverContext.Provider>);
    expect(await screen.findByRole('link', { name: preview.title })).toBeVisible();
    expect(container.querySelector('img')).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('does not carry a prior message preview through a pending replacement', async () => {
    const load = vi.fn().mockResolvedValueOnce(preview).mockImplementationOnce(() => new Promise(() => {}));
    const { rerender } = render(<LinkPreviewCard message={message} onLoad={load} />);
    expect(await screen.findByRole('link', { name: preview.title })).toBeVisible();
    rerender(<LinkPreviewCard message={{ ...message, id: '$other:test', body: 'https://example.test/other' }} onLoad={load} />);
    expect(screen.queryByRole('link', { name: preview.title })).toBeNull();
  });
});
