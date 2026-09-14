import { describe, expect, it } from 'vitest';
import { isMatrixEventId, isMatrixNavigationTarget, parseMatrixLink } from './matrixLinks';

describe('standard Matrix links', () => {
  it.each([
    ['https://matrix.to/#/%23lounge%3Atest', { roomAlias: '#lounge:test' }],
    ['https://matrix.to/#/#lounge:test', { roomAlias: '#lounge:test' }],
    ['https://matrix.to/#/!lounge:test', { roomId: '!lounge:test' }],
    ['https://matrix.to/#/%40alice%3Atest', { userId: '@alice:test' }],
    ['https://matrix.to/#/!lounge:test/%24opaque%2Fhash', { roomId: '!lounge:test', eventId: '$opaque/hash' }],
    ['https://matrix.to/#/!new-room-hash/$event?via=test&via=other.test:8448', { roomId: '!new-room-hash', eventId: '$event', via: ['test', 'other.test:8448'] }],
    ['matrix:r/lounge:test', { roomAlias: '#lounge:test' }],
    ['matrix:roomid/lounge:test', { roomId: '!lounge:test' }],
    ['matrix:roomid/new-room-hash/e/event%2Fhash', { roomId: '!new-room-hash', eventId: '$event/hash' }],
    ['matrix:u/alice:test?action=chat', { userId: '@alice:test' }],
    ['matrix:roomid/lounge:test/e/event?via=%5B2001%3Adb8%3A%3A1%5D%3A8448', { roomId: '!lounge:test', eventId: '$event', via: ['[2001:db8::1]:8448'] }],
    ['https://matrix.to/#/%23lounge:test/$event', { roomAlias: '#lounge:test', eventId: '$event' }],
    ['matrix:r/lounge:test/e/event', { roomAlias: '#lounge:test', eventId: '$event' }],
    [' MATRIX:roomid/lounge:test?via=test&via=test&org.example.hint=ok ', { roomId: '!lounge:test', via: ['test'] }],
    ['matrix:r/team%20lounge:test', { roomAlias: '#team lounge:test' }],
    ['https://matrix.to/#/%23legacy%09alias:test', { roomAlias: '#legacy\talias:test' }],
    ['matrix:u/legacy%20person:test', { userId: '@legacy person:test' }],
    ['matrix:u/:test', { userId: '@:test' }],
    ['matrix:r/%23lounge:test', { roomAlias: '##lounge:test' }],
    ['matrix:u/%40legacy:test', { userId: '@@legacy:test' }],
    ['matrix:roomid/!room:test', { roomId: '!!room:test' }],
    ['matrix:roomid/room:test/e/$event', { roomId: '!room:test', eventId: '$$event' }],
  ])('parses %s without network access', (link, expected) => {
    expect(parseMatrixLink(link)).toEqual(expected);
  });

  it.each([
    'https://other.test/#/!room:test', 'http://matrix.to/#/!room:test',
    'https://matrix.to.evil.test/#/!room:test', 'https://matrix.to@evil.test/#/!room:test',
    'https://matrix.to:8448/#/!room:test', 'https://matrix.to/?elsewhere=1#/!room:test',
    'javascript:matrix:roomid/room:test', '!room:test', '',
    'matrix://authority/roomid/room:test', 'matrix:roomid/room:test#unsupported',
    'matrix:roomid/room:test/e', 'matrix:roomid/room:test/e/',
    'matrix:roomid/room:test/e/event/extra', 'matrix:roomid/room:test/unknown/event',
    'matrix:u/alice:test/e/event', 'matrix:u/alice', 'matrix:r/alias',
    'https://matrix.to/#/!room:test/not-an-event', 'https://matrix.to/#/!room:test/',
    'https://matrix.to/#/@alice:test/$event', 'https://matrix.to/#/!room:test/$event/extra',
    'https://matrix.to/#/!room:test/%E0%A4%A', 'matrix:roomid/room:test?via=%ZZ',
    'matrix:roomid/room:test?via=evil.test%2Fpath', 'matrix:roomid/room:test?via=user%40test',
    'matrix:roomid/room:test?via=test%0A', 'matrix:roomid/room:test?via=test:65536',
    'matrix:roomid/room:test?via=', 'matrix:roomid/room:test?via=%5Bbroken%5D',
    'matrix:roomid/room:test/e/%00', 'matrix:roomid/room:test/e/%ED%A0%80',
    'matrix:r/room%00:test', 'matrix:u/person%00:test', 'matrix:u/%ED%A0%80:test',
    'matrix:r/team lounge:test', 'matrix:u/legacy\tperson:test',
    'https://matrix.to/#/!room:test/$event\nextra',
  ])('rejects the whole malformed destination %s', (link) => {
    expect(parseMatrixLink(link)).toBeUndefined();
  });

  it('bounds identifiers, complete links and routing lists', () => {
    expect(parseMatrixLink(`matrix:roomid/${'x'.repeat(255)}`)).toBeUndefined();
    expect(parseMatrixLink(`matrix:r/${'界'.repeat(100)}:test`)).toBeUndefined();
    expect(parseMatrixLink(`matrix:roomid/room:test?org.example=${'x'.repeat(4096)}`)).toBeUndefined();
    expect(parseMatrixLink(`matrix:roomid/room:test?${Array.from({ length: 9 }, (_, i) => `via=server${i}.test`).join('&')}`)).toBeUndefined();
  });

  it('validates programmatic targets as strictly as parsed links', () => {
    expect(isMatrixNavigationTarget({ roomId: '!room:test', eventId: '$event' })).toBe(true);
    expect(isMatrixNavigationTarget({ roomId: '!room:test', roomAlias: '#room:test' })).toBe(false);
    expect(isMatrixNavigationTarget({ eventId: '$event' })).toBe(false);
    expect(isMatrixNavigationTarget({ userId: '@alice:test', eventId: '$event' })).toBe(false);
    expect(isMatrixNavigationTarget({ roomId: '!room:test', via: ['test/path'] })).toBe(false);
  });

  it('validates standalone event identifiers without inventing a room destination', () => {
    expect(isMatrixEventId('$opaque/hash:test')).toBe(true);
    expect(isMatrixEventId('not-an-event')).toBe(false);
    expect(isMatrixEventId('$event\nextra')).toBe(false);
    expect(isMatrixEventId(`$${'x'.repeat(255)}`)).toBe(false);
    expect(isMatrixEventId(null)).toBe(false);
  });
});
