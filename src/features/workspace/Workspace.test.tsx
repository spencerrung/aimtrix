import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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


function renderWorkspace(
  overrides: {
    onPreferencesChange?: (preferences: UserPreferences) => void;
    onProfilePersonalizationChange?: (profile: ProfilePersonalization) => void;
    onMarkRoomRead?: (roomId: string) => Promise<void>;
    onSendMessage?: (roomId: string, body: string) => Promise<void>;
    onToggleReaction?: (roomId: string, eventId: string, key: string, ownReactionEventId?: string) => Promise<void>;
    onEditMessage?: (roomId: string, eventId: string, body: string) => Promise<void>;
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
      onThemeChange={vi.fn()}
      onPreferencesChange={onPreferencesChange}
      onProfilePersonalizationChange={overrides.onProfilePersonalizationChange}
      onMarkRoomRead={overrides.onMarkRoomRead}
      onSendMessage={overrides.onSendMessage}
      onToggleReaction={overrides.onToggleReaction}
      onEditMessage={overrides.onEditMessage}
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
    fireEvent.change(composer, { target: { value: 'A shiny new demo message' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(screen.getByText('A shiny new demo message')).toBeInTheDocument();
    expect(composer).toHaveValue('');
  });

  it('selects a room member mention and sends standard mention metadata', () => {
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ workspace: { ...demoWorkspace, mode: 'matrix' as const }, onSendMessage });
    const composer = screen.getByLabelText('Message Welcome Lounge');
    fireEvent.change(composer, { target: { value: '@mar' } });
    fireEvent.click(screen.getByRole('option', { name: /Mara/ }));
    expect(composer).toHaveValue('@Mara ');
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(onSendMessage).toHaveBeenCalledWith('welcome', '@Mara', ['@mara:example.com']);
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
        }],
      },
    };
    renderWorkspace({ workspace });
    expect(screen.getByText('@Spencer')).toHaveClass('message-mention');
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
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Viewing sunset.png' });
    expect(dialog).toHaveFocus();
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
    fireEvent.change(composer, { target: { value: '```' } });
    expect(composer).toHaveValue('');
    expect(screen.getByLabelText('Code block mode')).toHaveTextContent('typescript code');

    fireEvent.change(composer, { target: { value: 'const hello = "world";' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(screen.getByText('const hello = "world";')).toBeInTheDocument();
  });

  it('restores main composer focus after a delayed Matrix send settles', async () => {
    let resolveSend: (() => void) | undefined;
    const onSendMessage = vi.fn(() => new Promise<void>((resolve) => { resolveSend = resolve; }));
    const matrixWorkspace = { ...demoWorkspace, mode: 'matrix' as const };
    renderWorkspace({ workspace: matrixWorkspace, onSendMessage });

    const composer = screen.getByLabelText('Message Welcome Lounge');
    composer.focus();
    fireEvent.change(composer, { target: { value: 'Wait for the network' } });
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
    await waitFor(() => expect(within(picker).getByRole('button', { name: 'React with 👍' })).toHaveFocus());
    fireEvent.click(within(picker).getByRole('button', { name: 'React with 🎉' }));

    expect(onToggleReaction).toHaveBeenCalledWith('welcome', 'm1', '🎉', undefined);
    expect(screen.queryByRole('dialog', { name: 'Choose a reaction' })).not.toBeInTheDocument();
  });

  it('dismisses the reaction chooser with Escape and outside clicks', () => {
    renderWorkspace();

    fireEvent.click(screen.getAllByRole('button', { name: 'Add reaction' })[0]);
    fireEvent.keyDown(document, { key: 'Escape' });
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

    expect(composer).toHaveValue('The goal: 2006 in spirit, 2026 where it matters.');
    expect(screen.getByText('Editing message')).toBeInTheDocument();
    fireEvent.change(composer, { target: { value: 'The goal: old-school, without old bugs.' } });
    fireEvent.keyDown(composer, { key: 'Enter' });

    await waitFor(() => expect(onEditMessage).toHaveBeenCalledWith('welcome', 'm2', 'The goal: old-school, without old bugs.'));
  });

  it('does not hijack Up Arrow when the composer has a draft', () => {
    const onEditMessage = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ workspace: { ...demoWorkspace, mode: 'matrix' as const }, onEditMessage });

    const composer = screen.getByLabelText('Message Welcome Lounge');
    fireEvent.change(composer, { target: { value: 'keep writing' } });
    fireEvent.keyDown(composer, { key: 'ArrowUp' });

    expect(composer).toHaveValue('keep writing');
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
    fireEvent.change(composer, { target: { value: 'do not lose this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    expect(composer).toHaveValue('The goal: 2006 in spirit, 2026 where it matters.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel reply or edit' }));

    expect(composer).toHaveValue('do not lose this');
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

    await waitFor(() => expect(onEditMessage).toHaveBeenCalledWith('welcome', 'm2-thread-2', 'Keep Aqua; lose the bad UX.'));
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
    const imageClipboard = { items: [{ type: 'image/png', getAsFile: () => image }] };
    const composer = screen.getByLabelText('Message Welcome Lounge');

    fireEvent.paste(composer, { clipboardData: { items: [{ type: 'text/plain', getAsFile: () => null }] } });
    expect(onUploadAttachment).not.toHaveBeenCalled();
    fireEvent.paste(composer, { clipboardData: imageClipboard });
    await waitFor(() => expect(onUploadAttachment).toHaveBeenCalledWith('welcome', expect.objectContaining({ name: 'pasted-image.png' }), expect.any(Function), undefined));

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
    fireEvent.change(composer, { target: { value: 'Bring me back to this' } });
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
    fireEvent.change(composer, { target: { value: 'This should remain a draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(screen.getByText('That message did not send. Your draft has been restored.')).toBeInTheDocument());
    expect(composer).toHaveValue('This should remain a draft');
    expect(timeline.scrollTop).toBe(400);
    expect(screen.getByRole('button', { name: 'Jump to latest messages' })).toBeInTheDocument();
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

    expect(screen.getByLabelText('Message Welcome Lounge')).toHaveValue('🌈');
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

  it('reorders top-level spaces without adding drag badges to their icons', () => {
    const { container } = renderWorkspace();
    const spaces = screen.getByRole('navigation', { name: 'Spaces' });

    fireEvent.keyDown(within(spaces).getByRole('button', { name: 'Friends' }), {
      key: 'ArrowDown',
      altKey: true,
    });

    const labels = within(spaces).getAllByRole('button').map((button) => button.getAttribute('aria-label'));
    expect(labels).toEqual(['Home', 'Direct Messages', 'Homelab', 'Friends', 'Music']);
    expect(container.querySelector('.space-button__drag')).not.toBeInTheDocument();
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

  it('opens the profile page and saves a live decoration preview', () => {
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

    expect(onProfilePersonalizationChange).toHaveBeenCalledWith({
      ...defaultProfilePersonalization,
      bannerPreset: 'twilight',
      avatarFrame: 'leaf',
      bio: 'Welcome to my little corner of the web.',
    });
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
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByLabelText('Emoji picker')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add emoji' }));
    expect(screen.getByLabelText('Emoji picker')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByLabelText('Emoji picker')).not.toBeInTheDocument();
  });

  it('completes an emoji shortcode from the composer with Enter', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve([
        { emoji: '😄', name: 'smile' },
        { emoji: '😂', name: 'tears of joy' },
      ]),
    }));
    try {
      renderWorkspace();
      const composer = screen.getByLabelText('Message Welcome Lounge');
      composer.focus();
      fireEvent.change(composer, { target: { value: 'hello :smi' } });

      const listbox = await screen.findByRole('listbox', { name: 'Emoji and sticker suggestions' });
      expect(within(listbox).getByText(':smile:')).toBeInTheDocument();

      fireEvent.keyDown(composer, { key: 'Enter' });
      expect(composer).toHaveValue('hello 😄');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
