import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ShellReadingPosition, type ShellRoute, useShellNavigation } from './useShellNavigation';

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
    const actions = { navigate: result.current.navigate, back: result.current.back, forward: result.current.forward, remember: result.current.remember, rememberThread: result.current.rememberThread };
    act(() => result.current.navigate(conversation));
    rerender();
    expect(result.current.navigate).toBe(actions.navigate);
    expect(result.current.back).toBe(actions.back);
    expect(result.current.forward).toBe(actions.forward);
    expect(result.current.remember).toBe(actions.remember);
    expect(result.current.rememberThread).toBe(actions.rememberThread);
  });

  it('keeps separate main and thread reading positions through thread and reply destination Back/Forward', async () => {
    const { result } = renderHook(() => useShellNavigation(conversation));
    const mainReading: ShellReadingPosition = { mode: 'history', anchor: { eventId: '$main-anchor', offset: -14 } };
    act(() => result.current.remember(mainReading));
    act(() => result.current.navigate(thread));
    const firstEntry = result.current.entryId;
    const firstReading: ShellReadingPosition = { mode: 'history', anchor: { eventId: '$first-anchor', offset: 21 } };
    act(() => result.current.rememberThread(firstReading));
    firstReading.anchor!.offset = 999;
    const other = { ...thread, threadRootId: '$other-root' };
    act(() => result.current.navigate(other));
    expect(result.current.reading).toEqual(mainReading);
    expect(result.current.threadReading).toBeUndefined();
    act(() => result.current.rememberThread({ mode: 'live', atLatest: true }));
    const target = { ...other, threadEventId: '$specific-reply' };
    act(() => result.current.navigate(target));
    expect(result.current.reading).toEqual(mainReading);
    expect(result.current.route.eventId).toBeUndefined();
    expect(result.current.threadReading).toBeUndefined();
    act(() => result.current.rememberThread({ mode: 'context', anchor: { eventId: '$specific-reply', offset: 30 } }));
    act(() => result.current.back());
    await waitFor(() => expect(result.current.route).toEqual(other));
    expect(result.current.threadReading).toMatchObject({ mode: 'live', atLatest: true });
    act(() => result.current.back());
    await waitFor(() => expect(result.current.entryId).toBe(firstEntry));
    expect(result.current.threadReading?.anchor).toEqual({ eventId: '$first-anchor', offset: 21 });
    expect(result.current.reading).toEqual(mainReading);
    act(() => result.current.forward());
    await waitFor(() => expect(result.current.route).toEqual(other));
    act(() => result.current.forward());
    await waitFor(() => expect(result.current.route).toEqual(target));
    expect(result.current.threadReading?.anchor).toEqual({ eventId: '$specific-reply', offset: 30 });
    expect(result.current.reading).toEqual(mainReading);
    expect(JSON.stringify(window.history.state)).not.toMatch(/main-anchor|first-anchor|specific-reply|other-root|offset/);
  });

  it('preserves a thread reading position through ordinary contextual-tool replacements', async () => {
    const { result } = renderHook(() => useShellNavigation(conversation));
    act(() => result.current.navigate({ ...thread, threadEventId: '$reply' }));
    act(() => result.current.rememberThread({ mode: 'context', anchor: { eventId: '$reply', offset: -9 } }));
    const push = vi.spyOn(window.history, 'pushState');
    act(() => result.current.navigate({ ...result.current.route, panel: 'details' }));
    act(() => result.current.navigate({ ...result.current.route, panel: 'search' }));
    act(() => result.current.navigate({ ...result.current.route, panel: 'thread' }));
    expect(push).not.toHaveBeenCalled();
    expect(result.current.threadReading?.anchor).toEqual({ eventId: '$reply', offset: -9 });
    act(() => result.current.back());
    await waitFor(() => expect(result.current.route).toEqual(conversation));
  });

  it('keeps delayed thread scroll writes on their original entry and never imports them into a new account mount', async () => {
    const first = renderHook(() => useShellNavigation(conversation));
    act(() => first.result.current.navigate(thread));
    const oldEntry = first.result.current.entryId;
    const oldPointer = window.history.state;
    const rememberThread = first.result.current.rememberThread;
    const next = { ...thread, threadEventId: '$new-target' };
    act(() => first.result.current.navigate(next));
    act(() => rememberThread({ mode: 'history', anchor: { eventId: '$old-thread-anchor', offset: 7 } }, oldEntry));
    expect(first.result.current.threadReading).toBeUndefined();
    act(() => first.result.current.back());
    await waitFor(() => expect(first.result.current.entryId).toBe(oldEntry));
    expect(first.result.current.threadReading?.anchor?.eventId).toBe('$old-thread-anchor');
    first.unmount();
    const second = renderHook(() => useShellNavigation(list));
    act(() => rememberThread({ mode: 'context', anchor: { eventId: '$late-old-account', offset: 8 } }, oldEntry));
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: oldPointer })));
    expect(second.result.current.route).toEqual(list);
    expect(second.result.current.threadReading).toBeUndefined();
  });

  it('restores distinct same-room event destinations and their own reading positions in both directions', async () => {
    const { result } = renderHook(() => useShellNavigation(list));
    const first = { ...conversation, eventId: '$first-synthetic' };
    const second = { ...conversation, eventId: '$second-synthetic' };
    act(() => result.current.navigate(first));
    const firstEntry = result.current.entryId;
    const reading: ShellReadingPosition = { mode: 'context', anchor: { eventId: '$visible-synthetic', offset: -17 }, atLatest: false };
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    act(() => result.current.remember(reading, firstEntry));
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    reading.anchor!.offset = 999;
    act(() => result.current.navigate(second));
    act(() => result.current.remember({ mode: 'context', anchor: { eventId: '$second-visible', offset: 24 } }));
    const secondEntry = result.current.entryId;
    act(() => result.current.back());
    await waitFor(() => expect(result.current.entryId).toBe(firstEntry));
    expect(result.current.route).toEqual(first);
    expect(result.current.reading).toEqual({ mode: 'context', anchor: { eventId: '$visible-synthetic', offset: -17 }, atLatest: false });
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.canGoForward).toBe(true);
    act(() => result.current.forward());
    await waitFor(() => expect(result.current.entryId).toBe(secondEntry));
    expect(result.current.route).toEqual(second);
    expect(result.current.reading?.anchor).toEqual({ eventId: '$second-visible', offset: 24 });
    expect(result.current.canGoForward).toBe(false);
    expect(JSON.stringify(window.history.state)).not.toMatch(/synthetic|offset|context|visible/);
  });

  it('does not let a scroll callback from an older entry overwrite the new destination', async () => {
    const { result } = renderHook(() => useShellNavigation(list));
    act(() => result.current.navigate(conversation));
    const oldEntry = result.current.entryId;
    act(() => result.current.navigate({ ...conversation, eventId: '$new-synthetic' }));
    act(() => result.current.remember({ mode: 'history', anchor: { eventId: '$old-visible', offset: 7 } }, oldEntry));
    expect(result.current.reading).toBeUndefined();
    act(() => result.current.back());
    await waitFor(() => expect(result.current.entryId).toBe(oldEntry));
    expect(result.current.reading?.anchor?.eventId).toBe('$old-visible');
  });

  it('prunes the forward branch when navigating after Back and ignores its stale opaque pointer', async () => {
    const { result } = renderHook(() => useShellNavigation(list));
    act(() => result.current.navigate(conversation));
    act(() => result.current.navigate({ ...conversation, eventId: '$discarded-synthetic' }));
    const discarded = window.history.state;
    act(() => result.current.back());
    await waitFor(() => expect(result.current.route).toEqual(conversation));
    expect(result.current.canGoForward).toBe(true);
    const replacement = { ...conversation, eventId: '$replacement-synthetic' };
    act(() => result.current.navigate(replacement));
    expect(result.current.canGoForward).toBe(false);
    act(() => result.current.forward());
    expect(result.current.route).toEqual(replacement);
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: discarded })));
    expect(result.current.route).toEqual(list);
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.canGoForward).toBe(false);
  });

  it('retains native Forward after replacing a contextual tool in the middle of the chain', async () => {
    const { result } = renderHook(() => useShellNavigation(list));
    act(() => result.current.navigate(conversation));
    act(() => result.current.navigate(thread));
    const later = { ...conversation, roomId: 'later-synthetic' };
    act(() => result.current.navigate(later));
    act(() => result.current.back());
    await waitFor(() => expect(result.current.route).toEqual(thread));
    const details: ShellRoute = { ...thread, panel: 'details' };
    act(() => result.current.navigate(details));
    expect(result.current.canGoForward).toBe(true);
    act(() => result.current.forward());
    await waitFor(() => expect(result.current.route).toEqual(later));
    act(() => result.current.back());
    await waitFor(() => expect(result.current.route).toEqual(details));
    act(() => result.current.back());
    await waitFor(() => expect(result.current.route).toEqual(conversation));
  });

  it('pushes different event destinations even when both are contextual routes', async () => {
    const { result } = renderHook(() => useShellNavigation(conversation));
    const first = { ...thread, eventId: '$first-synthetic' };
    const second = { ...thread, eventId: '$second-synthetic' };
    act(() => result.current.navigate(first));
    act(() => result.current.navigate(second));
    act(() => result.current.back());
    await waitFor(() => expect(result.current.route).toEqual(first));
    act(() => result.current.back());
    await waitFor(() => expect(result.current.route).toEqual(conversation));
  });

  it('disables traversal controls while browser history is pending and applies the newest destination afterward', async () => {
    const { result } = renderHook(() => useShellNavigation(list));
    act(() => result.current.navigate(conversation));
    const previous = window.history.state;
    act(() => result.current.navigate(thread));
    const browserBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    act(() => result.current.back());
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.canGoForward).toBe(false);
    act(() => { result.current.back(); result.current.forward(); });
    expect(browserBack).toHaveBeenCalledTimes(1);
    act(() => result.current.navigate({ ...conversation, roomId: 'superseded-synthetic' }));
    const intended = { ...conversation, roomId: 'latest-synthetic' };
    act(() => result.current.navigate(intended));
    act(() => {
      window.history.replaceState(previous, '');
      window.dispatchEvent(new PopStateEvent('popstate', { state: previous }));
    });
    expect(result.current.route).toEqual(intended);
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.canGoForward).toBe(false);
  });

  it('bounds retained navigation and reading metadata to one hundred entries', () => {
    vi.spyOn(window.history, 'pushState').mockImplementation(() => { throw new DOMException('Disabled', 'SecurityError'); });
    const { result } = renderHook(() => useShellNavigation(list));
    for (let index = 0; index < 105; index += 1) {
      act(() => result.current.navigate({ ...conversation, eventId: `$synthetic-${index}` }));
      act(() => result.current.remember({ mode: 'context', anchor: { eventId: `$anchor-${index}`, offset: index } }));
    }
    for (let index = 103; index >= 5; index -= 1) {
      act(() => result.current.back());
      expect(result.current.route.eventId).toBe(`$synthetic-${index}`);
      expect(result.current.reading?.anchor?.offset).toBe(index);
    }
    // The pruned destination is gone; Back can still expose the local list.
    act(() => result.current.back());
    expect(result.current.route.surface).toBe('list');
    expect(result.current.canGoBack).toBe(false);
    act(() => result.current.forward());
    expect(result.current.route.eventId).toBe('$synthetic-6');
  });

  it('uses memory for Forward after a failed push even if replacement writes still succeed', () => {
    vi.spyOn(window.history, 'pushState').mockImplementation(() => { throw new DOMException('Disabled', 'SecurityError'); });
    const browserBack = vi.spyOn(window.history, 'back');
    const browserForward = vi.spyOn(window.history, 'forward');
    const { result } = renderHook(() => useShellNavigation(list));
    act(() => result.current.navigate(conversation));
    act(() => result.current.navigate(thread));
    act(() => result.current.back());
    expect(result.current.route).toEqual(conversation);
    act(() => result.current.back());
    expect(result.current.route).toEqual(list);
    act(() => result.current.forward());
    expect(result.current.route).toEqual(conversation);
    act(() => result.current.forward());
    expect(result.current.route).toEqual(thread);
    expect(browserBack).not.toHaveBeenCalled();
    expect(browserForward).not.toHaveBeenCalled();
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
