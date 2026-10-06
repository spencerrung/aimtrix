import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppViewport } from './useAppViewport';

function Frame({ inset = 0 }: { inset?: number }) {
  const notices = useRef<HTMLDivElement>(null);
  useAppViewport(notices);
  return <div style={{ paddingTop: inset }}><div ref={notices} /></div>;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('shared application viewport', () => {
  it('reserves the frame safe area once above notices and workspace', () => {
    vi.stubGlobal('innerHeight', 844);
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('visualViewport', undefined);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 50 } as DOMRect);
    render(<Frame inset={47} />);
    expect(document.documentElement.style.getPropertyValue('--aimtrix-content-height')).toBe('747px');
  });
  it('tracks keyboard height and offset, reserves notices, and restores the layout without treating zoom as a keyboard', () => {
    const viewport = new EventTarget();
    Object.assign(viewport, { height: 844, offsetTop: 0, scale: 1 });
    vi.stubGlobal('visualViewport', viewport);
    vi.stubGlobal('innerHeight', 844);
    vi.stubGlobal('innerWidth', 390);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 50 } as DOMRect);
    const { unmount } = render(<Frame />);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--aimtrix-content-height')).toBe('794px');
    act(() => { Object.assign(viewport, { height: 340, offsetTop: 32 }); viewport.dispatchEvent(new Event('resize')); });
    expect(root.dataset.compactViewport).toBe('true');
    expect(root.style.getPropertyValue('--aimtrix-content-height')).toBe('290px');
    expect(root.style.getPropertyValue('--aimtrix-visual-offset-top')).toBe('32px');
    act(() => { Object.assign(viewport, { scale: 2 }); viewport.dispatchEvent(new Event('resize')); });
    expect(root.dataset.compactViewport).toBe('false');
    expect(root.style.getPropertyValue('--aimtrix-content-height')).toBe('794px');
    act(() => { Object.assign(viewport, { height: 844, offsetTop: 0, scale: 1 }); viewport.dispatchEvent(new Event('resize')); });
    expect(root.style.getPropertyValue('--aimtrix-visual-offset-top')).toBe('0px');
    unmount();
    expect(root.style.getPropertyValue('--aimtrix-content-height')).toBe('');
    vi.unstubAllGlobals();
  });
});
