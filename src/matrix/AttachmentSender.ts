import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { EventType, MsgType } from 'matrix-js-sdk/lib/@types/event.js';
import type { RoomMessageEventContent } from 'matrix-js-sdk/lib/@types/events.js';

export type AttachmentPhase = 'encrypting' | 'uploading' | 'sending';
export interface AttachmentSendOptions {
  /** Stable for this staged item, including its retries; scoped to this session. */
  id?: string;
  signal?: AbortSignal;
  caption?: string;
  onPhase?: (phase: AttachmentPhase) => void;
}

type Operation = {
  client: MatrixClient; roomId: string; rootId?: string; fingerprint: string;
  txnId: string; content?: RoomMessageEventContent; event?: MatrixEvent;
  accepted: boolean; running: boolean; phase?: AttachmentPhase; abort?: AbortController;
};

export function attachmentValidationError(file: Pick<File, 'size' | 'name' | 'type'>, maxBytes: number): string | undefined {
  if (!file.size) return 'Empty files cannot be attached.';
  if (file.size > maxBytes) return 'This file exceeds the configured attachment size limit.';
  if (!file.name || file.name.length > 1024 || [...file.name].some((character) => character.charCodeAt(0) < 32)) return 'This file has an unsupported name.';
  if (file.type && !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/u.test(file.type)) return 'This file has an unsupported media type.';
  return undefined;
}

/** Session-owned uploads: preserve the event transaction and ciphertext on retry. */
export class AttachmentSender {
  private operations = new Map<string, Operation>();
  private generation = 0;

  constructor(private readonly hooks: {
    client: () => MatrixClient | undefined;
    maxBytes: number;
    relation: (roomId: string, rootId: string) => Record<string, unknown>;
    track: (client: MatrixClient, event: MatrixEvent) => void;
    changed: (roomId: string) => void;
  }) {}

  public cancel(id?: string): boolean {
    let cancelled = false;
    for (const [key, operation] of this.operations) {
      if (id && key !== id || operation.accepted || operation.phase === 'sending') continue;
      operation.abort?.abort();
      if (!operation.running && operation.event?.status === 'not_sent') {
        operation.client.cancelPendingEvent(operation.event);
        this.hooks.track(operation.client, operation.event);
      }
      if (!operation.running) this.operations.delete(key);
      cancelled = true;
    }
    return cancelled;
  }

  public clear(): void {
    this.generation++;
    for (const operation of this.operations.values()) operation.abort?.abort();
    this.operations.clear();
  }

