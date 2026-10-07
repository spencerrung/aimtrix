import { Blob as NodeBlob } from 'node:buffer';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { decryptAttachment, encryptAttachment } from 'matrix-encrypt-attachment';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { MatrixController } from './MatrixController';
import { defaultRuntimeConfig } from '../config/runtimeConfig';
import { MediaProvider } from './MediaProvider';
import { useMediaSource } from './useMediaSource';
import { MessageContent } from '../features/workspace/MessageContent';
import type { EncryptedMediaInfo } from './mediaContext';

vi.mock('matrix-encrypt-attachment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('matrix-encrypt-attachment')>();
  return { ...actual, decryptAttachment: vi.fn(actual.decryptAttachment) };
});

const MiB = 1024 * 1024;
function fixture() {
  const live = new Map<string, number>();
  let sequence = 0;
  const create = vi.fn((blob: Blob) => {
    const url = `blob:synthetic-${++sequence}`;
    live.set(url, blob.size);
    return url;
  });
  const revoke = vi.fn((url: string) => live.delete(url));
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  const fetchMedia = vi.fn<typeof fetch>().mockImplementation(async () => new Response(new Uint8Array(MiB), { headers: { 'content-type': 'audio/wav' } }));
  vi.stubGlobal('fetch', fetchMedia);
  const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
  const internal = controller as unknown as { client?: MatrixClient; clearMediaCache: () => void; mediaRequests: { entries: Map<string, unknown> } };
  internal.client = { getAccessToken: () => 'synthetic-token', mxcUrlToHttp: () => 'https://matrix.example.test/media' } as unknown as MatrixClient;
  return { controller, internal, live, create, revoke, fetchMedia };
}
function Audio({ source, encryptedFile }: { source: string; encryptedFile?: EncryptedMediaInfo }) {
  const url = useMediaSource(source, 64, encryptedFile, 'audio/wav');
  return <audio aria-label="Synthetic audio" src={url} />;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.mocked(decryptAttachment).mockClear(); });

