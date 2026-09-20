import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaResolverContext } from '../../matrix/mediaContext';
import { parseIncomingFormatting } from '../../matrix/incomingFormatting';
import type { MessageSummary } from '../../matrix/viewModels';
import { MessageContent } from './MessageContent';

const message: MessageSummary = { id: '$synthetic', roomId: '!synthetic:test', senderId: '@synthetic:test', senderName: 'Synthetic', body: 'Plain fallback', kind: 'text', isOwn: false, timestamp: 1 };
const rich = (html: string): MessageSummary => ({ ...message, formatted: parseIncomingFormatting(html, ['@buddy:test']) });
beforeEach(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } }); });

describe('shared message content', () => {
  it('preserves the original download filename while displaying a separate media caption', async () => {
    const resolve = vi.fn().mockResolvedValue('blob:synthetic-file');
    render(<MediaResolverContext.Provider value={resolve}><MessageContent message={{ ...message, body: 'A helpful caption', fileName: 'original.txt', mediaUrl: 'mxc://test/file', mediaKind: 'file', mimeType: 'text/plain' }} /></MediaResolverContext.Provider>);
    expect(await screen.findByRole('link', { name: 'original.txt' })).toHaveAttribute('download', 'original.txt');
    expect(screen.getByText('A helpful caption')).toBeVisible();
  });

  it('renders the supported rich subset literally and uses the same code-copy path', async () => {
    render(<MessageContent message={rich('<p><strong>**Literal stars**</strong> <a href="https://matrix.to/#/@buddy:test">Buddy</a></p><blockquote>Quoted</blockquote><ol start="3"><li>Third</li></ol><pre><code class="language-typescript">const value = 1;\n</code></pre>')} />);
    expect(screen.getByText('**Literal stars**').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: 'Buddy' })).toHaveClass('message-mention');
    expect(screen.getByText('Quoted').tagName).toBe('BLOCKQUOTE');
    expect(screen.getByRole('list')).toHaveAttribute('start', '3');
    const code = screen.getByRole('region', { name: 'typescript code block' });
    fireEvent.click(within(code).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('const value = 1;\n'));
  });

  it('never mounts concealed spoiler media and reveals nested spoilers independently', async () => {
    const resolve = vi.fn().mockResolvedValue('blob:synthetic-emoji');
    render(<MediaResolverContext.Provider value={resolve}><MessageContent message={rich('<span data-mx-spoiler="plot">Secret <img data-mx-emoticon src="mxc://test/emoji" alt=":synthetic:"><span data-mx-spoiler="ending">Ending</span></span>')} /></MediaResolverContext.Provider>);
    expect(screen.queryByText('Secret')).not.toBeInTheDocument();
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reveal spoiler: plot' }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith('mxc://test/emoji', 64, undefined, undefined));
    expect(screen.queryByText('Ending')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reveal spoiler: ending' }));
    expect(screen.getByText('Ending')).toBeVisible();
  });

  it.each([{ dataSaver: true, autoplayMedia: true }, { dataSaver: false, autoplayMedia: false }])('gates rich emoticons with preference %j', async (preferences) => {
    const resolve = vi.fn().mockResolvedValue('blob:synthetic-emoji');
    render(<MediaResolverContext.Provider value={resolve}><MessageContent {...preferences} message={rich('<img data-mx-emoticon src="mxc://test/emoji" alt=":synthetic:">')} /></MediaResolverContext.Provider>);
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Load emoji :synthetic:' }));
    await waitFor(() => expect(screen.getByRole('img', { name: ':synthetic:' })).toHaveAttribute('src', 'blob:synthetic-emoji'));
  });

  it('preserves plaintext Markdown, mentions, emoji and code when rich content is unavailable', () => {
    const { container } = render(<MessageContent message={{ ...message, body: '**Bold** @Buddy :synthetic: `literal`', mentions: [{ userId: '@buddy:test', label: '@Buddy' }] }} emojiCatalog={[{ id: 'synthetic', name: 'Synthetic emoji', src: '/synthetic.svg' }]} />);
    expect(screen.getByText('Bold').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: '@Buddy' })).toHaveClass('message-mention');
    expect(container.querySelector('code')).toHaveTextContent('literal');
    expect(screen.getByRole('img', { name: 'Synthetic emoji' })).toHaveAttribute('src', '/synthetic.svg');
  });

  it('keeps remote tracking images, styles, executable links and reply fallback out of rendered DOM', () => {
    const { container } = render(<MessageContent message={rich('<mx-reply><blockquote>Duplicated reply</blockquote></mx-reply><p style="background:url(https://tracker.test/image)"><img src="https://tracker.test/pixel" alt="Safe alt"><a href="javascript:alert(1)" onclick="alert(1)">Readable label</a><script>alert(1)</script></p>')} />);
    expect(screen.getByText(/Safe alt/)).toBeVisible();
    expect(screen.queryByText('Duplicated reply')).not.toBeInTheDocument();
    expect(container.querySelector('img,script,[style],[onclick],a')).toBeNull();
  });

  it('uses authenticated media resolution and explicit loading with data saver', async () => {
    const resolve = vi.fn().mockResolvedValue('blob:synthetic-image');
    render(<MediaResolverContext.Provider value={resolve}><MessageContent dataSaver message={{ ...message, kind: 'media', mediaKind: 'image', mediaUrl: 'mxc://test/image', mimeType: 'image/png' }} /></MediaResolverContext.Provider>);
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Load media' }));
    await waitFor(() => expect(screen.getByRole('img', { name: 'Plain fallback' })).toHaveAttribute('src', 'blob:synthetic-image'));
    expect(resolve).toHaveBeenCalledWith('mxc://test/image', 720, undefined, 'image/png');
  });

  it('keeps unsupported user-facing message kinds readable', () => {
    render(<MessageContent message={{ ...message, body: 'A future-client message', kind: 'unsupported', fallbackType: 'm.synthetic' }} />);
    expect(screen.getByText('A future-client message')).toBeVisible();
  });
});
