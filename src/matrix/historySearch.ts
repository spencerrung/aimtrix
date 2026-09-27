import type { MatrixClient } from 'matrix-js-sdk';
import { SearchOrderBy, type ISearchRequestBody } from 'matrix-js-sdk/lib/@types/search.js';

export interface HistorySearchFilters {
  term: string;
  roomId?: string;
  senderId?: string;
  after?: number;
  before?: number;
  kind?: 'messages' | 'media' | 'links';
}

export interface HistorySearchHit {
  roomId: string;
  eventId: string;
  senderId: string;
  body: string;
  timestamp: number;
  kind: 'message' | 'media' | 'link';
}

export interface HistorySearchPage {
  hits: HistorySearchHit[];
  nextBatch?: string;
  count?: number;
  searchedRoomIds: string[];
}

/** Server search only receives joined rooms whose history is not encrypted. */
export function searchableRoomIds(rooms: Array<{ id: string; encrypted: boolean; membership: string }>): string[] {
  return rooms.filter((room) => room.membership === 'join' && !room.encrypted).map((room) => room.id);
}

export function historySearchBody(filters: HistorySearchFilters, roomIds: string[]): ISearchRequestBody {
  const rooms = filters.roomId ? roomIds.filter((id) => id === filters.roomId) : roomIds;
  return {
    search_categories: {
      room_events: {
        search_term: filters.term.trim(),
        keys: ['content.body'],
        order_by: SearchOrderBy.Recent,
        filter: {
          rooms,
          types: filters.kind === 'media' ? ['m.room.message', 'm.sticker'] : ['m.room.message'],
          ...(filters.senderId ? { senders: [filters.senderId] } : {}),
          limit: 30,
        },
        event_context: { before_limit: 0, after_limit: 0 },
      },
    },
  };
}

function hitFromEvent(value: unknown, filters: HistorySearchFilters, allowedRooms: Set<string>): HistorySearchHit | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const event = value as Record<string, unknown>;
  const content = event.content;
  if (!content || typeof content !== 'object' || event.unsigned && typeof event.unsigned === 'object' && 'redacted_because' in event.unsigned) return undefined;
  const body = (content as Record<string, unknown>).body;
  const roomId = event.room_id;
  const eventId = event.event_id;
  const senderId = event.sender;
  const timestamp = event.origin_server_ts;
  if (typeof body !== 'string' || typeof roomId !== 'string' || !allowedRooms.has(roomId) ||
      typeof eventId !== 'string' || !eventId.startsWith('$') || typeof senderId !== 'string' ||
      typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return undefined;
  if (filters.after && timestamp < filters.after || filters.before && timestamp > filters.before) return undefined;
  const msgtype = (content as Record<string, unknown>).msgtype;
  const isMedia = event.type === 'm.sticker' || ['m.image', 'm.video', 'm.audio', 'm.file'].includes(String(msgtype));
  const isLink = /https?:\/\/\S+/i.test(body);
  if (filters.kind === 'media' && !isMedia || filters.kind === 'links' && !isLink) return undefined;
  return { roomId, eventId, senderId, body: body.slice(0, 500), timestamp, kind: isMedia ? 'media' : isLink ? 'link' : 'message' };
}

export async function searchUnencryptedHistory(
  client: Pick<MatrixClient, 'search'>,
  filters: HistorySearchFilters,
  roomIds: string[],
  nextBatch?: string,
  signal?: AbortSignal,
): Promise<HistorySearchPage> {
  const searchedRoomIds = filters.roomId ? roomIds.filter((id) => id === filters.roomId) : roomIds;
  if (!filters.term.trim() || searchedRoomIds.length === 0) return { hits: [], searchedRoomIds };
  const response = await client.search({ body: historySearchBody(filters, searchedRoomIds), next_batch: nextBatch }, signal);
  const events = response.search_categories?.room_events;
  const allowed = new Set(searchedRoomIds);
  return {
    hits: (events?.results ?? []).map((result) => hitFromEvent(result.result, filters, allowed)).filter((hit): hit is HistorySearchHit => Boolean(hit)),
    nextBatch: events?.next_batch,
    count: events?.count,
    searchedRoomIds,
  };
}
