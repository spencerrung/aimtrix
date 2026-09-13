import { useCallback, useEffect, useRef, useState } from 'react';

export type ShellPanel = 'thread' | 'details' | 'search';

export interface ShellRoute {
  surface: 'list' | 'conversation' | 'context';
  panel: ShellPanel | null;
  roomId?: string;
  spaceId?: string;
  threadRootId?: string;
}

const historyKey = '__aimtrixShell';

interface Entry {
  route: ShellRoute;
  previous?: number;
}

function sameRoute(left: ShellRoute, right: ShellRoute) {
  return left.surface === right.surface && left.panel === right.panel &&
    left.roomId === right.roomId && left.spaceId === right.spaceId &&
    left.threadRootId === right.threadRootId;
}

function stateRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/**
 * Owns navigation for one mounted workspace, independently of its viewport size.
 * Browser history contains opaque pointers only; room and event IDs remain in
 * memory and cannot be restored by another account or a later workspace mount.
 */
export function useShellNavigation(initialRoute: ShellRoute) {
  const [route, setRoute] = useState(initialRoute);
  const [session] = useState(() => `shell-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const navigationRef = useRef({
    session,
    initial: initialRoute,
    current: 0,
    sequence: 0,
    entries: new Map<number, Entry>([[0, { route: initialRoute }]]),
    mounted: false,
    traversing: false,
    pending: undefined as { route: ShellRoute; options: { replace?: boolean } } | undefined,
  });

  const writeHistory = useCallback((entry: number, replace: boolean) => {
    const navigation = navigationRef.current;
    if (typeof window === 'undefined') return false;
    try {
      const next = {
        ...stateRecord(window.history.state),
        [historyKey]: { session: navigation.session, entry },
      };
      if (replace) window.history.replaceState(next, '');
      else window.history.pushState(next, '');
      return true;
    } catch {
      // Embedded/restricted browsers can refuse history writes. Keep the
      // visible navigation usable using the same in-memory route chain.
      return false;
    }
  }, []);

  const navigate = useCallback((next: ShellRoute, options: { replace?: boolean } = {}) => {
    const navigation = navigationRef.current;
    if (!navigation.mounted && typeof window !== 'undefined') return;
    if (navigation.traversing) {
      // history.back() is asynchronous. Apply the latest intent after its
      // popstate, rather than allowing that older traversal to overwrite it.
      navigation.pending = { route: next, options };
      return;
    }
    let current = navigation.entries.get(navigation.current)!;
    if (sameRoute(current.route, next)) return;
    const enteringContext = next.surface === 'context' && current.route.surface !== 'context';
    if (enteringContext) {
      // A remembered desktop drawer is presentation state, not a parent
      // destination: closing its replacement must reveal the room alone.
      current = { ...current, route: { ...current.route, panel: null } };
      navigation.entries.set(navigation.current, current);
      if (current.route.surface === 'list') {
        // Desktop already displays a room alongside the list. Give that room
        // its own entry before opening context so a later narrow viewport has
        // the same context -> conversation -> list Back chain.
        const parent = ++navigation.sequence;
        current = {
          route: { ...next, surface: 'conversation', panel: null },
          previous: navigation.current,
        };
        navigation.entries.set(parent, current);
        navigation.current = parent;
        writeHistory(parent, false);
      }
    }
    // Switching the drawer's content keeps a single Back step to the room.
    const replace = !enteringContext && (options.replace ?? (current.route.surface === 'context' && next.surface === 'context'));
    const entry = ++navigation.sequence;
    navigation.entries.set(entry, {
      route: next,
      previous: replace ? current.previous : navigation.current,
    });
    navigation.current = entry;
    navigation.traversing = false;
    writeHistory(entry, replace);
    setRoute(next);
  }, [writeHistory]);

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
      if (entry) {
        navigation.current = pointer.entry as number;
        setRoute(entry.route);
      } else {
        // A previous workspace's entries are inert. Replace their marker rather
        // than recovering account-specific navigation after sign-out/sign-in.
        navigation.current = ++navigation.sequence;
        navigation.entries.set(navigation.current, { route: navigation.initial });
        writeHistory(navigation.current, true);
        setRoute(navigation.initial);
      }
      const pending = navigation.pending;
      navigation.pending = undefined;
      if (pending) navigate(pending.route, pending.options);
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      navigation.mounted = false;
      navigation.pending = undefined;
      window.removeEventListener('popstate', handlePopState);
      const state = stateRecord(window.history.state);
      if (stateRecord(state[historyKey]).session !== navigation.session) return;
      const sanitized = { ...state };
      delete sanitized[historyKey];
      try { window.history.replaceState(sanitized, ''); } catch { /* Restricted history. */ }
    };
  }, [navigate, writeHistory]);

  const back = useCallback(() => {
    const navigation = navigationRef.current;
    if (navigation.traversing || (!navigation.mounted && typeof window !== 'undefined')) return;
    const current = navigation.entries.get(navigation.current)!;
    if (current.previous !== undefined) {
      const pointer = typeof window !== 'undefined'
        ? stateRecord(stateRecord(window.history.state)[historyKey]) : {};
      if (pointer.session === navigation.session && pointer.entry === navigation.current) {
        try {
          navigation.traversing = true;
          window.history.back();
          return;
        } catch { navigation.traversing = false; }
      }
      navigation.current = current.previous;
      writeHistory(navigation.current, true);
      setRoute(navigation.entries.get(navigation.current)!.route);
    } else if (current.route.surface !== 'list') {
      navigate({
        ...current.route,
        surface: current.route.surface === 'context' ? 'conversation' : 'list',
        panel: null,
      }, { replace: true });
    }
  }, [navigate, writeHistory]);

  return { route, navigate, back };
}
