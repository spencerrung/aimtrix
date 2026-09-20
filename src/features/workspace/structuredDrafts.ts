/** Private device-local drafts. Never send these records as Matrix account data. */
export interface DraftScope { userId: string; homeserver: string }
export interface DraftContext { roomId: string; threadRootId?: string }
export interface DraftMention { userId: string; label: string }
export interface DraftInlineEmoji { id: string; shortcode: string; name: string; src: string; start: number; end: number; alt?: string; title?: string }
export interface DraftText { body: string; mentions?: DraftMention[]; inlineEmojis?: DraftInlineEmoji[]; codeLanguage?: string; codeMode?: boolean }
export interface DraftReply { id: string; senderId: string; senderName: string; body: string; threadRootId?: string }
export interface DraftAttachment { id: string; name: string; size: number; type: string; lastModified?: number; codeLanguage?: string; caption?: string; interrupted?: boolean }
export interface DraftComposition extends DraftText {
  reply?: DraftReply;
  /** Descriptors only. A restored file always requires explicit reattachment. */
  attachments?: DraftAttachment[];
}
export interface StructuredDraft extends DraftComposition {
  edit?: { id: string; body: string; originalDraft: DraftComposition; mentions?: DraftMention[] };
}
export interface StoredDraft { context: DraftContext; value: StructuredDraft; revision: string; updatedAt: number }
export type DraftStorageIssue = 'unavailable' | 'quota' | 'corrupt' | 'unsupported-version' | 'conflict' | 'cleanup-failed';
export interface DraftStorageStatus { mode: 'persistent' | 'volatile'; issue?: DraftStorageIssue }
/** Safe lifecycle metadata; never contains account IDs, bodies, names or filenames. */
export interface DraftStateSummary { hasDrafts: boolean; volatile: boolean; hasAttachments: boolean; sending: boolean }
export type DraftWriteResult = { ok: true; draft?: StoredDraft; status: DraftStorageStatus }
  | { ok: false; reason: 'stale-session' | 'conflict' | 'invalid' | 'limit'; current?: StoredDraft };
/** Account-owned, tab-only editor fallbacks; cleared on logout, preserved on suspension. */
export interface DraftEditorMemory {
  revisions: Map<string, number>;
  overrides: Map<string, StoredDraft>;
  bases: Map<string, string | undefined>;
  issues: Map<string, 'conflict' | 'invalid' | 'limit'>;
}
export interface DraftSession {
  readonly scope: DraftScope;
  isActive(): boolean;
  editorMemory(): DraftEditorMemory | undefined;
  read(context: DraftContext): StoredDraft | undefined;
  list(): StoredDraft[];
  write(context: DraftContext, value: StructuredDraft, expectedRevision: string | undefined): DraftWriteResult;
  remove(context: DraftContext, expectedRevision: string | undefined): DraftWriteResult;
  status(): DraftStorageStatus;
}
export const DRAFT_LIMITS = { count: 64, bytes: 1_048_576, body: 65_536, attachments: 20, mentions: 100, inlineEmojis: 200 } as const;
const PREFIX = 'aimtrix.private-drafts.v1:';
interface Envelope { version: 1; scope: DraftScope; epoch: string; drafts: StoredDraft[] }
interface Active { editorMemory: DraftEditorMemory; scope: DraftScope; key: string; envelope: Envelope; serialized: string | null; dirty: boolean; disabled: boolean }
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface Options { storage?: () => DraftStorage; now?: () => number; nonce?: () => string }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 2048): value is string => typeof value === 'string' && value.length <= max;
const id = (value: unknown): value is string => text(value) && value.length > 0;
const clone = <T>(value: T): T => structuredClone(value);
const contextKey = (context: DraftContext) => JSON.stringify([context.roomId, context.threadRootId ?? null]);
const validContext = (value: unknown): value is DraftContext => object(value) && id(value.roomId) && (value.threadRootId === undefined || id(value.threadRootId));
const byteLength = (value: string) => new TextEncoder().encode(value).length;

export function normalizeDraftScope(scope: DraftScope): DraftScope {
  if (!id(scope.userId)) throw new Error('A draft account is required.');
  const url = new URL(scope.homeserver);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('A draft homeserver is required.');
  return { userId: scope.userId, homeserver: url.href.replace(/\/+$/, '') };
}
export function draftStorageKey(scope: DraftScope): string { return `${PREFIX}${encodeURIComponent(JSON.stringify(normalizeDraftScope(scope)))}`; }

