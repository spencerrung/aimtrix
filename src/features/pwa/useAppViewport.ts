import { useLayoutEffect, type RefObject } from 'react';

/** One viewport model shared by the app frame and body-portaled surfaces. */
export function useAppViewport(notices: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const frame = notices.current?.parentElement;
    const sync = () => {
      const scale = viewport?.scale ?? 1;
      // Pinch zoom should magnify the current layout, rather than reflow it as a keyboard.
      const zoomed = Math.abs(scale - 1) > 0.05;
      const height = Math.round(zoomed ? window.innerHeight : (viewport?.height ?? window.innerHeight));
      const offset = zoomed ? 0 : Math.round(viewport?.offsetTop ?? 0);
      const frameStyle = frame ? getComputedStyle(frame) : undefined;
      const inset = (parseFloat(frameStyle?.paddingTop ?? '') || 0) + (parseFloat(frameStyle?.paddingBottom ?? '') || 0);
      const contentHeight = Math.max(0, height - inset - (notices.current?.getBoundingClientRect().height ?? 0));
      root.style.setProperty('--aimtrix-visual-height', `${height}px`);
      root.style.setProperty('--aimtrix-visual-offset-top', `${offset}px`);
      root.style.setProperty('--aimtrix-viewport-height', `${height}px`);
      root.style.setProperty('--aimtrix-viewport-offset-top', `${offset}px`);
      root.style.setProperty('--aimtrix-viewport-scale', `${scale}`);
      root.style.setProperty('--aimtrix-content-height', `${contentHeight}px`);
      root.dataset.compactViewport = String(!zoomed && window.innerWidth < 1200 && contentHeight <= 480);
    };
    sync();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(sync);
    if (notices.current) observer?.observe(notices.current);
    if (frame) observer?.observe(frame);
    viewport?.addEventListener('resize', sync);
    viewport?.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    return () => {
      observer?.disconnect();
      viewport?.removeEventListener('resize', sync);
      viewport?.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
      for (const property of ['height', 'offset-top', 'scale']) root.style.removeProperty(`--aimtrix-viewport-${property}`);
      root.style.removeProperty('--aimtrix-content-height');
      root.style.removeProperty('--aimtrix-visual-height');
      root.style.removeProperty('--aimtrix-visual-offset-top');
      delete root.dataset.compactViewport;
    };
  }, [notices]);
}