  public async send(roomId: string, file: File, progress?: (loaded: number, total: number) => void,
    rootId?: string, codeLanguage?: string, options: AttachmentSendOptions = {}): Promise<void> {
    const client = this.hooks.client();
    const room = client?.getRoom(roomId);
    if (!client || !room || room.getMyMembership() !== 'join') throw new Error('This conversation is not available.');
    if (rootId && (!rootId.startsWith('$') || room.hasPendingEvent(rootId))) throw new Error('This thread is not available.');
    const invalid = attachmentValidationError(file, this.hooks.maxBytes);
    if (invalid) throw new Error(invalid);
    const id = options.id ?? client.makeTxnId();
    const fingerprint = JSON.stringify([file.name, file.size, file.type, file.lastModified, options.caption ?? '', codeLanguage ?? '']);
    let operation = this.operations.get(id);
    if (operation && (operation.client !== client || operation.roomId !== roomId || operation.rootId !== rootId || operation.fingerprint !== fingerprint)) {
      throw new Error('This attachment changed. Remove it and add it again.');
    }
    if (operation?.accepted) return;
    if (operation?.running) throw new Error('This attachment is already being sent.');
    if (!operation) {
      while (this.operations.size >= 128) {
        const completed = [...this.operations].find(([, value]) => value.accepted);
        if (!completed) throw new Error('Finish or remove pending attachments before adding more.');
        this.operations.delete(completed[0]);
      }
      operation = { client, roomId, rootId, fingerprint, txnId: client.makeTxnId(), accepted: false, running: false };
      this.operations.set(id, operation);
    }
    const current = operation;
    const generation = this.generation;
    let requiresEncryption = room.hasEncryptionStateEvent();
    const abort = new AbortController();
    current.abort = abort; current.running = true;
    const cancel = () => { if (current.phase !== 'sending') abort.abort(); };
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) abort.abort();
    const guard = () => {
      if (generation !== this.generation || this.hooks.client() !== client || client.getRoom(roomId) !== room) throw new Error('The Matrix session changed.');
      if (abort.signal.aborted) throw new DOMException('Attachment cancelled.', 'AbortError');
      if (room.getMyMembership() !== 'join') throw new Error('This conversation is no longer available.');
      if ((requiresEncryption || room.hasEncryptionStateEvent()) && !client.getCrypto()) throw new Error('Encryption is not ready for this conversation.');
    };
    const encryptionRequired = async () => {
      guard();
      const required = room.hasEncryptionStateEvent() || Boolean(await client.getCrypto()?.isEncryptionEnabledInRoom?.(roomId));
      guard(); return required;
    };
    const permission = () => {
      if (!room.currentState.maySendEvent(requiresEncryption ? EventType.RoomMessageEncrypted : EventType.RoomMessage, client.getSafeUserId())) throw new Error('You cannot send attachments in this conversation.');
    };
    const phase = (value: AttachmentPhase) => { current.phase = value; options.onPhase?.(value); };
    try {
      guard();
      requiresEncryption = await encryptionRequired();
      permission();
      if (current.content && requiresEncryption && !('file' in current.content)) {
        // An existing failed SDK event must not be retried with its old plaintext
        // media reference after encryption is enabled. A new staged item is required.
        if (current.event || room.getEventForTxnId(current.txnId)) throw new Error('Room encryption changed. Remove this attachment and add it again.');
        current.content = undefined;
      }
      if (!current.content) {
        const encryptedRoom = requiresEncryption;
        const msgtype = file.type.startsWith('image/') ? MsgType.Image : file.type.startsWith('video/') ? MsgType.Video : file.type.startsWith('audio/') ? MsgType.Audio : MsgType.File;
        const metadata = { msgtype, body: options.caption?.trim() || file.name, filename: file.name,
          info: { mimetype: file.type || 'application/octet-stream', size: file.size },
          ...(codeLanguage ? { 'dev.alucard.aimtrix.code.v1': { language: codeLanguage } } : {}) };
        const uploadOptions = { abortController: abort, progressHandler: (value: { loaded: number; total: number }) => {
          if (this.generation === generation && !abort.signal.aborted) progress?.(value.loaded, value.total || file.size);
        } };
        if (encryptedRoom) {
          phase('encrypting');
          const { encryptAttachment } = await import('matrix-encrypt-attachment');
          guard();
          const bytes = await file.arrayBuffer();
          guard();
          const encrypted = await encryptAttachment(bytes);
          guard(); permission(); phase('uploading'); guard(); permission();
          const uploaded = await client.uploadContent(new Blob([encrypted.data]), { ...uploadOptions, type: 'application/octet-stream', includeFilename: false });
          guard();
          current.content = { ...metadata, file: { ...encrypted.info, hashes: encrypted.info.hashes ?? {}, url: uploaded.content_uri } } as RoomMessageEventContent;
        } else {
          guard(); permission(); phase('uploading'); guard(); permission();
          const uploaded = await client.uploadContent(file, { ...uploadOptions, name: file.name, type: file.type });
          guard();
          // Encryption can be enabled during an upload. Never publish a plaintext
          // file reference into a room which became encrypted in the meantime.
          if (await encryptionRequired()) throw new Error('Room encryption changed. Retry to encrypt this attachment.');
          current.content = { ...metadata, url: uploaded.content_uri } as RoomMessageEventContent;
        }
      }
      guard();
      const nowEncrypted = await encryptionRequired();
      if (requiresEncryption && !nowEncrypted) throw new Error('Room encryption changed. Check this conversation before retrying.');
      requiresEncryption = nowEncrypted;
      permission();
      if (requiresEncryption && !('file' in current.content)) {
        current.content = undefined;
        throw new Error('Room encryption changed. Retry to encrypt this attachment.');
      }
      const prior = current.event ?? room.getEventForTxnId(current.txnId);
      if (prior && (prior.status === null || prior.status === 'sent')) { current.accepted = true; return; }
      if (prior?.status === 'cancelled') throw new Error('This attachment was cancelled. Add it again to send.');
      phase('sending'); guard(); permission();
      const sending = prior?.status === 'not_sent' ? client.resendEvent(prior, room)
        : rootId ? client.sendEvent(roomId, rootId, EventType.RoomMessage, { ...current.content, ...this.hooks.relation(roomId, rootId) } as RoomMessageEventContent, current.txnId)
          : client.sendMessage(roomId, current.content, current.txnId);
      current.event = prior ?? room.getEventForTxnId(current.txnId);
      if (current.event) this.hooks.track(client, current.event);
      await sending;
      guard(); current.accepted = true;
    } catch (error) {
      current.event ??= room.getEventForTxnId(current.txnId);
      if (generation === this.generation && this.hooks.client() === client && current.event && (current.event.status === null || current.event.status === 'sent')) current.accepted = true;
      else throw error;
    } finally {
      options.signal?.removeEventListener('abort', cancel);
      current.running = false; current.abort = undefined; current.phase = undefined;
      if (generation === this.generation && this.hooks.client() === client) {
        if (current.event) this.hooks.track(client, current.event);
        if (abort.signal.aborted && !current.event) this.operations.delete(id);
        this.hooks.changed(roomId);
      }
    }
  }
}
