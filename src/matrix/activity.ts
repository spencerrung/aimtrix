import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import type { IEvent } from 'matrix-js-sdk/lib/models/event.js';
import { Method } from 'matrix-js-sdk/lib/http-api/method.js';
import { ReceiptType } from 'matrix-js-sdk/lib/@types/read_receipts.js';
import { validUnreadEventId } from './unreadState';
import { historyRelation, isVisibleTimelineEvent } from './historyEvents';

export const THREAD_FOLLOW_EVENT = 'dev.alucard.aimtrix.followed_threads.v1';
const PAGE = 30, MAX_ITEMS = 500, MAX_ROOMS = 200, ROOMS_PER_PAGE = 4, MAX_FOLLOWS = 128;
const encode = encodeURIComponent;
export interface ActivityItem {
  id: string;
  kind: 'notification' | 'thread';
  roomId: string;
  roomName: string;
  eventId: string;
  threadRootId?: string;
  senderId?: string;
  senderName?: string;
  body: string;
  timestamp: number;
  read: 'read' | 'unread' | 'unknown';
  highlighted: boolean;
  encrypted: boolean;
  unavailable: boolean;
  participated?: boolean;
  followed?: boolean;
  serverRead?: boolean;
}
export interface ActivitySnapshot {
  items: ActivityItem[];
  loading: boolean;
  loadingThreads: boolean;
  canLoadOlder: boolean;
  canLoadMoreThreads: boolean;
  error?: string;
  threadError?: string;
  coverage: {
    notifications: 'server' | 'unavailable' | 'not-loaded';
    limited: boolean;
    encryptedPending: boolean;
    roomsLoaded: number;
    roomsTotal: number;
    threadsUnsupported: boolean;
  };
}
interface RecordEntry {
  kind: ActivityItem['kind']; room: Room; event: MatrixEvent; preview?: MatrixEvent;
  timestamp: number; rootId?: string; highlighted: boolean; serverRead?: boolean; participated?: boolean;
}
interface RoomCursor { room: Room; token?: string; done: boolean; loaded: boolean; seen: Set<string> }
interface FollowPreferences { source?: MatrixEvent; threads: Record<string, boolean> }
const key = (roomId: string, eventId: string, kind: string) => JSON.stringify([roomId, eventId, kind]);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const timestamp = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
const cursor = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 4096 ? value : undefined;
export function parseThreadFollows(value: unknown): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  if (!object(value) || value.version !== 1 || !object(value.threads)) return result;
  for (const [id, followed] of Object.entries(value.threads).slice(0, MAX_FOLLOWS)) {
    if (validUnreadEventId(id) && typeof followed === 'boolean') result[id] = followed;
  }
  return result;
}
function notFound(error: unknown): boolean {
  return object(error) && (error.errcode === 'M_NOT_FOUND' || error.httpStatus === 404);
}

/** Read-only activity selections. Fetching never inserts SDK timelines or sends receipts. */
export class ActivityStore {
  private owner?: MatrixClient;
  private generation = 0;
  private records = new Map<string, RecordEntry>();
  private roomCursors = new Map<string, RoomCursor>();
  private follows = new Map<string, FollowPreferences>();
  private writes = new Map<string, Promise<void>>();
  private notificationToken?: string;
  private notificationTokens = new Set<string>();
  private exhausted = false;
  private loading = false;
  private loadingThreads = false;
  private limited = false;
  private notifications: ActivitySnapshot['coverage']['notifications'] = 'not-loaded';
  private error?: string;
  private threadError?: string;
  private threadsUnsupported = false;
  public constructor(private readonly clientGetter: () => MatrixClient | undefined, private readonly changed: () => void) {}

