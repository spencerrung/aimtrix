import { useCallback, useEffect, useRef, useState } from 'react';

export type ShellPanel = 'thread' | 'details' | 'search';

export interface ShellRoute {
  surface: 'list' | 'conversation' | 'context' | 'activity';
  panel: ShellPanel | null;
  roomId?: string;
  spaceId?: string;
  threadRootId?: string;
  threadEventId?: string;
  eventId?: string;
}

export interface ShellReadingPosition {
  mode: 'live' | 'history' | 'context';
  anchor?: { eventId: string; offset: number };
  atLatest?: boolean;
}

const historyKey = '__aimtrixShell';
const entryLimit = 100;

interface Entry {
  route: ShellRoute;
  reading?: ShellReadingPosition;
  threadReading?: ShellReadingPosition;
  previous?: number;
  next?: number;
}

function sameDestination(left: ShellRoute, right: ShellRoute) {
  return left.roomId === right.roomId && left.spaceId === right.spaceId && left.eventId === right.eventId;
}

function sameRoute(left: ShellRoute, right: ShellRoute) {
  return sameDestination(left, right) && left.surface === right.surface &&
    left.panel === right.panel && left.threadRootId === right.threadRootId && left.threadEventId === right.threadEventId;
}

function sameThreadDestination(left: ShellRoute, right: ShellRoute) {
  return Boolean(left.threadRootId) && left.roomId === right.roomId &&
    left.threadRootId === right.threadRootId && left.threadEventId === right.threadEventId;
}

function copyReading(reading?: ShellReadingPosition): ShellReadingPosition | undefined {
  return reading && {
    mode: reading.mode,
    atLatest: reading.atLatest,
    anchor: reading.anchor && Number.isFinite(reading.anchor.offset)
      ? { eventId: reading.anchor.eventId, offset: reading.anchor.offset } : undefined,
  };
}

function stateRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/**
 * Owns bounded navigation for one mounted workspace, independently of viewport.
 * Browser history contains opaque pointers only; room/event IDs and reading
 * positions stay in memory and cannot be restored by another account or mount.
 */
