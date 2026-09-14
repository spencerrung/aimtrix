import type { MatrixClient, MatrixEvent, Room, Thread as SDKThread } from 'matrix-js-sdk';
import { Direction as SDKDirection, EventTimeline } from 'matrix-js-sdk/lib/models/event-timeline.js';
import type { IContextResponse } from 'matrix-js-sdk/lib/@types/requests.js';
import type { IEvent } from 'matrix-js-sdk/lib/models/event.js';
import { Method } from 'matrix-js-sdk/lib/http-api/method.js';
import { Feature, ServerSupport } from 'matrix-js-sdk/lib/feature.js';
import { Thread } from 'matrix-js-sdk/lib/models/thread.js';
import type { HistorySummary } from './viewModels';
import { boundedTimelineEvents, HISTORY_MESSAGE_LIMIT, HISTORY_RAW_LIMIT, historyRelation, isVisibleTimelineEvent } from './historyEvents';

export interface ThreadHistoryView {
  roomId: string;
  rootId: string;
  root?: MatrixEvent;
  latestEvent?: MatrixEvent;
  replyCount?: number;
  replyCountIsLowerBound?: boolean;
  participated?: boolean;
  rootStatus: 'loading' | 'found' | 'removed' | 'unavailable';
  events: MatrixEvent[];
  state: HistorySummary;
}

type Direction = 'backward' | 'forward';
type Loading = NonNullable<HistorySummary['loading']>;
interface Cursor { timeline: ThreadPage; index: number; beforeId?: string; afterId?: string }
interface Navigation {
  client: MatrixClient;
  room: Room;
  rootId: string;
  thread?: SDKThread;
  prepared: boolean;
  hasLivePage: boolean;
  seenReplyIds: Set<string>;
  liveRevision: number;
  operationLiveRevision: number;
  arrivals: Array<{ revision: number; event: MatrixEvent }>;
  live: ThreadPage;
  pages: Set<ThreadPage>;
  older: Cursor;
  newer: Cursor;
  generation: number;
  exhausted: WeakMap<ThreadPage, Set<Direction>>;
}
interface Budget { requests: number; raw: number; tokens: Set<string> }
const PAGE_MESSAGES = 50;
const REQUEST_LIMIT = 10;
const sdkDirection = (direction: Direction) => direction === 'backward' ? EventTimeline.BACKWARDS : EventTimeline.FORWARDS;
const visibleCount = (events: MatrixEvent[]) => events.filter(isVisibleTimelineEvent).length;
const cursorAt = (timeline: ThreadPage, absolute: number): Cursor => ({
  timeline, index: absolute - timeline.getBaseIndex(),
  beforeId: timeline.getEvents()[absolute - 1]?.getId(), afterId: timeline.getEvents()[absolute]?.getId(),
});
const cloneCursor = (cursor: Cursor): Cursor => ({ ...cursor });

/** Relation pages are private selections, not SDK room/thread timelines. */
class ThreadPage {
  public previous?: ThreadPage;
  public next?: ThreadPage;
  public constructor(public events: MatrixEvent[], public rootId: string, public backward: string | null = null, public forward: string | null = null) {}
  public getEvents() { return this.events; }
  public getBaseIndex() { return 0; }
  public getPaginationToken(direction: string) { return direction === 'b' ? this.backward : this.forward; }
  public getNeighbouringTimeline(direction: string) { return (direction === 'b' ? this.previous : this.next) ?? null; }
  public getTimelineSet() { return { thread: { id: this.rootId } }; }
}

/** Independent bounded thread windows using standard relations APIs. Never constructs a thread or synthesizes receipts. */
export class ThreadHistory {
  private readonly navigation = new Map<string, Navigation>();
  private activeRootId?: string;

  public constructor(
    private readonly getClient: () => MatrixClient | undefined,
    private readonly views: Map<string, ThreadHistoryView>,
    private readonly publish: (roomId: string) => void,
  ) {}

  public clear(): void {
    for (const entry of this.navigation.values()) entry.generation += 1;
    this.navigation.clear(); this.views.clear(); this.activeRootId = undefined;
  }

