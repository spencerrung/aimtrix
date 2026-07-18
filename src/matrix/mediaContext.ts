import { createContext } from 'react';
import type { IEncryptedFile } from 'matrix-encrypt-attachment';

export type EncryptedMediaInfo = IEncryptedFile;

export type MediaResolver = (
  source: string,
  size: number,
  encryptedFile?: EncryptedMediaInfo,
  mimeType?: string,
) => Promise<string | undefined>;

export const MediaResolverContext = createContext<MediaResolver | undefined>(undefined);
