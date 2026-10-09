/** Browser-owned exclusion, scoped to the exact persistent SDK database prefix.
 * Never steal a lock or use a time-based lease: a suspended tab can still own Rust crypto.
 */
export interface CryptoOwnership {
  release(): Promise<void>;
}

export class CryptoOwnershipUnavailable extends Error {
  constructor() { super('Exclusive encrypted storage ownership is unavailable.'); }
}

export function cryptoTakeoverSupported(): boolean {
  return typeof BroadcastChannel === 'function';
}

export async function acquireCryptoOwnership(prefix: string, options: {
  signal?: AbortSignal;
  takeover?: boolean;
  onTakeover?: () => Promise<void>;
} = {}): Promise<CryptoOwnership | undefined> {
  if (!navigator.locks?.request) throw new CryptoOwnershipUnavailable();
  const name = `aimtrix.crypto-owner.v1:${prefix}`;
  const abort = new AbortController();
  const cancel = () => abort.abort();
  if (options.signal?.aborted) return undefined;
  options.signal?.addEventListener('abort', cancel, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let channel: BroadcastChannel | undefined;
  let acquired!: (owner: CryptoOwnership | undefined) => void;
  let failed!: (error: unknown) => void;
  const result = new Promise<CryptoOwnership | undefined>((resolve, reject) => { acquired = resolve; failed = reject; });
  const takeover = Boolean(options.takeover && cryptoTakeoverSupported());
  if (takeover) timeout = setTimeout(cancel, 10000);
  let request: Promise<unknown>;
  try {
    request = navigator.locks.request(name, { mode: 'exclusive', ...(takeover ? { signal: abort.signal } : { ifAvailable: true }) }, async (lock) => {
      if (!lock || abort.signal.aborted) { acquired(undefined); return; }
      if (timeout !== undefined) clearTimeout(timeout);
      options.signal?.removeEventListener('abort', cancel);
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let relinquishing = false;
      let ownerChannel: BroadcastChannel | undefined;
      if (cryptoTakeoverSupported() && options.onTakeover) {
        ownerChannel = new BroadcastChannel(name);
        ownerChannel.onmessage = (event: MessageEvent<unknown>) => {
          if (relinquishing || !event.data || typeof event.data !== 'object' || !('type' in event.data) || event.data.type !== 'takeover') return;
          relinquishing = true;
          // Shutdown owns release. Failure must keep exclusion, never open a second client.
          void options.onTakeover!().catch(() => { relinquishing = false; });
        };
      }
      acquired({ release: async () => { release(); await request; } });
      try { await held; } finally { ownerChannel?.close(); }
    });
    void request.catch((error: unknown) => {
      if (abort.signal.aborted) acquired(undefined);
      else failed(error);
    });
    if (takeover) {
      channel = new BroadcastChannel(name);
      channel.postMessage({ type: 'takeover' });
    }
    return await result;
  } catch (error) {
    abort.abort();
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
    channel?.close();
  }
}
