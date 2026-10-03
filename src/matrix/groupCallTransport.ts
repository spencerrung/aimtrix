import type { MatrixClient } from 'matrix-js-sdk';
import type { MatrixRTCSession } from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSession.js';

export interface GroupCallTransport {
  [key: string]: unknown;
  type: 'livekit';
  livekit_service_url: string;
}

function validUrl(value: unknown, protocols: string[]): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return;
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!protocols.includes(url.protocol) && !(loopback && (url.protocol === 'http:' || url.protocol === 'ws:'))) return;
    if (url.username || url.password || url.search || url.hash) return;
    return url.toString().replace(/\/$/, '');
  } catch { return; }
}

export function parseGroupCallTransport(value: unknown): GroupCallTransport | undefined {
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (record.type !== 'livekit') return;
  const url = validUrl(record.livekit_service_url, ['https:']);
  return url ? { type: 'livekit', livekit_service_url: url } : undefined;
}

export async function discoverGroupCallTransport(client: Pick<MatrixClient, '_unstable_getRTCTransports' | 'getClientWellKnown'>, session?: Pick<MatrixRTCSession, 'getOldestMembership'>): Promise<GroupCallTransport | undefined> {
  const oldest = session?.getOldestMembership();
  const current = oldest && parseGroupCallTransport(oldest.getTransport(oldest));
  if (current) return current;
  const advertised = await client._unstable_getRTCTransports().catch(() => []);
  for (const candidate of advertised) {
    const transport = parseGroupCallTransport(candidate);
    if (transport) return transport;
  }
  const wellKnown = client.getClientWellKnown() as Record<string, unknown> | undefined;
  const foci = wellKnown?.['org.matrix.msc4143.rtc_foci'] ?? wellKnown?.['m.rtc_foci'];
  if (Array.isArray(foci)) for (const candidate of foci) {
    const transport = parseGroupCallTransport(candidate);
    if (transport) return transport;
  }
}

export interface GroupCallAuthorization {
  url: string;
  jwt: string;
}

export async function authorizeGroupCall(
  client: Pick<MatrixClient, 'getOpenIdToken'>,
  transport: GroupCallTransport,
  identity: { deviceId: string },
  roomId: string,
  signal?: AbortSignal,
): Promise<GroupCallAuthorization> {
  const openidToken = await client.getOpenIdToken();
  // The state-event membership uses the legacy user:device backend identity.
  // Its JWT must come from the matching legacy endpoint; /get_token hashes it.
  const response = await fetch(`${transport.livekit_service_url}/sfu/get`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      room: roomId,
      openid_token: openidToken,
      device_id: identity.deviceId,
    }),
    signal,
  });
  if (!response.ok) throw new Error(`The MatrixRTC authorization service rejected this call (${response.status}).`);
  const result = await response.json() as Record<string, unknown>;
  const url = validUrl(result.url, ['wss:']);
  if (!url || typeof result.jwt !== 'string' || !result.jwt || result.jwt.length > 16_384) {
    throw new Error('The MatrixRTC authorization service returned an invalid connection.');
  }
  return { url, jwt: result.jwt };
}
