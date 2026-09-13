import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ShellRoute, useShellNavigation } from './useShellNavigation';

const list: ShellRoute = { surface: 'list', panel: null, spaceId: 'synthetic-space' };
const conversation: ShellRoute = { ...list, surface: 'conversation', roomId: 'synthetic-room' };
const thread: ShellRoute = { ...conversation, surface: 'context', panel: 'thread', threadRootId: 'synthetic-root' };

beforeEach(() => window.history.replaceState({ unrelated: { retained: true } }, ''));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('workspace shell navigation', () => {
  it('uses the same list, conversation and contextual entries for visible Back and browser Forward', async () => {
    const { result } = renderHook(() => useShellNavigation(list));
    act(() => result.current.navigate(conversation));
    act(() => result.current.navigate(thread));
    act(() => result.current.back());
    await waitFor(() => expect(result.current.route).toEqual(conversation));
    act(() => result.current.back());
    await waitFor(() => expect(result.current.route).toEqual(list));
    act(() => window.history.forward());
    await waitFor(() => expect(result.current.route).toEqual(conversation));
    act(() => window.history.forward());
    await waitFor(() => expect(result.current.route).toEqual(thread));
  });

  it('replaces contextual content so browser Back always reaches the invoking conversation', async () => {
    const { result } = renderHook(() => useShellNavigation(list));
    const push = vi.spyOn(window.history, 'pushState');
    act(() => result.current.navigate(conversation));
    act(() => result.current.navigate(thread));
    const details: ShellRoute = { ...thread, panel: 'details' };
    act(() => result.current.navigate(details));
    const search: ShellRoute = { ...details, panel: 'search' };
    act(() => result.current.navigate(search));
    expect(push).toHaveBeenCalledTimes(2);
    act(() => window.history.back());
    await waitFor(() => expect(result.current.route).toEqual(conversation));
    act(() => window.history.forward());
    await waitFor(() => expect(result.current.route).toEqual(search));
  });

  it('inserts the visible desktop room before context opened directly from the initial list', async () => {
    const desktopList: ShellRoute = { ...conversation, surface: 'list', panel: 'details' };
    const { result } = renderHook(() => useShellNavigation(desktopList));
    act(() => result.current.navigate(thread));
    act(() => result.current.back());
    await waitFor(() => expect(result.current.route).toEqual({ ...thread, surface: 'conversation', panel: null }));
    act(() => window.history.back());
    await waitFor(() => expect(result.current.route).toEqual({ ...desktopList, panel: null }));
    act(() => window.history.forward());
    await waitFor(() => expect(result.current.route.surface).toBe('conversation'));
    act(() => window.history.forward());
    await waitFor(() => expect(result.current.route).toEqual(thread));
  });

  it('does not reopen remembered desktop details after closing their replacement thread', async () => {
    const { result } = renderHook(() => useShellNavigation(list));
    act(() => result.current.navigate({ ...conversation, panel: 'details' }));
    act(() => result.current.navigate(thread));
    act(() => result.current.back());
    await waitFor(() => expect(result.current.route).toEqual(conversation));
    act(() => result.current.back());
    await waitFor(() => expect(result.current.route).toEqual(list));
  });

  it('keeps navigation action identities stable through transitions and rerenders', () => {
    const { result, rerender } = renderHook(() => useShellNavigation(list));
    const actions = { navigate: result.current.navigate, back: result.current.back };
    act(() => result.current.navigate(conversation));
    rerender();
    expect(result.current.navigate).toBe(actions.navigate);
    expect(result.current.back).toBe(actions.back);
  });

  it('applies newer navigation after a pending browser traversal instead of letting Back overwrite it', async () => {
    const { result } = renderHook(() => useShellNavigation(list));
    act(() => result.current.navigate(conversation));
    act(() => result.current.navigate(thread));
    const nextRoom: ShellRoute = { ...conversation, roomId: 'synthetic-next-room' };
    act(() => {
      result.current.back();
      result.current.navigate(nextRoom);
    });
    await waitFor(() => expect(result.current.route).toEqual(nextRoom));
    act(() => result.current.back());
    await waitFor(() => expect(result.current.route).toEqual(conversation));
  });

  it('does not write duplicate entries on identical navigation, rerenders or viewport changes', () => {
    const { result, rerender } = renderHook(() => useShellNavigation(list));
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    act(() => result.current.navigate({ ...list }));
    rerender();
    act(() => window.dispatchEvent(new Event('resize')));
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('preserves unrelated history state while keeping room and event identifiers in memory', () => {
    const { result, unmount } = renderHook(() => useShellNavigation(list));
    act(() => result.current.navigate(conversation));
    act(() => result.current.navigate(thread));
    const serialized = JSON.stringify(window.history.state);
    expect(serialized).not.toContain('synthetic');
    expect(window.history.state.unrelated).toEqual({ retained: true });
    unmount();
    expect(window.history.state).toEqual({ unrelated: { retained: true } });
  });

  it('cannot recover an old workspace route when a later account visits an old history entry', () => {
    const first = renderHook(() => useShellNavigation(list));
    act(() => first.result.current.navigate(thread));
    const oldState = window.history.state;
    const staleNavigate = first.result.current.navigate;
    first.unmount();
    const nextList: ShellRoute = { surface: 'list', panel: null, spaceId: 'next-account-space' };
    const second = renderHook(() => useShellNavigation(nextList));
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: oldState })));
    expect(second.result.current.route).toEqual(nextList);
    expect(window.history.state.__aimtrixShell.session).not.toBe(oldState.__aimtrixShell.session);
    const nextState = window.history.state;
    act(() => staleNavigate(conversation));
    expect(window.history.state).toEqual(nextState);
  });

  it('provides parent routes for an initial context without leaving the application', () => {
    const { result } = renderHook(() => useShellNavigation(thread));
    const browserBack = vi.spyOn(window.history, 'back');
    act(() => result.current.back());
    expect(result.current.route).toEqual({ ...thread, surface: 'conversation', panel: null });
    act(() => result.current.back());
    expect(result.current.route).toEqual({ ...thread, surface: 'list', panel: null });
    act(() => result.current.back());
    expect(browserBack).not.toHaveBeenCalled();
  });

  it('keeps navigation usable when an embedded browser refuses history writes', () => {
    vi.spyOn(window.history, 'pushState').mockImplementation(() => { throw new DOMException('Disabled', 'SecurityError'); });
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => { throw new DOMException('Disabled', 'SecurityError'); });
    const { result } = renderHook(() => useShellNavigation(list));
    act(() => result.current.navigate(conversation));
    act(() => result.current.navigate(thread));
    act(() => result.current.back());
    expect(result.current.route).toEqual(conversation);
    act(() => result.current.back());
    expect(result.current.route).toEqual(list);
  });

  it('falls back to its parent route if browser Back itself is unavailable', () => {
    const { result } = renderHook(() => useShellNavigation(list));
    act(() => result.current.navigate(conversation));
    vi.spyOn(window.history, 'back').mockImplementation(() => { throw new DOMException('Disabled', 'SecurityError'); });
    act(() => result.current.back());
    expect(result.current.route).toEqual(list);
  });

  it('renders the supplied route without a browser for server rendering', () => {
    function ShellProbe() {
      return useShellNavigation(thread).route.surface;
    }
    vi.stubGlobal('window', undefined);
    expect(renderToString(createElement(ShellProbe))).toBe('context');
  });
});
