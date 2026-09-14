import { describe, expect, it } from 'vitest';
import { parsePushRoute, pushRouteFromMessage, routeUrl } from './pushRouting';

describe('push routing', () => {
  it('accepts opaque Matrix room and event identifiers', () => {
    const route = parsePushRoute(new URL('https://aimtrix.example/?room=!room:example.org&event=$event/1'));

    expect(route).toEqual({ roomId: '!room:example.org', eventId: '$event/1' });
    expect(routeUrl(route ?? {})).toBe('/?room=%21room%3Aexample.org&event=%24event%2F1');
  });

  it('rejects arbitrary notification message data', () => {
    expect(pushRouteFromMessage({ roomId: 'not-a-room', body: 'private message' })).toBeUndefined();
    expect(pushRouteFromMessage({ roomId: '!safe:example.org' })).toEqual({ roomId: '!safe:example.org', eventId: undefined });
  });
});

describe('Matrix destination routing', () => {
  it.each([
    ['https://matrix.to/#/%23lounge:test/$event?via=test&via=other.test', { roomAlias: '#lounge:test', eventId: '$event', via: ['test', 'other.test'] }],
    ['matrix:u/alice:test', { userId: '@alice:test' }],
    ['matrix:roomid/room:test/e/event%2Fhash?via=test', { roomId: '!room:test', eventId: '$event/hash', via: ['test'] }],
    ['https://aimtrix.test/?alias=%23lounge%3Atest&event=%24event&via=test', { roomAlias: '#lounge:test', eventId: '$event', via: ['test'] }],
    ['aimtrix://open?user=%40alice%3Atest', { userId: '@alice:test' }],
  ])('preserves the complete target through %s and the application URL', (link, expected) => {
    const route = parsePushRoute(new URL(link));
    expect(route).toEqual(expected);
    expect(parsePushRoute(new URL(routeUrl(route!), 'https://aimtrix.test'))).toEqual(expected);
  });

  it('preserves event-only notifications and drops unrelated message contents', () => {
    const route = pushRouteFromMessage({ eventId: '$event/hash', body: 'Synthetic ignored text', accessToken: 'not-used' });
    expect(route).toEqual({ eventId: '$event/hash', roomId: undefined });
    expect(parsePushRoute(new URL(routeUrl(route!), 'https://aimtrix.test'))).toEqual(route);
  });

  it.each([
    'https://aimtrix.test/?room=!room:test&event=broken',
    'https://aimtrix.test/?room=!room:test&event=',
    'https://aimtrix.test/?room=!room:test&event=%00',
    'https://aimtrix.test/?room=!room:test&event=%ZZ',
    'https://aimtrix.test/?room=!room:test&event=$one&event=$two',
    'https://aimtrix.test/?room=broken&event=$event',
    'https://aimtrix.test/?room=!room:test&alias=%23room:test',
    'https://aimtrix.test/?user=@alice:test&event=$event',
    'https://aimtrix.test/?room=!room:test&via=test/path',
    'https://aimtrix.test/?event=$event&via=test',
    'https://matrix.to/#/!room:test/broken?room=!room:test',
    'matrix:roomid/room:test/e/?room=!room:test',
  ])('rejects the entire malformed explicit route %s', (link) => {
    expect(parsePushRoute(new URL(link))).toBeUndefined();
  });

  it.each(['broken', '', null, 42, { id: '$event' }])('does not downgrade malformed event %j into a room-only route', (eventId) => {
    expect(pushRouteFromMessage({ roomId: '!room:test', eventId })).toBeUndefined();
  });

  it('replaces every stale target field while retaining the current application path and settings', () => {
    const path = routeUrl({ userId: '@alice:test' }, 'https://aimtrix.test/client/?demo=1&room=!old:test&alias=%23old:test&event=$old&via=old.test#old');
    expect(path).toBe('/client/?demo=1&user=%40alice%3Atest');
    expect(routeUrl({ eventId: '$event' }, `https://aimtrix.test${path}`)).toBe('/client/?demo=1&event=%24event');
    expect(routeUrl({ roomId: '!room:test' }, 'capacitor://localhost')).toBe('/?room=%21room%3Atest');
  });

  it('rejects malformed programmatic serialization before changing the destination', () => {
    expect(() => routeUrl({ roomId: '!room:test', eventId: 'broken' })).toThrow('invalid');
  });
});
