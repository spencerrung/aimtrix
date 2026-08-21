export interface PushRoute {
  roomId?: string;
  eventId?: string;
}

const roomIdPattern = /^![^\s?#]{1,255}$/;
const eventIdPattern = /^\$[^\s?#]{1,255}$/;

function safeRouteValue(value: string | null, pattern: RegExp): string | undefined {
  return value && pattern.test(value) ? value : undefined;
}

export function parsePushRoute(url: URL): PushRoute | undefined {
  const route: PushRoute = {
    roomId: safeRouteValue(url.searchParams.get('room'), roomIdPattern),
    eventId: safeRouteValue(url.searchParams.get('event'), eventIdPattern),
  };
  return route.roomId || route.eventId ? route : undefined;
}

export function pushRouteFromMessage(value: unknown): PushRoute | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { roomId?: unknown; eventId?: unknown };
  const roomId = typeof candidate.roomId === 'string' && roomIdPattern.test(candidate.roomId)
    ? candidate.roomId
    : undefined;
  const eventId = typeof candidate.eventId === 'string' && eventIdPattern.test(candidate.eventId)
    ? candidate.eventId
    : undefined;
  return roomId || eventId ? { roomId, eventId } : undefined;
}

export function routeUrl(route: PushRoute, origin = window.location.origin): string {
  const url = new URL('/', origin);
  if (route.roomId) url.searchParams.set('room', route.roomId);
  if (route.eventId) url.searchParams.set('event', route.eventId);
  return `${url.pathname}${url.search}`;
}
