import { useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';

/** Form pickers use normal Tab order; action menus opt into arrow navigation. */
export function Popover({ children, label, className, onClose, trigger, surfaceRef, style, menu = false }: {
  children: ReactNode; label: string; className?: string; onClose: () => void;
  trigger?: RefObject<HTMLElement | null>; surfaceRef?: RefObject<HTMLDivElement | null>; style?: CSSProperties; menu?: boolean;
}) {
  const localRef = useRef<HTMLDivElement>(null);
  const ref = surfaceRef ?? localRef;
  const close = useRef(onClose);
  useLayoutEffect(() => { close.current = onClose; });
  useLayoutEffect(() => {
    const element = ref.current!;
    const opener = trigger?.current ?? (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null);
    const first = element.querySelector<HTMLElement>(menu ? '[role^="menuitem"]:not(:disabled)' : 'input, select, button:not(:disabled), [tabindex="0"]');
    first?.focus();
    let restore = true;
    const outside = (event: PointerEvent) => {
      if (!element.contains(event.target as Node) && !opener?.contains(event.target as Node)) {
        restore = false; close.current();
      }
    };
    const blur = (event: FocusEvent) => {
      if (!element.contains(event.target as Node) && !opener?.contains(event.target as Node)) {
        restore = false; close.current();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', blur);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', blur);
      if (restore && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [menu, ref, trigger]);
  return <div ref={ref} className={className} style={style} role={menu ? 'menu' : 'dialog'} aria-label={label}
    onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (!menu) return;
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)')];
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : undefined;
      if (next !== undefined) { event.preventDefault(); items[next]?.focus(); }
    }}>{children}</div>;
}
