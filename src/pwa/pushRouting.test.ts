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
