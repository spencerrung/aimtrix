import { useRef, useState } from 'react';

/** A synchronous latch also protects rapid submissions before React rerenders. */
export function useAction() {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(true);
    try { await action(); }
    finally { running.current = false; setBusy(false); }
  };
  return { busy, run };
}
