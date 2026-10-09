// Only the SDK client is synthetic; controllers, browser locks and ownership UI are production code.
export { ClientEvent, RoomEvent, RoomStateEvent, MatrixEventEvent, PendingEventOrdering } from 'matrix-js-sdk/lib/matrix.js';

export const counts = { initialized: 0, started: 0, stopped: 0, prefixes: [] as string[] };
export function createClient() {
  return {
    on: () => undefined, removeListener: () => undefined,
    getRooms: () => [], getAccountData: () => undefined,
    initRustCrypto: async ({ cryptoDatabasePrefix }: { cryptoDatabasePrefix: string }) => {
      counts.initialized++; counts.prefixes.push(cryptoDatabasePrefix);
    },
    startClient: async () => { counts.started++; window.dispatchEvent(new Event('crypto-started')); },
    stopClient: () => { counts.stopped++; },
    doesServerSupportThread: async () => ({ threads: 0 }),
  };
}
