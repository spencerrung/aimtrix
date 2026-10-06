import { useLayoutEffect, type RefObject } from 'react';

/** Fixed surfaces use layout coordinates, including the visual viewport's offset. */
export function visibleViewport() {
  const viewport = window.visualViewport;
  return { top: viewport?.offsetTop ?? 0, left: viewport?.offsetLeft ?? 0,
    height: viewport?.height ?? window.innerHeight, width: viewport?.width ?? window.innerWidth };
}

export function useAnchoredPopover(open: boolean, trigger: RefObject<HTMLElement | null>, surface: RefObject<HTMLElement | null>, gap = 4) {
  useLayoutEffect(() => {
    if (!open || !trigger.current || !surface.current) return;
    const element = surface.current;
    const place = () => {
      if (!trigger.current) return;
      const viewport = visibleViewport();
      element.style.setProperty('max-height', `${Math.max(0, viewport.height - 24)}px`);
      element.style.setProperty('max-width', `${Math.max(0, viewport.width - 24)}px`);
      const anchor = trigger.current.getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      const minTop = viewport.top + 12;
      const minLeft = viewport.left + 12;
      const below = anchor.bottom + gap;
      const top = below + bounds.height <= viewport.top + viewport.height - 12 ? below : anchor.top - bounds.height - gap;
      element.style.setProperty('top', `${Math.max(minTop, Math.min(top, viewport.top + viewport.height - bounds.height - 12))}px`);
      element.style.setProperty('left', `${Math.max(minLeft, Math.min(anchor.right - bounds.width, viewport.left + viewport.width - bounds.width - 12))}px`);
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    observer?.observe(element);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', place);
    viewport?.addEventListener('scroll', place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      observer?.disconnect();
      viewport?.removeEventListener('resize', place);
      viewport?.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, trigger, surface, gap]);
}
