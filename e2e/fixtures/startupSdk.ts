export { ClientEvent, RoomEvent, RoomStateEvent, MatrixEventEvent, PendingEventOrdering } from 'matrix-js-sdk/lib/matrix.js';

export const clients: ReturnType<typeof createClient>[] = [];
export function createClient() {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  const counts = { started: 0, stopped: 0, retried: 0 };
  const client = {
    counts,
    on: (name: string, callback: (...args: any[]) => void) => {
      const callbacks = listeners.get(name) ?? new Set(); callbacks.add(callback); listeners.set(name, callbacks);
    },
    removeListener: (name: string, callback: (...args: any[]) => void) => listeners.get(name)?.delete(callback),
    emit: (name: string, ...args: unknown[]) => [...(listeners.get(name) ?? [])].forEach((callback) => callback(...args)),
    getRooms: () => [], getVisibleRooms: () => [], getAccountData: () => undefined,
    getSafeUserId: () => '@synthetic:example.test', getUser: () => undefined,
    initRustCrypto: async () => {},
    startClient: async () => { counts.started++; },
    stopClient: () => { counts.stopped++; },
    retryImmediately: () => { counts.retried++; return true; },
    doesServerSupportThread: async () => ({ threads: 0 }),
  };
  clients.push(client);
  return client;
}
