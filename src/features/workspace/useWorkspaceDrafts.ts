import { useCallback, useState, useSyncExternalStore } from 'react';
import { StructuredDraftStore, type DraftContext, type DraftScope, type DraftSession, type StructuredDraft, type StoredDraft } from './structuredDrafts';

export const draftContextKey = (context: DraftContext) => JSON.stringify([context.roomId, context.threadRootId ?? null]);
export const hasDraftContent = (value: StructuredDraft) => Boolean(value.body || value.reply || value.edit || value.attachments?.length || value.codeMode || value.codeLanguage && value.codeLanguage !== 'text');
export interface DraftCapture { context: DraftContext; revision: number; storedRevision?: string; value: StructuredDraft }

/** One mounted account owns the session. App remounts Workspace on scope change. */
export function useWorkspaceDrafts(options: { store?: StructuredDraftStore; scope?: DraftScope; userId: string; initialRooms?: Record<string, string>; initialThreads?: Record<string, string>; threadRooms?: Record<string, string> }) {
  const [store] = useState(() => options.store && options.scope ? options.store : new StructuredDraftStore({ storage: () => { throw new Error('Volatile workspace'); } }));
  const [session] = useState<DraftSession>(() => {
    const owner = store.open(options.scope ?? { userId: options.userId, homeserver: 'https://volatile-drafts.invalid' });
    for (const [roomId, body] of Object.entries(options.initialRooms ?? {})) if (body && !owner.read({ roomId })) owner.write({ roomId }, { body }, undefined);
    for (const [threadRootId, body] of Object.entries(options.initialThreads ?? {})) {
      const roomId = options.threadRooms?.[threadRootId];
      if (roomId && body && !owner.read({ roomId, threadRootId })) owner.write({ roomId, threadRootId }, { body }, undefined);
    }
    return owner;
  });
  const version = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  const [, render] = useState(0);
  const [local] = useState(() => session.editorMemory()!);
  const active = session.isActive();
  const get = useCallback((context: DraftContext): StructuredDraft => {
    if (!session.isActive()) return { body: '' };
    const key = draftContextKey(context);
    const override = local.overrides.get(key);
    if (override) return override.value;
    const stored = session.read(context);
    local.bases.set(key, stored?.revision);
    return stored?.value ?? { body: '' };
  }, [session, local]);
  const capture = useCallback((context: DraftContext): DraftCapture => {
    const value = structuredClone(get(context));
    const key = draftContextKey(context);
    return { context, value, revision: local.revisions.get(key) ?? 0, storedRevision: local.bases.get(key) };
  }, [get, local]);
  const update = useCallback((context: DraftContext, value: StructuredDraft): boolean => {
    if (!session.isActive()) return false;
    const key = draftContextKey(context);
    if (!local.bases.has(key)) local.bases.set(key, session.read(context)?.revision);
    local.revisions.set(key, (local.revisions.get(key) ?? 0) + 1);
    local.overrides.set(key, { context, value: structuredClone(value), revision: `volatile-${local.revisions.get(key)}`, updatedAt: Date.now() });
    const expected = local.bases.get(key);
    const result = hasDraftContent(value) ? session.write(context, value, expected) : session.remove(context, expected);
    if (result.ok) { local.overrides.delete(key); local.bases.set(key, result.draft?.revision); local.issues.delete(key); }
    else if (result.reason !== 'stale-session') local.issues.set(key, result.reason);
    render((current) => current + 1);
    return result.ok;
  }, [session, local]);
  const unchanged = useCallback((submitted: DraftCapture) => session.isActive()
    && (local.revisions.get(draftContextKey(submitted.context)) ?? 0) === submitted.revision
    && session.read(submitted.context)?.revision === submitted.storedRevision, [session, local]);
  const finish = useCallback((submitted: DraftCapture, replacement?: StructuredDraft): boolean => {
    if (!unchanged(submitted)) return false;
    return update(submitted.context, replacement ?? { body: '', attachments: submitted.value.attachments });
  }, [unchanged, update]);
  const list = active ? new Map(session.list().map((record) => [draftContextKey(record.context), record])) : new Map<string, StoredDraft>();
  if (active) for (const [key, override] of local.overrides) { if (hasDraftContent(override.value)) list.set(key, override); else list.delete(key); }
  return { get, capture, update, unchanged, finish, active, isActive: session.isActive, version, list: [...list.values()].sort((a, b) => b.updatedAt - a.updatedAt), status: store.getStatus(), writeIssue: local.issues.values().next().value };
}
