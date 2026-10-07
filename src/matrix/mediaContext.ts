import { createContext } from 'react';
import type { IEncryptedFile } from 'matrix-encrypt-attachment';

export type EncryptedMediaInfo = IEncryptedFile;

// Each caller owns its request until release, including while it is pending.
// Capture the original promise before awaiting/wrapping it; direct controller
// callers must release it when their consumer finishes. React hooks do this.
// Plain promises remain supported for demo/fixture resolvers without Blob URLs.
export type MediaRequest = Promise<string | undefined> & { release?: () => void };

export type MediaResolver = (
  source: string,
  size: number,
  encryptedFile?: EncryptedMediaInfo,
  mimeType?: string,
  original?: boolean,
) => MediaRequest;

export const MediaResolverContext = createContext<MediaResolver | undefined>(undefined);