export function useShellNavigation(initialRoute: ShellRoute) {
  const [view, setView] = useState(() => ({
    route: initialRoute, entryId: 0, reading: undefined as ShellReadingPosition | undefined,
    threadReading: undefined as ShellReadingPosition | undefined,
    canGoBack: initialRoute.surface !== 'list', canGoForward: false,
  }));
  const [session] = useState(() => `shell-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const navigationRef = useRef({
    session,
    initial: initialRoute,
    current: 0,
    sequence: 0,
    entries: new Map<number, Entry>([[0, { route: initialRoute }]]),
    mounted: false,
    browserUsable: true,
    traversing: false,
    pending: undefined as { route: ShellRoute; options: { replace?: boolean } } | undefined,
  });

  const publish = useCallback(() => {
    const navigation = navigationRef.current;
    const entry = navigation.entries.get(navigation.current)!;
    setView({
      route: entry.route, entryId: navigation.current, reading: copyReading(entry.reading),
      threadReading: copyReading(entry.threadReading),
      canGoBack: !navigation.traversing && (entry.previous !== undefined || entry.route.surface !== 'list'),
      canGoForward: !navigation.traversing && entry.next !== undefined,
    });
  }, []);

  const historyMatchesCurrent = useCallback(() => {
    if (typeof window === 'undefined') return false;
    const pointer = stateRecord(stateRecord(window.history.state)[historyKey]);
    const navigation = navigationRef.current;
    return pointer.session === navigation.session && pointer.entry === navigation.current;
  }, []);

  const writeHistory = useCallback((entry: number, replace: boolean) => {
    const navigation = navigationRef.current;
    if (typeof window === 'undefined') return;
    try {
      const next = { ...stateRecord(window.history.state), [historyKey]: { session: navigation.session, entry } };
      if (replace) window.history.replaceState(next, '');
      else window.history.pushState(next, '');
    } catch {
      // A failed push means browser and memory adjacency no longer agree. Use
      // memory for both directions for the rest of this workspace lifetime.
      navigation.browserUsable = false;
    }
  }, []);

  const navigate = useCallback((next: ShellRoute, options: { replace?: boolean } = {}) => {
    const navigation = navigationRef.current;
    if (!navigation.mounted && typeof window !== 'undefined') return;
    if (navigation.traversing) {
      // Browser traversal is asynchronous: its popstate must finish before the
      // latest new destination can replace the forward branch.
      navigation.pending = { route: next, options };
      return;
    }
    let current = navigation.entries.get(navigation.current)!;
    if (sameRoute(current.route, next)) return;
    if (!historyMatchesCurrent()) navigation.browserUsable = false;
    const enteringContext = next.surface === 'context' && current.route.surface !== 'context';
    const changingThread = current.route.panel === 'thread' && next.panel === 'thread' && !sameThreadDestination(current.route, next);
    // Contextual tools replace one another; different rooms/message links are
    // destinations even when both happen to be displayed in contextual routes.
    const replace = !enteringContext && (options.replace ??
      (current.route.surface === 'context' && next.surface === 'context' && sameDestination(current.route, next) && !changingThread));
    if (!replace) {
      let future = current.next;
      while (future !== undefined) {
        const following = navigation.entries.get(future)?.next;
        navigation.entries.delete(future);
        future = following;
      }
      current.next = undefined;
    }
    if (enteringContext) {
      current = { ...current, route: { ...current.route, panel: null } };
      navigation.entries.set(navigation.current, current);
      if (current.route.surface === 'list') {
        // Desktop shows a room alongside the list: insert that room so mobile
        // still has context -> conversation -> list after a viewport change.
        const parent = ++navigation.sequence;
        const previous = navigation.current;
        current.next = parent;
        current = {
          route: { ...next, surface: 'conversation', panel: null },
          reading: sameDestination(current.route, next) ? copyReading(current.reading) : undefined,
          previous,
        };
        navigation.entries.set(parent, current);
        navigation.current = parent;
        writeHistory(parent, false);
      }
    }
    const previousId = navigation.current;
    const entry = ++navigation.sequence;
    const parent = replace ? current.previous : previousId;
    const following = replace ? current.next : undefined;
    navigation.entries.set(entry, {
      route: { ...next },
      reading: sameDestination(current.route, next) ? copyReading(current.reading) : undefined,
      threadReading: sameThreadDestination(current.route, next) ? copyReading(current.threadReading) : undefined,
      previous: parent, next: following,
    });
    if (parent !== undefined) navigation.entries.get(parent)!.next = entry;
    if (following !== undefined) navigation.entries.get(following)!.previous = entry;
    if (replace) navigation.entries.delete(previousId);
    navigation.current = entry;
    // Remove the oldest reachable entry; if we're at that entry, discard the
    // furthest forward one instead. No retained link may point at pruned data.
    while (navigation.entries.size > entryLimit) {
      let oldest = navigation.current;
      while (navigation.entries.get(oldest)!.previous !== undefined) oldest = navigation.entries.get(oldest)!.previous!;
      if (oldest !== navigation.current) {
        const following = navigation.entries.get(oldest)!.next!;
        navigation.entries.get(following)!.previous = undefined;
        navigation.entries.delete(oldest);
      } else {
        let newest = navigation.current;
        while (navigation.entries.get(newest)!.next !== undefined) newest = navigation.entries.get(newest)!.next!;
        const previous = navigation.entries.get(newest)!.previous!;
        navigation.entries.get(previous)!.next = undefined;
        navigation.entries.delete(newest);
      }
    }
    writeHistory(entry, replace);
    publish();
  }, [historyMatchesCurrent, publish, writeHistory]);

  useEffect(() => {
    const navigation = navigationRef.current;
    if (typeof window === 'undefined') return;
    navigation.mounted = true;
    writeHistory(navigation.current, true);
    const handlePopState = (event: PopStateEvent) => {
      navigation.traversing = false;
      const pointer = stateRecord(stateRecord(event.state)[historyKey]);
      const entry = pointer.session === navigation.session && typeof pointer.entry === 'number'
        ? navigation.entries.get(pointer.entry) : undefined;
      if (entry) navigation.current = pointer.entry as number;
      else {
        // Another account/mount, a discarded branch, or pruned history cannot
        // recover private destinations. Start a fresh chain at this workspace.
        navigation.current = ++navigation.sequence;
        navigation.entries.clear();
        navigation.entries.set(navigation.current, { route: navigation.initial });
        writeHistory(navigation.current, true);
      }
      publish();
      const pending = navigation.pending;
      navigation.pending = undefined;
      if (pending) navigate(pending.route, pending.options);
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      navigation.mounted = false;
      navigation.traversing = false;
      navigation.pending = undefined;
      window.removeEventListener('popstate', handlePopState);
      const state = stateRecord(window.history.state);
      if (stateRecord(state[historyKey]).session !== navigation.session) return;
      const sanitized = { ...state };
      delete sanitized[historyKey];
      try { window.history.replaceState(sanitized, ''); } catch { /* Restricted history. */ }
    };
  }, [navigate, publish, writeHistory]);

  const traverse = useCallback((direction: 'back' | 'forward') => {
    const navigation = navigationRef.current;
    if (navigation.traversing || (!navigation.mounted && typeof window !== 'undefined')) return;
    const current = navigation.entries.get(navigation.current)!;
    const target = direction === 'back' ? current.previous : current.next;
    if (target !== undefined) {
      if (navigation.browserUsable && historyMatchesCurrent()) {
        try {
          navigation.traversing = true;
          publish();
          window.history[direction]();
          return;
        } catch { navigation.traversing = false; navigation.browserUsable = false; }
      }
      navigation.current = target;
      writeHistory(target, true);
      publish();
    } else if (direction === 'back' && current.route.surface !== 'list') {
      navigate({
        ...current.route,
        surface: current.route.surface === 'context' ? 'conversation' : 'list',
        panel: null,
      }, { replace: true });
    }
  }, [historyMatchesCurrent, navigate, publish, writeHistory]);

  const back = useCallback(() => traverse('back'), [traverse]);
  const forward = useCallback(() => traverse('forward'), [traverse]);
  // Captured while scrolling/before leaving; deliberately does not render or
  // create a destination. The returned reading snapshot changes on traversal.
  const remember = useCallback((reading?: ShellReadingPosition, entryId?: number) => {
    const navigation = navigationRef.current;
    if (!navigation.mounted) return;
    const entry = navigation.entries.get(entryId ?? navigation.current);
    if (entry) entry.reading = copyReading(reading);
  }, []);

  const rememberThread = useCallback((reading?: ShellReadingPosition, entryId?: number) => {
    const navigation = navigationRef.current;
    if (!navigation.mounted) return;
    const entry = navigation.entries.get(entryId ?? navigation.current);
    if (entry?.route.threadRootId) entry.threadReading = copyReading(reading);
  }, []);

  return { ...view, navigate, back, forward, remember, rememberThread };
}
