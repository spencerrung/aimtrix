import { attachmentValidationError, type AttachmentSendOptions, type AttachmentPhase } from '../../matrix/AttachmentSender';
import type { DraftAttachment, DraftContext } from './structuredDrafts';

export type StagedAttachment = DraftAttachment & {
  context: DraftContext;
  file?: File;
  phase: 'staged' | 'reattach' | 'queued' | AttachmentPhase | 'failed' | 'sent' | 'cancelled';
  progress: number;
  error?: string;
};
export const attachmentContextKey = (context: DraftContext) => JSON.stringify([context.roomId, context.threadRootId ?? null]);
const mutable = (item: StagedAttachment) => ['staged', 'reattach', 'failed', 'cancelled', 'sent'].includes(item.phase);

/** File bytes are held only for the current mounted account, never persisted. */
export class StagedAttachments {
  private items: StagedAttachment[] = [];
  private version = 0;
  private generation = 0;
  private running = false;
  private activeAbort?: AbortController;
  private activeId?: string;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly actions: {
    maxBytes: number;
    send: (context: DraftContext, file: File, progress: (loaded: number, total: number) => void, codeLanguage: string | undefined, options: AttachmentSendOptions) => Promise<void>;
    cancel?: (id: string) => void;
    persist: (context: DraftContext, descriptors: DraftAttachment[]) => void;
  }) {}
  getVersion = () => this.version;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  list(context: DraftContext): StagedAttachment[] { return this.items.filter((item) => attachmentContextKey(item.context) === attachmentContextKey(context)); }
  private changed(context: DraftContext): void {
    const descriptors = this.list(context).filter((item) => !['sent', 'cancelled'].includes(item.phase)).map((item) => ({
      id: item.id, name: item.name, type: item.type, size: item.size, lastModified: item.lastModified,
      codeLanguage: item.codeLanguage, caption: item.caption, interrupted: item.interrupted,
    }));
    this.actions.persist(context, descriptors);
    this.version++; for (const listener of this.listeners) listener();
  }
  restore(context: DraftContext, descriptors: DraftAttachment[]): void {
    for (const descriptor of descriptors) if (this.items.length < 128 && this.list(context).length < 20 && !this.items.some((item) => item.id === descriptor.id)) {
      this.items.push({ ...descriptor, context, phase: 'reattach', progress: 0 });
    }
    this.version++; for (const listener of this.listeners) listener();
  }
  stage(context: DraftContext, files: File[], codeLanguage?: string): string[] {
    const errors: string[] = [];
    // Completed rows are feedback, not retained queue capacity or file storage.
    this.items = this.items.filter((item) => !['sent', 'cancelled'].includes(item.phase));
    for (const file of files) {
      const error = attachmentValidationError(file, this.actions.maxBytes);
      if (error) { errors.push(`${file.name}: ${error}`); continue; }
      if (this.list(context).filter((item) => !['sent', 'cancelled'].includes(item.phase)).length >= 20 || this.items.length >= 128) {
        errors.push('Finish or remove staged attachments before adding more.'); break;
      }
      this.items.push({ id: crypto.randomUUID(), context, file, name: file.name, type: file.type, size: file.size,
        lastModified: file.lastModified, codeLanguage, phase: 'staged', progress: 0 });
    }
    this.changed(context); return errors;
  }
  caption(id: string, caption: string): void {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || !['staged', 'reattach'].includes(item.phase)) return;
    item.caption = caption.slice(0, 16_384); this.changed(item.context);
  }
  reattach(id: string, file: File): string | undefined {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.phase !== 'reattach') return 'This attachment is no longer waiting for a file.';
    const error = attachmentValidationError(file, this.actions.maxBytes);
    if (error) return error;
    if (file.name !== item.name || file.size !== item.size) return 'Choose the original file, or remove this item and add a different file.';
    item.file = file; item.type = file.type; item.lastModified = file.lastModified; item.phase = 'staged';
    this.changed(item.context); return undefined;
  }
  move(id: string, offset: -1 | 1): void {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || !mutable(item)) return;
    const siblings = this.list(item.context);
    const other = siblings[siblings.indexOf(item) + offset];
    if (!other || !mutable(other)) return;
    const a = this.items.indexOf(item), b = this.items.indexOf(other);
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    this.changed(item.context);
  }
  remove(id: string): void {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.phase === 'sending') return;
    this.actions.cancel?.(id);
    if (item.id === this.activeId) this.activeAbort?.abort();
    this.items = this.items.filter((candidate) => candidate !== item);
    this.changed(item.context);
  }
  send(context: DraftContext): void {
    for (const item of this.list(context)) if (item.phase === 'staged' && item.file) item.phase = 'queued';
    this.changed(context); void this.pump();
  }
  retry(id: string): void {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.phase !== 'failed' || !item.file) return;
    item.phase = 'queued'; item.error = undefined; this.changed(item.context); void this.pump();
  }
  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const generation = this.generation;
    try {
      while (generation === this.generation) {
        const item = this.items.find((candidate) => candidate.phase === 'queued');
        if (!item?.file) break;
        const abort = new AbortController(); this.activeAbort = abort; this.activeId = item.id;
        const current = () => generation === this.generation && this.items.includes(item);
        item.interrupted = true;
        this.changed(item.context);
        try {
          await this.actions.send(item.context, item.file, (loaded, total) => {
            if (!current()) return;
            item.progress = total > 0 ? Math.min(100, Math.round(loaded / total * 100)) : 0;
            this.version++; for (const listener of this.listeners) listener();
          }, item.codeLanguage, { id: item.id, signal: abort.signal, caption: item.caption,
            onPhase: (phase) => { if (current()) { item.phase = phase; this.changed(item.context); } } });
          if (current()) { item.phase = 'sent'; item.file = undefined; item.progress = 100; item.interrupted = false; }
        } catch {
          if (current()) {
            item.phase = abort.signal.aborted ? 'cancelled' : 'failed';
            item.error = abort.signal.aborted ? undefined : 'This attachment could not be confirmed. Retry this item or remove it.';
            if (abort.signal.aborted) item.file = undefined;
          }
        } finally { if (current()) this.changed(item.context); }
      }
    } finally { if (generation === this.generation) { this.running = false; this.activeAbort = undefined; this.activeId = undefined; } }
  }
  clear(): void {
    this.generation++; this.activeAbort?.abort();
    for (const item of this.items) this.actions.cancel?.(item.id);
    this.items = []; this.running = false; this.activeAbort = undefined; this.activeId = undefined;
    this.version++; for (const listener of this.listeners) listener();
  }
}
