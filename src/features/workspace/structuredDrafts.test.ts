import { describe, expect, it, vi } from 'vitest';
import { DRAFT_LIMITS, StructuredDraftStore, draftStorageKey, type DraftWriteResult, type StructuredDraft } from './structuredDrafts';

const scope = { userId: '@synthetic:example.test', homeserver: 'https://matrix.example.test/' };
const room = { roomId: '!synthetic:example.test' };
function setup() {
  const values = new Map<string, string>();
  const storage = { getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value); }), removeItem: vi.fn((key: string) => { values.delete(key); }) };
  let revision = 0;
  const create = () => new StructuredDraftStore({ storage: () => storage, nonce: () => `synthetic-${++revision}`, now: () => 42 });
  return { storage, values, create };
}
const revision = (result: DraftWriteResult) => { if (!result.ok || !result.draft) throw new Error('Expected draft'); return result.draft.revision; };

describe('structured private drafts', () => {
  it('round trips rich room/thread drafts while persisting only attachment descriptors', () => {
    const test = setup(); const store = test.create(); const session = store.open(scope);
    const value: StructuredDraft = { body: 'Hello @Synthetic :wave:', mentions: [{ userId: '@other:example.test', label: 'Synthetic' }],
      inlineEmojis: [{ id: 'wave', shortcode: ':wave:', name: 'Wave', src: '/assets/wave.svg', start: 17, end: 23 }],
      reply: { id: '$reply', senderId: '@other:example.test', senderName: 'Synthetic', body: 'Synthetic quote' },
      edit: { id: '$edit', body: 'Before', originalDraft: { body: 'Original', mentions: [] } }, codeMode: true, codeLanguage: 'text',
      attachments: [{ id: 'attachment', name: 'synthetic.txt', type: 'text/plain', size: 42, lastModified: 1, file: new File(['never serialize bytes'], 'synthetic.txt') } as StructuredDraft['attachments'] extends Array<infer T> | undefined ? T : never] };
    expect(session.write(room, value, undefined).ok).toBe(true);
    expect(session.write({ ...room, threadRootId: '$root' }, { body: 'Thread' }, undefined).ok).toBe(true);
    const loaded = test.create().open(scope);
    expect(loaded.read(room)?.value).toEqual({ ...value, attachments: [{ id: 'attachment', name: 'synthetic.txt', type: 'text/plain', size: 42, lastModified: 1 }] });
    expect(loaded.read({ ...room, threadRootId: '$root' })?.value.body).toBe('Thread');
    expect([...test.values.values()].join('')).not.toContain('never serialize bytes');
    const copy = loaded.read(room)!; copy.value.body = 'Changed copy';
    expect(loaded.read(room)?.value.body).toBe(value.body);
  });

  it('isolates homeservers and rooms sharing a thread ID, and revokes old account callbacks', () => {
    const test = setup(); const store = test.create(); const first = store.open(scope);
    first.write({ ...room, threadRootId: '$root' }, { body: 'First' }, undefined);
    first.write({ roomId: '!other:example.test', threadRootId: '$root' }, { body: 'Other room' }, undefined);
    const second = store.open({ ...scope, homeserver: 'https://other.example.test' });
    expect(second.list()).toEqual([]);
    expect(first.write(room, { body: 'Stale' }, undefined)).toEqual({ ok: false, reason: 'stale-session' });
    expect(store.open(scope).list()).toHaveLength(2);
    expect(draftStorageKey(scope)).toBe(draftStorageKey({ ...scope, homeserver: 'https://matrix.example.test' }));
  });

  it('keeps a new account active when a delayed old-account cleanup completes', () => {
    const test = setup(); const store = test.create(); store.open(scope).write(room, { body: 'Old account' }, undefined);
    const nextScope = { ...scope, userId: '@next:example.test' }; const next = store.open(nextScope);
    next.write(room, { body: 'New account' }, undefined);
    store.clear(scope);
    expect(next.isActive()).toBe(true); expect(next.read(room)?.value.body).toBe('New account');
    expect(test.values.has(draftStorageKey(scope))).toBe(false);
  });

  it('restores the original quote and staged captions when cancelling an edit', () => {
    const test = setup(); const session = test.create().open(scope);
    const originalDraft = { body: 'Original', reply: { id: '$quoted', senderId: '@other:test', senderName: 'Other', body: 'Synthetic quote' },
      attachments: [{ id: 'file', name: 'synthetic.txt', type: 'text/plain', size: 1, caption: 'Synthetic caption', interrupted: true }] };
    session.write(room, { body: 'Edited', edit: { id: '$edit', body: 'Before edit', originalDraft } }, undefined);
    expect(test.create().open(scope).read(room)?.value.edit?.originalDraft).toEqual(originalDraft);
  });

  it('retains same-account volatile drafts across recovery but rejects stale callbacks and delayed send cleanup', () => {
    const test = setup(); test.storage.setItem.mockImplementation(() => { throw new DOMException('Synthetic', 'QuotaExceededError'); });
    const store = test.create(); const before = store.open(scope);
    const old = revision(before.write(room, { body: 'First' }, undefined));
    store.suspend(); const after = store.open(scope);
    expect(before.isActive()).toBe(false); expect(after.isActive()).toBe(true);
    expect(after.read(room)?.value.body).toBe('First');
    expect(before.remove(room, old)).toEqual({ ok: false, reason: 'stale-session' });
    const current = revision(after.write(room, { body: 'Newer' }, old));
    expect(after.remove(room, old)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(after.read(room)?.revision).toBe(current);
    expect(after.status()).toEqual({ mode: 'volatile', issue: 'quota' });
    test.storage.setItem.mockImplementation((key, value) => { test.values.set(key, value); });
    expect(after.write(room, { body: 'Saved now' }, current)).toMatchObject({ ok: true, status: { mode: 'persistent' } });
  });

  it('detects sequential tab revisions and logout revokes other tab writers', () => {
    const test = setup(); const firstStore = test.create(); const first = firstStore.open(scope); const secondStore = test.create(); const second = secondStore.open(scope);
    const old = revision(first.write(room, { body: 'One' }, undefined));
    expect(second.read(room)?.revision).toBe(old);
    first.write(room, { body: 'Two' }, old);
    expect(second.write(room, { body: 'Late tab' }, old)).toMatchObject({ ok: false, reason: 'conflict' });
    firstStore.clear();
    expect(second.write(room, { body: 'After logout' }, old)).toEqual({ ok: false, reason: 'stale-session' });
    expect(test.values.size).toBe(0);
  });

  it('notifies subscribers of remote deletion and does not expose another account record', () => {
    const test = setup(); const store = test.create(); const session = store.open(scope); session.write(room, { body: 'Private' }, undefined);
    const listener = vi.fn(); const unsubscribe = store.subscribe(listener);
    test.values.delete(draftStorageKey(scope));
    window.dispatchEvent(new StorageEvent('storage', { key: draftStorageKey(scope) }));
    expect(listener).toHaveBeenCalledOnce(); expect(session.list()).toEqual([]); unsubscribe();
    test.values.set(draftStorageKey(scope), JSON.stringify({ version: 1, scope: { ...scope, userId: '@wrong:example.test' }, epoch: 'x', drafts: [] }));
    const isolated = test.create().open(scope);
    expect(isolated.list()).toEqual([]); expect(isolated.status().issue).toBe('corrupt');
  });

  it.each(['{broken', JSON.stringify({ version: 55, scope, drafts: [] })])('preserves inaccessible schema on disk and falls back to volatile drafts: %s', (serialized) => {
    const test = setup(); test.values.set(draftStorageKey(scope), serialized);
    const session = test.create().open(scope);
    expect(session.write(room, { body: 'Still usable' }, undefined).ok).toBe(true);
    expect(session.status().mode).toBe('volatile'); expect(session.read(room)?.value.body).toBe('Still usable');
    expect(test.values.get(draftStorageKey(scope))).toBe(serialized);
  });

  it('migrates scoped version zero text records without inventing thread room ownership', () => {
    const test = setup(); test.values.set(draftStorageKey(scope), JSON.stringify({ version: 0, scope, drafts: [{ context: room, body: 'Old draft' }] }));
    const session = test.create().open(scope); const old = session.read(room)!;
    expect(old.value).toEqual({ body: 'Old draft' });
    session.write(room, { body: 'Updated' }, old.revision);
    expect(JSON.parse(test.values.get(draftStorageKey(scope))!).version).toBe(1);
  });

  it('survives denied storage access and clears memory even when deletion fails', () => {
    const store = new StructuredDraftStore({ storage: () => { throw new Error('Synthetic denial'); } });
    const session = store.open(scope); session.write(room, { body: 'Only memory' }, undefined);
    expect(session.status()).toEqual({ mode: 'volatile', issue: 'unavailable' });
    expect(store.clear()).toEqual({ cleared: false });
    expect(session.list()).toEqual([]); expect(store.getStatus().issue).toBe('cleanup-failed');
  });

  it('revokes volatile fallback on another tab logout even when storage reads stay denied', () => {
    const store = new StructuredDraftStore({ storage: () => { throw new Error('Synthetic denial'); } });
    const session = store.open(scope); session.write(room, { body: 'Only memory' }, undefined);
    const unsubscribe = store.subscribe(() => undefined);
    expect(store.getStatus()).toBe(store.getStatus());
    window.dispatchEvent(new StorageEvent('storage', { key: draftStorageKey(scope), newValue: null }));
    expect(session.isActive()).toBe(false);
    expect(session.list()).toEqual([]);
    expect(session.write(room, { body: 'Late callback' }, undefined)).toEqual({ ok: false, reason: 'stale-session' });
    unsubscribe();
  });

  it('rejects unsafe occurrences and oversize records without evicting other unsent work', () => {
    const test = setup(); const session = test.create().open(scope);
    for (const src of ['blob:synthetic', 'data:image/png;base64,AAAA', 'javascript:alert(1)', 'https://name:secret@example.test/a']) {
      expect(session.write(room, { body: ':wave:', inlineEmojis: [{ id: 'wave', name: 'Wave', shortcode: ':wave:', start: 0, end: 6, src }] }, undefined)).toEqual({ ok: false, reason: 'invalid' });
    }
    expect(session.write(room, { body: 'x'.repeat(DRAFT_LIMITS.body + 1) }, undefined).ok).toBe(false);
    for (let index = 0; index < DRAFT_LIMITS.count; index++) expect(session.write({ roomId: `!room-${index}:example.test` }, { body: 'Synthetic' }, undefined).ok).toBe(true);
    expect(session.write(room, { body: 'No eviction' }, undefined)).toEqual({ ok: false, reason: 'limit' });
    expect(session.list()).toHaveLength(DRAFT_LIMITS.count);
  });
});
