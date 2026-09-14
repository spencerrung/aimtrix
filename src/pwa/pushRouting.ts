import { isMatrixEventId, isMatrixNavigationTarget, parseMatrixLink, type MatrixNavigationTarget } from '../matrix/matrixLinks';

/** Event-only notifications remain valid even though standard links need a room. */
export type PushRoute = MatrixNavigationTarget;

const routeParameters = ['room', 'alias', 'user', 'event', 'via'] as const;

export function parsePushRoute(url: URL): PushRoute | undefined {
  if (url.protocol === 'matrix:' || url.hostname === 'matrix.to') return parseMatrixLink(url.href);
  try { decodeURIComponent(url.search.slice(1)); } catch { return undefined; }
  // Conflicting explicit destinations are rejected rather than choosing one.
  if (routeParameters.some((key) => key !== 'via' && url.searchParams.getAll(key).length > 1)) return undefined;
  const via = url.searchParams.getAll('via');
  return pushRouteFromMessage({
    roomId: url.searchParams.get('room') ?? undefined,
    roomAlias: url.searchParams.get('alias') ?? undefined,
    userId: url.searchParams.get('user') ?? undefined,
    eventId: url.searchParams.get('event') ?? undefined,
    via: via.length ? via : undefined,
  });
}

export function pushRouteFromMessage(value: unknown): PushRoute | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const route = {
    roomId: candidate.roomId,
    eventId: candidate.eventId,
    ...(candidate.roomAlias !== undefined ? { roomAlias: candidate.roomAlias } : {}),
    ...(candidate.userId !== undefined ? { userId: candidate.userId } : {}),
    ...(candidate.via !== undefined ? { via: candidate.via } : {}),
  } as MatrixNavigationTarget;
  const eventOnly = route.roomId === undefined && route.roomAlias === undefined && route.userId === undefined
    && route.via === undefined && isMatrixEventId(route.eventId);
  if (!eventOnly && !isMatrixNavigationTarget(route)) return undefined;
  if (route.via) route.via = [...new Set(route.via)];
  return route;
}

/** Replaces destination fields while retaining unrelated application parameters. */
export function routeUrl(route: PushRoute, location = window.location.origin): string {
  const validated = pushRouteFromMessage(route);
  if (!validated && Object.values(route).some((value) => value !== undefined)) throw new Error('That Matrix destination is invalid.');
  const url = new URL(location);
  url.hash = '';
  for (const parameter of routeParameters) url.searchParams.delete(parameter);
  if (validated?.roomId) url.searchParams.set('room', validated.roomId);
  if (validated?.roomAlias) url.searchParams.set('alias', validated.roomAlias);
  if (validated?.userId) url.searchParams.set('user', validated.userId);
  if (validated?.eventId) url.searchParams.set('event', validated.eventId);
  for (const via of validated?.via ?? []) url.searchParams.append('via', via);
  return `${url.pathname || '/'}${url.search}`;
}
