import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MessageSummary } from '../../matrix/viewModels';
import { MessageDeliveryStatus } from './MessageDeliveryStatus';

const message: MessageSummary = {
  id: '$synthetic', roomId: '!synthetic:test', senderId: '@self:test', senderName: 'Self',
  body: 'Synthetic message', kind: 'text', isOwn: true, timestamp: 1,
};

describe('outgoing message delivery marks', () => {
  it('keeps pending and failed sends grey and recoverable without claiming delivery', () => {
    const { rerender } = render(<MessageDeliveryStatus message={{ ...message, delivery: 'sending' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Sending…');
    expect(screen.getByRole('status')).toHaveClass('message-delivery-mark--sending');
    rerender(<MessageDeliveryStatus message={{ ...message, delivery: 'failed' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Send not confirmed');
    expect(screen.getByRole('status')).toHaveClass('message-delivery-mark--failed');
    expect(screen.queryByRole('img', { name: /Sent|Read/ })).not.toBeInTheDocument();
  });

  it('shows server acceptance with one check and a real reader receipt with two', () => {
    const { rerender } = render(<MessageDeliveryStatus message={{ ...message, delivery: 'accepted' }} />);
    const accepted = screen.getByRole('img', { name: 'Sent to server' });
    expect(accepted).toHaveClass('message-delivery-mark--accepted');
    expect(accepted).toHaveAttribute('title', expect.stringContaining('Delivery to another device has not been confirmed'));
    expect(accepted.querySelectorAll('svg.lucide-check')).toHaveLength(1);
    rerender(<MessageDeliveryStatus message={{ ...message, delivery: 'accepted', readBy: [{ id: '@friend:test', displayName: 'Friend' }] }} />);
    const read = screen.getByRole('img', { name: 'Read by Friend' });
    expect(read).toHaveClass('message-delivery-mark--read');
    expect(read.querySelectorAll('svg.lucide-check-check')).toHaveLength(1);
    expect(read).toHaveAttribute('title', expect.stringContaining('does not prove that the message was decrypted'));
  });

  it('does not render a send mark on another person’s message', () => {
    const { container } = render(<MessageDeliveryStatus message={{ ...message, isOwn: false, delivery: 'accepted' }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
