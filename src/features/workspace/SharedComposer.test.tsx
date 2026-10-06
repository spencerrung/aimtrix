import { createRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SharedComposer, type SharedComposerHandle, type SharedComposerProps } from './SharedComposer';
import { StagedAttachments } from './stagedAttachments';
import type { StructuredDraft } from './structuredDrafts';

vi.mock('../media/emojiPacks', async (original) => ({ ...await original<typeof import('../media/emojiPacks')>(), loadEmojiPacks: async () => [
  { id: 'custom-wave', name: 'Custom wave', src: '/synthetic-wave.svg' },
  { id: 'wave', name: 'Wave', emoji: '👋' },
] }));
const members = [{ id: '@synthetic:example.test', displayName: 'Synthetic Friend', presence: 'online' as const }];
function mount(overrides: Partial<SharedComposerProps> = {}, initial: StructuredDraft = { body: '' }) {
  const ref = createRef<SharedComposerHandle>(); const onSubmit = vi.fn().mockResolvedValue('sent');
  function Harness() {
    const [value, setValue] = useState(initial);
    return <><SharedComposer ref={ref} contextKey="room/thread" value={value} onChange={setValue} onSubmit={onSubmit} roomName="Synthetic room" thread members={members} emojiPacks={[{ id: 'synthetic', name: 'Synthetic', manifestUrl: '/synthetic.json', source: 'operator' }]} stickerPacks={[]} {...overrides} /><output data-testid="draft">{JSON.stringify(value)}</output><button>Other action</button></>;
  }
  const rendered = render(<Harness />);
  const draft = () => JSON.parse(screen.getByTestId('draft').textContent!) as StructuredDraft;
  return { ...rendered, ref, onSubmit, draft };
}

