import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultRuntimeConfig } from '../../config/runtimeConfig';
import { demoWorkspace } from '../../demo/demoWorkspace';
import {
  defaultUserPreferences,
  type UserPreferences,
} from '../../settings/preferences';
import {
  defaultProfilePersonalization,
  type ProfilePersonalization,
} from '../../settings/profilePersonalization';
import { Workspace } from './Workspace';
import { MessageSendError } from '../../matrix/messageDelivery';
function installResizeObserver() {
  const observers = new Set<ResizeObserverCallback>();
  class ResizeObserverMock {
    private readonly callback: ResizeObserverCallback;

    public constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      observers.add(callback);
    }

    public observe() {}
    public unobserve() {}
    public disconnect() {
      observers.delete(this.callback);
    }
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  return () => {
    for (const callback of observers) callback([], {} as ResizeObserver);
  };
}

function rect(top: number): DOMRect {
  return {
    bottom: top,
    height: 0,
    left: 0,
    right: 0,
    top,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

function setComposerText(composer: HTMLElement, text: string) {
  composer.textContent = text;
  composer.focus();
  const range = document.createRange();
  range.selectNodeContents(composer);
  range.collapse(false);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent.input(composer);
}

function pendingSend() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}


function renderWorkspace(
  overrides: {
    onInviteToRoom?: (roomId: string, userId: string) => Promise<void>;
    onPreferencesChange?: (preferences: UserPreferences) => void;
    onProfilePersonalizationChange?: (profile: ProfilePersonalization) => void;
    profilePersonalization?: ProfilePersonalization;
    onMarkRoomRead?: (roomId: string) => Promise<void>;
    onSendMessage?: (
      roomId: string,
      body: string,
      mentions?: Array<{ userId: string; label: string }>,
      inlineEmojis?: Array<{ start: number; end: number; shortcode: string; id: string; name: string; src: string }>,
    ) => Promise<void>;
    onSendReply?: (
      roomId: string,
      body: string,
      target: { id: string; senderId: string; body: string; threadRootId?: string },
      mentions?: Array<{ userId: string; label: string }>,
      inlineEmojis?: Array<{ start: number; end: number; shortcode: string; id: string; name: string; src: string }>,
    ) => Promise<void>;
    onToggleReaction?: (roomId: string, eventId: string, key: string, ownReactionEventId?: string) => Promise<void>;
    onEditMessage?: (
      roomId: string,
      eventId: string,
      body: string,
      mentions?: Array<{ userId: string; label: string }>,
      inlineEmojis?: Array<{ start: number; end: number; shortcode: string; id: string; name: string; src: string }>,
    ) => Promise<void>;
    onSendSticker?: (roomId: string, sticker: { id: string; name: string; src: string }) => Promise<void>;
    onReorderRootSpaces?: (spaceIds: string[]) => Promise<void>;
    onUploadAttachment?: (roomId: string, file: File, onProgress?: (loaded: number, total: number) => void, threadRootId?: string) => Promise<void>;
    onLoadLinkPreview?: (url: string) => Promise<{ title?: string; description?: string; imageUrl?: string; siteName?: string } | undefined>;
    workspace?: typeof demoWorkspace;
  } = {},
) {
  const onPreferencesChange =
    overrides.onPreferencesChange ?? vi.fn<(preferences: UserPreferences) => void>();
  const view = (workspace: typeof demoWorkspace) => (
    <Workspace
      workspace={workspace}
      config={defaultRuntimeConfig}
      theme="aqua"
      preferences={defaultUserPreferences}
      profilePersonalization={overrides.profilePersonalization}
      onThemeChange={vi.fn()}
      onPreferencesChange={onPreferencesChange}
      onProfilePersonalizationChange={overrides.onProfilePersonalizationChange}
      onInviteToRoom={overrides.onInviteToRoom}
      onMarkRoomRead={overrides.onMarkRoomRead}
      onSendMessage={overrides.onSendMessage}
      onSendReply={overrides.onSendReply}
      onToggleReaction={overrides.onToggleReaction}
      onEditMessage={overrides.onEditMessage}
      onSendSticker={overrides.onSendSticker}
      onReorderRootSpaces={overrides.onReorderRootSpaces}
      onUploadAttachment={overrides.onUploadAttachment}
      onLoadLinkPreview={overrides.onLoadLinkPreview}
      onSignOut={vi.fn()}
    />
  );
  const result = render(view(overrides.workspace ?? demoWorkspace));
  return {
    ...result,
    onPreferencesChange,
    rerenderWorkspace: (workspace: typeof demoWorkspace) => result.rerender(view(workspace)),
  };
}

describe('Workspace demo', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends a local demo message through the real composer interaction', () => {
    renderWorkspace();

    const composer = screen.getByLabelText('Message Welcome Lounge');
    setComposerText(composer, 'A shiny new demo message');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(screen.getByText('A shiny new demo message')).toBeInTheDocument();
    expect(composer).toBeEmptyDOMElement();
  });

  it('selects a room member mention with arrows and Tab and sends standard mention metadata', () => {
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ workspace: { ...demoWorkspace, mode: 'matrix' as const }, onSendMessage });
    const composer = screen.getByLabelText('Message Welcome Lounge');
    setComposerText(composer, '@');
    const suggestions = screen.getByRole('listbox', { name: 'Mention a room member' });
    expect(within(suggestions).getByRole('option', { name: /Spencer/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(composer, { key: 'ArrowDown' });
    expect(within(suggestions).getByRole('option', { name: /Mara/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(composer, { key: 'Tab' });
    expect(composer).toHaveTextContent('@Mara');
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(onSendMessage).toHaveBeenCalledWith('welcome', '@Mara', [{
      userId: '@mara:example.com',
      label: 'Mara',
    }]);
  });

  it('does not send stale mention metadata after the visible mention is removed', () => {
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ workspace: { ...demoWorkspace, mode: 'matrix' as const }, onSendMessage });
    const composer = screen.getByLabelText('Message Welcome Lounge');
    setComposerText(composer, '@mar');
    fireEvent.click(screen.getByRole('option', { name: /Mara/ }));
    setComposerText(composer, 'No mention now');
    fireEvent.keyDown(composer, { key: 'Enter' });

    expect(onSendMessage).toHaveBeenCalledWith('welcome', 'No mention now');
  });

  it('renders Matrix messages with mention metadata as visible mentions', () => {
    const workspace = {
      ...demoWorkspace,
      messagesByRoom: {
        ...demoWorkspace.messagesByRoom,
        welcome: [{
          id: 'mentioned-message', roomId: 'welcome', senderId: '@mara:example.com', senderName: 'Mara',
          body: '@Spencer can you check this?', timestamp: Date.now(), kind: 'text' as const, isOwn: false,
          mentionUserIds: ['@you:example.com'],
          mentions: [{ userId: '@you:example.com', label: '@Spencer' }],
        }],
      },
    };
    renderWorkspace({ workspace });
    expect(screen.getByRole('link', { name: '@Spencer' })).toHaveClass('message-mention');
    expect(screen.getByRole('link', { name: '@Spencer' })).toHaveAttribute(
      'href',
      'https://matrix.to/#/%40you%3Aexample.com',
    );
  });

  it('does not partially link mention labels inside larger words', () => {
    const workspace = structuredClone(demoWorkspace);
    workspace.messagesByRoom.welcome = [{
      id: 'mention-boundary', roomId: 'welcome', senderId: '@mara:example.com', senderName: 'Mara',
      body: '@Anna and foo@Ann are plain text', timestamp: Date.now(), kind: 'text', isOwn: false,
      mentionUserIds: ['@ann:example.com'],
      mentions: [{ userId: '@ann:example.com', label: '@Ann' }],
    }];
    renderWorkspace({ workspace });

    expect(screen.queryByRole('link', { name: '@Ann' })).not.toBeInTheDocument();
    expect(screen.getByText('@Anna and foo@Ann are plain text')).toBeInTheDocument();
  });

  it('shows a subtle accessible marker beside edited message metadata', () => {
    const workspace = structuredClone(demoWorkspace);
    workspace.messagesByRoom.welcome = [{
      id: 'edited-message', roomId: 'welcome', senderId: '@mara:example.com', senderName: 'Mara',
      body: 'Corrected text', timestamp: Date.now(), kind: 'text', isOwn: false, edited: true,
    }];
    renderWorkspace({ workspace });

    expect(screen.getByLabelText('Edited message')).toHaveTextContent('edited');
    expect(screen.getByLabelText('Edited message')).toHaveClass('edited-label');
  });

  it('adds one calm day separator only after a cross-day quiet period', () => {
    const workspace = structuredClone(demoWorkspace);
    workspace.messagesByRoom.welcome = [
      {
        id: 'late-day-one', roomId: 'welcome', senderId: '@mara:example.com', senderName: 'Mara',
        body: 'Signing off', timestamp: new Date(2025, 0, 1, 18, 0).getTime(), kind: 'text', isOwn: false,
      },
      {
        id: 'day-two', roomId: 'welcome', senderId: '@you:example.com', senderName: 'Spencer',
        body: 'Morning!', timestamp: new Date(2025, 0, 2, 8, 0).getTime(), kind: 'text', isOwn: true,
      },
      {
        id: 'same-day', roomId: 'welcome', senderId: '@mara:example.com', senderName: 'Mara',
        body: 'Coffee?', timestamp: new Date(2025, 0, 2, 8, 5).getTime(), kind: 'text', isOwn: false,
      },
    ];
    renderWorkspace({ workspace });

    expect(screen.getAllByRole('separator', { name: /Messages from/ })).toHaveLength(1);
    expect(screen.getByRole('separator', { name: /Thursday, January 2, 2025/ })).toBeInTheDocument();
  });

  it('does not add a divider when active conversation crosses midnight', () => {
    const workspace = structuredClone(demoWorkspace);
    workspace.messagesByRoom.welcome = [
      {
        id: 'before-midnight', roomId: 'welcome', senderId: '@mara:example.com', senderName: 'Mara',
        body: 'Still here', timestamp: new Date(2025, 0, 1, 23, 50).getTime(), kind: 'text', isOwn: false,
      },
      {
        id: 'after-midnight', roomId: 'welcome', senderId: '@you:example.com', senderName: 'Spencer',
        body: 'Same conversation', timestamp: new Date(2025, 0, 2, 0, 10).getTime(), kind: 'text', isOwn: true,
      },
    ];
    renderWorkspace({ workspace });

    expect(screen.queryByRole('separator', { name: /Messages from/ })).not.toBeInTheDocument();
  });

  it('opens an image attachment in a dialog and restores focus after closing', async () => {
    const workspace = structuredClone(demoWorkspace);
    workspace.messagesByRoom.welcome = [{
      id: 'image-message', roomId: 'welcome', senderId: '@mara:example.com', senderName: 'Mara',
      body: 'sunset.png', timestamp: Date.now(), kind: 'media', isOwn: false,
      mediaKind: 'image', mediaUrl: 'https://example.test/sunset.png', mimeType: 'image/png',
    }];
    renderWorkspace({ workspace });

    const trigger = screen.getByRole('button', { name: 'View sunset.png full size' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Viewing sunset.png' });
    expect(within(dialog).getByRole('button', { name: 'Actual size' })).toHaveFocus();
    expect(within(dialog).getByRole('img', { name: 'sunset.png' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Actual size' }));
    expect(within(dialog).getByRole('button', { name: 'Fit image' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Viewing sunset.png' })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('does not open stickers or non-image attachments in the image viewer', () => {
    const workspace = structuredClone(demoWorkspace);
    workspace.messagesByRoom.welcome = [
      { id: 'sticker', roomId: 'welcome', senderId: '@mara:example.com', senderName: 'Mara', body: 'hello sticker', timestamp: Date.now(), kind: 'sticker', isOwn: false, mediaKind: 'image', mediaUrl: 'https://example.test/sticker.png' },
      { id: 'file', roomId: 'welcome', senderId: '@mara:example.com', senderName: 'Mara', body: 'notes.pdf', timestamp: Date.now(), kind: 'media', isOwn: false, mediaKind: 'file', mediaUrl: 'https://example.test/notes.pdf' },
    ];
    renderWorkspace({ workspace });

    expect(screen.queryByRole('button', { name: /View .* full size/ })).not.toBeInTheDocument();
  });

  it('turns a triple-backtick trigger into a multiline code draft without showing the fence', () => {
    renderWorkspace();
    const composer = screen.getByLabelText('Message Welcome Lounge');
    setComposerText(composer, '```');
    expect(composer).toBeEmptyDOMElement();
    expect(screen.getByLabelText('Code block mode')).toHaveTextContent('text code');

    setComposerText(composer, 'const hello = "world";');
    fireEvent.keyDown(composer, { key: 'Enter' });
    const codeBlock = screen.getByRole('region', { name: 'text code block' });
    expect(codeBlock).toHaveTextContent('const hello = "world";');
  });

  it('starts code mode from the toolbar without inserting fence characters', () => {
    renderWorkspace();
    const composer = screen.getByLabelText('Message Welcome Lounge');
    fireEvent.click(screen.getByRole('button', { name: 'Insert code block' }));
    expect(composer).toBeEmptyDOMElement();
    expect(screen.getByLabelText('Code block mode')).toHaveTextContent('text code');

    fireEvent.change(screen.getByRole('combobox', { name: 'Code language' }), { target: { value: 'javascript' } });
    setComposerText(composer, 'const answer = 42;');
    expect(composer).not.toHaveTextContent('```');
    expect(screen.getByLabelText('Code block mode')).toHaveTextContent('javascript code');
  });

  it('copies rendered fenced code through the clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const workspace = structuredClone(demoWorkspace);
    workspace.messagesByRoom.welcome = [{
      id: 'code-message', roomId: 'welcome', senderId: '@mara:example.com', senderName: 'Mara',
      body: '```javascript\nconst answer = 42;\n```', timestamp: Date.now(), kind: 'text', isOwn: false,
    }];
    renderWorkspace({ workspace });

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('const answer = 42;\n'));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('renders code files collapsed with expand, copy, and download actions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('line one\nline two\nline three\nline four\nline five\nline six', { status: 200 })));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const workspace = structuredClone(demoWorkspace);
    workspace.messagesByRoom.welcome = [{
      id: 'code-file', roomId: 'welcome', senderId: '@mara:example.com', senderName: 'Mara',
      body: 'snippet.ts', timestamp: Date.now(), kind: 'media', isOwn: false,
      mediaKind: 'file', mediaUrl: 'https://example.test/snippet.ts', mimeType: 'text/plain',
      codeFile: true, codeLanguage: 'typescript',
    }];
    renderWorkspace({ workspace });

    const file = await screen.findByRole('region', { name: 'snippet.ts code file' });
    expect(file).toHaveTextContent('line one');
    expect(file).not.toHaveTextContent('line six');
    fireEvent.click(within(file).getByRole('button', { name: 'Expand' }));
    expect(file).toHaveTextContent('line six');
    fireEvent.click(within(file).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('line one\nline two\nline three\nline four\nline five\nline six'));
    expect(within(file).getByRole('link', { name: 'Download' })).toHaveAttribute('download', 'snippet.ts');
  });

  it('restores main composer focus after a delayed Matrix send settles', async () => {
    let resolveSend: (() => void) | undefined;
    const onSendMessage = vi.fn(() => new Promise<void>((resolve) => { resolveSend = resolve; }));
    const matrixWorkspace = { ...demoWorkspace, mode: 'matrix' as const };
    renderWorkspace({ workspace: matrixWorkspace, onSendMessage });

    const composer = screen.getByLabelText('Message Welcome Lounge');
    composer.focus();
    setComposerText(composer, 'Wait for the network');
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(onSendMessage).toHaveBeenCalledWith('welcome', 'Wait for the network');

    resolveSend?.();
    await waitFor(() => expect(composer).toHaveFocus());
  });

  it('opens a reaction chooser before sending the selected Matrix reaction', async () => {
    const onToggleReaction = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ workspace: { ...demoWorkspace, mode: 'matrix' as const }, onToggleReaction });

    fireEvent.click(screen.getAllByRole('button', { name: 'Add reaction' })[0]);
    expect(onToggleReaction).not.toHaveBeenCalled();
    const picker = screen.getByRole('dialog', { name: 'Choose a reaction' });
    expect(picker.parentElement).toBe(document.body);
    await waitFor(() => expect(within(picker).getByRole('textbox', { name: 'Search reaction emoji' })).toHaveFocus());
    fireEvent.click(within(picker).getByRole('button', { name: 'React with 🎉' }));

    expect(onToggleReaction).toHaveBeenCalledWith('welcome', 'm1', '🎉', undefined);
    expect(screen.queryByRole('dialog', { name: 'Choose a reaction' })).not.toBeInTheDocument();
  });

  it('searches the lazy emoji catalog and remembers a selected reaction', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: () => Promise.resolve({ entries: [
        { id: 'party-popper', emoji: '🎉', name: 'party popper' },
        { id: 'confetti', emoji: '🎊', name: 'confetti' },
      ] }),
    }));
    const onToggleReaction = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ workspace: { ...demoWorkspace, mode: 'matrix' as const }, onToggleReaction });

    fireEvent.click(screen.getAllByRole('button', { name: 'Add reaction' })[0]);
    const picker = screen.getByRole('dialog', { name: 'Choose a reaction' });
    fireEvent.change(within(picker).getByRole('textbox', { name: 'Search reaction emoji' }), {
      target: { value: ':confetti:' },
    });

    await within(picker).findByRole('button', { name: 'React with 🎊' });
    fireEvent.click(within(picker).getByRole('button', { name: 'React with 🎊' }));

    expect(onToggleReaction).toHaveBeenCalledWith('welcome', 'm1', '🎊', undefined);
    expect(JSON.parse(localStorage.getItem('aimtrix.recent-emoji.v1') || '[]')).toContain('🎊');
  });

  it('keeps reactions Unicode-only for cross-client portability', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: () => Promise.resolve({ entries: [{ id: 'bufo-wave', name: 'Bufo wave', src: './bufo-wave.png' }] }),
    }));
    const onToggleReaction = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ workspace: { ...demoWorkspace, mode: 'matrix' as const }, onToggleReaction });

    fireEvent.click(screen.getAllByRole('button', { name: 'Add reaction' })[0]);
    const picker = screen.getByRole('dialog', { name: 'Choose a reaction' });
    fireEvent.change(within(picker).getByRole('textbox', { name: 'Search reaction emoji' }), {
      target: { value: 'bufo' },
    });

    await waitFor(() => expect(within(picker).queryByRole('button', { name: /bufo/i })).not.toBeInTheDocument());
    expect(onToggleReaction).not.toHaveBeenCalled();
  });

  it('keeps animated emoji on a static preview until pointer hover', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: () => Promise.resolve({
        entries: [{
          id: 'bufo-wave',
          name: 'Bufo wave',
          src: './bufo-wave.gif',
          previewSrc: './previews/bufo-wave.webp',
        }],
      }),
    }));
    renderWorkspace({ workspace: { ...demoWorkspace, mode: 'matrix' as const } });

    fireEvent.click(screen.getByRole('button', { name: 'Add emoji' }));
    const picker = screen.getByLabelText('Emoji picker');
    fireEvent.change(within(picker).getByRole('textbox', { name: 'Search emoji' }), {
      target: { value: 'bufo' },
    });

    const image = (await within(picker).findByRole('button', { name: 'Insert :bufo-wave:' }))
      .querySelector('img')!;
    expect(image).toHaveAttribute(
      'src',
      'http://localhost:3000/emoji/packs/standard/previews/bufo-wave.webp',
    );
    fireEvent.pointerEnter(image);
    expect(image).toHaveAttribute(
      'src',
      'http://localhost:3000/emoji/packs/standard/bufo-wave.gif',
    );
    fireEvent.pointerLeave(image);
    expect(image).toHaveAttribute(
      'src',
      'http://localhost:3000/emoji/packs/standard/previews/bufo-wave.webp',
    );
  });

  it('renders image-backed pack shortcodes inline in messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: () => Promise.resolve({ entries: [{ id: 'bufo-wave', name: 'Bufo wave', src: './bufo-wave.png' }] }),
    }));
    try {
      const workspace = structuredClone(demoWorkspace);
      workspace.messagesByRoom.welcome = [{
        id: 'bufo-message', roomId: 'welcome', senderId: '@mara:example.com', senderName: 'Mara',
        body: 'Look :bufo-wave:!', timestamp: Date.now(), kind: 'text', isOwn: false,
      }];
      renderWorkspace({ workspace });

      const bufo = await screen.findByRole('img', { name: 'Bufo wave' });
      expect(bufo).toHaveAttribute('src', 'http://localhost:3000/emoji/packs/standard/bufo-wave.png');
      expect(screen.getByText('Look ', { exact: false })).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('dismisses the reaction chooser with Escape and outside clicks', () => {
    renderWorkspace();

    fireEvent.click(screen.getAllByRole('button', { name: 'Add reaction' })[0]);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Choose a reaction' })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Add reaction' })[0]);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Choose a reaction' })).not.toBeInTheDocument();
  });

  it('uses Up Arrow in an empty composer to edit the latest own text message', async () => {
    const onEditMessage = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ workspace: { ...demoWorkspace, mode: 'matrix' as const }, onEditMessage });

    const composer = screen.getByLabelText('Message Welcome Lounge');
    composer.focus();
    fireEvent.keyDown(composer, { key: 'ArrowUp' });

    expect(composer).toHaveTextContent('The goal: 2006 in spirit, 2026 where it matters.');
    expect(screen.getByText('Editing message')).toBeInTheDocument();
    setComposerText(composer, 'The goal: old-school, without old bugs.');
    fireEvent.keyDown(composer, { key: 'Enter' });

    await waitFor(() => expect(onEditMessage).toHaveBeenCalledWith('welcome', 'm2', 'The goal: old-school, without old bugs.', []));
  });

  it('does not hijack Up Arrow when the composer has a draft', () => {
    const onEditMessage = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ workspace: { ...demoWorkspace, mode: 'matrix' as const }, onEditMessage });

    const composer = screen.getByLabelText('Message Welcome Lounge');
    setComposerText(composer, 'keep writing');
    fireEvent.keyDown(composer, { key: 'ArrowUp' });

    expect(composer).toHaveTextContent('keep writing');
    expect(onEditMessage).not.toHaveBeenCalled();
    expect(screen.queryByText('Editing message')).not.toBeInTheDocument();
  });

  it('focuses the desktop composer when switching rooms', async () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: /Mara Chen/ }));

    await waitFor(() => expect(screen.getByLabelText('Message Mara Chen')).toHaveFocus());
  });

  it('restores the existing draft when cancelling an edit', () => {
    renderWorkspace();

    const composer = screen.getByLabelText('Message Welcome Lounge');
    setComposerText(composer, 'do not lose this');
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    expect(composer).toHaveTextContent('The goal: 2006 in spirit, 2026 where it matters.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel reply or edit' }));

    expect(composer).toHaveTextContent('do not lose this');
  });

  it('uses Up Arrow in an empty thread composer to edit the latest own thread reply', async () => {
    const onEditMessage = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ workspace: { ...demoWorkspace, mode: 'matrix' as const }, onEditMessage });

    fireEvent.click(screen.getByRole('button', { name: /2 replies/ }));
    const composer = screen.getByLabelText('Message thread');
    composer.focus();
    fireEvent.keyDown(composer, { key: 'ArrowUp' });

    expect(composer).toHaveValue('Keep the Aqua, lose the bad UX.');
    fireEvent.change(composer, { target: { value: 'Keep Aqua; lose the bad UX.' } });
    fireEvent.keyDown(composer, { key: 'Enter' });

    await waitFor(() => expect(onEditMessage).toHaveBeenCalledWith('welcome', 'm2-thread-2', 'Keep Aqua; lose the bad UX.', []));
  });

  it('selects thread mentions with arrows and Enter and sends portable metadata', async () => {
    const onSendReply = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({
      workspace: { ...demoWorkspace, mode: 'matrix' as const },
      onSendReply,
    });
    fireEvent.click(screen.getByRole('button', { name: /2 replies/ }));
    const thread = screen.getByRole('complementary', { name: 'Thread' });
    const composer = within(thread).getByLabelText('Message thread');
    fireEvent.change(composer, { target: { value: '@' } });
    fireEvent.keyDown(composer, { key: 'ArrowDown' });
    expect(within(thread).getByRole('option', { name: /Mara/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(composer).toHaveValue('@Mara ');
    fireEvent.keyDown(composer, { key: 'Enter' });

    await waitFor(() => expect(onSendReply).toHaveBeenCalledWith(
      'welcome',
      '@Mara',
      {
        id: 'm2',
        senderId: '@you:example.com',
        body: 'The goal: 2006 in spirit, 2026 where it matters.',
        threadRootId: 'm2',
      },
      [{ userId: '@mara:example.com', label: 'Mara' }],
    ));
  });

  it('links URLs, renders Matrix previews, and dismisses them locally', async () => {
    const previewUrl = 'https://example.test/roadmap';
    const workspace = {
      ...demoWorkspace,
      messagesByRoom: {
        ...demoWorkspace.messagesByRoom,
        welcome: [{
          id: 'link-preview-message',
          roomId: 'welcome',
          senderId: '@mara:demo',
          senderName: 'Mara',
          body: `Check this out: ${previewUrl}`,
          timestamp: Date.now(),
          kind: 'text' as const,
          isOwn: false,
        }],
      },
    };
    renderWorkspace({
      workspace,
      onLoadLinkPreview: vi.fn().mockResolvedValue({
        title: 'Aimtrix roadmap',
        description: 'The next Matrix client milestones.',
        siteName: 'Aimtrix',
      }),
    });

    const link = screen.getByRole('link', { name: previewUrl });
    expect(link).toHaveAttribute('href', previewUrl);
    expect(await screen.findByRole('link', { name: 'Aimtrix roadmap' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide link preview' }));
    expect(screen.queryByRole('link', { name: 'Aimtrix roadmap' })).not.toBeInTheDocument();
  });

  it('uploads pasted images while preserving text paste and thread context', async () => {
    const onUploadAttachment = vi.fn().mockResolvedValue(undefined);
    const matrixWorkspace = { ...demoWorkspace, mode: 'matrix' as const };
    renderWorkspace({ workspace: matrixWorkspace, onUploadAttachment });
    const image = new File(['pixels'], '', { type: 'image/png' });
    const imageClipboard = {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
      files: [],
      getData: () => '',
    };
    const composer = screen.getByLabelText('Message Welcome Lounge');

    fireEvent.paste(composer, { clipboardData: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }], files: [], getData: () => 'text' } });
    expect(onUploadAttachment).not.toHaveBeenCalled();
    fireEvent.paste(composer, { clipboardData: imageClipboard });
    await waitFor(() => expect(onUploadAttachment).toHaveBeenCalledWith('welcome', expect.objectContaining({ name: 'pasted-image.png' }), expect.any(Function), undefined));
    fireEvent.paste(composer, { clipboardData: { items: [], files: [image], getData: () => '' } });
    await waitFor(() => expect(onUploadAttachment).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: /2 replies/ }));
    const threadComposer = screen.getByLabelText('Message thread');
    fireEvent.paste(threadComposer, { clipboardData: imageClipboard });
    await waitFor(() => expect(onUploadAttachment).toHaveBeenLastCalledWith('welcome', expect.any(File), expect.any(Function), expect.any(String)));
  });

  it('shows compact read-position avatars on the last message each buddy read', () => {
    const { container } = renderWorkspace();

    expect(screen.getByLabelText('Read by Mara')).toBeInTheDocument();
    expect(screen.getByLabelText('Read by Aimie')).toBeInTheDocument();
    expect(screen.getByLabelText('Read by PixelGhost')).toBeInTheDocument();
    expect(container.querySelectorAll('.read-indicator')).toHaveLength(3);
  });

  it('marks and positions the unread boundary when returning to a room', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    renderWorkspace();

    expect(screen.getByRole('separator', { name: '3 unread messages below' })).toHaveTextContent('3 unread messages');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  });

  it('trusts a latest-message receipt over a stale unread count', () => {
    const workspace = structuredClone(demoWorkspace);
    const room = workspace.rooms.find((candidate) => candidate.id === 'welcome');
    if (!room) throw new Error('Welcome Lounge fixture is missing');
    room.readUpToMessageId = 'm5';
    room.unreadCount = 7;
    room.timelineUnreadCount = 7;
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(840);

    renderWorkspace({ workspace });

    expect(screen.queryByRole('separator', { name: /unread/ })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Messages' }).scrollTop).toBe(840);
    scrollHeight.mockRestore();
  });

  it('counts unread messages from a loaded receipt instead of the notification count', () => {
    const workspace = structuredClone(demoWorkspace);
    const room = workspace.rooms.find((candidate) => candidate.id === 'welcome');
    if (!room) throw new Error('Welcome Lounge fixture is missing');
    room.readUpToMessageId = 'm2';
    room.unreadCount = 1;
    room.timelineUnreadCount = 1;

    renderWorkspace({ workspace });

    expect(screen.getByRole('separator', { name: '3 unread messages below' })).toBeInTheDocument();
  });

  it('keeps the unread boundary centered when initial history is prepended', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const initialWorkspace = structuredClone(demoWorkspace);
    initialWorkspace.mode = 'matrix';
    const initialRoom = initialWorkspace.rooms.find((room) => room.id === 'welcome');
    if (!initialRoom) throw new Error('Welcome Lounge fixture is missing');
    initialRoom.readUpToMessageId = undefined;
    initialWorkspace.messagesByRoom.welcome = initialWorkspace.messagesByRoom.welcome.slice(-2);
    const { rerenderWorkspace } = renderWorkspace({ workspace: initialWorkspace });

    expect(screen.getByRole('separator', { name: '3 unread messages below' }).nextElementSibling).toHaveTextContent('Encryption is on');

    const loadedWorkspace = structuredClone(demoWorkspace);
    loadedWorkspace.mode = 'matrix';
    const loadedRoom = loadedWorkspace.rooms.find((room) => room.id === 'welcome');
    if (!loadedRoom) throw new Error('Welcome Lounge fixture is missing');
    loadedRoom.readUpToMessageId = undefined;
    rerenderWorkspace(loadedWorkspace);

    expect(screen.getByRole('separator', { name: '3 unread messages below' }).nextElementSibling).toHaveTextContent('carefully polishes');
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('clears loaded-message search before positioning a newly selected room', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Search loaded messages' }));
    fireEvent.change(screen.getByPlaceholderText('Search loaded messages'), {
      target: { value: 'not in Mara' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Mara Chen/ }));

    expect(screen.queryByPlaceholderText('Search loaded messages')).not.toBeInTheDocument();
    expect(screen.getByRole('separator', { name: '2 unread messages below' })).toBeInTheDocument();
  });

  it('lands at the latest message when the room has no unread messages', () => {
    const workspace = structuredClone(demoWorkspace);
    const room = workspace.rooms.find((candidate) => candidate.id === 'welcome');
    if (!room) throw new Error('Welcome Lounge fixture is missing');
    room.unreadCount = 0;
    room.timelineUnreadCount = 0;
    room.readUpToMessageId = 'm5';
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(840);

    renderWorkspace({ workspace });
    const timeline = screen.getByRole('region', { name: 'Messages' });

    expect(screen.queryByRole('separator', { name: /unread/ })).not.toBeInTheDocument();
    expect(timeline.scrollTop).toBe(840);
    scrollHeight.mockRestore();
  });

  it('returns to the latest message after an optimistic local read update', async () => {
    const workspace = structuredClone(demoWorkspace);
    workspace.mode = 'matrix';
    const onMarkRoomRead = vi.fn().mockResolvedValue(undefined);
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(840);
    const { rerenderWorkspace } = renderWorkspace({ workspace, onMarkRoomRead });

    expect(screen.getByRole('separator', { name: '3 unread messages below' })).toBeInTheDocument();
    await waitFor(() => expect(onMarkRoomRead).toHaveBeenCalledWith('welcome'));

    const readWorkspace = structuredClone(workspace);
    const readRoom = readWorkspace.rooms.find((room) => room.id === 'welcome');
    if (!readRoom) throw new Error('Welcome Lounge fixture is missing');
    readRoom.unreadCount = 0;
    readRoom.timelineUnreadCount = 0;
    readRoom.readUpToMessageId = 'm5';
    rerenderWorkspace(readWorkspace);

    fireEvent.click(screen.getByRole('button', { name: /Dev Shack/ }));
    fireEvent.click(screen.getByRole('button', { name: /Welcome Lounge/ }));

    expect(screen.queryByRole('separator', { name: /unread/ })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Messages' }).scrollTop).toBe(840);
    scrollHeight.mockRestore();
  });

  it('stays at the latest message when rendered rows change height', () => {
    const notifyResize = installResizeObserver();
    const workspace = structuredClone(demoWorkspace);
    const room = workspace.rooms.find((candidate) => candidate.id === 'welcome');
    if (!room) throw new Error('Welcome Lounge fixture is missing');
    room.unreadCount = 0;
    room.timelineUnreadCount = 0;
    room.readUpToMessageId = 'm5';
    let height = 840;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => height);

    renderWorkspace({ workspace });
    const timeline = screen.getByRole('region', { name: 'Messages' });
    expect(timeline.scrollTop).toBe(840);

    height = 1120;
    notifyResize();

    expect(timeline.scrollTop).toBe(1120);
  });

  it('keeps the unread boundary anchored when rendered rows change height', () => {
    const notifyResize = installResizeObserver();
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    let markerTop = 320;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('timeline')) return rect(100);
      if (this.classList.contains('unread-divider')) return rect(markerTop);
      return rect(0);
    });

    renderWorkspace();
    const timeline = screen.getByRole('region', { name: 'Messages' });
    markerTop = 395;
    notifyResize();

    expect(timeline.scrollTop).toBe(75);
  });

  it('does not follow row growth after the user scrolls away', async () => {
    const notifyResize = installResizeObserver();
    const workspace = structuredClone(demoWorkspace);
    const room = workspace.rooms.find((candidate) => candidate.id === 'welcome');
    if (!room) throw new Error('Welcome Lounge fixture is missing');
    room.unreadCount = 0;
    room.timelineUnreadCount = 0;
    room.readUpToMessageId = 'm5';
    let height = 840;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => height);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);

    renderWorkspace({ workspace });
    const timeline = screen.getByRole('region', { name: 'Messages' });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    timeline.scrollTop = 400;
    fireEvent.scroll(timeline);

    height = 1120;
    notifyResize();

    expect(timeline.scrollTop).toBe(400);
  });

  it('returns to the local echo when sending after scrolling away from the tail', async () => {
    const workspace = structuredClone(demoWorkspace);
    const room = workspace.rooms.find((candidate) => candidate.id === 'welcome');
    if (!room) throw new Error('Welcome Lounge fixture is missing');
    room.unreadCount = 0;
    room.timelineUnreadCount = 0;
    room.readUpToMessageId = 'm5';
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);

    renderWorkspace({ workspace });
    const timeline = screen.getByRole('region', { name: 'Messages' });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    timeline.scrollTop = 400;
    fireEvent.scroll(timeline);
    expect(screen.getByRole('button', { name: 'Jump to latest messages' })).toBeInTheDocument();

    const composer = screen.getByLabelText('Message Welcome Lounge');
    setComposerText(composer, 'Bring me back to this');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(screen.getByText('Bring me back to this')).toBeInTheDocument());
    await waitFor(() => expect(timeline.scrollTop).toBe(1000));
    expect(screen.queryByRole('button', { name: 'Jump to latest messages' })).not.toBeInTheDocument();
  });

  it('keeps a detached viewport fixed when remote messages arrive', async () => {
    const workspace = structuredClone(demoWorkspace);
    const room = workspace.rooms.find((candidate) => candidate.id === 'welcome');
    if (!room) throw new Error('Welcome Lounge fixture is missing');
    room.unreadCount = 0;
    room.timelineUnreadCount = 0;
    room.readUpToMessageId = 'm5';
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
    const { rerenderWorkspace } = renderWorkspace({ workspace });
    const timeline = screen.getByRole('region', { name: 'Messages' });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    timeline.scrollTop = 400;
    fireEvent.scroll(timeline);

    const updatedWorkspace = structuredClone(workspace);
    updatedWorkspace.messagesByRoom.welcome.push({
      id: 'm6', roomId: 'welcome', senderId: '@mara:example.com', senderName: 'Mara',
      body: 'A remote message', timestamp: Date.now(), kind: 'text', isOwn: false,
    });
    rerenderWorkspace(updatedWorkspace);

    expect(timeline.scrollTop).toBe(400);
    expect(screen.getByRole('button', { name: 'Jump to latest messages' })).toBeInTheDocument();
  });

  it('keeps a detached viewport fixed when a Matrix send fails', async () => {
    const workspace = structuredClone(demoWorkspace);
    workspace.mode = 'matrix';
    const room = workspace.rooms.find((candidate) => candidate.id === 'welcome');
    if (!room) throw new Error('Welcome Lounge fixture is missing');
    room.unreadCount = 0;
    room.timelineUnreadCount = 0;
    room.readUpToMessageId = 'm5';
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
    renderWorkspace({ workspace, onSendMessage: vi.fn().mockRejectedValue(new Error('offline')) });
    const timeline = screen.getByRole('region', { name: 'Messages' });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    timeline.scrollTop = 400;
    fireEvent.scroll(timeline);

    const composer = screen.getByLabelText('Message Welcome Lounge');
    setComposerText(composer, 'This should remain a draft');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(screen.getByText('That message did not send. Your draft is still here.')).toBeInTheDocument());
    expect(composer).toHaveTextContent('This should remain a draft');
    expect(timeline.scrollTop).toBe(400);
    expect(screen.getByRole('button', { name: 'Jump to latest messages' })).toBeInTheDocument();
  });

  it.each(['accepted', 'retained', 'preparation'] as const)('preserves a newer main draft after an older send is %s', async (outcome) => {
    const pending = pendingSend();
    const onSendMessage = vi.fn().mockReturnValue(pending.promise);
    renderWorkspace({ workspace: { ...demoWorkspace, mode: 'matrix' }, onSendMessage });
    const composer = screen.getByLabelText('Message Welcome Lounge');
    setComposerText(composer, 'Submitted text');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(composer).toHaveTextContent('Submitted text');
    expect(composer).toHaveAttribute('contenteditable', 'true');
    setComposerText(composer, 'A newer draft');
    await act(async () => { if (outcome === 'accepted') pending.resolve(); else pending.reject(new MessageSendError(outcome === 'retained')); });
    expect(composer).toHaveTextContent('A newer draft');
    expect(onSendMessage).toHaveBeenCalledExactlyOnceWith('welcome', 'Submitted text');
  });

  it.each(['', 'Submitted text'])('recognizes user revision even when the newer draft is %j', async (newer) => {
    const pending = pendingSend();
    renderWorkspace({ workspace: { ...demoWorkspace, mode: 'matrix' }, onSendMessage: () => pending.promise });
    const composer = screen.getByLabelText('Message Welcome Lounge');
    setComposerText(composer, 'Submitted text');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    setComposerText(composer, 'An intermediate revision');
    setComposerText(composer, newer);
    await act(async () => pending.reject(new MessageSendError(true)));
    expect(composer.textContent).toBe(newer);
  });

  it.each(['accepted', 'retained', 'preparation'] as const)('cleans up only the unchanged main draft when a send is %s', async (outcome) => {
    const pending = pendingSend();
    renderWorkspace({ workspace: { ...demoWorkspace, mode: 'matrix' }, onSendMessage: () => pending.promise });
    const composer = screen.getByLabelText('Message Welcome Lounge');
    setComposerText(composer, 'Submitted text');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await act(async () => { if (outcome === 'accepted') pending.resolve(); else pending.reject(new MessageSendError(outcome === 'retained')); });
    expect(composer.textContent).toBe(outcome === 'preparation' ? 'Submitted text' : '');
  });

  it.each(['accepted', 'retained'] as const)('does not move focus or clear another room after an older send is %s', async (outcome) => {
    const pending = pendingSend();
    renderWorkspace({ workspace: { ...demoWorkspace, mode: 'matrix' }, onSendMessage: () => pending.promise });
    setComposerText(screen.getByLabelText('Message Welcome Lounge'), 'First room text');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    fireEvent.click(screen.getByRole('button', { name: /Mara Chen/ }));
    const otherComposer = screen.getByLabelText('Message Mara Chen');
    setComposerText(otherComposer, 'Second room text');
    const focusedControl = screen.getByRole('button', { name: 'Add emoji' });
    focusedControl.focus();
    await act(async () => { if (outcome === 'accepted') pending.resolve(); else pending.reject(new MessageSendError(true)); });
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
    expect(otherComposer).toHaveTextContent('Second room text');
    expect(focusedControl).toHaveFocus();
    expect(screen.queryByText(/Use Retry on the failed message/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Welcome Lounge/ }));
    expect(screen.getByLabelText('Message Welcome Lounge').textContent).toBe('');
  });

  it('keeps a newly selected reply target when an earlier reply succeeds', async () => {
    const pending = pendingSend();
    const onSendReply = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    renderWorkspace({ workspace: { ...demoWorkspace, mode: 'matrix' }, onSendReply });
    const composer = screen.getByLabelText('Message Welcome Lounge');
    fireEvent.click(screen.getAllByRole('button', { name: 'Reply' })[0]);
    setComposerText(composer, 'The first reply');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Reply' })[1]);
    setComposerText(composer, 'The next reply');
    await act(async () => pending.resolve());
    expect(screen.getByText('Replying to Spencer')).toBeInTheDocument();
    expect(composer).toHaveTextContent('The next reply');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(onSendReply).toHaveBeenNthCalledWith(2, 'welcome', 'The next reply', expect.objectContaining({ id: 'm2' }), []));
  });

  it.each(['accepted', 'retained'] as const)('preserves the pre-edit draft after cancelling an in-flight edit that is %s', async (outcome) => {
    const pending = pendingSend();
    renderWorkspace({ workspace: { ...demoWorkspace, mode: 'matrix' }, onEditMessage: () => pending.promise });
    const composer = screen.getByLabelText('Message Welcome Lounge');
    setComposerText(composer, 'My original draft');
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    setComposerText(composer, 'Submitted edit');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel reply or edit' }));
    await act(async () => { if (outcome === 'accepted') pending.resolve(); else pending.reject(new MessageSendError(true)); });
    expect(composer).toHaveTextContent('My original draft');
    expect(screen.queryByText('Editing message')).not.toBeInTheDocument();
  });

  it('preserves newer code composition when a previous text send finishes', async () => {
    const pending = pendingSend();
    renderWorkspace({ workspace: { ...demoWorkspace, mode: 'matrix' }, onSendMessage: () => pending.promise });
    const composer = screen.getByLabelText('Message Welcome Lounge');
    setComposerText(composer, 'Submitted text');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert code block' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Code language' }), { target: { value: 'typescript' } });
    await act(async () => pending.resolve());
    expect(composer).toHaveTextContent('Submitted text');
    expect(screen.getByLabelText('Code block mode')).toHaveTextContent('typescript code');
  });

  it.each(['accepted', 'retained', 'preparation'] as const)('preserves a newer thread draft after an older reply is %s', async (outcome) => {
    const pending = pendingSend();
    const onSendReply = vi.fn().mockReturnValue(pending.promise);
    renderWorkspace({ workspace: { ...demoWorkspace, mode: 'matrix' }, onSendReply });
    fireEvent.click(screen.getByRole('button', { name: /2 replies/ }));
    const composer = screen.getByLabelText('Message thread');
    fireEvent.change(composer, { target: { value: 'Submitted thread text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send thread reply' }));
    expect(composer).toHaveValue('Submitted thread text');
    fireEvent.change(composer, { target: { value: 'A newer thread draft' } });
    await act(async () => { if (outcome === 'accepted') pending.resolve(); else pending.reject(new MessageSendError(outcome === 'retained')); });
    expect(composer).toHaveValue('A newer thread draft');
    expect(onSendReply).toHaveBeenCalledTimes(1);
  });

  it('keeps a new thread edit context when an earlier thread reply succeeds', async () => {
    const pending = pendingSend();
    const onEditMessage = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ workspace: { ...demoWorkspace, mode: 'matrix' }, onSendReply: () => pending.promise, onEditMessage });
    fireEvent.click(screen.getByRole('button', { name: /2 replies/ }));
    const thread = screen.getByRole('complementary', { name: 'Thread' });
    const composer = within(thread).getByLabelText('Message thread');
    fireEvent.change(composer, { target: { value: 'Submitted thread text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send thread reply' }));
    fireEvent.click(within(thread).getByRole('button', { name: 'Edit message' }));
    await act(async () => pending.resolve());
    expect(within(thread).getByText('Editing message')).toBeInTheDocument();
    expect(composer).toHaveValue('Keep the Aqua, lose the bad UX.');
    fireEvent.click(screen.getByRole('button', { name: 'Send thread reply' }));
    await waitFor(() => expect(onEditMessage).toHaveBeenCalledWith('welcome', 'm2-thread-2', 'Keep the Aqua, lose the bad UX.', []));
  });

  it('does not refocus a reopened thread when its older request finishes', async () => {
    const pending = pendingSend();
    renderWorkspace({ workspace: { ...demoWorkspace, mode: 'matrix' }, onSendReply: () => pending.promise });
    fireEvent.click(screen.getByRole('button', { name: /2 replies/ }));
    fireEvent.change(screen.getByLabelText('Message thread'), { target: { value: 'Submitted thread text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send thread reply' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close thread' }));
    fireEvent.click(screen.getByRole('button', { name: /2 replies/ }));
    const focusedControl = screen.getByRole('button', { name: 'Close thread' });
    focusedControl.focus();
    await act(async () => pending.resolve());
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
    expect(focusedControl).toHaveFocus();
    expect(screen.getByLabelText('Message thread')).toHaveValue('');
  });

  it('marks newer messages read only after a detached viewport returns to the bottom', async () => {
    installResizeObserver();
    const workspace = structuredClone(demoWorkspace);
    workspace.mode = 'matrix';
    const room = workspace.rooms.find((candidate) => candidate.id === 'welcome');
    if (!room) throw new Error('Welcome Lounge fixture is missing');
    room.unreadCount = 0;
    room.timelineUnreadCount = 0;
    room.readUpToMessageId = 'm5';
    const onMarkRoomRead = vi.fn().mockResolvedValue(undefined);
    let height = 840;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => height);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
    const { rerenderWorkspace } = renderWorkspace({ workspace, onMarkRoomRead });
    await waitFor(() => expect(onMarkRoomRead).toHaveBeenCalledTimes(1));

    const timeline = screen.getByRole('region', { name: 'Messages' });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    timeline.scrollTop = 400;
    fireEvent.scroll(timeline);

    const updatedWorkspace = structuredClone(workspace);
    updatedWorkspace.messagesByRoom.welcome.push({
      id: 'm6',
      roomId: 'welcome',
      senderId: '@mara:example.com',
      senderName: 'Mara',
      body: 'One more message',
      timestamp: Date.now(),
      kind: 'text',
      isOwn: false,
    });
    height = 1000;
    rerenderWorkspace(updatedWorkspace);
    expect(onMarkRoomRead).toHaveBeenCalledTimes(1);

    timeline.scrollTop = 800;
    fireEvent.scroll(timeline);
    await waitFor(() => expect(onMarkRoomRead).toHaveBeenCalledTimes(2));
  });

  it('opens a quick emoji tray and inserts the selected emoji', () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Add emoji' }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert 🌈' }));

    expect(screen.getByLabelText('Message Welcome Lounge')).toHaveTextContent('🌈');
  });

  it('stages an image-backed emoji until the composer is submitted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: () => Promise.resolve({ entries: [{ id: 'bufo-wave', name: 'Bufo wave', src: './bufo-wave.png' }] }),
    }));
    try {
      let finishMessageSend = () => {};
      const onSendMessage = vi.fn(() => new Promise<void>((resolve) => {
        finishMessageSend = resolve;
      }));
      const onSendSticker = vi.fn().mockResolvedValue(undefined);
      renderWorkspace({
        workspace: { ...demoWorkspace, mode: 'matrix' as const },
        onSendMessage,
        onSendSticker,
      });
      fireEvent.click(screen.getByRole('button', { name: 'Add emoji' }));
      const picker = screen.getByLabelText('Emoji picker');
      fireEvent.change(within(picker).getByRole('textbox', { name: 'Search emoji' }), {
        target: { value: 'bufo' },
      });

      const bufoButton = await within(picker).findByRole('button', { name: 'Insert :bufo-wave:' });
      expect(bufoButton.querySelector('img')).toHaveAttribute('src', 'http://localhost:3000/emoji/packs/standard/bufo-wave.png');
      fireEvent.click(bufoButton);

      const composer = screen.getByLabelText('Message Welcome Lounge');
      expect(composer.querySelector('[data-inline-composer-token="true"] img')).toHaveAttribute('src', 'http://localhost:3000/emoji/packs/standard/bufo-wave.png');
      expect(onSendSticker).not.toHaveBeenCalled();
      fireEvent.keyDown(composer, { key: 'Enter' });
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledWith('welcome', ':bufo-wave:', [], [{
        start: 0,
        end: 11,
        shortcode: ':bufo-wave:',
        id: 'bufo-wave',
        name: 'Bufo wave',
        src: 'http://localhost:3000/emoji/packs/standard/bufo-wave.png',
      }]));
      fireEvent.keyDown(composer, { key: 'Enter' });
      expect(onSendMessage).toHaveBeenCalledTimes(1);
      expect(onSendSticker).not.toHaveBeenCalled();
      expect(within(composer).getByRole('img', { name: 'Bufo wave' })).toBeInTheDocument();
      finishMessageSend();
      await waitFor(() => expect(composer).toBeEmptyDOMElement());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses the saved default profile pack when opening the chat sticker picker', () => {
    renderWorkspace({
      profilePersonalization: {
        ...defaultProfilePersonalization,
        defaultStickerPack: '/stickers/aero/manifest.json',
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open sticker pack' }));

    expect(screen.getByLabelText('Sticker pack')).toHaveValue('/stickers/aero/manifest.json');
  });

  it('filters rooms when a Matrix space is selected', () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Homelab' }));

    expect(screen.getByRole('button', { name: /Dev Shack/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mara Chen/ })).not.toBeInTheDocument();
    expect(screen.getByRole('main', { name: /Dev Shack/ })).toBeInTheDocument();
  });

  it('renders nested subspaces as collapsible room trees', () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Friends' }));

    const subspace = screen.getByRole('button', { name: /Vidja Gamez/ });
    expect(subspace).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /GIF Club/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dev Shack/ })).toBeInTheDocument();

    fireEvent.click(subspace);
    expect(subspace).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /GIF Club/ })).not.toBeInTheDocument();
  });

  it('drags a top-level space downward without adding drag badges to its icon', () => {
    const { container } = renderWorkspace();
    const spaces = screen.getByRole('navigation', { name: 'Spaces' });
    const transferData = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: 'none',
      setData: vi.fn((type: string, value: string) => transferData.set(type, value)),
      getData: vi.fn((type: string) => transferData.get(type) ?? ''),
    };
    const friends = within(spaces).getByRole('button', { name: 'Friends' });
    const homelab = within(spaces).getByRole('button', { name: 'Homelab' });

    expect(friends.querySelector('span')).toHaveAttribute('draggable', 'false');

    fireEvent.dragStart(friends, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith('application/x-aimtrix-space', 'friends');
    fireEvent.dragOver(homelab, { dataTransfer });
    fireEvent.drop(homelab, { dataTransfer });

    const labels = within(spaces).getAllByRole('button').map((button) => button.getAttribute('aria-label'));
    expect(labels).toEqual(['Home', 'Direct Messages', 'Homelab', 'Friends', 'Music']);
    expect(container.querySelector('.space-button__drag')).not.toBeInTheDocument();
  });

  it('persists only joined root spaces and announces the saved position', async () => {
    const onReorderRootSpaces = vi.fn().mockResolvedValue(undefined);
    const workspace = structuredClone(demoWorkspace);
    workspace.mode = 'matrix';
    workspace.spaces.push({
      id: '!preview:example.com',
      name: 'Preview only',
      initials: 'PO',
      color: '#777777',
      kind: 'matrix',
      membership: 'leave',
      canManage: false,
      childIds: [],
      directRoomIds: [],
      childSpaceIds: [],
      parentSpaceIds: [],
      roomIds: [],
      unreadCount: 0,
      highlighted: false,
    });
    renderWorkspace({ workspace, onReorderRootSpaces });
    const spaces = screen.getByRole('navigation', { name: 'Spaces' });

    fireEvent.keyDown(within(spaces).getByRole('button', { name: 'Friends' }), {
      key: 'ArrowDown',
      altKey: true,
    });

    await waitFor(() => expect(onReorderRootSpaces).toHaveBeenCalledWith([
      'lab',
      'friends',
      'music',
    ]));
    expect(within(spaces).getByLabelText('Space reorder status')).toHaveTextContent('Friends moved to position 2 of 3.');
  });

  it('provides a dedicated direct-message space', () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: /^Direct Messages$/ }));

    expect(screen.getByRole('button', { name: /Mara Chen/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /PixelGhost/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Welcome Lounge/ })).not.toBeInTheDocument();
    expect(screen.getByRole('main', { name: /Mara Chen/ })).toBeInTheDocument();
  });

  it('reorders rooms and moves them into subspaces in arrange mode', () => {
    const { container } = renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Friends' }));
    fireEvent.click(screen.getByRole('button', { name: 'Arrange rooms and subspaces' }));

    fireEvent.click(screen.getByRole('button', { name: 'Move Mara Chen down' }));
    const arrangedNames = [...container.querySelectorAll('.buddy-row--arranging .buddy-row__copy strong')].map((node) => node.textContent);
    expect(arrangedNames.slice(0, 2)).toEqual(['PixelGhost', 'Mara Chen']);

    fireEvent.change(screen.getByLabelText('Move Mara Chen to another subspace'), {
      target: { value: 'vidja-gamez' },
    });
    const gameBranch = screen.getByText('Vidja Gamez', { selector: '.space-branch__toggle strong' }).closest('.space-branch');
    expect(gameBranch).not.toBeNull();
    expect(within(gameBranch as HTMLElement).getByText('Mara Chen')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Finish arranging space' }));
    expect(screen.getByRole('button', { name: /Mara Chen/ })).toBeInTheDocument();
  });

  it('retains rejected invitations and reports feedback in People without duplicate submissions', async () => {
    let reject!: (error: Error) => void;
    const invite = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    renderWorkspace({ workspace: { ...demoWorkspace, mode: 'matrix' }, onInviteToRoom: invite });
    const input = screen.getByRole('textbox', { name: 'Matrix ID to invite' });
    fireEvent.change(input, { target: { value: '@synthetic:example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite to room' }));
    fireEvent.click(screen.getByRole('button', { name: 'Invite to room' }));
    expect(invite).toHaveBeenCalledOnce();
    reject(new Error('synthetic denial'));
    await screen.findByText('Invite failed. Check your room permissions.');
    expect(input).toHaveValue('@synthetic:example.test');
  });

  it('filters the buddy list without removing the active conversation', () => {
    renderWorkspace();

    fireEvent.change(screen.getByLabelText('Search conversations'), {
      target: { value: 'Pixel' },
    });

    expect(screen.getByText('PixelGhost', { selector: '.buddy-row__copy strong' })).toBeInTheDocument();
    expect(screen.queryByText('Mara Chen', { selector: '.buddy-row__copy strong' })).not.toBeInTheDocument();
    expect(screen.getByRole('main', { name: /Welcome Lounge/ })).toBeInTheDocument();
  });

  it('sets a restrained room backdrop and exposes the Decorator role', () => {
    const { container } = renderWorkspace();

    expect(screen.getByLabelText('Read by Mara')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Decorate conversation background' }));
    const dialog = screen.getByRole('dialog', { name: 'Decorate Welcome Lounge' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Blue lagoon' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save backdrop' }));
    expect(container.querySelector('.conversation')).toHaveClass('room-backdrop--blue-lagoon');

    fireEvent.change(within(dialog).getByLabelText('Who can change the room background'), {
      target: { value: 'members' },
    });
    expect(screen.getByLabelText('Role for PixelGhost')).toHaveValue('25');
  });

  it('lets a space admin set an inherited backdrop and assign Decorators', async () => {
    const { container } = renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Friends' }));
    fireEvent.click(screen.getByRole('button', { name: /GIF Club/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Decorate conversation background' }));
    const dialog = screen.getByRole('dialog', { name: 'Decorate GIF Club' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Friends space' }));
    expect(within(dialog).getByLabelText('Decorator role for PixelGhost')).toBeChecked();
    fireEvent.click(within(dialog).getByLabelText('Decorator role for Mara'));
    expect(within(dialog).getByLabelText('Decorator role for Mara')).toBeChecked();
    await waitFor(() => expect(within(dialog).getByText('Mara is now a Decorator.')).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Graphite grid' }));
    expect(within(dialog).getByRole('button', { name: 'Graphite grid' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save backdrop' }));
    await waitFor(() => expect(within(dialog).getByText('Space backdrop saved.')).toBeInTheDocument());

    await waitFor(() => expect(container.querySelector('.conversation')).toHaveClass('room-backdrop--graphite-grid'));
  });

  it('opens the profile page and saves a live decoration preview', async () => {
    const onProfilePersonalizationChange = vi.fn();
    renderWorkspace({ onProfilePersonalizationChange });

    fireEvent.click(screen.getByText('Building a better buddy list ✨').closest('button') as HTMLButtonElement);
    expect(screen.getByRole('dialog', { name: 'My profile page' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Decorate my page' }));
    fireEvent.change(screen.getByPlaceholderText('A note for your own Aimtrix page — only you can read it…'), {
      target: { value: 'Welcome to my little corner of the web.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Twilight' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fresh leaf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save my page' }));

    await waitFor(() => expect(onProfilePersonalizationChange).toHaveBeenCalledWith({
      ...defaultProfilePersonalization,
      bannerPreset: 'twilight',
      avatarFrame: 'leaf',
      bio: 'Welcome to my little corner of the web.',
    }));
  });

  it('labels decoration privacy and lets users frame a custom banner', () => {
    renderWorkspace({
      profilePersonalization: {
        ...defaultProfilePersonalization,
        bannerMxc: 'mxc://example.test/banner',
      },
    });

    fireEvent.click(screen.getByRole('button', { name: /Spencer/ }));
    const dialog = screen.getByRole('dialog', { name: 'My profile page' });
    expect(within(dialog).getByText(/Only visible to you/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decorate my page' }));
    const horizontal = within(dialog).getByLabelText('Banner horizontal focus');
    fireEvent.change(horizontal, { target: { value: '24' } });
    expect(horizontal).toHaveValue('24');
    expect(within(dialog).getByText('Preview matches the profile card crop.')).toBeInTheDocument();
  });

  it('opens the profile decorator from settings as well as the self card', () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decorate profile page' }));

    expect(screen.queryByRole('dialog', { name: 'Personalize Aimtrix' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'My profile page' })).toBeInTheDocument();
  });

  it('opens real settings and applies appearance changes', () => {
    const onPreferencesChange = vi.fn();
    renderWorkspace({ onPreferencesChange });

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(screen.getByRole('dialog', { name: 'Personalize Aimtrix' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Appearance/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Grape' }));

    expect(onPreferencesChange).toHaveBeenCalledWith({
      ...defaultUserPreferences,
      accent: 'grape',
    });

    fireEvent.click(screen.getByRole('button', { name: /Appearance/ }));
    fireEvent.click(screen.getByRole('button', { name: 'clear' }));
    expect(onPreferencesChange).toHaveBeenLastCalledWith({
      ...defaultUserPreferences,
      messageSurface: 'clear',
    });
  });

  it('restores the last selected room from local storage', () => {
    localStorage.setItem(
      'aimtrix.location.v2:@you:example.com',
      JSON.stringify({ roomId: 'dev-shack', spaceId: 'home' }),
    );
    renderWorkspace();

    expect(screen.getByLabelText('Message Dev Shack')).toBeInTheDocument();
  });

  it('closes the emoji tray on Escape and on an outside click', () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Add emoji' }));
    expect(screen.getByLabelText('Emoji picker')).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByLabelText('Emoji picker')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add emoji' }));
    expect(screen.getByLabelText('Emoji picker')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByLabelText('Emoji picker')).not.toBeInTheDocument();
  });

  it('completes Unicode emoji inline and stages image-backed emoji until submit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: () => Promise.resolve({ entries: [
        { id: 'smile', emoji: '😄', name: 'smile' },
        { id: 'tears-of-joy', emoji: '😂', name: 'tears of joy' },
        { id: 'bufo-wave', name: 'bufo wave', src: './bufo-wave.png' },
      ] }),
    }));
    try {
      const onSendMessage = vi.fn().mockResolvedValue(undefined);
      const onSendSticker = vi.fn().mockResolvedValue(undefined);
      renderWorkspace({
        workspace: { ...demoWorkspace, mode: 'matrix' as const },
        onSendMessage,
        onSendSticker,
      });
      const composer = screen.getByLabelText('Message Welcome Lounge');
      composer.focus();
      setComposerText(composer, 'hello :smi');

      const listbox = await screen.findByRole('listbox', { name: 'Emoji and sticker suggestions' });
      expect(within(listbox).getByText(':smile:')).toBeInTheDocument();

      fireEvent.keyDown(composer, { key: 'Enter' });
      expect(composer).toHaveTextContent('hello 😄');

      setComposerText(composer, 'hello :bufo');
      const bufoListbox = await screen.findByRole('listbox', { name: 'Emoji and sticker suggestions' });
      expect(within(bufoListbox).getByText('bufo wave')).toBeInTheDocument();
      expect(within(bufoListbox).getByText('inline emoji')).toBeInTheDocument();
      fireEvent.keyDown(composer, { key: 'Tab' });
      expect(composer).toHaveTextContent('hello');
      expect(composer.querySelector('[data-inline-composer-token="true"]')).toBeInTheDocument();
      expect(onSendSticker).not.toHaveBeenCalled();

      fireEvent.keyDown(composer, { key: 'Enter' });
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledWith('welcome', 'hello :bufo-wave:', [], [{
        start: 6,
        end: 17,
        shortcode: ':bufo-wave:',
        id: 'bufo-wave',
        name: 'bufo wave',
        src: 'http://localhost:3000/emoji/packs/standard/bufo-wave.png',
      }]));
      expect(onSendSticker).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
