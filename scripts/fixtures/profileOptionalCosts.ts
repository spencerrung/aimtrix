import { PrivateSearchStore, deletePrivateSearchDatabase, type IndexedHit } from '../../src/matrix/privateSearchStore';

declare global {
  interface Window {
    profilePrivateIndex: (events: number, pageSize: number) => Promise<Record<string, number>>;
    profileAttachmentCrypto: (bytes: number) => Promise<Record<string, number>>;
  }
}

window.profilePrivateIndex = async (events, pageSize) => {
  const scope = { userId: '@synthetic:test', homeserver: 'https://synthetic.invalid' };
  await deletePrivateSearchDatabase(scope);
  const unlockStart = performance.now();
  const store = await PrivateSearchStore.unlock(scope, 'synthetic-only-passphrase');
  const unlockMs = performance.now() - unlockStart;
  try {
    const pageTimings: number[] = [];
    for (let offset = 0; offset < events; offset += pageSize) {
      const batch: IndexedHit[] = Array.from({ length: Math.min(pageSize, events - offset) }, (_, index) => {
        const number = offset + index;
        return { roomId: '!synthetic:test', eventId: `$synthetic-${number}`, senderId: '@synthetic:test', body: `Synthetic index message ${number}`, timestamp: number, kind: 'text' };
      });
      const start = performance.now();
      await store.putPage('!synthetic:test', batch, { roomId: '!synthetic:test', complete: false, indexed: offset + batch.length, skipped: 0 });
      pageTimings.push(performance.now() - start);
    }
    const searchStart = performance.now();
    const result = await store.search({ term: `Synthetic index message ${events - 1}` });
    const searchMs = performance.now() - searchStart;
    const statusStart = performance.now();
    const status = await store.status();
    const statusMs = performance.now() - statusStart;
    const estimate = await navigator.storage.estimate();
    return {
      unlockMs: Math.round(unlockMs),
      indexTotalMs: Math.round(pageTimings.reduce((sum, duration) => sum + duration, 0)),
      indexLastPageMs: Math.round(pageTimings.at(-1) ?? 0),
      searchMs: Math.round(searchMs),
      statusMs: Math.round(statusMs),
      indexedEvents: status.total,
      searchHits: result.hits.length,
      originStorageKiB: Math.round((estimate.usage ?? 0) / 1024),
    };
  } finally {
    store.close();
    await deletePrivateSearchDatabase(scope);
  }
};

window.profileAttachmentCrypto = async (bytes) => {
  const payload = new Uint8Array(bytes).fill(7);
  const { encryptAttachment, decryptAttachment } = await import('matrix-encrypt-attachment');
  const encryptStart = performance.now();
  const encrypted = await encryptAttachment(payload.buffer);
  const encryptMs = performance.now() - encryptStart;
  const decryptStart = performance.now();
  const decrypted = new Uint8Array(await decryptAttachment(encrypted.data, encrypted.info));
  const decryptMs = performance.now() - decryptStart;
  if (decrypted.length !== payload.length || decrypted.some((byte) => byte !== 7)) throw new Error('Synthetic crypto round trip failed.');
  return { attachmentBytes: bytes, encryptMs: Math.round(encryptMs), decryptMs: Math.round(decryptMs) };
};