  public close(): void {
    const entry = this.activeRootId ? this.navigation.get(this.activeRootId) : undefined;
    if (entry) {
      entry.generation += 1;
      if (this.views.get(entry.rootId)?.state.loading) this.update(entry, { loading: undefined });
    }
    this.activeRootId = undefined;
  }

  public roomSelected(roomId: string): void {
    if (this.activeRootId && this.navigation.get(this.activeRootId)?.room.roomId !== roomId) this.close();
  }

  private current(entry: Navigation, generation = entry.generation): boolean {
    return this.getClient() === entry.client && entry.client.getRoom(entry.room.roomId) === entry.room
      && entry.room.getMyMembership() === 'join' && this.navigation.get(entry.rootId) === entry
      && entry.generation === generation && this.activeRootId === entry.rootId;
  }

  private select(roomId: string, rootId: string): Navigation {
    const client = this.getClient();
    const room = client?.getRoom(roomId);
    if (!client || !room || room.getMyMembership() !== 'join' || !rootId || room.hasPendingEvent(rootId)) throw new Error('This thread is not available.');
    if (this.activeRootId !== rootId) { this.close(); this.activeRootId = rootId; }
    let entry = this.navigation.get(rootId);
    if (!entry || entry.client !== client || entry.room !== room) {
      const timeline = new ThreadPage([], rootId);
      entry = { client, room, rootId, prepared: false, hasLivePage: false, seenReplyIds: new Set(), liveRevision: 0, operationLiveRevision: 0, arrivals: [], live: timeline, pages: new Set([timeline]), older: cursorAt(timeline, 0), newer: cursorAt(timeline, 0), generation: 0, exhausted: new WeakMap() };
      this.navigation.set(rootId, entry);
      this.views.delete(rootId);
      this.update(entry, {});
      while (this.navigation.size > 32) {
        const oldest = this.navigation.keys().next().value!;
        this.navigation.delete(oldest); this.views.delete(oldest);
      }
    }
    return entry;
  }

  private update(entry: Navigation, state: Partial<HistorySummary>, events = this.views.get(entry.rootId)?.events ?? [], rootFields: Partial<Pick<ThreadHistoryView, 'root' | 'rootStatus' | 'latestEvent' | 'replyCount' | 'replyCountIsLowerBound' | 'participated'>> = {}): void {
    const old = this.views.get(entry.rootId);
    this.views.set(entry.rootId, {
      roomId: entry.room.roomId, rootId: entry.rootId, rootStatus: 'loading', ...old, ...rootFields, events,
      state: { mode: 'live', canLoadOlder: false, canLoadNewer: false, ...old?.state, ...state, revision: (old?.state.revision ?? 0) + 1 },
    });
    this.publish(entry.room.roomId);
  }

  private begin(entry: Navigation, loading: Loading): number {
    entry.generation += 1;
    // Until the first server page exists, retries still own every accepted
    // arrival collected during initial root preparation.
    entry.operationLiveRevision = entry.hasLivePage ? entry.liveRevision : 0;
    this.update(entry, { loading, error: undefined, errorDirection: undefined });
    return entry.generation;
  }

  private async prepare(entry: Navigation, generation: number): Promise<boolean> {
    if (entry.prepared) return true;
    let root = entry.room.getThread(entry.rootId)?.rootEvent ?? entry.room.findEventById(entry.rootId);
    if (!root) {
      const raw = await entry.client.fetchRoomEvent(entry.room.roomId, entry.rootId);
      if (!this.current(entry, generation)) return false;
      if (raw.event_id !== entry.rootId || raw.room_id && raw.room_id !== entry.room.roomId) throw new Error('Unavailable root.');
      root = entry.client.getEventMapper()({ ...raw, room_id: entry.room.roomId });
    }
    await entry.client.decryptEventIfNeeded(root).catch(() => undefined);
    if (!this.current(entry, generation)) return false;
    if (root.getId() !== entry.rootId || root.getRoomId() !== entry.room.roomId || root.status
      || (root.threadRootId && root.threadRootId !== entry.rootId) || (!root.isRedacted() && !isVisibleTimelineEvent(root))) throw new Error('Unavailable root.');
    entry.thread = entry.room.getThread(entry.rootId) ?? undefined;
    const bundled = root.getServerAggregatedRelation<{ latest_event?: Partial<IEvent>; count?: number; current_user_participated?: boolean }>('m.thread');
    const latestEvent = bundled?.latest_event ? (await this.mapEvents(entry, generation, [bundled.latest_event])).find(isVisibleTimelineEvent) : undefined;
    const count = typeof bundled?.count === 'number' && Number.isSafeInteger(bundled.count) && bundled.count >= 0 ? bundled.count : undefined;
    if (!this.current(entry, generation)) return false;
    entry.prepared = true;
    this.update(entry, {}, undefined, { root, rootStatus: root.isRedacted() ? 'removed' : 'found', latestEvent: entry.arrivals.length ? this.views.get(entry.rootId)?.latestEvent ?? latestEvent : latestEvent,
      ...(count !== undefined ? { replyCount: Math.max(count, entry.seenReplyIds.size), replyCountIsLowerBound: entry.seenReplyIds.size > count || entry.liveRevision > entry.operationLiveRevision } : {}),
      ...(bundled?.current_user_participated === true ? { participated: true } : bundled?.current_user_participated === false && this.views.get(entry.rootId)?.participated !== true ? { participated: false } : {}),
    });
    return true;
  }

