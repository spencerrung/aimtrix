// Synthetic browser fixture for the real private-search panel and encrypted IndexedDB store.
import { createRoot } from 'react-dom/client';
import { demoWorkspace } from '../../src/demo/demoWorkspace';
import { HistorySearchPanel, type PrivateSearchActions } from '../../src/features/workspace/HistorySearchPanel';
import { PrivateSearchStore, deletePrivateSearchDatabase } from '../../src/matrix/privateSearchStore';
import '../../src/styles.css';

const scope = { userId: '@fixture:test', homeserver: 'https://matrix.test' };
const room = { ...demoWorkspace.rooms[0], id: '!private:test', encrypted: true, membership: 'join' as const, name: 'Private Fixture' };
const hit = { roomId: room.id, eventId: '$older', senderId: '@buddy:test', body: 'Synthetic nebula history', timestamp: Date.now() - 86_400_000, kind: 'message' as const };
let store: PrivateSearchStore | undefined;
const actions: PrivateSearchActions = {
  status: async () => store?.status() ?? { unlocked: false, rooms: [], total: 0 },
  unlock: async (passphrase) => { store?.close(); store = await PrivateSearchStore.unlock(scope, passphrase); return store.status(); },
  index: async (_roomId, onProgress, signal) => {
    if (!store) throw new Error('Locked');
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const progress = await store.putPage(room.id, [hit], { roomId: room.id, indexed: 0, skipped: 1, complete: true });
    onProgress(progress);
    return store.status();
  },
  clear: async () => { store?.close(); store = undefined; await deletePrivateSearchDatabase(scope); },
};
createRoot(document.getElementById('root')!).render(<main style={{ width: 'min(100%, 560px)', height: '100dvh', margin: 'auto', borderInline: '1px solid var(--border)' }}>
  <HistorySearchPanel open rooms={[room]} loadedMessages={[]} initialRoomId={room.id} privateSearch={actions}
    onSearch={async (filters, _nextBatch, signal) => ({ hits: [], privateHits: (await store?.search(filters, signal))?.hits ?? [], searchedRoomIds: [] })}
    onOpen={async () => undefined} onClose={() => undefined} />
</main>);