describe('shared room/thread composer', () => {
  it('sends staged files from the shared Send control without requiring text', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const queue = new StagedAttachments({ maxBytes: 1024, send, persist: vi.fn() });
    const context = { roomId: '!synthetic:test', threadRootId: '$thread' };
    const test = mount({ attachments: { queue, context }, stageFiles: (files) => { queue.stage(context, files); } });
    const submit = screen.getByRole('button', { name: 'Send thread reply' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'More message tools' }));
    fireEvent.change(screen.getByLabelText('Choose thread attachment'), { target: { files: [new File(['synthetic'], 'file.txt', { type: 'text/plain' })] } });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.getByRole('button', { name: 'More message tools' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('region', { name: 'Thread attachments' }).closest('.composer__field')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Send thread attachments' })).not.toBeInTheDocument();
    fireEvent.click(submit);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(test.onSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect(submit).toBeDisabled());
  });

  it('retains attachments when text fails, and sends both only after accepted text', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const queue = new StagedAttachments({ maxBytes: 1024, send, persist: vi.fn() });
    const context = { roomId: '!synthetic:test' };
    queue.stage(context, [new File(['synthetic'], 'file.txt', { type: 'text/plain' })]);
    const onSubmit = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce('sent');
    mount({ attachments: { queue, context }, onSubmit }, { body: 'Synthetic accompanying text' });
    fireEvent.click(screen.getByRole('button', { name: 'Send thread reply' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(send).not.toHaveBeenCalled();
    expect(queue.list(context)).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send thread reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Send thread reply' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  });

  it('sends a selected file without posting or clearing the accompanying draft or other files', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const queue = new StagedAttachments({ maxBytes: 1024, send, persist: vi.fn() });
    const context = { roomId: '!synthetic:test' };
    queue.stage(context, [new File(['synthetic'], 'first.txt'), new File(['synthetic'], 'second.txt')]);
    const test = mount({ attachments: { queue, context } }, { body: 'Unsent code draft', codeMode: true });
    screen.getAllByText('Caption & options').forEach((summary) => summary.closest('details')!.open = true);
    fireEvent.click(screen.getByRole('button', { name: 'Send only first.txt' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][1].name).toBe('first.txt');
    expect(test.onSubmit).not.toHaveBeenCalled();
    expect(test.draft().body).toBe('Unsent code draft');
    expect(queue.list(context).some((item) => item.name === 'second.txt' && item.phase === 'staged')).toBe(true);
  });

  it('converts accepted code to a file-only draft, retaining failed staging and newer edits', async () => {
    let finish!: (accepted: boolean) => void;
    const stageFiles = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const test = mount({ stageFiles }, { body: 'original code', codeMode: true, codeLanguage: 'javascript' });
    fireEvent.click(screen.getByRole('button', { name: 'Send code as file' }));
    await waitFor(() => expect(stageFiles).toHaveBeenCalledTimes(1));
    await act(async () => finish(false));
    expect(test.draft().body).toBe('original code');
    fireEvent.click(screen.getByRole('button', { name: 'Send code as file' }));
    await waitFor(() => expect(stageFiles).toHaveBeenCalledTimes(2));
    act(() => test.ref.current?.insertText(' newer', { start: 13, end: 13 }));
    await act(async () => finish(true));
    expect(test.draft().body).toBe('original code newer');
    fireEvent.click(screen.getByRole('button', { name: 'Send code as file' }));
    await waitFor(() => expect(stageFiles).toHaveBeenCalledTimes(3));
    await act(async () => finish(true));
    expect(test.draft()).toMatchObject({ body: '', codeMode: false });
    expect(test.onSubmit).not.toHaveBeenCalled();
  });

  it('leaves files staged after a pending text submission for a later Send', async () => {
    let finish!: (value: 'sent') => void;
    const onSubmit = vi.fn(() => new Promise<'sent'>((resolve) => { finish = resolve; }));
    const send = vi.fn().mockResolvedValue(undefined);
    const queue = new StagedAttachments({ maxBytes: 1024, send, persist: vi.fn() });
    const context = { roomId: '!synthetic:test' };
    queue.stage(context, [new File(['synthetic'], 'reviewed.txt')]);
    mount({ attachments: { queue, context }, onSubmit }, { body: 'Text' });
    fireEvent.click(screen.getByRole('button', { name: 'Send thread reply' }));
    act(() => { queue.stage(context, [new File(['synthetic'], 'later.txt')]); });
    await act(async () => finish('sent'));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][1].name).toBe('reviewed.txt');
    expect(queue.list(context).some((item) => item.name === 'later.txt' && item.phase === 'staged')).toBe(true);
  });

  it('keeps only durable file descriptors when code conversion updates the draft', async () => {
    const context = { roomId: '!synthetic:test' };
    const queue = new StagedAttachments({ maxBytes: 1024, send: vi.fn(), persist: vi.fn() });
    const test = mount({ attachments: { queue, context }, stageFiles: (files, language) => queue.stage(context, files, language).length === 0 },
      { body: 'const synthetic = true;', codeMode: true, codeLanguage: 'javascript' });
    fireEvent.click(screen.getByRole('button', { name: 'Send code as file' }));
    await waitFor(() => expect(test.draft().body).toBe(''));
    expect(test.draft().attachments).toEqual([expect.objectContaining({ name: 'snippet.js', codeLanguage: 'javascript' })]);
    expect(test.draft().attachments![0]).not.toHaveProperty('file');
    expect(test.draft().attachments![0]).not.toHaveProperty('context');
  });

  it('hydrates occurrence metadata and passes code, mentions and custom emoji through the thread submit contract', async () => {
    const initial: StructuredDraft = { body: '@Synthetic Friend :custom-wave:', mentions: [{ userId: members[0].id, label: members[0].displayName }],
      inlineEmojis: [{ id: 'custom-wave', shortcode: ':custom-wave:', name: 'Custom wave', src: '/synthetic-wave.svg', start: 18, end: 31 }] };
    const test = mount({}, initial);
    expect(screen.getByRole('textbox', { name: 'Message thread' }).querySelectorAll('[data-inline-composer-token]')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Send thread reply' }));
    await waitFor(() => expect(test.onSubmit).toHaveBeenCalledWith(initial.body, initial.mentions, initial.inlineEmojis));
    expect(test.draft()).toEqual(initial);
  });

  it('selects a mention with keyboard, preserves its identity and ignores Enter during IME composition', async () => {
    const test = mount(); await act(async () => undefined);
    const editor = screen.getByRole('textbox', { name: 'Message thread' });
    act(() => { editor.focus(); test.ref.current?.insertText('@Syn'); test.ref.current?.setSelection({ start: 4, end: 4 }); });
    fireEvent.keyUp(editor, { key: 'n' });
    await screen.findByRole('option', { name: /Synthetic Friend/ });
    fireEvent.keyDown(editor, { key: 'Enter', isComposing: true });
    expect(test.onSubmit).not.toHaveBeenCalled(); expect(test.draft().body).toBe('@Syn');
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(test.draft().mentions).toEqual([{ userId: members[0].id, label: members[0].displayName }]);
    expect(test.draft().body).toBe('@Synthetic Friend ');
    fireEvent.click(screen.getByRole('button', { name: 'Send thread reply' }));
    await waitFor(() => expect(test.onSubmit).toHaveBeenCalledWith('@Synthetic Friend ', [{ userId: members[0].id, label: members[0].displayName }], []));
  });

  it('inserts custom emoji from the lazy picker and preserves explicit occurrence offsets', async () => {
    const test = mount({}, { body: 'Hello ' }); await act(async () => undefined);
    act(() => test.ref.current?.setSelection({ start: 6, end: 6 }));
    fireEvent.click(screen.getByRole('button', { name: 'Add emoji' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Insert :custom-wave:' }));
    expect(test.draft()).toMatchObject({ body: 'Hello :custom-wave:', inlineEmojis: [{ id: 'custom-wave', start: 6, end: 19, src: '/synthetic-wave.svg' }] });
  });

  it('stages multiple selected and pasted files without sending or clearing a code draft', async () => {
    const stageFiles = vi.fn(); const test = mount({ stageFiles }, { body: 'console.log("synthetic")', codeMode: true, codeLanguage: 'javascript' });
    const first = new File(['one'], 'one.txt', { type: 'text/plain' }); const second = new File(['two'], 'two.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('Choose thread attachment'), { target: { files: [first, second] } });
    await waitFor(() => expect(stageFiles).toHaveBeenCalledWith([first, second], undefined));
    fireEvent.click(screen.getByRole('button', { name: 'Send code as file' }));
    await waitFor(() => expect(stageFiles).toHaveBeenCalledWith([expect.objectContaining({ name: 'snippet.js' })], 'javascript'));
    const image = new File(['image'], 'synthetic.png', { type: 'image/png' });
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }], files: [], getData: () => '' } });
    await waitFor(() => expect(stageFiles).toHaveBeenCalledWith([image], undefined));
    expect(test.draft().body).toBe('console.log("synthetic")'); expect(test.onSubmit).not.toHaveBeenCalled();
  });

  it('keeps newer text and later focus untouched when a submission finishes', async () => {
    let finish!: (value: 'sent') => void;
    const onSubmit = vi.fn(() => new Promise<'sent'>((resolve) => { finish = resolve; }));
    const test = mount({ onSubmit }, { body: 'Submitted' });
    fireEvent.click(screen.getByRole('button', { name: 'Send thread reply' }));
    act(() => test.ref.current?.insertText(' newer', { start: 9, end: 9 }));
    screen.getByRole('button', { name: 'Other action' }).focus();
    await act(async () => finish('sent'));
    expect(test.draft().body).toBe('Submitted newer');
    expect(screen.getByRole('button', { name: 'Other action' })).toHaveFocus();
  });

  it('exits code mode without discarding staged text or forcing a send', () => {
    const test = mount({}, { body: 'Keep this snippet', codeMode: true, codeLanguage: 'javascript' });
    fireEvent.click(screen.getByRole('button', { name: 'Exit code mode' }));
    expect(test.draft()).toMatchObject({ body: 'Keep this snippet', codeMode: false, codeLanguage: 'javascript' });
    expect(screen.getByRole('button', { name: 'Insert code block' })).toBeInTheDocument();
    expect(test.onSubmit).not.toHaveBeenCalled();
  });

  it('keeps tool Escape and code formatting keyboard accessible', async () => {
    const test = mount({}, { body: 'synthetic code' });
    const more = screen.getByRole('button', { name: 'More message tools' });
    fireEvent.click(more); expect(more).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Insert code block' }), { key: 'Escape' });
    expect(more).toHaveAttribute('aria-expanded', 'false'); expect(more).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Insert code block' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Code language' }), { target: { value: 'rust' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send thread reply' }));
    await waitFor(() => expect(test.onSubmit).toHaveBeenCalledWith('```rust\nsynthetic code\n```', [], []));
  });
});