  public async open(roomId: string, rootId: string, eventId?: string): Promise<void> {
    const entry = this.select(roomId, rootId);
    const view = this.views.get(rootId)!;
    if (view.state.loading && (!eventId || eventId === view.state.targetEventId || (eventId === rootId && view.state.loading === 'latest'))) return;
    if (entry.prepared && (entry.hasLivePage || view.state.mode !== 'live') && !eventId && !view.state.error) { this.refresh(entry.room); return; }
    const generation = this.begin(entry, eventId && eventId !== rootId ? 'context' : 'latest');
    if (eventId && eventId !== rootId) this.update(entry, { mode: 'context', targetEventId: eventId, targetStatus: undefined });
    try {
      if (!await this.prepare(entry, generation)) return;
      if (eventId && eventId !== rootId) { await this.context(entry, generation, eventId); return; }
      await this.fetchLatest(entry, generation);
    } catch {
      if (this.current(entry, generation)) this.update(entry, { loading: undefined, error: 'This thread could not be opened. Check your access and connection, then try again.', errorDirection: eventId && eventId !== rootId ? 'context' : 'latest' }, undefined, entry.prepared ? {} : { rootStatus: 'unavailable' });
    }
  }

  private async mapEvents(entry: Navigation, generation: number, raw: Partial<IEvent>[]): Promise<MatrixEvent[]> {
    const events = raw.slice(0, PAGE_MESSAGES).flatMap((item) => {
      if (!item.event_id || item.room_id && item.room_id !== entry.room.roomId) return [];
      return [entry.client.getEventMapper({ decrypt: false })({ ...item, room_id: entry.room.roomId })];
    });
    await Promise.allSettled(events.map((event) => entry.client.decryptEventIfNeeded(event)));
    if (!this.current(entry, generation)) return [];
    const selected = events.filter((event) => {
      const relation = historyRelation(event);
      return event.getId() !== entry.rootId && !event.status && (relation?.rel_type === 'm.thread' && relation.event_id === entry.rootId
        || event.threadRootId === entry.rootId
        || !isVisibleTimelineEvent(event) && relation?.event_id && relation.event_id !== entry.rootId);
    });
    this.recordReplies(entry, selected);
    return selected;
  }

  private recordReplies(entry: Navigation, events: MatrixEvent[], live = false): void {
    const view = this.views.get(entry.rootId);
    if (!view) return;
    let novel = false;
    let participated = view.participated;
    for (const event of events) {
      const id = event.getId();
      if (!id || event.status || !isVisibleTimelineEvent(event) || historyRelation(event)?.rel_type !== 'm.thread' || historyRelation(event)?.event_id !== entry.rootId) continue;
      if (!entry.seenReplyIds.has(id)) { novel = true; if (entry.seenReplyIds.size < HISTORY_RAW_LIMIT) entry.seenReplyIds.add(id); }
      if (event.getSender() === entry.client.getUserId?.()) participated = true;
    }
    const replyCount = Math.max(view.replyCount ?? 0, entry.seenReplyIds.size);
    const replyCountIsLowerBound = view.replyCountIsLowerBound ?? view.replyCount === undefined;
    if (novel || participated !== view.participated) this.update(entry, {}, undefined, { replyCount, replyCountIsLowerBound: replyCountIsLowerBound || live || replyCount > (view.replyCount ?? 0), participated });
  }

