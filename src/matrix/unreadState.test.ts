import { describe, expect, it } from 'vitest';
import { parseMarkedUnread, UNREAD_RETURN_POINT } from './unreadState';

describe('marked-unread account data', () => {
  it.each([undefined, null, [], 'true', { unread: 'true' }, { unread: 1 }])('requires the standard boolean flag: %j', (content) => {
    expect(parseMarkedUnread(content)).toEqual({ markedUnread: false });
  });

  it.each([null, [], '$event:test', { event_id: 42 }, { event_id: '' }, { event_id: 'not-an-event' }, { event_id: '$bad\nvalue' }, { event_id: `$${'x'.repeat(1024)}` }])('ignores malformed extension but retains standard reminder: %j', (extension) => {
    expect(parseMarkedUnread({ unread: true, [UNREAD_RETURN_POINT]: extension })).toEqual({ markedUnread: true, unreadEventId: undefined });
  });

  it('ignores foreign extensions and stale positions after another client clears the standard flag', () => {
    expect(parseMarkedUnread({ unread: true, 'other.client.return_point': { event_id: '$other:test' } })).toEqual({ markedUnread: true, unreadEventId: undefined });
    expect(parseMarkedUnread({ unread: false, [UNREAD_RETURN_POINT]: { event_id: '$old:test' } })).toEqual({ markedUnread: false });
  });
});
