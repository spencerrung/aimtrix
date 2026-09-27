import { describe, expect, it, vi } from 'vitest';
import { historySearchBody, searchableRoomIds, searchUnencryptedHistory } from './historySearch';

const rooms = [
  { id: '!plain:test', membership: 'join', encrypted: false },
  { id: '!secret:test', membership: 'join', encrypted: true },
  { id: '!left:test', membership: 'leave', encrypted: false },
];

describe('history search', () => {
  it('only sends joined unencrypted rooms and applies sender/type filters', () => {
    const ids = searchableRoomIds(rooms);
    expect(ids).toEqual(['!plain:test']);
    expect(historySearchBody({ term: '  hello ', senderId: '@a:test', kind: 'media' }, ids).search_categories.room_events).toMatchObject({
      search_term: 'hello', keys: ['content.body'],
      filter: { rooms: ['!plain:test'], senders: ['@a:test'], types: ['m.room.message', 'm.sticker'] },
    });
  });

  it('ignores results outside authorized rooms, redactions, and local date/type mismatches', async () => {
    const event = (room_id: string, event_id: string, body: string, origin_server_ts: number) => ({
      result: { room_id, event_id, body, sender: '@a:test', origin_server_ts, type: 'm.room.message', content: { body, msgtype: 'm.text' } },
    });
    const search = vi.fn().mockResolvedValue({ search_categories: { room_events: { count: 4, next_batch: 'page-2', results: [
      event('!plain:test', '$valid', 'https://example.com', 200),
      event('!secret:test', '$secret', 'secret', 200),
      event('!plain:test', '$old', 'https://example.com', 50),
      { result: { ...event('!plain:test', '$redacted', 'https://example.com', 200).result, unsigned: { redacted_because: {} } } },
    ] } } });
    const page = await searchUnencryptedHistory({ search } as never, { term: 'https', after: 100, kind: 'links' }, ['!plain:test'], undefined, new AbortController().signal);
    expect(page.hits.map((hit) => hit.eventId)).toEqual(['$valid']);
    expect(page.nextBatch).toBe('page-2');
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ search_categories: expect.anything() }) }), expect.any(AbortSignal));
  });
});
