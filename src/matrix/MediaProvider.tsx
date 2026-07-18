import type { ReactNode } from 'react';
import { MediaResolverContext, type MediaResolver } from './mediaContext';

export function MediaProvider({
  resolver,
  children,
}: {
  resolver?: MediaResolver;
  children: ReactNode;
}) {
  return (
    <MediaResolverContext.Provider value={resolver}>
      {children}
    </MediaResolverContext.Provider>
  );
}
