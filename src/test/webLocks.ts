/** Minimal exclusive Web Locks model for JSDOM. Real browser arbitration is tested in Playwright. */
export function createTestLockManager(): LockManager {
  const held = new Set<string>();
  const waiting = new Map<string, Set<() => void>>();
  return {
    request: async (name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => {
      if (options.signal && options.ifAvailable) throw new DOMException('signal with ifAvailable', 'NotSupportedError');
      while (held.has(name) && !options.ifAvailable) {
        await new Promise<void>((resolve, reject) => {
          const callbacks = waiting.get(name) ?? new Set();
          const wake = () => { options.signal?.removeEventListener('abort', cancel); callbacks.delete(wake); resolve(); };
          const cancel = () => { callbacks.delete(wake); reject(new DOMException('Aborted', 'AbortError')); };
          callbacks.add(wake); waiting.set(name, callbacks);
          options.signal?.addEventListener('abort', cancel, { once: true });
        });
      }
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (held.has(name)) return callback(null);
      held.add(name);
      try { return await callback({ name, mode: 'exclusive' }); }
      finally { held.delete(name); waiting.get(name)?.forEach((wake) => wake()); }
    },
  } as LockManager;
}
