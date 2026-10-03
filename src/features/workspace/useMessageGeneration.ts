import { useLayoutEffect, useRef } from 'react';

// Isolate mounted cleanup closures from message-action props, which can capture
// a full workspace snapshot on large accounts.
export function useMessageGeneration(messageId: string) {
  const generation = useRef(0);
  useLayoutEffect(() => () => { generation.current += 1; }, [messageId]);
  return generation;
}
