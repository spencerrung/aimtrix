import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { EventTimeline } from 'matrix-js-sdk/lib/models/event-timeline.js';
import type { HistorySummary } from './viewModels';
import { boundedTimelineEvents, HISTORY_MESSAGE_LIMIT, HISTORY_RAW_LIMIT, isVisibleTimelineEvent } from './historyEvents';

export interface HistoryView {
  events: MatrixEvent[];
  state: HistorySummary;
}

type Direction = 'backward' | 'forward';
type Loading = NonNullable<HistorySummary['loading']>;
interface Cursor { timeline: EventTimeline; index: number; beforeId?: string; afterId?: string }
interface Navigation {
  client: MatrixClient;
  room: Room;
  older: Cursor;
  newer: Cursor;
  generation: number;
  exhausted: WeakMap<EventTimeline, Set<Direction>>;
}
interface Budget { requests: number; raw: number; tokens: Map<EventTimeline, Set<string>> }
const PAGE_MESSAGES = 50;
const REQUEST_LIMIT = 10;
const sdkDirection = (direction: Direction) => direction === 'backward' ? EventTimeline.BACKWARDS : EventTimeline.FORWARDS;
const visibleCount = (events: MatrixEvent[]) => events.filter(isVisibleTimelineEvent).length;
const cursorAt = (timeline: EventTimeline, absolute: number): Cursor => ({
  timeline, index: absolute - timeline.getBaseIndex(),
  beforeId: timeline.getEvents()[absolute - 1]?.getId(), afterId: timeline.getEvents()[absolute]?.getId(),
});
const cloneCursor = (cursor: Cursor): Cursor => ({ ...cursor });

/** Controller-owned selections over SDK timelines. No independent clients or SDK listeners. */
export class RoomHistory {
  private readonly navigation = new Map<string, Navigation>();
  private preparedClients = new WeakSet<MatrixClient>();
  private activeRoomId?: string;

  public constructor(
    private readonly getClient: () => MatrixClient | undefined,
    private readonly views: Map<string, HistoryView>,
    private readonly publish: (roomId: string) => void,
  ) {}

  public clear(): void {
    for (const entry of this.navigation.values()) entry.generation += 1;
    this.navigation.clear();
    this.views.clear();
    this.preparedClients = new WeakSet();
    this.activeRoomId = undefined;
  }

  private current(entry: Navigation, generation = entry.generation): boolean {
    return this.getClient() === entry.client
      && entry.client.getRoom(entry.room.roomId) === entry.room
      && entry.room.getMyMembership() === 'join'
      && this.navigation.get(entry.room.roomId) === entry
      && entry.generation === generation
      && this.activeRoomId === entry.room.roomId;
  }

  private select(roomId: string): Navigation {
    const client = this.getClient();
    const room = client?.getRoom(roomId);
    if (!client || !room || room.getMyMembership() !== 'join') throw new Error('This conversation is not available.');
    if (this.activeRoomId !== roomId) {
      const previous = this.activeRoomId ? this.navigation.get(this.activeRoomId) : undefined;
      if (previous) {
        previous.generation += 1;
        if (this.views.get(previous.room.roomId)?.state.loading) this.update(previous, { loading: undefined });
      }
      this.activeRoomId = roomId;
    }
    let entry = this.navigation.get(roomId);
    if (!entry || entry.client !== client || entry.room !== room) {
      const timeline = room.getLiveTimeline();
      entry = { client, room, older: cursorAt(timeline, timeline.getEvents().length), newer: cursorAt(timeline, timeline.getEvents().length), generation: 0, exhausted: new WeakMap() };
      this.navigation.set(roomId, entry);
      this.views.delete(roomId);
      this.liveSelection(entry);
    }
    return entry;
  }

  private update(entry: Navigation, state: Partial<HistorySummary>, events = this.views.get(entry.room.roomId)?.events ?? []): void {
    const old = this.views.get(entry.room.roomId)?.state;
    this.views.set(entry.room.roomId, {
      events,
      state: { mode: 'live', canLoadOlder: false, canLoadNewer: false, ...old, ...state, revision: (old?.revision ?? 0) + 1 },
    });
    this.publish(entry.room.roomId);
  }