  public clear(): void {
    this.generation++; this.owner = undefined; this.records.clear(); this.roomCursors.clear(); this.follows.clear(); this.writes.clear();
    this.notificationToken = undefined; this.notificationTokens.clear(); this.exhausted = false;
    this.loading = false; this.loadingThreads = false; this.limited = false;
    this.notifications = 'not-loaded'; this.error = undefined; this.threadError = undefined; this.threadsUnsupported = false;
  }
  private client(): MatrixClient | undefined {
    const client = this.clientGetter();
    if (this.owner !== client) { this.clear(); this.owner = client; }
    return client;
  }
  private active(client: MatrixClient, generation: number, room?: Room): boolean {
    return this.clientGetter() === client && this.owner === client && this.generation === generation &&
      (!room || client.getRoom(room.roomId) === room && room.getMyMembership() === 'join');
  }
  private rooms(client: MatrixClient): Room[] {
    const rooms = client.getRooms().filter((room) => room.getMyMembership() === 'join' && room.getType?.() !== 'm.space');
    if (rooms.length > MAX_ROOMS) this.limited = true;
    return rooms.slice(0, MAX_ROOMS);
  }
  private preferences(room: Room): FollowPreferences {
    const source = room.getAccountData(THREAD_FOLLOW_EVENT);
    let current = this.follows.get(room.roomId);
    if (!current || current.source !== source) {
      current = { source, threads: parseThreadFollows(source?.getContent()) }; this.follows.set(room.roomId, current);
    }
    return current;
  }
  public followState(roomId: string, rootId: string): boolean | undefined {
    const room = this.client()?.getRoom(roomId);
    return room?.getMyMembership() === 'join' ? this.preferences(room).threads[rootId] : undefined;
  }
  public isThreadFollowed(roomId: string, rootId: string): boolean | undefined { return this.followState(roomId, rootId); }
  private keep(record: RecordEntry): void {
    const id = key(record.room.roomId, record.kind === 'thread' ? record.rootId! : record.event.getId()!, record.kind);
    const previous = this.records.get(id);
    if (record.kind === 'thread' && previous) {
      record.participated ||= previous.participated;
      if (previous.timestamp > record.timestamp && previous.preview) {
        record.preview = previous.preview; record.timestamp = previous.timestamp;
      }
    }
    this.records.set(id, record);
    if (this.records.size > MAX_ITEMS) {
      const oldest = [...this.records].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      this.records.delete(oldest[0]); this.limited = true;
    }
  }
  private async map(client: MatrixClient, generation: number, room: Room, raw: unknown): Promise<MatrixEvent | undefined> {
    if (!object(raw) || !validUnreadEventId(raw.event_id) || typeof raw.type !== 'string' || !object(raw.content) ||
      raw.room_id !== undefined && raw.room_id !== room.roomId || !this.active(client, generation, room)) return;
    // One mapper per event: SDK mapper's mutable preventReEmit flag must not
    // leak from a known event to a later cache-only encrypted event.
    const event = client.getEventMapper({ decrypt: false })({ ...raw, room_id: room.roomId } as IEvent);
    await client.decryptEventIfNeeded(event).catch(() => undefined);
    if (!this.active(client, generation, room) || event.status || event.getRoomId() !== room.roomId) return;
    return event;
  }
  public async refresh(): Promise<void> {
    const client = this.client(); if (!client) return;
    if (this.loading || this.loadingThreads) return;
    this.notificationToken = undefined; this.notificationTokens.clear(); this.exhausted = false;
    this.roomCursors.clear(); this.threadsUnsupported = false; this.limited = false;
    await Promise.all([this.fetchNotifications(client), this.loadMoreThreads()]);
  }
  public async loadOlder(): Promise<void> {
    const client = this.client();
    if (!client || this.loading || this.exhausted || this.notificationTokens.size >= 20) return;
    await this.fetchNotifications(client);
  }
  private async fetchNotifications(client: MatrixClient): Promise<void> {
    const generation = this.generation;
    this.loading = true; this.error = undefined; this.changed();
    try {
      const response = await client.http.authedRequest<unknown>(Method.Get, '/notifications', {
        limit: PAGE, ...(this.notificationToken ? { from: this.notificationToken } : {}),
      });
      if (!this.active(client, generation)) return;
      if (!object(response) || !Array.isArray(response.notifications)) throw new Error('Invalid activity response');
      for (const notification of response.notifications.slice(0, PAGE)) {
        if (!object(notification) || typeof notification.room_id !== 'string') continue;
        const room = client.getRoom(notification.room_id);
        if (!room || room.getMyMembership() !== 'join') continue;
        const event = await this.map(client, generation, room, notification.event);
        if (!event || !isVisibleTimelineEvent(event)) continue;
        const relation = historyRelation(event);
        const rootId = relation?.rel_type === 'm.thread' && validUnreadEventId(relation.event_id) ? relation.event_id : undefined;
        const actions = client.getPushActionsForEvent(event, true);
        this.keep({ kind: 'notification', room, event, timestamp: timestamp(notification.ts) || event.getTs(), rootId,
          highlighted: actions?.tweaks?.highlight === true || Array.isArray(notification.actions) && notification.actions.some((action) => object(action) && action.set_tweak === 'highlight' && action.value !== false),
          serverRead: typeof notification.read === 'boolean' ? notification.read : undefined });
      }
      if (!this.active(client, generation)) return;
      const next = cursor(response.next_token);
      this.exhausted = !next || this.notificationTokens.has(next);
      if (next) this.notificationTokens.add(next);
      if (this.notificationTokens.size >= 20 || response.notifications.length > PAGE) this.limited = true;
      this.notificationToken = next; this.notifications = 'server';
    } catch {
      if (this.active(client, generation)) { this.error = 'Activity could not refresh. Try again.'; if (this.notifications === 'not-loaded') this.notifications = 'unavailable'; }
    } finally { if (this.active(client, generation)) { this.loading = false; this.changed(); } }
  }
  public async loadMoreThreads(): Promise<void> {
    const client = this.client(); if (!client || this.loadingThreads) return;
    const generation = this.generation;
    this.loadingThreads = true; this.threadError = undefined; this.changed();
    try {
      const rooms = this.rooms(client);
      for (const room of rooms) if (!this.roomCursors.has(room.roomId)) this.roomCursors.set(room.roomId, { room, done: false, loaded: false, seen: new Set() });
      const support = await client.doesServerSupportThread();
      if (!this.active(client, generation)) return;
      const supported = support.list !== 0;
      if (!supported) this.threadsUnsupported = true;
      const pending = [...this.roomCursors.values()].filter((state) => !state.done)
        .sort((a, b) => Number(a.loaded) - Number(b.loaded)).slice(0, ROOMS_PER_PAGE);
      for (const state of pending) {
        const room = state.room;
        if (!this.active(client, generation, room)) { state.done = true; continue; }
        if (supported) {
          const response = await client.http.authedRequest<unknown>(Method.Get, `/rooms/${encode(room.roomId)}/threads`,
            { include: 'participated', limit: PAGE, ...(state.token ? { from: state.token } : {}) }, undefined,
            { prefix: support.list === 2 ? '/_matrix/client/v1' : '/_matrix/client/unstable/org.matrix.msc3856' });
          if (!this.active(client, generation, room)) continue;
          if (!object(response) || !Array.isArray(response.chunk)) throw new Error('Invalid thread response');
          for (const raw of response.chunk.slice(0, PAGE)) await this.addThread(client, generation, room, raw, true);
          const next = cursor(response.next_batch);
          state.done = !next || state.seen.has(next) || state.seen.size >= 20;
          if (next) state.seen.add(next);
          state.token = next;
          if (state.seen.size >= 20) this.limited = true;
        } else {
          for (const thread of room.getThreads().slice(0, PAGE)) {
            if (thread.hasCurrentUserParticipated && thread.rootEvent) await this.addThread(client, generation, room, thread.rootEvent.event, true);
          }
          state.done = true;
        }
        let fetched = 0;
        for (const [rootId, followed] of Object.entries(this.preferences(room).threads)) {
          if (!followed || state.loaded && this.records.has(key(room.roomId, rootId, 'thread'))) continue;
          if (fetched++ >= PAGE) { this.limited = true; state.done = false; break; }
          try {
            const raw = await client.fetchRoomEvent(room.roomId, rootId);
            if (raw.event_id === rootId) await this.addThread(client, generation, room, raw, false);
          } catch { if (this.active(client, generation, room)) { this.threadError = 'Some followed threads are unavailable.'; state.done = false; } }
        }
        state.loaded = true;
      }
    } catch {
      if (this.active(client, generation)) this.threadError = 'Threads could not refresh. Try again.';
    } finally { if (this.active(client, generation)) { this.loadingThreads = false; this.changed(); } }
  }
  private async addThread(client: MatrixClient, generation: number, room: Room, raw: unknown, participated: boolean): Promise<void> {
    const event = await this.map(client, generation, room, raw); if (!event) return;
    const rootId = event.getId()!;
    const bundle = event.getServerAggregatedRelation<{ latest_event?: unknown }>('m.thread');
    const latest = bundle?.latest_event ? await this.map(client, generation, room, bundle.latest_event) : undefined;
    if (!this.active(client, generation, room)) return;
    const relation = latest && historyRelation(latest);
    const preview = relation?.rel_type === 'm.thread' && relation.event_id === rootId ? latest : undefined;
    this.keep({ kind: 'thread', room, event, rootId, preview, timestamp: (preview ?? event).getTs(), highlighted: false, participated });
  }
  public async setThreadFollow(roomId: string, rootId: string, following: boolean): Promise<void> {
    const client = this.client(), room = client?.getRoom(roomId);
    if (!client || !room || room.getMyMembership() !== 'join' || !validUnreadEventId(rootId)) throw new Error('This thread is unavailable.');
    const generation = this.generation;
    const previous = this.writes.get(roomId);
    const operation = (async () => {
      await previous?.catch(() => undefined);
      if (!this.active(client, generation, room)) throw new Error('The conversation changed.');
      const path = `/user/${encode(client.getSafeUserId())}/rooms/${encode(roomId)}/account_data/${encode(THREAD_FOLLOW_EVENT)}`;
      let content: unknown;
      try { content = await client.http.authedRequest(Method.Get, path); }
      catch (error) {
        // SDK errors can include request paths and private response data.
        // eslint-disable-next-line preserve-caught-error
        if (!notFound(error)) throw new Error('Thread following could not load. Try again.');
      }
      if (!this.active(client, generation, room)) throw new Error('The conversation changed.');
      const threads = parseThreadFollows(content);
      if (!(rootId in threads) && Object.keys(threads).length >= MAX_FOLLOWS) throw new Error('This room has reached its followed-thread preference limit.');
      threads[rootId] = following;
      try { await client.http.authedRequest(Method.Put, path, undefined, { version: 1, threads }); }
      catch { throw new Error('Thread following could not save. Try again.'); }
      if (!this.active(client, generation, room)) return;
      this.follows.set(roomId, { source: room.getAccountData(THREAD_FOLLOW_EVENT), threads });
      this.changed();
    })();
    this.writes.set(roomId, operation);
    try { await operation; } finally { if (this.writes.get(roomId) === operation) this.writes.delete(roomId); }
  }
  public owns(event: MatrixEvent): boolean {
    const client = this.client();
    return Boolean(client && [...this.records.values()].some((record) => this.active(client, this.generation, record.room) &&
      (record.event === event || record.preview === event)));
  }
  public observe(event: MatrixEvent, room?: Room, live = false): void {
    const client = this.client(); if (!client) return;
    room ??= client.getRoom(event.getRoomId()) ?? undefined;
    if (!room || !this.active(client, this.generation, room)) return;
    if (event.getType() === THREAD_FOLLOW_EVENT) this.follows.set(room.roomId, { source: event, threads: parseThreadFollows(event.getContent()) });
    const target = event.getAssociatedId();
    for (const record of this.records.values()) {
      if (record.room !== room) continue;
      for (const candidate of [record.event, record.preview]) {
        if (candidate && event.isRedaction() && target === candidate.getId()) candidate.makeRedacted(event, room);
      }
      if (record.event.getId() === event.getId()) record.event = event;
      if (record.preview?.getId() === event.getId()) record.preview = event;
    }
    const relation = historyRelation(event);
    if (!event.status && isVisibleTimelineEvent(event) && relation?.rel_type === 'm.thread' && validUnreadEventId(relation.event_id)) {
      const thread = this.records.get(key(room.roomId, relation.event_id, 'thread'));
      if (thread && event.getTs() >= thread.timestamp) { thread.preview = event; thread.timestamp = event.getTs(); }
    }
    if (live && !event.status && event.getSender() !== client.getUserId() && isVisibleTimelineEvent(event)) {
      const actions = client.getPushActionsForEvent(event, true);
      if (actions?.notify) {
        const relation = historyRelation(event);
        this.keep({ kind: 'notification', room, event, timestamp: event.getTs(), highlighted: actions.tweaks?.highlight === true,
          rootId: relation?.rel_type === 'm.thread' && validUnreadEventId(relation.event_id) ? relation.event_id : undefined });
      }
    }
    this.changed();
  }
  private read(record: RecordEntry, event: MatrixEvent, client: MatrixClient): ActivityItem['read'] {
    const context = record.rootId ? record.room.getThread(record.rootId) : record.room;
    if (!context) return 'unknown';
    const scope = record.rootId ?? 'main';
    let knownUnread = false;
    for (const type of [ReceiptType.ReadPrivate, ReceiptType.Read]) {
      const receipt = context.getReadReceiptForUserId(client.getSafeUserId(), true, type);
      if (!receipt || (record.rootId ? receipt.data.thread_id !== scope : receipt.data.thread_id && receipt.data.thread_id !== scope)) continue;
      if (receipt.eventId === event.getId()) return 'read';
      const order = context.getUnfilteredTimelineSet().compareEventOrdering(event.getId()!, receipt.eventId);
      if (order !== null && order <= 0) return 'read';
      if (order !== null && order > 0) knownUnread = true;
    }
    return knownUnread ? 'unread' : 'unknown';
  }
  public snapshot(): ActivitySnapshot {
    const client = this.client();
    const items: ActivityItem[] = [];
    if (client) for (const [id, record] of this.records) {
      if (!this.active(client, this.generation, record.room)) { this.records.delete(id); continue; }
      const followed = record.rootId ? this.preferences(record.room).threads[record.rootId] : undefined;
      if (record.kind === 'thread' && followed === false) continue;
      const event = record.preview ?? record.event;
      const encrypted = event.getType() === 'm.room.encrypted';
      const unavailable = event.isRedacted();
      const content = event.getContent<{ body?: unknown }>();
      const senderId = event.getSender();
      items.push({ id, kind: record.kind, roomId: record.room.roomId, roomName: record.room.name || record.room.roomId,
        eventId: event.getId()!, threadRootId: record.rootId, senderId, senderName: senderId ? record.room.getMember(senderId)?.name ?? senderId : undefined,
        body: unavailable ? 'This message was removed.' : encrypted ? 'Encrypted activity. Keys are not available yet.' : typeof content.body === 'string' ? content.body.slice(0, 1000) : 'Matrix activity',
        timestamp: record.timestamp, read: this.read(record, event, client), highlighted: client.getPushActionsForEvent(event, true)?.tweaks?.highlight === true || record.highlighted,
        encrypted, unavailable, participated: record.participated, followed, serverRead: record.serverRead });
    }
    return { items: items.sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id)), loading: this.loading, loadingThreads: this.loadingThreads,
      canLoadOlder: !this.exhausted && this.notificationTokens.size < 20, canLoadMoreThreads: [...this.roomCursors.values()].some((state) => !state.done),
      error: this.error, threadError: this.threadError, coverage: { notifications: this.notifications, limited: this.limited,
        encryptedPending: items.some((item) => item.encrypted), roomsLoaded: [...this.roomCursors.values()].filter((state) => state.loaded).length,
        roomsTotal: client ? this.rooms(client).length : 0, threadsUnsupported: this.threadsUnsupported } };
  }
}