  private async relationPage(entry: Navigation, generation: number, direction: Direction, from?: string): Promise<ThreadPage | undefined> {
    const response = await entry.client.fetchRelations(entry.room.roomId, entry.rootId, null, null, {
      dir: sdkDirection(direction) as SDKDirection, limit: PAGE_MESSAGES, from,
      recurse: entry.client.canSupport?.get(Feature.RelationsRecursion) !== ServerSupport.Unsupported || undefined,
    });
    if (!this.current(entry, generation)) return;
    const events = await this.mapEvents(entry, generation, response.chunk);
    if (!this.current(entry, generation)) return;
    const page = new ThreadPage(direction === 'backward' ? events.reverse() : events, entry.rootId,
      direction === 'backward' ? response.next_batch ?? null : from ?? null,
      direction === 'forward' ? response.next_batch ?? null : from ?? null);
    return page;
  }

  private async fetchLatest(entry: Navigation, generation: number): Promise<void> {
    const revision = entry.operationLiveRevision;
    const page = await this.relationPage(entry, generation, 'backward');
    if (!page || !this.current(entry, generation)) return;
    const arrivals = entry.arrivals.filter((arrival) => arrival.revision > revision).map((arrival) => arrival.event);
    page.events = [...new Map([...page.events, ...arrivals].map((event) => [event.getId(), event])).values()];
    entry.pages.clear(); entry.pages.add(page); entry.live = page; entry.hasLivePage = true;
    const loaded = await this.collect(entry, generation, cursorAt(page, page.events.length), 'backward', PAGE_MESSAGES, { requests: 1, raw: 0, tokens: new Set() });
    if (!this.current(entry, generation)) return;
    const previousLatest = this.views.get(entry.rootId)?.latestEvent;
    const latestEvent = [...page.events].reverse().find(isVisibleTimelineEvent) ?? [...loaded].reverse().find(isVisibleTimelineEvent) ?? previousLatest;
    if (!loaded.some(isVisibleTimelineEvent) && latestEvent && isVisibleTimelineEvent(latestEvent) && !page.events.includes(latestEvent)) page.events.push(latestEvent);
    this.update(entry, {}, undefined, { latestEvent });
    this.liveSelection(entry);
  }

  private retainPage(entry: Navigation, page: ThreadPage): void {
    entry.pages.add(page);
    while (entry.pages.size > 40) {
      const removable = [...entry.pages].find((candidate) => candidate !== page && candidate !== entry.live
        && candidate !== entry.older.timeline && candidate !== entry.newer.timeline);
      if (!removable) break;
      // Neighbor pages keep their protocol boundary tokens, so discarded data
      // can be fetched again without retaining an unbounded linked chain.
      if (removable.previous) removable.previous.next = undefined;
      if (removable.next) removable.next.previous = undefined;
      removable.previous = undefined; removable.next = undefined;
      entry.pages.delete(removable);
    }
  }

  private async paginate(entry: Navigation, generation: number, page: ThreadPage, direction: Direction): Promise<boolean> {
    const from = page.getPaginationToken(sdkDirection(direction));
    if (!from) return false;
    const added = await this.relationPage(entry, generation, direction, from);
    if (!added || !this.current(entry, generation)) return false;
    if (direction === 'backward') { page.previous = added; added.next = page; }
    else { page.next = added; added.previous = page; }
    this.retainPage(entry, added);
    return Boolean(added.getPaginationToken(sdkDirection(direction)));
  }

