import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import type { MatrixRTCSession } from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSession.js';
import { authorizeGroupCall, discoverGroupCallTransport, parseGroupCallTransport } from './groupCallTransport';

afterEach(() => vi.unstubAllGlobals());

describe('MatrixRTC transport contract', () => {
  it('rejects unsafe or malformed advertised services', () => {
    expect(parseGroupCallTransport({ type: 'livekit', livekit_service_url: 'https://rtc.example.test/jwt/' }))
      .toEqual({ type: 'livekit', livekit_service_url: 'https://rtc.example.test/jwt' });
    for (const url of ['http://rtc.example.test', 'javascript:alert(1)', 'https://user:pass@rtc.example.test', 'https://rtc.example.test/?token=secret']) {
      expect(parseGroupCallTransport({ type: 'livekit', livekit_service_url: url })).toBeUndefined();
    }
    expect(parseGroupCallTransport({ type: 'other', livekit_service_url: 'https://rtc.example.test' })).toBeUndefined();
  });

  it('uses the active call focus before local discovery and falls back to well-known', async () => {
    const client = {
      _unstable_getRTCTransports: vi.fn().mockResolvedValue([{ type: 'livekit', livekit_service_url: 'https://local.example.test' }]),
      getClientWellKnown: () => ({ 'org.matrix.msc4143.rtc_foci': [{ type: 'livekit', livekit_service_url: 'https://wellknown.example.test' }] }),
    } as unknown as Pick<MatrixClient, '_unstable_getRTCTransports' | 'getClientWellKnown'>;
    const member = { getTransport: () => ({ type: 'livekit', livekit_service_url: 'https://joined.example.test' }) };
    const joined = { getOldestMembership: () => member } as unknown as Pick<MatrixRTCSession, 'getOldestMembership'>;
    expect(await discoverGroupCallTransport(client, joined)).toEqual({ type: 'livekit', livekit_service_url: 'https://joined.example.test' });
    expect(client._unstable_getRTCTransports).not.toHaveBeenCalled();
    const empty = { getOldestMembership: () => undefined } as Pick<MatrixRTCSession, 'getOldestMembership'>;
    expect(await discoverGroupCallTransport(client, empty)).toEqual({ type: 'livekit', livekit_service_url: 'https://local.example.test' });
    vi.mocked(client._unstable_getRTCTransports).mockRejectedValue(new Error('unsupported'));
    expect(await discoverGroupCallTransport(client, empty)).toEqual({ type: 'livekit', livekit_service_url: 'https://wellknown.example.test' });
  });

  it('requests the JWT matching legacy membership identity and refuses invalid SFU responses', async () => {
    const client = { getOpenIdToken: vi.fn().mockResolvedValue({ access_token: '<synthetic>', token_type: 'Bearer' }) } as unknown as Pick<MatrixClient, 'getOpenIdToken'>;
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: 'wss://sfu.example.test', jwt: 'synthetic.jwt.value' }), { status: 200 }));
    vi.stubGlobal('fetch', request);
    const identity = { userId: '@user:example.test', deviceId: 'DEVICE', memberId: '@user:example.test:DEVICE' };
    const transport = { type: 'livekit' as const, livekit_service_url: 'https://rtc.example.test/jwt' };
    expect(await authorizeGroupCall(client, transport, identity, '!room:example.test')).toEqual({ url: 'wss://sfu.example.test', jwt: 'synthetic.jwt.value' });
    expect(request).toHaveBeenCalledWith('https://rtc.example.test/jwt/sfu/get', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(request.mock.calls[0][1].body as string);
    expect(body).toEqual({ room: '!room:example.test', openid_token: { access_token: '<synthetic>', token_type: 'Bearer' }, device_id: identity.deviceId });
    request.mockResolvedValueOnce(new Response(JSON.stringify({ url: 'ws://outside.example.test', jwt: 'bad' }), { status: 200 }));
    await expect(authorizeGroupCall(client, transport, identity, '!room:example.test')).rejects.toThrow('invalid connection');
    request.mockResolvedValueOnce(new Response('denied', { status: 403 }));
    await expect(authorizeGroupCall(client, transport, identity, '!room:example.test')).rejects.toThrow('(403)');
  });

  it('requests the hashed-identity JWT contract for sticky memberships', async () => {
    const client = { getOpenIdToken: vi.fn().mockResolvedValue({ access_token: '<synthetic>', token_type: 'Bearer' }) } as unknown as Pick<MatrixClient, 'getOpenIdToken'>;
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: 'wss://sfu.example.test', jwt: 'synthetic.jwt.value' }), { status: 200 }));
    vi.stubGlobal('fetch', request);
    const identity = { userId: '@user:example.test', deviceId: 'DEVICE', memberId: '@user:example.test:DEVICE' };
    const transport = { type: 'livekit' as const, livekit_service_url: 'https://rtc.example.test/jwt' };
    await authorizeGroupCall(client, transport, identity, '!room:example.test', undefined, 'matrix_2_0');
    expect(request).toHaveBeenCalledWith('https://rtc.example.test/jwt/get_token', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(request.mock.calls[0][1].body as string)).toEqual({
      room_id: '!room:example.test', slot_id: 'm.call#ROOM',
      openid_token: { access_token: '<synthetic>', token_type: 'Bearer' },
      member: { id: identity.memberId, claimed_user_id: identity.userId, claimed_device_id: identity.deviceId },
    });
  });
});
