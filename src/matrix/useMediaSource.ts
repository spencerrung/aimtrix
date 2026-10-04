import { useContext, useEffect, useState } from 'react';
import {
  MediaResolverContext,
  type EncryptedMediaInfo,
} from './mediaContext';

export function useMediaSourceState(
  source: string | undefined,
  size: number,
  encryptedFile?: EncryptedMediaInfo,
  mimeType?: string,
  original = false,
): { url?: string; status: 'idle' | 'loading' | 'ready' | 'unavailable'; retry: () => void } {
  const resolver = useContext(MediaResolverContext);
  const [resolved, setResolved] = useState<{ key: string; url?: string }>();
  const [attempt, setAttempt] = useState(0);
  const requiresResolution = source?.startsWith('mxc://') ?? false;
  const key = `${source ?? ''}|${size}|${mimeType ?? ''}|${encryptedFile?.hashes?.sha256 ?? ''}|${original}|${attempt}`;

  useEffect(() => {
    if (!source || !requiresResolution || !resolver) return;
    let active = true;
    void Promise.resolve().then(() => original ? resolver(source, size, encryptedFile, mimeType, true) : resolver(source, size, encryptedFile, mimeType))
      .then((url) => { if (active) setResolved({ key, url }); })
      .catch(() => { if (active) setResolved({ key }); });
    return () => {
      active = false;
    };
  }, [encryptedFile, key, mimeType, original, requiresResolution, resolver, size, source]);

  const retry = () => setAttempt((value) => value + 1);
  if (!source) return { status: 'idle', retry };
  if (!requiresResolution) return { url: source, status: 'ready', retry };
  if (!resolver) return { status: 'unavailable', retry };
  if (resolved?.key !== key) return { status: 'loading', retry };
  return resolved.url ? { url: resolved.url, status: 'ready', retry } : { status: 'unavailable', retry };
}

export function useMediaSource(
  source: string | undefined,
  size: number,
  encryptedFile?: EncryptedMediaInfo,
  mimeType?: string,
  original = false,
): string | undefined {
  return useMediaSourceState(source, size, encryptedFile, mimeType, original).url;
}