  private canRead(entry: Navigation, cursor: Cursor, direction: Direction): boolean {
    const absolute = this.cursorPosition(cursor);
    if (direction === 'backward' ? absolute > 0 : absolute < cursor.timeline.getEvents().length) return true;
    if (cursor.timeline.getNeighbouringTimeline(sdkDirection(direction))) return true;
    if (direction === 'forward' && (cursor.timeline === entry.live || !Thread.hasServerSideFwdPaginationSupport)) return false;
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
    const crossed = new Set<ThreadPage>();
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
        if (event.getId() === cursor.timeline.getTimelineSet().thread?.id) { cursor.index += direction === 'backward' ? -1 : 1; continue; }
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
    const timeline = entry.live;
    entry.newer = cursorAt(timeline, timeline.getEvents().length);
    entry.older = cloneCursor(entry.newer);
    const events = boundedTimelineEvents(this.read(entry.older, 'backward', HISTORY_MESSAGE_LIMIT, HISTORY_RAW_LIMIT));
    this.update(entry, {
      mode: 'live', loading: undefined, error: undefined, errorDirection: undefined,
      targetEventId: undefined, targetStatus: undefined,
      canLoadOlder: this.canRead(entry, entry.older, 'backward'), canLoadNewer: false,
    }, events);
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
      const key = `${direction}:${token}`;
      if (budget.tokens.has(key)) break;
      budget.tokens.add(key);
      budget.requests += 1;
      const more = await this.paginate(entry, generation, cursor.timeline, direction);
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
    const timeline = [...entry.pages].find((page) => page.events.some((event) => event.getId() === id)) ?? fallback.timeline;
    const index = timeline.getEvents().findIndex((candidate) => candidate === event || candidate.getId() === id);
    return index < 0 ? fallback : cursorAt(timeline, index + Number(after));
  }

