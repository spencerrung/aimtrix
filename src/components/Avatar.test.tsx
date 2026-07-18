import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MediaProvider } from '../matrix/MediaProvider';
import { Avatar } from './Avatar';

describe('Avatar', () => {
  it('resolves authenticated MXC media before rendering an image', async () => {
    const resolver = vi.fn().mockResolvedValue('blob:resolved-avatar');
    const { container } = render(
      <MediaProvider resolver={resolver}>
        <Avatar name="Mara Chen" src="mxc://example.com/avatar" size="small" />
      </MediaProvider>,
    );

    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    expect(resolver).toHaveBeenCalledWith(
      'mxc://example.com/avatar',
      66,
      undefined,
      undefined,
    );
  });

  it('falls back to initials when Matrix media cannot be loaded', () => {
    const { container } = render(
      <Avatar name="Mara Chen" src="https://matrix.example.com/broken-avatar" />,
    );
    const image = container.querySelector('img');
    expect(image).not.toBeNull();

    fireEvent.error(image!);

    expect(container).toHaveTextContent('MC');
    expect(container.querySelector('img')).toBeNull();
  });
});
