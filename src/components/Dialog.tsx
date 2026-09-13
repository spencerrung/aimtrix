import { useContext, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { DialogContext } from './dialogContext';
const focusable = 'button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]';

function available(item: HTMLElement) {
  if (item.matches(':disabled') || item.closest('[hidden], [inert]')) return false;
  if (item.checkVisibility && !item.checkVisibility({ visibilityProperty: true })) return false;
  for (let parent: HTMLElement | null = item; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector('summary')?.contains(item)) return false;
  }
  return true;
}

export function Dialog({ children, className, backdropClassName, onClose, busy = false, ...label }: {
  children: ReactNode;
  className: string;
  backdropClassName?: string;
  onClose: () => void;
  busy?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const latest = useRef({ onClose, busy });
  const [childBusy, setChildBusy] = useState(0);
  const [registerBusy] = useState(() => () => {
    setChildBusy((count) => count + 1);
    return () => setChildBusy((count) => count - 1);
  });
  const pending = busy || childBusy > 0;
  useLayoutEffect(() => { latest.current = { onClose, busy: pending }; });
  const dismiss = () => { if (!latest.current.busy) latest.current.onClose(); };

  useLayoutEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Native modality supplies background inertness and correctly stacks nested dialogs.
    element.showModal();
    const items = [...element.querySelectorAll<HTMLElement>(focusable)].filter(available);
    (items.find((item) => item.hasAttribute('data-initial-focus')) ?? items[0])?.focus();
    return () => {
      element.close();
      // Defer restoration until React has mounted a replacement surface, if any.
      queueMicrotask(() => {
        const top = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1);
        if (top && !top.contains(opener) && top.contains(document.activeElement)) return;
        const target = opener?.isConnected && available(opener) && !opener.closest('[style*="display: none"]')
          ? opener : top ? [...top.querySelectorAll<HTMLElement>(focusable)].find(available) : [...document.querySelectorAll<HTMLElement>('[data-focus-fallback], main, h1')].find(available);
        if (target) {
          if (!target.matches(focusable)) target.setAttribute('tabindex', '-1');
          target.focus({ preventScroll: true });
        }
      });
    };
  }, []);

  return <DialogContext.Provider value={{ dismiss, busy: pending, registerBusy }}>
    <dialog ref={dialog} className={`interaction-dialog ${backdropClassName ?? 'interaction-backdrop'}`} {...label}
      aria-modal="true" onCancel={(event) => { event.preventDefault(); event.stopPropagation(); dismiss(); }}
      onClick={(event) => { if (event.target === event.currentTarget) dismiss(); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && (event.target as Element).closest('dialog') === event.currentTarget) { event.preventDefault(); event.stopPropagation(); dismiss(); }
        if (event.key !== 'Tab' || (event.target as Element).closest('dialog') !== event.currentTarget) return;
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>(focusable)]
          .filter((item) => item.tabIndex >= 0 && !item.matches(':disabled') && !item.closest('[hidden], [inert]') && item.getClientRects().length > 0);
        const first = items[0]; const last = items.at(-1);
        if (!first) { event.preventDefault(); dialog.current?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
      <section className={className}>{children}</section>
    </dialog>
  </DialogContext.Provider>;
}

export function DialogClose(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const context = useContext(DialogContext);
  return <button {...props} type="button" disabled={context?.busy || props.disabled} onClick={context?.dismiss} />;
}

export function DialogButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const context = useContext(DialogContext);
  return <button {...props} disabled={context?.busy || props.disabled} />;
}
