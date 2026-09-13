import { createContext, useContext, useLayoutEffect } from 'react';
export const DialogContext = createContext<{ dismiss: () => void; busy: boolean; registerBusy: () => () => void } | null>(null);
export function useDialogBusy(busy: boolean) {
  const register = useContext(DialogContext)?.registerBusy;
  useLayoutEffect(() => busy ? register?.() : undefined, [busy, register]);
}
