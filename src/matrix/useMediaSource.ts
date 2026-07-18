import { useContext, useEffect, useState } from 'react';
import {
  MediaResolverContext,
  type EncryptedMediaInfo,
} from './mediaContext';

export function useMediaSource(
  source: string | undefined,
  size: number,
  encryptedFile?: EncryptedMediaInfo,
  mimeType?: string,
): string | undefined {
  const resolver = useContext(MediaResolverContext);
  const [resolved, setResolved] = useState<{ source: string; url?: string }>();
  const requiresResolution = source?.startsWith('mxc://') ?? false;

  useEffect(() => {
    if (!source || !requiresResolution || !resolver) return;
    let active = true;
    void resolver(source, size, encryptedFile, mimeType).then((url) => {
      if (active) setResolved({ source, url });
    });
    return () => {
      active = false;
    };
  }, [encryptedFile, mimeType, requiresResolution, resolver, size, source]);

  if (!source) return undefined;
  if (!requiresResolution) return source;
  return resolved?.source === source ? resolved.url : undefined;
}