describe('Matrix media ownership', () => {
  it('bounds retained bytes while navigating through forty 1 MiB attachments in one session', async () => {
    const test = fixture();
    const media = (index: number) => <MediaProvider resolver={test.controller.resolveMedia}><Audio source={`mxc://test/audio-${index}`} /></MediaProvider>;
    const view = render(media(0));
    let peakBytes = 0;
    for (let index = 0; index < 40; index++) {
      view.rerender(media(index));
      await waitFor(() => expect(view.container.querySelector('audio')).toHaveAttribute('src', `blob:synthetic-${index + 1}`));
      peakBytes = Math.max(peakBytes, [...test.live.values()].reduce((sum, bytes) => sum + bytes, 0));
    }
    view.unmount();
    expect(test.create).toHaveBeenCalledTimes(40);
    expect({ peakBytes, retainedBytes: [...test.live.values()].reduce((sum, bytes) => sum + bytes, 0), revoked: test.revoke.mock.calls.length })
      .toEqual({ peakBytes: MiB, retainedBytes: 0, revoked: 40 });
    expect(test.internal.mediaRequests.entries.size).toBe(0);
  });

  it('shares one download until the final consumer releases, including reacquisition by another consumer', async () => {
    const test = fixture();
    const first = test.controller.resolveMedia('mxc://test/shared', 64, undefined, 'audio/wav');
    const second = test.controller.resolveMedia('mxc://test/shared', 64, undefined, 'audio/wav');
    expect(await first).toBe(await second);
    expect(test.fetchMedia).toHaveBeenCalledOnce();
    first.release(); first.release();
    expect(test.revoke).not.toHaveBeenCalled();
    const third = test.controller.resolveMedia('mxc://test/shared', 64, undefined, 'audio/wav');
    expect(await third).toBe(await second);
    second.release();
    expect(test.revoke).not.toHaveBeenCalled();
    third.release();
    expect(test.revoke).toHaveBeenCalledExactlyOnceWith('blob:synthetic-1');
    const again = test.controller.resolveMedia('mxc://test/shared', 64, undefined, 'audio/wav');
    expect(await again).toBe('blob:synthetic-2');
    expect(test.fetchMedia).toHaveBeenCalledTimes(2);
    again.release();
    expect(test.live.size).toBe(0);
  });

  it('keeps a shared pending request running until its final consumer leaves', async () => {
    const test = fixture(); const download = deferred<Response>();
    test.fetchMedia.mockReturnValueOnce(download.promise);
    const first = test.controller.resolveMedia('mxc://test/shared', 64);
    const second = test.controller.resolveMedia('mxc://test/shared', 64);
    await vi.waitFor(() => expect(test.fetchMedia).toHaveBeenCalledOnce());
    const signal = test.fetchMedia.mock.calls[0][1]!.signal!;
    first.release();
    expect(signal.aborted).toBe(false);
    download.resolve(new Response('synthetic image'));
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBe('blob:synthetic-1');
    second.release();
    expect(signal.aborted).toBe(true);
    expect(test.live.size).toBe(0);
  });

  it('aborts an abandoned download and rejects stale bytes even if fetch ignores cancellation', async () => {
    const test = fixture(); const download = deferred<Response>();
    test.fetchMedia.mockReturnValueOnce(download.promise);
    const request = test.controller.resolveMedia('mxc://test/abandoned', 64);
    await vi.waitFor(() => expect(test.fetchMedia).toHaveBeenCalledOnce());
    request.release();
    expect(test.fetchMedia.mock.calls[0][1]!.signal!.aborted).toBe(true);
    expect(test.internal.mediaRequests.entries.size).toBe(0);
    // Reacquire the same key before the abandoned download finishes.
    const replacement = test.controller.resolveMedia('mxc://test/abandoned', 64);
    await expect(replacement).resolves.toBe('blob:synthetic-1');
    download.resolve(new Response('stale bytes'));
    await expect(request).resolves.toBeUndefined();
    const shared = test.controller.resolveMedia('mxc://test/abandoned', 64);
    await expect(shared).resolves.toBe('blob:synthetic-1');
    expect(test.create).toHaveBeenCalledOnce();
    expect(test.fetchMedia).toHaveBeenCalledTimes(2);
    replacement.release(); shared.release();
  });

  it('does not start a resolver after cleanup before the hook microtask, or leak after Strict Mode cleanup', async () => {
    const test = fixture();
    const view = render(<MediaProvider resolver={test.controller.resolveMedia}><Audio source="mxc://test/never-started" /></MediaProvider>);
    view.unmount();
    await Promise.resolve();
    expect(test.fetchMedia).not.toHaveBeenCalled();
    const strict = render(<StrictMode><MediaProvider resolver={test.controller.resolveMedia}><Audio source="mxc://test/strict" /></MediaProvider></StrictMode>);
    await waitFor(() => expect(strict.container.querySelector('audio')).toHaveAttribute('src', 'blob:synthetic-1'));
    strict.unmount();
    expect(test.create).toHaveBeenCalledOnce();
    expect(test.live.size).toBe(0);
  });

  it('clears active and pending media on account teardown without resurrecting stale URLs', async () => {
    const test = fixture();
    const ready = test.controller.resolveMedia('mxc://test/ready', 64);
    await ready;
    const download = deferred<Response>(); test.fetchMedia.mockReturnValueOnce(download.promise);
    const pending = test.controller.resolveMedia('mxc://test/pending', 64);
    await vi.waitFor(() => expect(test.fetchMedia).toHaveBeenCalledTimes(2));
    test.internal.client = undefined;
    test.internal.clearMediaCache();
    expect(test.live.size).toBe(0);
    expect(test.fetchMedia.mock.calls[1][1]!.signal!.aborted).toBe(true);
    download.resolve(new Response('old account bytes'));
    await expect(pending).resolves.toBeUndefined();
    ready.release(); pending.release(); test.internal.clearMediaCache();
    expect(test.create).toHaveBeenCalledOnce();
    expect(test.revoke).toHaveBeenCalledOnce();
  });

  it('retries failed media without allowing an obsolete owner to delete the new request', async () => {
    const test = fixture(); test.fetchMedia.mockResolvedValueOnce(new Response('', { status: 503 }));
    const failed = test.controller.resolveMedia('mxc://test/retry', 64);
    await expect(failed).resolves.toBeUndefined();
    expect(test.fetchMedia.mock.calls[0][1]!.signal!.aborted).toBe(true);
    const retry = test.controller.resolveMedia('mxc://test/retry', 64);
    failed.release();
    await expect(retry).resolves.toBe('blob:synthetic-1');
    const shared = test.controller.resolveMedia('mxc://test/retry', 64);
    await shared;
    expect(test.fetchMedia).toHaveBeenCalledTimes(2);
    retry.release(); shared.release();
  });

  it('decrypts authenticated media exactly and releases both ciphertext work and the decrypted blob', async () => {
    const test = fixture(); const cleartext = new TextEncoder().encode('synthetic encrypted attachment');
    const encrypted = await encryptAttachment(cleartext.buffer);
    test.fetchMedia.mockResolvedValueOnce(new Response(encrypted.data));
    const request = test.controller.resolveMedia('mxc://test/encrypted', 64, encrypted.info, 'audio/wav');
    await expect(request).resolves.toBe('blob:synthetic-1');
    expect(Array.from(new Uint8Array(await test.create.mock.calls[0][0].arrayBuffer()))).toEqual(Array.from(cleartext));
    expect(test.fetchMedia).toHaveBeenCalledWith('https://matrix.example.test/media', {
      signal: expect.any(AbortSignal), headers: { Accept: 'audio/wav', Authorization: 'Bearer synthetic-token' },
    });
    request.release();
    expect(test.live.size).toBe(0);
    const decrypted = deferred<ArrayBuffer>();
    vi.mocked(decryptAttachment).mockReturnValueOnce(decrypted.promise);
    test.fetchMedia.mockResolvedValueOnce(new Response(encrypted.data));
    const abandoned = test.controller.resolveMedia('mxc://test/encrypted', 64, encrypted.info, 'audio/wav');
    await vi.waitFor(() => expect(decryptAttachment).toHaveBeenCalledTimes(2));
    abandoned.release();
    decrypted.resolve(cleartext.buffer);
    await expect(abandoned).resolves.toBeUndefined();
    expect(test.create).toHaveBeenCalledOnce();
    expect(test.internal.mediaRequests.entries.size).toBe(0);
  });

  it('keeps every active URL valid and releases a viewer original while its inline thumbnail stays mounted', async () => {
    const test = fixture();
    const message = { id: '$synthetic', roomId: '!synthetic:test', senderId: '@synthetic:test', senderName: 'Synthetic', timestamp: 1, body: 'Synthetic image', kind: 'media' as const, mediaKind: 'image' as const, mediaUrl: 'mxc://test/image', mimeType: 'image/png', isOwn: false };
    const view = render(<MediaProvider resolver={test.controller.resolveMedia}><MessageContent message={message} /></MediaProvider>);
    const preview = await screen.findByRole('button', { name: 'View Synthetic image full size' });
    fireEvent.click(preview);
    const viewer = screen.getByRole('dialog', { name: 'Viewing Synthetic image' });
    await waitFor(() => expect(within(viewer).getByRole('img')).toHaveAttribute('src', 'blob:synthetic-2'));
    expect([...test.live.values()]).toEqual([MiB, MiB]);
    fireEvent.click(within(viewer).getByRole('button', { name: 'Close image viewer' }));
    expect(test.live.has('blob:synthetic-2')).toBe(false);
    expect(test.live.has('blob:synthetic-1')).toBe(true);
    expect(within(preview).getByRole('img')).toHaveAttribute('src', 'blob:synthetic-1');
    fireEvent.click(preview);
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('img')).toHaveAttribute('src', 'blob:synthetic-3'));
    view.unmount();
    expect(test.live.size).toBe(0);
  });

  it('keeps a visible decrypted URL live across equivalent immutable snapshot metadata', async () => {
    const test = fixture(); const encrypted = await encryptAttachment(new TextEncoder().encode('synthetic').buffer);
    test.fetchMedia.mockResolvedValueOnce(new Response(encrypted.data));
    const media = (file: EncryptedMediaInfo) => <MediaProvider resolver={test.controller.resolveMedia}><Audio source="mxc://test/snapshot" encryptedFile={file} /></MediaProvider>;
    const view = render(media(encrypted.info));
    await waitFor(() => expect(view.container.querySelector('audio')).toHaveAttribute('src', 'blob:synthetic-1'));
    view.rerender(media(structuredClone(encrypted.info)));
    await Promise.resolve();
    expect(test.fetchMedia).toHaveBeenCalledOnce();
    expect(test.revoke).not.toHaveBeenCalled();
    expect(view.container.querySelector('audio')).toHaveAttribute('src', 'blob:synthetic-1');
    view.unmount();
    expect(test.live.size).toBe(0);
  });

  it('rejects corrupt encrypted media without retaining a URL or a resolver entry', async () => {
    const test = fixture(); const encrypted = await encryptAttachment(new TextEncoder().encode('synthetic').buffer);
    test.fetchMedia.mockResolvedValueOnce(new Response('corrupt ciphertext'));
    const request = test.controller.resolveMedia('mxc://test/corrupt', 64, encrypted.info, 'video/webm');
    await expect(request).resolves.toBeUndefined();
    expect(test.create).not.toHaveBeenCalled();
    expect(test.internal.mediaRequests.entries.size).toBe(0);
    expect(test.fetchMedia.mock.calls[0][1]!.signal!.aborted).toBe(true);
    request.release();
  });
});
