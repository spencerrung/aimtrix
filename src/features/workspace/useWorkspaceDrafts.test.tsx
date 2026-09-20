import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { StructuredDraftStore, draftStorageKey, type DraftContext } from './structuredDrafts';
import { useWorkspaceDrafts } from './useWorkspaceDrafts';

const scope = { userId: '@synthetic:example.test', homeserver: 'https://matrix.example.test' };
const room = { roomId: '!room:example.test' };
const thread = { ...room, threadRootId: '$root' };
beforeEach(() => localStorage.clear());
function mount(store = new StructuredDraftStore()) {
  return renderHook(() => useWorkspaceDrafts({ store, scope, userId: scope.userId }));
}

describe('workspace structured draft adapter', () => {
  it('keeps room/thread metadata independent and restores complete original composition after editing', () => {
    const hook = mount();
    const original = { body: 'Original', mentions: [{ userId: '@other:example.test', label: 'Other' }], reply: { id: '$quoted', senderId: '@other:example.test', senderName: 'Other', body: 'Synthetic quote' }, attachments: [{ id: 'staged', name: 'synthetic.txt', size: 5, type: 'text/plain' }] };
    act(() => { hook.result.current.update(room, original); hook.result.current.update(thread, { body: 'Thread original' }); });
    act(() => hook.result.current.update(room, { body: 'Edited text', edit: { id: '$edit', body: 'Before edit', originalDraft: original }, attachments: original.attachments }));
    const captured = hook.result.current.capture(room);
    act(() => { expect(hook.result.current.finish(captured, captured.value.edit?.originalDraft)).toBe(true); });
    expect(hook.result.current.get(room)).toEqual(original);
    expect(hook.result.current.get(thread).body).toBe('Thread original');
    hook.unmount();
    expect(mount().result.current.get(room)).toEqual(original);
  });

  it('clears a submitted revision while retaining staged attachments and a newer edit', () => {
    const hook = mount();
    act(() => hook.result.current.update(room, { body: 'Submitted', attachments: [{ id: 'file', name: 'synthetic.txt', size: 1, type: 'text/plain' }] }));
    const older = hook.result.current.capture(room);
    act(() => hook.result.current.update(room, { ...hook.result.current.get(room), body: 'Newer text' }));
    act(() => { expect(hook.result.current.finish(older)).toBe(false); });
    const current = hook.result.current.capture(room);
    act(() => { expect(hook.result.current.finish(current)).toBe(true); });
    expect(hook.result.current.get(room)).toMatchObject({ body: '', attachments: [{ id: 'file' }] });
    expect(hook.result.current.list).toHaveLength(1);
  });

  it('prevents delayed send completion from erasing another tab revision', () => {
    const store = new StructuredDraftStore(); const hook = mount(store);
    act(() => hook.result.current.update(room, { body: 'Submitted' }));
    const submitted = hook.result.current.capture(room);
    const other = new StructuredDraftStore().open(scope);
    act(() => other.write(room, { body: 'Other tab edit' }, other.read(room)?.revision));
    act(() => { expect(hook.result.current.finish(submitted)).toBe(false); });
    expect(hook.result.current.get(room).body).toBe('Other tab edit');
  });

  it('retains unsaved invalid metadata in memory but removes all editor overrides when account ownership is revoked', () => {
    const store = new StructuredDraftStore(); const hook = mount(store);
    act(() => hook.result.current.update(room, { body: ':wave:', inlineEmojis: [{ id: 'wave', name: 'Wave', shortcode: ':wave:', start: 0, end: 6, src: 'blob:synthetic' }] }));
    expect(hook.result.current.writeIssue).toBe('invalid'); expect(hook.result.current.get(room).body).toBe(':wave:');
    act(() => { localStorage.removeItem(draftStorageKey(scope)); window.dispatchEvent(new StorageEvent('storage', { key: draftStorageKey(scope), newValue: null })); });
    expect(hook.result.current.active).toBe(false); expect(hook.result.current.get(room)).toEqual({ body: '' }); expect(hook.result.current.list).toEqual([]);
    act(() => { expect(hook.result.current.update(room, { body: 'Late input' })).toBe(false); });
    expect(localStorage.getItem(draftStorageKey(scope))).toBeNull();
  });


  it('preserves exceptional unsaved editor fallbacks across same-account recovery and clears them on logout', () => {
    const store = new StructuredDraftStore(); const hook = mount(store);
    act(() => hook.result.current.update(room, { body: ':wave:', inlineEmojis: [{ id: 'wave', name: 'Wave', shortcode: ':wave:', start: 0, end: 6, src: 'blob:synthetic' }] }));
    act(() => store.suspend()); hook.unmount();
    const recovered = mount(store);
    expect(recovered.result.current.get(room).body).toBe(':wave:');
    expect(recovered.result.current.writeIssue).toBe('invalid');
    act(() => store.clear()); recovered.unmount();
    const signedInAgain = mount(store);
    expect(signedInAgain.result.current.get(room).body).toBe('');
    expect(signedInAgain.result.current.writeIssue).toBeUndefined();
  });

  it('hydrates only explicitly room-scoped legacy thread text and keeps volatile fallback usable', () => {
    const hook = renderHook(() => useWorkspaceDrafts({ userId: scope.userId, initialRooms: { [room.roomId]: 'Room legacy' }, initialThreads: { $root: 'Thread legacy', $unowned: 'Do not guess room' }, threadRooms: { $root: room.roomId } }));
    expect(hook.result.current.get(room).body).toBe('Room legacy'); expect(hook.result.current.get(thread).body).toBe('Thread legacy');
    expect(hook.result.current.list).toHaveLength(2); expect(hook.result.current.status.mode).toBe('volatile');
    const submitted = hook.result.current.capture(thread);
    act(() => { expect(hook.result.current.finish(submitted)).toBe(true); });
    expect(hook.result.current.list.map((draft) => draft.context)).toEqual([room] satisfies DraftContext[]);
  });

  it('preserves empty code mode and language selection through the controlled composer', () => {
    const hook = mount();
    act(() => hook.result.current.update(room, { body: '', codeMode: true, codeLanguage: 'rust' }));
    expect(hook.result.current.get(room)).toMatchObject({ body: '', codeMode: true, codeLanguage: 'rust' });
    expect(hook.result.current.list).toHaveLength(1);
  });

  it('does not activate a supplied persistent store without an explicit authenticated scope', () => {
    const store = new StructuredDraftStore(); const owner = store.open(scope); owner.write(room, { body: 'Real account private draft' }, undefined);
    const hook = renderHook(() => useWorkspaceDrafts({ store, userId: scope.userId }));
    expect(hook.result.current.get(room).body).toBe(''); expect(hook.result.current.status.mode).toBe('volatile');
    expect(owner.isActive()).toBe(true); expect(owner.read(room)?.value.body).toBe('Real account private draft');
  });
});