  private begin(entry: Navigation, loading: Loading): number {
    entry.generation += 1;
    this.update(entry, { loading, error: undefined, errorDirection: undefined });
    return entry.generation;
  }

  private canRead(entry: Navigation, cursor: Cursor, direction: Direction): boolean {
    const absolute = this.cursorPosition(cursor);
    if (direction === 'backward' ? absolute > 0 : absolute < cursor.timeline.getEvents().length) return true;
    if (cursor.timeline.getNeighbouringTimeline(sdkDirection(direction))) return true;
    if (direction === 'forward' && cursor.timeline === entry.room.getLiveTimeline()) return false;
    return !entry.exhausted.get(cursor.timeline)?.has(direction) && Boolean(cursor.timeline.getPaginationToken(sdkDirection(direction)));
  }

  private cursorPosition(cursor: Cursor): number {
    const events = cursor.timeline.getEvents();
    const before = cursor.beforeId ? events.findIndex((event) => event.getId() === cursor.beforeId) : -1;
    const after = cursor.afterId ? events.findIndex((event) => event.getId() === cursor.afterId) : -1;
    return before >= 0 ? before + 1 : after >= 0 ? after : Math.max(0, Math.min(events.length, cursor.index + cursor.timeline.getBaseIndex()));
  }

  /** Base-index-relative positions survive SDK prepends without shifting the view. */
  private read(cursor: Cursor, direction: Direction, maxVisible: number, maxRaw: number): MatrixEvent[] {
    const result: MatrixEvent[] = [];
    let visible = 0;
    const crossed = new Set<EventTimeline>();
    cursor.index = this.cursorPosition(cursor) - cursor.timeline.getBaseIndex();
    while (result.length < maxRaw) {
      if (direction === 'backward' && visible >= maxVisible) break;
      const timeline = cursor.timeline;
      const events = timeline.getEvents();
      const absolute = Math.max(0, Math.min(events.length, cursor.index + timeline.getBaseIndex()));
      cursor.index = absolute - timeline.getBaseIndex();
      const index = direction === 'backward' ? absolute - 1 : absolute;
      if (index >= 0 && index < events.length) {
        const event = events[index];
        if (visible >= maxVisible && isVisibleTimelineEvent(event)) break;
        cursor.index += direction === 'backward' ? -1 : 1;
        result.push(event);
        if (isVisibleTimelineEvent(event)) visible += 1;
        continue;
      }
      const next = timeline.getNeighbouringTimeline(sdkDirection(direction));
      if (!next || crossed.has(next)) break;
      crossed.add(timeline);
      Object.assign(cursor, cursorAt(next, direction === 'backward' ? next.getEvents().length : 0));
    }
    Object.assign(cursor, cursorAt(cursor.timeline, cursor.index + cursor.timeline.getBaseIndex()));
    return direction === 'backward' ? result.reverse() : result;
  }

  private liveSelection(entry: Navigation): void {
    const timeline = entry.room.getLiveTimeline();
    entry.newer = cursorAt(timeline, timeline.getEvents().length);
    entry.older = cloneCursor(entry.newer);
    const events = boundedTimelineEvents(this.read(entry.older, 'backward', HISTORY_MESSAGE_LIMIT, HISTORY_RAW_LIMIT));
    this.update(entry, {
      mode: 'live', loading: undefined, error: undefined, errorDirection: undefined,
      targetEventId: undefined, targetStatus: undefined,
      canLoadOlder: this.canRead(entry, entry.older, 'backward'), canLoadNewer: false,
    }, events);
  }

  public async open(roomId: string): Promise<void> {
    const entry = this.select(roomId);
    const state = this.views.get(roomId)?.state;
    if (state?.mode === 'live' && !state.loading) this.liveSelection(entry);
  }