  public async load(roomId: string, rootId: string, direction: Direction = 'backward'): Promise<void> {
    const entry = this.select(roomId, rootId);
    if (!entry.prepared || this.views.get(rootId)?.state.loading) return;
    const generation = this.begin(entry, direction);
    this.update(entry, { mode: 'history', targetEventId: undefined, targetStatus: undefined });
    const cursor = cloneCursor(direction === 'backward' ? entry.older : entry.newer);
    const previous = this.views.get(rootId)!.events;
    try {
      const added = await this.collect(entry, generation, cursor, direction, PAGE_MESSAGES, { requests: 0, raw: 0, tokens: new Set() });
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

  private async context(entry: Navigation, generation: number, eventId: string): Promise<void> {
    this.update(entry, { mode: 'context', loading: 'context', targetEventId: eventId, targetStatus: undefined });
    const budget: Budget = { requests: 0, raw: 0, tokens: new Set() };
    let timeline = [...entry.pages].find((page) => page.events.some((event) => event.getId() === eventId));
    if (!timeline && Thread.hasServerSideFwdPaginationSupport) {
      const response = await entry.client.http.authedRequest<IContextResponse>(Method.Get,
        `/rooms/${encodeURIComponent(entry.room.roomId)}/context/${encodeURIComponent(eventId)}`, { limit: '0' });
      if (!this.current(entry, generation)) return;
      const events = response.event ? await this.mapEvents(entry, generation, [response.event]) : [];
      if (!events.length && response.event?.event_id === eventId && (!response.event.room_id || response.event.room_id === entry.room.roomId)) {
        const unavailable = entry.client.getEventMapper({ decrypt: false })({ ...response.event, room_id: entry.room.roomId });
        if (unavailable.isRedacted()) events.push(unavailable);
      }
      if (!this.current(entry, generation)) return;
      timeline = new ThreadPage(events, entry.rootId, response.start ?? null, response.end ?? null);
      this.retainPage(entry, timeline);
    }
    if (!timeline) {
      const revision = entry.operationLiveRevision;
      let page = await this.relationPage(entry, generation, 'backward');
      if (!page || !this.current(entry, generation)) return;
      budget.requests += 1;
      page.events = [...new Map([...page.events, ...entry.arrivals.filter((arrival) => arrival.revision > revision).map((arrival) => arrival.event)].map((event) => [event.getId(), event])).values()];
      entry.live = page; entry.hasLivePage = true; this.retainPage(entry, page);
      const seen = new Set<string>();
      while (budget.requests < REQUEST_LIMIT) {
        if (page.events.some((event) => event.getId() === eventId)) { timeline = page; break; }
        const token = page.backward;
        if (!token || seen.has(token)) break;
        seen.add(token); budget.requests += 1;
        await this.paginate(entry, generation, page, 'backward');
        if (!this.current(entry, generation)) return;
        if (!page.previous) break;
        page = page.previous;
      }
      if (!timeline && page.events.some((event) => event.getId() === eventId)) timeline = page;
    }
    const target = timeline?.getEvents().find((event) => event.getId() === eventId);
    if (target) await entry.client.decryptEventIfNeeded(target).catch(() => undefined);
    if (!this.current(entry, generation)) return;
    const relation = target && historyRelation(target);
    if (!timeline || !target || target.getRoomId() !== entry.room.roomId || target.status || target.isRedacted()
      || !isVisibleTimelineEvent(target) || (target.threadRootId !== entry.rootId && !(relation?.rel_type === 'm.thread' && relation.event_id === entry.rootId))) {
      this.update(entry, { loading: undefined, targetStatus: target?.isRedacted() ? 'removed' : 'unavailable', errorDirection: 'context', error: target?.isRedacted() ? 'This reply was removed.' : 'This reply is not available in this thread.' });
      return;
    }
    const index = timeline.getEvents().indexOf(target);
    const older = cursorAt(timeline, index);
    const newer = cursorAt(timeline, index + 1);
    const before = await this.collect(entry, generation, older, 'backward', 25, budget);
    const after = await this.collect(entry, generation, newer, 'forward', 25, budget);
    if (!this.current(entry, generation)) return;
    entry.older = older; entry.newer = newer;
    this.update(entry, { loading: undefined, targetStatus: target.isRedacted() ? 'removed' : 'found', canLoadOlder: this.canRead(entry, older, 'backward'), canLoadNewer: this.canRead(entry, newer, 'forward') }, boundedTimelineEvents([...before, target, ...after]));
  }

  public async latest(roomId: string, rootId: string): Promise<void> {
    const entry = this.select(roomId, rootId);
    const generation = this.begin(entry, 'latest');
    try {
      if (await this.prepare(entry, generation)) await this.fetchLatest(entry, generation);
    } catch {
      if (this.current(entry, generation)) this.update(entry, { loading: undefined, errorDirection: 'latest', error: 'Latest replies could not be loaded. Try again.' }, undefined, entry.prepared ? {} : { rootStatus: 'unavailable' });
    }
  }

  public detach(roomId: string, rootId: string, detached: boolean): void {
    const entry = this.navigation.get(rootId);
    const view = this.views.get(rootId);
    if (!entry?.prepared || entry.room.roomId !== roomId || !view || !this.current(entry) || view.state.loading) return;
    if (detached && view.state.mode === 'live') this.update(entry, { mode: 'history' });
    else if (!detached && view.state.mode === 'history' && !this.canRead(entry, entry.newer, 'forward')) this.liveSelection(entry);
  }

  public hasEvent(roomId: string, eventId: string): boolean {
    return [...this.navigation.values()].some((entry) => entry.room.roomId === roomId
      && (entry.rootId === eventId || this.views.get(entry.rootId)?.latestEvent?.getId() === eventId || [...entry.pages].some((page) => page.events.some((event) => event.getId() === eventId))));
  }

  public observe(event: MatrixEvent, room: Room, live = false): void {
    if (this.getClient()?.getRoom(room.roomId) !== room || event.getRoomId() !== room.roomId || event.status) return;
    for (const entry of this.navigation.values()) {
      if (entry.room !== room || entry.client !== this.getClient() || room.getMyMembership() !== 'join') continue;
      const view = this.views.get(entry.rootId);
      if (!view) continue;
      const candidates = [view.root, view.latestEvent, ...[...entry.pages].flatMap((page) => page.events)].filter((candidate): candidate is MatrixEvent => Boolean(candidate));
      const relation = historyRelation(event);
      const redacts = event.isRedaction() ? event.getAssociatedId() : undefined;
      const targetId = redacts ?? relation?.event_id;
      const targets = [...new Set(candidates.filter((candidate) => candidate.getId() === targetId))];
      if (redacts && targets.length) {
        for (const target of targets) if (!target.isRedacted()) target.makeRedacted(event, room);
        if (entry.seenReplyIds.delete(redacts)) this.update(entry, {}, undefined, { replyCount: Math.max((view.replyCount ?? 0) - 1, entry.seenReplyIds.size), replyCountIsLowerBound: true });
      } else if (relation?.rel_type === 'm.replace' && targets.length) {
        for (const target of targets) {
          if (target.getSender() !== event.getSender()) continue;
          const previous = target.replacingEvent();
          if (!previous || event.getTs() > previous.getTs() || (event.getTs() === previous.getTs() && (event.getId() ?? '') > (previous.getId() ?? ''))) target.makeReplaced(event);
        }
      } else if (relation?.event_id && targets.length && relation.rel_type !== 'm.thread') {
        for (const page of entry.pages) if (page.events.some((candidate) => candidate.getId() === targetId) && !page.events.some((candidate) => candidate.getId() === event.getId())) page.events.push(event);
        if (view.events.some((candidate) => candidate.getId() === targetId)) this.update(entry, {}, boundedTimelineEvents([...view.events, event]));
      }
      if (live && relation?.rel_type === 'm.thread' && relation.event_id === entry.rootId
        && !entry.live.events.some((candidate) => candidate.getId() === event.getId())) {
        entry.live.events.push(event);
        if (entry.live.events.length > HISTORY_RAW_LIMIT) entry.live.events.splice(0, entry.live.events.length - HISTORY_RAW_LIMIT);
        entry.arrivals.push({ revision: ++entry.liveRevision, event });
        if (entry.arrivals.length > HISTORY_MESSAGE_LIMIT) entry.arrivals.shift();
        this.recordReplies(entry, [event], true);
        // A remote echo can take SDK ownership while the first HTTP page is
        // pending. Keep the accepted row visible without releasing its read gate.
        this.update(entry, {}, view.state.mode === 'live' && (view.state.loading || !entry.prepared)
          ? boundedTimelineEvents([...view.events, event]) : undefined,
        { latestEvent: isVisibleTimelineEvent(event) ? event : view.latestEvent });
      }
    }
    this.refresh(room);
  }

  public refresh(room: Room): void {
    for (const entry of this.navigation.values()) {
      if (entry.room !== room || this.getClient() !== entry.client || entry.client.getRoom(room.roomId) !== room) continue;
      if (room.getMyMembership() !== 'join') {
        entry.generation += 1; this.navigation.delete(entry.rootId); this.views.delete(entry.rootId); this.publish(room.roomId); continue;
      }
      const view = this.views.get(entry.rootId);
      if (!entry.prepared || !view || view.state.loading) continue;
      if (view.root?.isRedacted() && view.rootStatus !== 'removed') this.update(entry, {}, undefined, { rootStatus: 'removed' });
      const known = room.getThread(entry.rootId);
      const cachedIds = new Set(entry.live.events.map((event) => event.getId()));
      const sdkEvents = known?.events ?? [];
      const lastCachedId = [...entry.live.events].reverse().find(isVisibleTimelineEvent)?.getId();
      const overlap = lastCachedId ? sdkEvents.findIndex((event) => event.getId() === lastCachedId) : -1;
      // Only a shared ordered anchor proves that SDK events are successors.
      // An old SDK history page must never be appended as the newest replies.
      if (overlap >= 0) for (const event of sdkEvents.slice(overlap + 1, overlap + 1 + HISTORY_RAW_LIMIT)) {
        if (historyRelation(event)?.rel_type === 'm.thread' && historyRelation(event)?.event_id === entry.rootId
          && !event.status && !cachedIds.has(event.getId())) { entry.live.events.push(event); cachedIds.add(event.getId()); }
      }
      const latestEvent = [...entry.live.events].reverse().find((event) => !event.status && isVisibleTimelineEvent(event));
      if (latestEvent && latestEvent !== view.latestEvent) this.update(entry, {}, undefined, { latestEvent });
      else if (view.latestEvent?.isRedacted()) this.update(entry, {}, undefined, { latestEvent: undefined });
      if (entry.live.events.length > HISTORY_RAW_LIMIT) entry.live.events.splice(0, entry.live.events.length - HISTORY_RAW_LIMIT);
      if (view.state.mode === 'live') this.liveSelection(entry);
      else this.update(entry, { canLoadOlder: this.canRead(entry, entry.older, 'backward'), canLoadNewer: this.canRead(entry, entry.newer, 'forward'), ...(view.events.find((event) => event.getId() === view.state.targetEventId)?.isRedacted() ? { targetStatus: 'removed' as const } : {}) });
    }
  }
}
