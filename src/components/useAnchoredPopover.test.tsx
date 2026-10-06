import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAnchoredPopover } from './useAnchoredPopover';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps a fixed menu inside the offset visual viewport as the keyboard opens and closes', () => {
  const viewport = new EventTarget();
  Object.assign(viewport, { height: 340, width: 390, offsetTop: 120, offsetLeft: 0 });
  vi.stubGlobal('visualViewport', viewport);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return (this.tagName === 'BUTTON' ? { top: 420, bottom: 450, right: 380, width: 44, height: 30 }
      : { width: Math.min(200, parseFloat(this.style.maxWidth)), height: Math.min(420, parseFloat(this.style.maxHeight)) }) as DOMRect;
  });
  function Fixture() {
    const trigger = useRef<HTMLButtonElement>(null);
    const surface = useRef<HTMLDivElement>(null);
    useAnchoredPopover(true, trigger, surface);
    return <><button ref={trigger}>Open</button><div ref={surface} data-testid="menu" /></>;
  }
  const { getByTestId, unmount } = render(<Fixture />);
  const menu = getByTestId('menu');
  expect(menu.style.maxHeight).toBe('316px');
  expect(menu.style.top).toBe('132px');
  expect(menu.style.left).toBe('178px');
  act(() => { Object.assign(viewport, { height: 844, offsetTop: 0 }); viewport.dispatchEvent(new Event('resize')); });
  expect(menu.style.maxHeight).toBe('820px');
  expect(menu.style.top).toBe('12px');
  act(() => { Object.assign(viewport, { width: 195, offsetLeft: 80, height: 332, offsetTop: 40, scale: 2 }); viewport.dispatchEvent(new Event('resize')); });
  expect(menu.style.maxWidth).toBe('171px');
  expect(menu.style.left).toBe('92px');
  expect(menu.style.top).toBe('52px');
  unmount();
});