  private async collect(entry: Navigation, generation: number, cursor: Cursor, direction: Direction, count: number, budget: Budget): Promise<MatrixEvent[]> {
    const result: MatrixEvent[] = [];
    while (this.current(entry, generation) && visibleCount(result) < count && budget.raw < HISTORY_RAW_LIMIT) {
      const chunk = this.read(cursor, direction, count - visibleCount(result), HISTORY_RAW_LIMIT - budget.raw);
      if (chunk.length) {
        budget.raw += chunk.length;
        await Promise.allSettled(chunk.map((event) => entry.client.decryptEventIfNeeded(event)));
        if (!this.current(entry, generation)) return [];
        if (direction === 'backward') result.unshift(...chunk);
        else result.push(...chunk);
        continue;
      }
      if (!this.canRead(entry, cursor, direction) || budget.requests >= REQUEST_LIMIT) break;
      const token = cursor.timeline.getPaginationToken(sdkDirection(direction));
      if (!token) break;
      const tokens = budget.tokens.get(cursor.timeline) ?? new Set<string>();
      const key = `${direction}:${token}`;
      if (tokens.has(key)) break;
      tokens.add(key); budget.tokens.set(cursor.timeline, tokens);
      budget.requests += 1;
      const more = await entry.client.paginateEventTimeline(cursor.timeline, { backwards: direction === 'backward', limit: PAGE_MESSAGES });
      if (!this.current(entry, generation)) return [];
      if (!more) {
        const exhausted = entry.exhausted.get(cursor.timeline) ?? new Set<Direction>();
        exhausted.add(direction); entry.exhausted.set(cursor.timeline, exhausted);
      }
    }
    return result;
  }

  private eventCursor(entry: Navigation, event: MatrixEvent, after: boolean, fallback: Cursor): Cursor {
    const id = event.getId();
    const timeline = entry.room.getUnfilteredTimelineSet().getTimelineForEvent(id) ?? fallback.timeline;
    const index = timeline.getEvents().findIndex((candidate) => candidate === event || candidate.getId() === id);
    return index < 0 ? fallback : cursorAt(timeline, index + Number(after));
  }

  public async load(roomId: string, direction: Direction = 'backward'): Promise<void> {
    const entry = this.select(roomId);
    if (this.views.get(roomId)?.state.loading) return;
    const generation = this.begin(entry, direction);
    this.update(entry, { mode: 'history', targetEventId: undefined, targetStatus: undefined });
    const cursor = cloneCursor(direction === 'backward' ? entry.older : entry.newer);
    const previous = this.views.get(roomId)!.events;
    try {
      const added = await this.collect(entry, generation, cursor, direction, PAGE_MESSAGES, { requests: 0, raw: 0, tokens: new Map() });
      if (!this.current(entry, generation)) return;
      const combined = direction === 'backward' ? [...added, ...previous] : [...previous, ...added];
      const unique = [...new Map(combined.map((event) => [event.getId() ?? event, event])).values()];
      const events = boundedTimelineEvents(unique, HISTORY_MESSAGE_LIMIT, direction === 'backward' ? 'forward' : 'backward');
      const visible = events.filter(isVisibleTimelineEvent);
      if (direction === 'backward') {
        entry.older = cursor;
        if (visible.length) entry.newer = this.eventCursor(entry, visible.at(-1)!, true, entry.newer);
      } else {
        entry.newer = cursor;
        if (visible.length) entry.older = this.eventCursor(entry, visible[0], false, entry.older);
      }
      this.update(entry, { loading: undefined, canLoadOlder: this.canRead(entry, entry.older, 'backward'), canLoadNewer: this.canRead(entry, entry.newer, 'forward') }, events);
    } catch {
      if (this.current(entry, generation)) this.update(entry, { loading: undefined, error: 'History could not be loaded. Check your connection and try again.', errorDirection: direction });
    }
  }

