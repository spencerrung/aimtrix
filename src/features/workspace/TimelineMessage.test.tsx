import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MessageSummary } from '../../matrix/viewModels';
import { parseIncomingFormatting } from '../../matrix/incomingFormatting';
import { TimelineMessage } from './TimelineMessage';

const message: MessageSummary = { id: '$synthetic', roomId: '!synthetic:test', senderId: '@synthetic:test', senderName: 'Synthetic', body: 'Formatted synthetic message', kind: 'text', isOwn: false, timestamp: 1,
  formatted: parseIncomingFormatting('<blockquote>Same rich quote</blockquote><pre><code class="language-json">{ "synthetic": true }</code></pre>'),
};
const props = { dataSaver: false, autoplayMedia: true, onReply: vi.fn(), onOpenThread: vi.fn(), onStartThread: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onPin: vi.fn(), canPin: false, onReact: vi.fn(), emojiCatalog: [], recentEmojis: [], onLoadEmojiCatalog: vi.fn(), onEmojiUsed: vi.fn(), onMediaLoad: vi.fn() };

describe('shared timeline message', () => {
  it('renders equivalent room/reply/root content and suppresses recursive root thread controls', () => {
    render(<><TimelineMessage {...props} message={message} /><TimelineMessage {...props} message={{ ...message, id: '$root', isThreadRoot: true, thread: { replyCount: 2 } }} hideThreadControls /></>);
    expect(screen.getAllByText('Same rich quote')).toHaveLength(2);
    expect(screen.getAllByRole('region', { name: 'json code block' })).toHaveLength(2);
    const articles = screen.getAllByRole('article');
    expect(within(articles[1]).queryByRole('button', { name: 'Reply in thread' })).not.toBeInTheDocument();
    expect(within(articles[1]).queryByText('2 replies')).not.toBeInTheDocument();
    expect(within(articles[1]).getByRole('button', { name: 'More message actions' })).toBeVisible();
  });

  it('keeps rejected reactions visible inside the message instead of leaking server details', async () => {
    const react = vi.fn().mockRejectedValue(new Error('Synthetic private server detail'));
    render(<TimelineMessage {...props} message={message} onReact={react} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add reaction' }));
    fireEvent.click(screen.getByRole('button', { name: 'React with 👍' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reaction could not be updated. Try again.');
    expect(screen.queryByText(/private server detail/)).not.toBeInTheDocument();
    expect(react).toHaveBeenCalledWith(message, '👍', undefined);
  });

  it('can remove an owned reaction when new reactions are forbidden', () => {
    const react = vi.fn();
    const own = { ...message, actions: { reply: false, thread: false, react: false, pin: false, edit: false, redact: false },
      reactions: [{ key: '👍', count: 1, reacted: true, ownEventId: '$own-reaction', canRemove: true }] };
    render(<TimelineMessage {...props} message={own} onReact={react} />);
    expect(screen.queryByRole('button', { name: 'Add reaction' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '👍, 1 reactions' }));
    expect(react).toHaveBeenCalledWith(own, '👍', '$own-reaction');
  });
});
