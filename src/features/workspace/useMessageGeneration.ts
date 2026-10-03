import { useLayoutEffect, useRef } from 'react';

export function useMessageGeneration(messageId: string) {
  const generation = useRef(0);
  useLayoutEffect(() => () => { generation.current += 1; }, [messageId]);
  return generation;
}