function assetSource(value: unknown): value is string {
  if (!text(value, 4096) || !value) return false;
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return true;
  try { const url = new URL(value); return ['https:', 'http:', 'mxc:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
function mentions(value: unknown): DraftMention[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > DRAFT_LIMITS.mentions || value.some((item) => !object(item) || !id(item.userId) || !id(item.label))) throw new Error('Invalid mentions');
  return value.map((item) => ({ userId: item.userId, label: item.label }));
}
function draftText(value: unknown): DraftText {
  if (!object(value) || !text(value.body, DRAFT_LIMITS.body)) throw new Error('Invalid text');
  const result: DraftText = { body: value.body };
  if (value.mentions !== undefined) result.mentions = mentions(value.mentions);
  if (value.codeLanguage !== undefined) { if (!text(value.codeLanguage, 80)) throw new Error('Invalid language'); result.codeLanguage = value.codeLanguage; }
  if (value.codeMode !== undefined) { if (typeof value.codeMode !== 'boolean') throw new Error('Invalid mode'); result.codeMode = value.codeMode; }
  if (value.inlineEmojis !== undefined) {
    if (!Array.isArray(value.inlineEmojis) || value.inlineEmojis.length > DRAFT_LIMITS.inlineEmojis) throw new Error('Invalid emoji');
    result.inlineEmojis = value.inlineEmojis.map((item) => {
      if (!object(item) || !id(item.id) || !id(item.shortcode) || !text(item.name) || !assetSource(item.src)
        || !Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.end) || Number(item.start) < 0 || Number(item.end) > result.body.length
        || Number(item.end) <= Number(item.start) || result.body.slice(Number(item.start), Number(item.end)) !== item.shortcode
        || item.alt !== undefined && !text(item.alt) || item.title !== undefined && !text(item.title)) throw new Error('Invalid emoji');
      return { id: item.id, shortcode: item.shortcode, name: item.name, src: item.src, start: Number(item.start), end: Number(item.end),
        ...(item.alt !== undefined ? { alt: item.alt as string } : {}), ...(item.title !== undefined ? { title: item.title as string } : {}) };
    });
    const ordered = [...result.inlineEmojis].sort((a, b) => a.start - b.start);
    if (ordered.some((item, index) => index > 0 && item.start < ordered[index - 1].end)) throw new Error('Overlapping emoji');
  }
  return result;
}
function draftValue(value: unknown, allowEdit = true): StructuredDraft {
  const result: StructuredDraft = draftText(value);
  const source = value as Record<string, unknown>;
  if (source.reply !== undefined) {
    const reply = source.reply;
    if (!object(reply) || !id(reply.id) || !id(reply.senderId) || !text(reply.senderName) || !text(reply.body, DRAFT_LIMITS.body) || reply.threadRootId !== undefined && !id(reply.threadRootId)) throw new Error('Invalid reply');
    result.reply = { id: reply.id, senderId: reply.senderId, senderName: reply.senderName, body: reply.body, ...(reply.threadRootId ? { threadRootId: reply.threadRootId as string } : {}) };
  }
  if (source.edit !== undefined && allowEdit) {
    const edit = source.edit;
    if (!object(edit) || !id(edit.id) || !text(edit.body, DRAFT_LIMITS.body)) throw new Error('Invalid edit');
    result.edit = { id: edit.id, body: edit.body, originalDraft: draftValue(edit.originalDraft, false), ...(edit.mentions !== undefined ? { mentions: mentions(edit.mentions) } : {}) };
  }
  if (source.attachments !== undefined) {
    if (!Array.isArray(source.attachments) || source.attachments.length > DRAFT_LIMITS.attachments) throw new Error('Invalid attachments');
    result.attachments = source.attachments.map((item) => {
      if (!object(item) || !id(item.id) || !id(item.name) || !text(item.type, 255) || !Number.isSafeInteger(item.size) || Number(item.size) < 0
        || item.lastModified !== undefined && (!Number.isSafeInteger(item.lastModified) || Number(item.lastModified) < 0)
        || item.codeLanguage !== undefined && !text(item.codeLanguage, 80)
        || item.caption !== undefined && !text(item.caption, DRAFT_LIMITS.body)
        || item.interrupted !== undefined && typeof item.interrupted !== 'boolean') throw new Error('Invalid attachment');
      return { id: item.id, name: item.name, type: item.type, size: Number(item.size),
        ...(item.lastModified !== undefined ? { lastModified: Number(item.lastModified) } : {}), ...(item.codeLanguage !== undefined ? { codeLanguage: item.codeLanguage as string } : {}),
        ...(item.caption !== undefined ? { caption: item.caption as string } : {}), ...(item.interrupted !== undefined ? { interrupted: item.interrupted as boolean } : {}) };
    });
    if (new Set(result.attachments.map((item) => item.id)).size !== result.attachments.length) throw new Error('Duplicate attachment');
  }
  return result;
}

/** Sync revision checks protect delayed callbacks; storage events notify other tabs. */
export class StructuredDraftStore {
  private active?: Active;
  private generation = 0;
  private sequence = 0;
  private version = 0;
  private storageStatus: DraftStorageStatus = { mode: 'volatile' };
  private readonly listeners = new Set<() => void>();
  private readonly storage: () => DraftStorage;
  private readonly now: () => number;
  private readonly nonce: () => string;
  constructor(options: Options = {}) {
    this.storage = options.storage ?? (() => localStorage);
    this.now = options.now ?? Date.now;
    this.nonce = options.nonce ?? (() => crypto.randomUUID());
  }
  getVersion = () => this.version;
  getStatus = (): DraftStorageStatus => this.storageStatus;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1 && typeof window !== 'undefined') window.addEventListener('storage', this.onStorage);
    return () => { this.listeners.delete(listener); if (!this.listeners.size && typeof window !== 'undefined') window.removeEventListener('storage', this.onStorage); };
  };
  private emit() { this.version++; for (const listener of this.listeners) listener(); }
  private onStorage = (event: StorageEvent) => {
    const active = this.active;
    if (!active || event.key !== active.key && event.key !== null) return;
    let revoked = event.newValue === null;
    if (!revoked && event.newValue) {
      try { revoked = this.parse(event.newValue, active.scope).epoch !== active.envelope.epoch; } catch { /* A malformed external record is handled by refresh. */ }
    }
    if (revoked) { this.releaseMemory(); this.active = undefined; this.generation++; this.storageStatus = { mode: 'volatile' }; }
    else this.refresh();
    this.emit();
  };
  private releaseMemory() {
    const memory = this.active?.editorMemory;
    memory?.revisions.clear(); memory?.overrides.clear(); memory?.bases.clear(); memory?.issues.clear();
  }
  private fail(issue: DraftStorageIssue) { this.storageStatus = { mode: 'volatile', issue }; }
  private parse(serialized: string, scope: DraftScope): Envelope {
    if (byteLength(serialized) > DRAFT_LIMITS.bytes) throw new Error('corrupt');
    const raw: unknown = JSON.parse(serialized);
    if (!object(raw) || !object(raw.scope) || draftStorageKey(raw.scope as unknown as DraftScope) !== draftStorageKey(scope)) throw new Error('corrupt');
    if (raw.version !== 1 && raw.version !== 0) throw new Error('unsupported-version');
    if (!Array.isArray(raw.drafts) || raw.drafts.length > DRAFT_LIMITS.count || raw.version === 1 && !id(raw.epoch)) throw new Error('corrupt');
    const drafts = raw.drafts.map((record) => {
      if (!object(record) || !validContext(record.context)) throw new Error('corrupt');
      const value = draftValue(raw.version === 0 ? { body: record.body } : record.value);
      if (raw.version === 1 && (!id(record.revision) || typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt))) throw new Error('corrupt');
      return { context: { roomId: record.context.roomId, ...(record.context.threadRootId ? { threadRootId: record.context.threadRootId } : {}) }, value,
        revision: raw.version === 0 ? this.nonce() : record.revision as string, updatedAt: raw.version === 0 ? this.now() : record.updatedAt as number };
    });
    if (new Set(drafts.map((draft) => contextKey(draft.context))).size !== drafts.length) throw new Error('corrupt');
    return { version: 1, scope, epoch: raw.version === 0 ? this.nonce() : raw.epoch as string, drafts };
  }
  open(input: DraftScope): DraftSession {
    const scope = normalizeDraftScope(input);
    const key = draftStorageKey(scope);
    if (this.active?.key !== key) {
      this.releaseMemory();
      this.generation++;
      this.active = { editorMemory: { revisions: new Map(), overrides: new Map(), bases: new Map(), issues: new Map() }, scope, key, envelope: { version: 1, scope, epoch: this.nonce(), drafts: [] }, serialized: null, dirty: false, disabled: false };
      this.storageStatus = { mode: 'persistent' };
      try {
        const serialized = this.storage().getItem(key);
        if (serialized !== null) {
          this.active.serialized = serialized;
          try { this.active.envelope = this.parse(serialized, scope); }
          catch (error) {
            const issue = error instanceof Error && error.message === 'unsupported-version' ? 'unsupported-version' : 'corrupt';
            this.fail(issue); this.active.disabled = true;
          }
        } else this.persist();
      } catch { this.fail('unavailable'); this.active.disabled = true; }
      this.emit();
    }
    const generation = this.generation;
    const valid = () => generation === this.generation && this.active?.key === key;
    return {
      scope: clone(scope),
      editorMemory: () => valid() ? this.active?.editorMemory : undefined,
      isActive: () => { if (valid()) this.refresh(); return valid(); },
      read: (context) => valid() ? this.read(context) : undefined,
      list: () => valid() ? this.list() : [],
      write: (context, value, revision) => valid() ? this.write(context, value, revision) : { ok: false, reason: 'stale-session' },
      remove: (context, revision) => valid() ? this.write(context, undefined, revision) : { ok: false, reason: 'stale-session' },
      status: () => valid() ? this.getStatus() : { mode: 'volatile', issue: 'unavailable' },
    };
  }
  /** Revoke mounted UI callbacks while retaining volatile text through same-account reauthentication. */
  suspend(): void { this.generation++; this.emit(); }
  /** Explicit logout/forget: clear memory first, then remove private account storage. */
  clear(scope?: DraftScope): { cleared: boolean } {
    const active = this.active;
    const key = scope ? draftStorageKey(scope) : active?.key;
    const clearingActive = !scope || active?.key === key;
    if (clearingActive) { this.releaseMemory(); this.active = undefined; this.generation++; }
    let cleared = true;
    if (clearingActive) this.storageStatus = { mode: 'volatile' };
    if (key) try { this.storage().removeItem(key); } catch { cleared = false; this.fail('cleanup-failed'); }
    this.emit(); return { cleared };
  }
  private refresh(): boolean {
    const active = this.active;
    if (!active || active.disabled) return Boolean(active);
    try {
      const serialized = this.storage().getItem(active.key);
      if (serialized === active.serialized) return true;
      if (serialized === null) { this.releaseMemory(); this.active = undefined; this.generation++; return false; }
      const next = this.parse(serialized, active.scope);
      if (next.epoch !== active.envelope.epoch) { this.releaseMemory(); this.active = undefined; this.generation++; return false; }
      if (active.dirty) { this.fail('conflict'); return false; }
      active.envelope = next; active.serialized = serialized;
      return true;
    } catch { active.disabled = true; this.fail('unavailable'); return true; }
  }
  private read(context: DraftContext): StoredDraft | undefined {
    this.refresh();
    const record = this.active?.envelope.drafts.find((draft) => contextKey(draft.context) === contextKey(context));
    return record && clone(record);
  }
  private list(): StoredDraft[] { this.refresh(); return clone(this.active?.envelope.drafts ?? []).sort((a, b) => b.updatedAt - a.updatedAt || contextKey(a.context).localeCompare(contextKey(b.context))); }
  private persist(): void {
    const active = this.active!;
    if (active.disabled) return;
    const serialized = JSON.stringify(active.envelope);
    try { this.storage().setItem(active.key, serialized); active.serialized = serialized; active.dirty = false; this.storageStatus = { mode: 'persistent' }; }
    catch (error) { active.dirty = true; this.fail(error instanceof DOMException && error.name === 'QuotaExceededError' ? 'quota' : 'unavailable'); }
  }
  private write(context: DraftContext, value: StructuredDraft | undefined, revision: string | undefined): DraftWriteResult {
    if (!validContext(context)) return { ok: false, reason: 'invalid' };
    if (!this.refresh()) return { ok: false, reason: this.active ? 'conflict' : 'stale-session' };
    const active = this.active!;
    const key = contextKey(context);
    const current = active.envelope.drafts.find((draft) => contextKey(draft.context) === key);
    if (current?.revision !== revision) return { ok: false, reason: 'conflict', ...(current ? { current: clone(current) } : {}) };
    let draft: StoredDraft | undefined;
    try { if (value !== undefined) draft = { context: { roomId: context.roomId, ...(context.threadRootId ? { threadRootId: context.threadRootId } : {}) }, value: draftValue(value), revision: `${this.nonce()}:${++this.sequence}`, updatedAt: this.now() }; }
    catch { return { ok: false, reason: 'invalid' }; }
    const drafts = [...active.envelope.drafts.filter((record) => contextKey(record.context) !== key), ...(draft ? [draft] : [])];
    if (drafts.length > DRAFT_LIMITS.count || byteLength(JSON.stringify({ ...active.envelope, drafts })) > DRAFT_LIMITS.bytes) return { ok: false, reason: 'limit' };
    active.envelope = { ...active.envelope, drafts }; active.dirty = true;
    this.persist(); this.emit();
    return { ok: true, ...(draft ? { draft: clone(draft) } : {}), status: this.getStatus() };
  }
}
