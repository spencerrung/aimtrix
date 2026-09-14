import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ThreadSummary } from '../../matrix/viewModels';
import type { ShellReadingPosition } from './useShellNavigation';
import { captureTimelineAnchor, historyRows, restoreTimelineAnchor, type TimelineAnchor } from './timelineAnchors';

type Direction = 'backward' | 'forward';
interface Options {
  roomId?: string;
  thread?: ThreadSummary;
  active: boolean;
  entryId: number;
  eventId?: string;
  requestId?: number;
  reading?: ShellReadingPosition;
  open?: (eventId?: string) => Promise<void>;
  load?: (direction: Direction) => Promise<void>;
  latest?: () => Promise<void>;
  detached?: (detached: boolean) => void;
  close?: () => void;
  remember: (reading: ShellReadingPosition, entryId: number) => void;
}
interface Pending {
  generation: number;
  done: boolean;
  target?: string;
  reading?: ShellReadingPosition;
  latest?: boolean;
  revision?: number;
  interaction?: number;
}

/** Each thread and browser entry owns its reading position independently of the room. */
export function useThreadViewport(options: Options) {
  const viewport = useRef<HTMLDivElement>(null);
  const current = useRef(options);
  const positions = useRef(new Map<string, ShellReadingPosition>());
  const anchor = useRef<TimelineAnchor | undefined>(undefined);
  const attached = useRef(true);
  const pending = useRef<Pending | undefined>(undefined);
  const generation = useRef(0);
  const interaction = useRef(0);
  useLayoutEffect(() => {
    const observe = () => { interaction.current += 1; };
    window.addEventListener('pointerdown', observe, true);
    window.addEventListener('keydown', observe, true);
    return () => { window.removeEventListener('pointerdown', observe, true); window.removeEventListener('keydown', observe, true); };
  }, []);
  const [version, render] = useState(0);
  const [requestBusy, setRequestBusy] = useState(false);
  const [error, setError] = useState(false);
  useLayoutEffect(() => { current.current = options; });
  const lastRequest = useRef(options.requestId);
  const key = options.roomId && options.thread ? `${options.roomId}\n${options.thread.rootId}` : undefined;

  const capture = useCallback(() => {
    const { thread, roomId, active, entryId, remember, detached } = current.current;
    const element = viewport.current;
    if (!element || !active || !thread || !roomId || pending.current || thread.history?.loading) return;
    anchor.current = captureTimelineAnchor(element);
    const atLatest = element.scrollHeight - element.clientHeight - element.scrollTop <= 48;
    attached.current = atLatest && (!thread.history || thread.history.mode === 'live');
    const first = anchor.current?.candidates[0];
    const reading: ShellReadingPosition = {
      mode: thread.history?.mode ?? 'live', atLatest: attached.current,
      anchor: first && { eventId: first.eventId, offset: first.offset },
    };
    positions.current.set(`${roomId}\n${thread.rootId}`, reading);
    while (positions.current.size > 32) positions.current.delete(positions.current.keys().next().value!);
    remember(reading, entryId);
    detached?.(!attached.current);
  }, []);

  const request = useCallback((operation: () => Promise<void> | undefined, restore: Omit<Pending, 'generation' | 'done' | 'revision'> = {}) => {
    const sequence = ++generation.current;
    pending.current = { generation: sequence, done: false, revision: current.current.thread?.history?.revision, interaction: interaction.current, ...restore };
    setError(false);
    setRequestBusy(true);
    render((value) => value + 1);
    void Promise.resolve().then(() => {
      if (generation.current !== sequence) return;
      return operation();
    }).then(() => {
      if (generation.current !== sequence || !pending.current) return;
      pending.current.done = true;
      render((value) => value + 1);
    }).catch(() => {
      if (generation.current !== sequence) return;
      pending.current = undefined;
      setError(true);
      setRequestBusy(false);
    });
  }, []);

  useLayoutEffect(() => {
    if (!options.active || !key) return;
    const refreshed = options.requestId !== lastRequest.current;
    lastRequest.current = options.requestId;
    const saved = refreshed ? undefined : options.reading ?? (options.eventId ? undefined : positions.current.get(key));
    const target = saved?.atLatest ? undefined : saved?.anchor?.eventId ?? options.eventId;
    anchor.current = undefined;
    attached.current = saved?.atLatest ?? !target;
    if (!options.open && !options.latest) {
      pending.current = { generation: ++generation.current, done: true, target, reading: saved, latest: saved?.atLatest };
      return;
    }
    pending.current = { generation: ++generation.current, done: false, revision: options.thread?.history?.revision };
    const open = options.open;
    const latest = options.latest;
    // A request can resolve before React receives the controller's snapshot.
    // Keep old rows from becoming this entry's position until it is committed.
    queueMicrotask(() => {
      if (!current.current.active || `${current.current.roomId}\n${current.current.thread?.rootId}` !== key || current.current.entryId !== options.entryId) return;
      request(() => saved?.atLatest && latest
        ? latest() : open?.(target), { target, reading: saved, latest: saved?.atLatest });
    });
    return () => {
      generation.current += 1;
      pending.current = undefined;
      current.current.close?.();
    };
  // Snapshot changes must not restart navigation or overwrite its saved position.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, options.active, options.entryId, options.eventId, options.requestId, request]);

  const restore = useCallback(() => {
    const { thread, active } = current.current;
    const element = viewport.current;
    if (!element || !thread || !active) return;
    const state = pending.current;
    if (state) {
      if (!state.done || thread.history?.loading) return;
      if (thread.history && state.revision === thread.history.revision) return;
      if (current.current.open && !thread.history && thread.rootStatus === 'loading') return;
      if (state.target && state.target !== thread.rootId && thread.history && thread.history.targetEventId !== state.target && !thread.history.error) return;
      if (state.latest && thread.history && thread.history.mode !== 'live' && !thread.history.error) return;
      if (thread.history?.error) restoreTimelineAnchor(element, anchor.current);
      else if (state.reading?.anchor && !state.reading.atLatest) {
        const { eventId, offset } = state.reading.anchor;
        restoreTimelineAnchor(element, { candidates: [{ key: eventId, eventId, offset }] });
      } else if (state.target) {
        const row = historyRows(element).find((item) => item.dataset.eventId === state.target);
        if (row) {
          element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - 12;
          const focus = document.activeElement;
          if ((state.interaction === undefined || state.interaction === interaction.current) && !focus?.closest('input,textarea,[contenteditable="true"],dialog,[role="dialog"],[role="menu"]')) row.focus({ preventScroll: true });
        } else if (state.target === thread.rootId) element.scrollTop = 0;
      } else if (state.latest || attached.current) { attached.current = true; element.scrollTop = element.scrollHeight; }
      else restoreTimelineAnchor(element, anchor.current);
      pending.current = undefined;
      queueMicrotask(() => setRequestBusy(false));
    } else if (attached.current && (!thread.history || thread.history.mode === 'live')) element.scrollTop = element.scrollHeight;
    else restoreTimelineAnchor(element, anchor.current);
    capture();
  }, [capture]);
  useLayoutEffect(() => {
    restore();
    const frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [options.thread, options.active, version, restore]);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !options.active || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(restore);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    return () => observer.disconnect();
  }, [options.active, options.thread, restore]);

  const load = (direction: Direction) => {
    if (pending.current || current.current.thread?.history?.loading) return;
    capture(); attached.current = false;
    const operation = current.current.load;
    request(() => operation?.(direction));
  };
  const latest = () => { capture(); const operation = current.current.latest; request(() => operation?.(), { latest: true }); };
  const retry = () => {
    const thread = current.current.thread;
    if (thread?.history?.errorDirection === 'latest') { latest(); return; }
    if (thread?.history?.errorDirection === 'backward' || thread?.history?.errorDirection === 'forward') load(thread.history.errorDirection);
    else {
      const operation = current.current.open;
      const target = thread?.history?.targetEventId ?? current.current.eventId;
      request(() => operation?.(target), { target });
    }
  };
  return { viewport, capture, restore, load, latest, retry, error, busy: requestBusy || Boolean(options.thread?.history?.loading),
    canRead: () => current.current.active && Boolean(current.current.thread) && !pending.current && !current.current.thread?.history?.loading && (!current.current.thread?.history || current.current.thread.history.mode === 'live') };
}
