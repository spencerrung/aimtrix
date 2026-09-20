import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { AttachmentSender } from './AttachmentSender';

const encrypt = vi.hoisted(() => vi.fn(async (data: ArrayBuffer) => ({ data, info: { v: 'v2', hashes: { sha256: 'synthetic' }, iv: 'synthetic', key: { kty: 'oct', k: 'synthetic' } } })));
vi.mock('matrix-encrypt-attachment', () => ({ encryptAttachment: encrypt }));
const file = () => {
  const value = new File(['synthetic'], 'sample.txt', { type: 'text/plain', lastModified: 1 });
  Object.defineProperty(value, 'arrayBuffer', { value: async () => new ArrayBuffer(9) });
  return value;
};
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function fixture(encrypted = false) {
  const pending = new Map<string, MatrixEvent>();
  let sequence = 0;
  const room = { roomId: '!synthetic:test', getMyMembership: () => 'join', hasPendingEvent: () => false,
    hasEncryptionStateEvent: vi.fn(() => encrypted), currentState: { maySendEvent: vi.fn(() => true) },
    getEventForTxnId: (id: string) => pending.get(id) } as unknown as Room;
  const uploadContent = vi.fn<MatrixClient['uploadContent']>().mockResolvedValue({ content_uri: 'mxc://synthetic.test/file' });
  const sendMessage = vi.fn<MatrixClient['sendMessage']>().mockResolvedValue({ event_id: '$accepted' });
  const resendEvent = vi.fn(async (event: MatrixEvent) => { event.status = null; return { event_id: '$accepted' }; });
  const client = { getRoom: () => room, getSafeUserId: () => '@self:synthetic.test', getCrypto: vi.fn(() => ({ isEncryptionEnabledInRoom: async () => false })),
    makeTxnId: () => `transaction-${++sequence}`, uploadContent, sendMessage, sendEvent: vi.fn(async () => ({ event_id: '$thread-accepted' })), resendEvent,
    cancelPendingEvent: vi.fn((event: MatrixEvent) => { event.status = 'cancelled' as MatrixEvent['status']; }) } as unknown as MatrixClient;
  let active: MatrixClient | undefined = client;
  const track = vi.fn();
  const sender = new AttachmentSender({ client: () => active, maxBytes: 1000, track, changed: vi.fn(),
    relation: (_room, root) => ({ 'm.relates_to': { rel_type: 'm.thread', event_id: root } }) });
  return { sender, client, room, pending, uploadContent, sendMessage, resendEvent, track, disconnect: () => { active = undefined; sender.clear(); } };
}

