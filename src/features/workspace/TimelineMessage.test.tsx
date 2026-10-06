import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('focuses the clicked thread summary before opening context when pointer activation leaves focus in the composer', () => {
    const openedFrom: Element[] = [];
    render(<><textarea aria-label="Existing composer" /><TimelineMessage {...props} message={{ ...message, thread: { replyCount: 2 } }} onOpenThread={() => { openedFrom.push(document.activeElement!); }} /></>);
    screen.getByRole('textbox', { name: 'Existing composer' }).focus();
    const trigger = screen.getByRole('button', { name: /2 replies/ });
    // fireEvent.click does not give buttons focus, matching Safari pointer activation.
    fireEvent.click(trigger);
    expect(openedFrom).toEqual([trigger]);
    expect(trigger).toHaveFocus();
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

  it('anchors a reaction opened from More to the visible menu trigger', async () => {
    render(<TimelineMessage {...props} message={message} />);
    const more = screen.getByRole('button', { name: 'More message actions' });
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add reaction' }));
    const picker = await screen.findByRole('dialog', { name: 'Choose a reaction' });
    fireEvent.keyDown(picker, { key: 'Escape' });
    await waitFor(() => expect(more).toHaveFocus());
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