  public async context(roomId: string, eventId: string): Promise<void> {
    const entry = this.select(roomId);
    const generation = this.begin(entry, 'context');
    this.update(entry, { mode: 'context', targetEventId: eventId, targetStatus: undefined });
    try {
      const timeline = await entry.client.getEventTimeline(entry.room.getUnfilteredTimelineSet(), eventId);
      if (!this.current(entry, generation)) return;
      const target = timeline?.getEvents().find((event) => event.getId() === eventId);
      if (!target) {
        this.update(entry, { loading: undefined, targetStatus: 'unavailable', errorDirection: 'context', error: 'That message is not available in this conversation.' });
        return;
      }
      await entry.client.decryptEventIfNeeded(target).catch(() => undefined);
      if (!this.current(entry, generation)) return;
      if (target.isRedacted() || !isVisibleTimelineEvent(target)) {
        this.update(entry, { loading: undefined, targetStatus: target.isRedacted() ? 'removed' : 'unavailable', errorDirection: 'context', error: target.isRedacted() ? 'That message was removed.' : 'That message is not available in this conversation.' });
        return;
      }
      const index = timeline!.getEvents().indexOf(target);
      const older = cursorAt(timeline!, index);
      const newer = cursorAt(timeline!, index + 1);
      const budget: Budget = { requests: 0, raw: 0, tokens: new Map() };
      const before = await this.collect(entry, generation, older, 'backward', 25, budget);
      if (!this.current(entry, generation)) return;
      const after = await this.collect(entry, generation, newer, 'forward', 25, budget);
      if (!this.current(entry, generation)) return;
      if (target.isRedacted()) {
        this.update(entry, { loading: undefined, targetStatus: 'removed', errorDirection: 'context', error: 'That message was removed.' });
        return;
      }
      entry.older = older; entry.newer = newer;
      this.update(entry, {
        mode: 'context', loading: undefined, targetStatus: 'found',
        canLoadOlder: this.canRead(entry, older, 'backward'), canLoadNewer: this.canRead(entry, newer, 'forward'),
      }, boundedTimelineEvents([...before, target, ...after]));
    } catch {
      if (this.current(entry, generation)) this.update(entry, { loading: undefined, targetStatus: 'unavailable', errorDirection: 'context', error: 'That message could not be opened. It may be unavailable, or your connection may need attention.' });
    }
  }

  public async latest(roomId: string): Promise<void> {
    const entry = this.select(roomId);
    entry.generation += 1;
    this.liveSelection(entry);
  }

  public detach(roomId: string, detached: boolean): void {
    const entry = this.navigation.get(roomId);
    const view = this.views.get(roomId);
    if (!entry || !view || !this.current(entry) || view.state.loading) return;
    // Unread positioning can run while the SDK is still assembling its first
    // room timeline. Freeze only after that initial batch is complete.
    if (!this.preparedClients.has(entry.client)) {
      if (!entry.client.isInitialSyncComplete()) return;
      this.preparedClients.add(entry.client);
    }
    if (detached && view.state.mode === 'live') this.update(entry, { mode: 'history' });
    else if (!detached && view.state.mode === 'history' && !this.canRead(entry, entry.newer, 'forward')) this.liveSelection(entry);
  }

  /** PREPARED/SYNCING follows processing of a complete SDK sync response. */
  public syncCompleted(): void {
    const client = this.getClient();
    if (!client || this.preparedClients.has(client)) return;
    this.preparedClients.add(client);
    for (const entry of this.navigation.values()) if (entry.client === client) this.refresh(entry.room);
  }

  /** Only the live selection follows sync. History keeps references to its own SDK events. */
  public refresh(room: Room): void {
    const entry = this.navigation.get(room.roomId);
    if (!entry || entry.room !== room || this.getClient() !== entry.client || entry.client.getRoom(room.roomId) !== room) return;
    if (room.getMyMembership() !== 'join') {
      entry.generation += 1;
      this.navigation.delete(room.roomId); this.views.delete(room.roomId);
      this.publish(room.roomId);
      return;
    }
    const view = this.views.get(room.roomId);
    if (view?.state.mode === 'live' && !view.state.loading) this.liveSelection(entry);
    else if (view && !view.state.loading) {
      const canLoadOlder = this.canRead(entry, entry.older, 'backward');
      const canLoadNewer = this.canRead(entry, entry.newer, 'forward');
      const target = view.state.targetStatus === 'found' ? view.events.find((event) => event.getId() === view.state.targetEventId) : undefined;
      if (target?.isRedacted()) this.update(entry, { canLoadOlder, canLoadNewer, targetStatus: 'removed', error: 'That message was removed.', errorDirection: 'context' });
      else if (canLoadOlder !== view.state.canLoadOlder || canLoadNewer !== view.state.canLoadNewer) this.update(entry, { canLoadOlder, canLoadNewer });
    }
  }
}