describe('AttachmentSender', () => {
  it.each([false, true])('honors synchronous cancellation from upload phase feedback (encrypted=%s)', async (encrypted) => {
    const test = fixture(encrypted);
    await expect(test.sender.send(test.room.roomId, file(), undefined, undefined, undefined, {
      id: 'phase-cancel', onPhase: (phase) => { if (phase === 'uploading') test.sender.cancel('phase-cancel'); },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(test.uploadContent).not.toHaveBeenCalled();
    expect(test.sendMessage).not.toHaveBeenCalled();
  });

  it('sends standard captions and a stable transaction, and never resends a successful item', async () => {
    const test = fixture(); const attachment = file();
    await test.sender.send(test.room.roomId, attachment, undefined, undefined, undefined, { id: 'item', caption: 'A caption' });
    await test.sender.send(test.room.roomId, attachment, undefined, undefined, undefined, { id: 'item', caption: 'A caption' });
    expect(test.uploadContent).toHaveBeenCalledTimes(1);
    expect(test.sendMessage).toHaveBeenCalledTimes(1);
    expect(test.sendMessage).toHaveBeenCalledWith(test.room.roomId, expect.objectContaining({ body: 'A caption', filename: 'sample.txt', url: 'mxc://synthetic.test/file' }), expect.any(String));
  });
  it('retries the original encrypted local event without reuploading or re-encrypting the file', async () => {
    const test = fixture(true); const attachment = file(); const before = encrypt.mock.calls.length;
    const event = { status: 'not_sent' } as MatrixEvent;
    test.sendMessage.mockImplementationOnce(async (...args: unknown[]) => {
      test.pending.set(args[2] as string, event); throw new Error('synthetic failure');
    });
    await expect(test.sender.send(test.room.roomId, attachment, undefined, undefined, undefined, { id: 'item' })).rejects.toThrow();
    await test.sender.send(test.room.roomId, attachment, undefined, undefined, undefined, { id: 'item' });
    expect(test.resendEvent).toHaveBeenCalledWith(event, test.room);
    expect(test.uploadContent).toHaveBeenCalledTimes(1);
    expect(encrypt.mock.calls.length - before).toBe(1);
    expect(test.sendMessage.mock.calls[0][1]).toMatchObject({ filename: 'sample.txt', file: { url: 'mxc://synthetic.test/file' } });
    expect(test.sendMessage.mock.calls[0][1]).not.toHaveProperty('url');
  });
  it('preserves acceptance when the remote echo wins a failed HTTP response', async () => {
    const test = fixture();
    test.sendMessage.mockImplementationOnce(async (...args: unknown[]) => { test.pending.set(args[2] as string, { status: null } as MatrixEvent); throw new Error('late failure'); });
    await expect(test.sender.send(test.room.roomId, file(), undefined, undefined, undefined, { id: 'item' })).resolves.toBeUndefined();
  });
  it('does not send or upload after cancellation while encryption is pending', async () => {
    const test = fixture(true); const held = deferred<Awaited<ReturnType<typeof encrypt>>>();
    encrypt.mockReturnValueOnce(held.promise);
    const sending = test.sender.send(test.room.roomId, file(), undefined, undefined, undefined, { id: 'item' });
    const failure = expect(sending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(encrypt).toHaveBeenCalled());
    test.sender.cancel('item');
    held.resolve({ data: new ArrayBuffer(9), info: { v: 'v2', hashes: { sha256: 'synthetic' }, iv: 'synthetic', key: { kty: 'oct', k: 'synthetic' } } });
    await failure;
    expect(test.uploadContent).not.toHaveBeenCalled(); expect(test.sendMessage).not.toHaveBeenCalled();
  });
  it('releases failed SDK events on item removal and refuses cancellation once sending starts', async () => {
    const test = fixture(); const held = deferred<{ event_id: string }>();
    test.sendMessage.mockReturnValueOnce(held.promise);
    const sending = test.sender.send(test.room.roomId, file(), undefined, undefined, undefined, { id: 'item' });
    await vi.waitFor(() => expect(test.sendMessage).toHaveBeenCalled());
    expect(test.sender.cancel('item')).toBe(false);
    held.resolve({ event_id: '$accepted' }); await sending;
    const failed = { status: 'not_sent' } as MatrixEvent;
    test.sendMessage.mockImplementationOnce(async (...args: unknown[]) => { test.pending.set(args[2] as string, failed); throw new Error('failure'); });
    await expect(test.sender.send(test.room.roomId, file(), undefined, undefined, undefined, { id: 'failed' })).rejects.toThrow();
    test.sender.cancel('failed');
    expect(test.client.cancelPendingEvent).toHaveBeenCalledWith(failed);
  });
  it('stops a plaintext upload if encryption becomes enabled before send', async () => {
    const test = fixture();
    test.uploadContent.mockImplementationOnce(async () => { vi.mocked(test.room.hasEncryptionStateEvent).mockReturnValue(true); return { content_uri: 'mxc://synthetic.test/plain' }; });
    await expect(test.sender.send(test.room.roomId, file())).rejects.toThrow('encryption changed');
    expect(test.sendMessage).not.toHaveBeenCalled();
  });
  it('uses the crypto backend encryption knowledge even when room state is incomplete', async () => {
    const test = fixture();
    vi.mocked(test.client.getCrypto).mockReturnValue({ isEncryptionEnabledInRoom: async () => true } as unknown as ReturnType<MatrixClient['getCrypto']>);
    await test.sender.send(test.room.roomId, file(), undefined, '$root', undefined, { id: 'item' });
    expect(test.client.sendEvent).toHaveBeenCalledWith(test.room.roomId, '$root', 'm.room.message', expect.objectContaining({ file: expect.any(Object), 'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } }), expect.any(String));
  });
  it('rejects missing crypto, denied permissions and invalid files before uploading', async () => {
    const test = fixture(true);
    vi.mocked(test.client.getCrypto).mockReturnValue(undefined);
    await expect(test.sender.send(test.room.roomId, file())).rejects.toThrow('Encryption');
    expect(test.uploadContent).not.toHaveBeenCalled();
    const plain = fixture(); vi.mocked(plain.room.currentState.maySendEvent).mockReturnValue(false);
    await expect(plain.sender.send(plain.room.roomId, file())).rejects.toThrow('cannot send');
    await expect(plain.sender.send(plain.room.roomId, new File([], 'empty'))).rejects.toThrow('Empty');
    await expect(plain.sender.send(plain.room.roomId, new File(['x'.repeat(1001)], 'large'))).rejects.toThrow('size limit');
    expect(plain.uploadContent).not.toHaveBeenCalled();
  });
  it('ignores completion from a previous account lifecycle', async () => {
    const test = fixture(); const held = deferred<{ content_uri: string }>(); test.uploadContent.mockReturnValueOnce(held.promise);
    const sending = test.sender.send(test.room.roomId, file()); const failure = expect(sending).rejects.toThrow('session changed');
    await vi.waitFor(() => expect(test.uploadContent).toHaveBeenCalled()); test.disconnect(); held.resolve({ content_uri: 'mxc://synthetic.test/old' }); await failure;
    expect(test.sendMessage).not.toHaveBeenCalled();
  });

  it('does not retry a failed plaintext SDK event after encryption becomes required', async () => {
    const test = fixture(); const attachment = file();
    const failed = { status: 'not_sent' } as MatrixEvent;
    test.sendMessage.mockImplementationOnce(async (...args: unknown[]) => { test.pending.set(args[2] as string, failed); throw new Error('Synthetic rejection'); });
    await expect(test.sender.send(test.room.roomId, attachment, undefined, undefined, undefined, { id: 'item' })).rejects.toThrow();
    vi.mocked(test.room.hasEncryptionStateEvent).mockReturnValue(true);
    await expect(test.sender.send(test.room.roomId, attachment, undefined, undefined, undefined, { id: 'item' })).rejects.toThrow('Remove this attachment');
    expect(test.resendEvent).not.toHaveBeenCalled(); expect(test.uploadContent).toHaveBeenCalledTimes(1);
    expect(test.sender.cancel('item')).toBe(true);
    expect(test.client.cancelPendingEvent).toHaveBeenCalledWith(failed);
  });

  it.each(['membership', 'permission'] as const)('checks changed %s after an upload before sending', async (change) => {
    const test = fixture();
    test.uploadContent.mockImplementationOnce(async () => {
      if (change === 'membership') vi.spyOn(test.room, 'getMyMembership').mockReturnValue('leave');
      else vi.mocked(test.room.currentState.maySendEvent).mockReturnValue(false);
      return { content_uri: 'mxc://synthetic.test/file' };
    });
    await expect(test.sender.send(test.room.roomId, file())).rejects.toThrow();
    expect(test.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects duplicate active operations and aborts an upload without sending', async () => {
    const test = fixture(); const attachment = file(); const held = deferred<{ content_uri: string }>();
    test.uploadContent.mockReturnValueOnce(held.promise);
    const sending = test.sender.send(test.room.roomId, attachment, undefined, undefined, undefined, { id: 'item' });
    const failure = expect(sending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(test.uploadContent).toHaveBeenCalled());
    await expect(test.sender.send(test.room.roomId, attachment, undefined, undefined, undefined, { id: 'item' })).rejects.toThrow('already being sent');
    test.sender.cancel('item');
    expect(test.uploadContent.mock.calls[0][1]?.abortController?.signal.aborted).toBe(true);
    held.resolve({ content_uri: 'mxc://synthetic.test/file' }); await failure;
    expect(test.sendMessage).not.toHaveBeenCalled();
  });
});
