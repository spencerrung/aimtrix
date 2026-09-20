import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { MatrixController } from './MatrixController';
import { defaultRuntimeConfig } from '../config/runtimeConfig';
import type { AimtrixPlatform } from '../platform/platform';

const encrypt = vi.hoisted(() => vi.fn(async (data: ArrayBuffer) => ({ data, info: { v: 'v2', key: { kty: 'oct', k: 'synthetic' }, hashes: { sha256: 'synthetic' }, iv: 'synthetic' } })));
vi.mock('matrix-encrypt-attachment', () => ({ encryptAttachment: encrypt }));
const roomId = '!media:test';
const sticker = { id: 'synthetic', name: 'Synthetic sticker', src: '/stickers/synthetic.svg' };
const emote = { ...sticker, shortcode: ':synthetic:' };
function response(type = 'image/svg+xml') { return new Response('synthetic', { headers: { 'content-type': type } }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
function fixture(encrypted = false) {
  const room = {
    roomId, getMyMembership: vi.fn().mockReturnValue('join'), hasEncryptionStateEvent: vi.fn().mockReturnValue(encrypted),
    hasPendingEvent: vi.fn().mockReturnValue(false), getEventForTxnId: () => undefined, getThread: () => undefined,
    currentState: { maySendEvent: vi.fn().mockReturnValue(true) },
  };
  const crypto = { isEncryptionEnabledInRoom: vi.fn().mockResolvedValue(false) };
  const client = {
    getRoom: vi.fn((id: string) => id === roomId ? room : undefined), getSafeUserId: () => '@self:test', getCrypto: vi.fn().mockReturnValue(crypto),
    makeTxnId: () => 'synthetic-transaction', uploadContent: vi.fn().mockResolvedValue({ content_uri: 'mxc://test/synthetic' }),
    sendEvent: vi.fn().mockResolvedValue({ event_id: '$accepted' }), sendMessage: vi.fn().mockResolvedValue({ event_id: '$accepted' }),
  };
  const config = structuredClone(defaultRuntimeConfig);
  const controller = new MatrixController(config);
  const internal = controller as unknown as { client?: MatrixClient; sdk: unknown; scheduleWorkspacePublish: () => void };
  internal.client = client as unknown as MatrixClient;
  internal.sdk = { EventType: { Sticker: 'm.sticker', RoomMessage: 'm.room.message' }, MsgType: { Text: 'm.text' } };
  internal.scheduleWorkspacePublish = vi.fn();
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response());
  vi.stubGlobal('fetch', fetch);
  return { controller, internal, client, crypto, room, fetch, config };
}
beforeEach(() => { vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('File', NodeFile); encrypt.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

describe('controller media sends across room and thread destinations', () => {
  it('encrypts thread stickers using remembered crypto state and the standard five-argument thread overload', async () => {
    const test = fixture(); test.crypto.isEncryptionEnabledInRoom.mockResolvedValue(true);
    await test.controller.sendSticker(roomId, sticker, '$root');
    expect(encrypt).toHaveBeenCalledOnce();
    expect(test.client.uploadContent).toHaveBeenCalledWith(expect.any(Blob), { type: 'application/octet-stream', includeFilename: false });
    expect(test.client.sendEvent).toHaveBeenCalledWith(roomId, '$root', 'm.sticker', expect.objectContaining({
      file: expect.objectContaining({ url: 'mxc://test/synthetic' }),
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root', is_falling_back: true, 'm.in_reply_to': { event_id: '$root' } },
    }), 'synthetic-transaction');
    expect(test.client.sendEvent.mock.calls[0][3]).not.toHaveProperty('url');
    expect(test.fetch).toHaveBeenCalledWith(sticker.src, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  });

  it('supports relative bundled stickers on native local origins without allowing arbitrary schemes', async () => {
    const test = fixture();
    const platform = (test.controller as unknown as { platform: AimtrixPlatform }).platform;
    const location = vi.spyOn(platform.deepLinks, 'currentUrl').mockReturnValue(new URL('tauri://localhost'));
    try {
      await test.controller.sendSticker(roomId, sticker);
      expect(test.fetch).toHaveBeenCalledWith(sticker.src, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      await expect(test.controller.sendSticker(roomId, { ...sticker, src: 'file:///private/image.png' })).rejects.toThrow('unsupported URL');
    } finally { location.mockRestore(); }
  });

  it('routes GIFs through encrypted attachment upload with the requested thread root', async () => {
    const test = fixture(true); test.fetch.mockImplementation(async () => response('image/gif'));
    await test.controller.sendGif(roomId, { title: 'Synthetic gif', mediaUrl: 'https://media.example.test/synthetic.gif' }, '$root');
    expect(test.client.sendEvent).toHaveBeenCalledWith(roomId, '$root', 'm.room.message', expect.objectContaining({
      msgtype: 'm.image', file: expect.objectContaining({ url: 'mxc://test/synthetic' }),
      'm.relates_to': expect.objectContaining({ rel_type: 'm.thread', event_id: '$root' }),
    }), 'synthetic-transaction');
    expect(test.client.sendMessage).not.toHaveBeenCalled();
  });

  it.each(['gif', 'sticker', 'inline-emoji'] as const)('does not upload %s into a replacement session after asset fetch', async (kind) => {
    const test = fixture(); const held = deferred<Response>(); test.fetch.mockReturnValueOnce(held.promise);
    const sending = kind === 'gif' ? test.controller.sendGif(roomId, { title: 'Synthetic', mediaUrl: 'https://media.example.test/image.gif' }, '$root')
      : kind === 'sticker' ? test.controller.sendSticker(roomId, sticker, '$root')
        : test.controller.sendThreadMessage(roomId, '$root', ':synthetic:', [], [emote]);
    const failure = expect(sending).rejects.toThrow();
    await vi.waitFor(() => expect(test.fetch).toHaveBeenCalled());
    test.internal.client = undefined;
    held.resolve(response()); await failure;
    expect(test.client.uploadContent).not.toHaveBeenCalled(); expect(test.client.sendEvent).not.toHaveBeenCalled();
  });

  it.each(['membership', 'permission', 'encryption'] as const)('blocks a sticker when %s changes during download', async (change) => {
    const test = fixture(); const held = deferred<Response>(); test.fetch.mockReturnValueOnce(held.promise);
    const sending = test.controller.sendSticker(roomId, sticker); const failure = expect(sending).rejects.toThrow();
    await vi.waitFor(() => expect(test.fetch).toHaveBeenCalled());
    if (change === 'membership') test.room.getMyMembership.mockReturnValue('leave');
    if (change === 'permission') test.room.currentState.maySendEvent.mockReturnValue(false);
    if (change === 'encryption') test.crypto.isEncryptionEnabledInRoom.mockResolvedValue(true);
    held.resolve(response()); await failure;
    expect(test.client.uploadContent).not.toHaveBeenCalled(); expect(test.client.sendEvent).not.toHaveBeenCalled();
  });

  it('does not send a plaintext sticker asset after encryption is enabled during upload', async () => {
    const test = fixture();
    test.client.uploadContent.mockImplementationOnce(async () => { test.room.hasEncryptionStateEvent.mockReturnValue(true); return { content_uri: 'mxc://test/plain' }; });
    await expect(test.controller.sendSticker(roomId, sticker)).rejects.toThrow('encryption changed');
    expect(test.client.sendEvent).not.toHaveBeenCalled();
    await test.controller.sendSticker(roomId, sticker);
    expect(test.client.sendEvent.mock.calls[0][2]).toHaveProperty('file');
    expect(encrypt).toHaveBeenCalledOnce();
  });

  it('retains inline emoji and mention metadata in a thread while checking permission after upload', async () => {
    const test = fixture();
    await test.controller.sendThreadMessage(roomId, '$root', '@Peer :synthetic:', [{ userId: '@peer:test', label: 'Peer' }], [emote]);
    expect(test.client.sendEvent.mock.calls[0][3]).toMatchObject({
      'm.mentions': { user_ids: ['@peer:test'] }, format: 'org.matrix.custom.html',
      formatted_body: expect.stringContaining('data-mx-emoticon'),
      'm.relates_to': expect.objectContaining({ event_id: '$root' }),
    });
    test.client.sendEvent.mockClear();
    test.client.uploadContent.mockImplementationOnce(async () => { test.room.currentState.maySendEvent.mockReturnValue(false); return { content_uri: 'mxc://test/second' }; });
    await expect(test.controller.sendThreadMessage(roomId, '$root', ':other:', [], [{ ...emote, id: 'other', src: '/other.svg', shortcode: ':other:' }])).rejects.toThrow('cannot send');
    expect(test.client.sendEvent).not.toHaveBeenCalled();
  });

  it('rejects unsupported or oversized assets and stops oversized streaming responses before uploading', async () => {
    const test = fixture(); test.config.media.maxUploadBytes = 10;
    test.fetch.mockImplementationOnce(async () => response('text/html'));
    await expect(test.controller.sendSticker(roomId, sticker)).rejects.toThrow('unsupported media');
    const cancelled = vi.fn();
    test.fetch.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(11)); }, cancel: cancelled,
    }), { headers: { 'content-type': 'image/png' } }));
    await expect(test.controller.sendSticker(roomId, sticker)).rejects.toThrow('upload limit');
    expect(cancelled).toHaveBeenCalledOnce();
    await expect(test.controller.sendGif(roomId, { title: 'Synthetic', mediaUrl: 'data:image/gif;base64,AA==' })).rejects.toThrow('unsupported URL');
    expect(test.client.uploadContent).not.toHaveBeenCalled();
  });
});
