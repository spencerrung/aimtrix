import { afterEach, expect, it, vi } from 'vitest';
import type { ValidatedAuthMetadata } from 'matrix-js-sdk/lib/oauth/index.js';
import { TokenRefreshLogoutError } from 'matrix-js-sdk/lib/http-api/index.js';
import { beginDelegatedAuth, completeDelegatedAuth, readDelegatedCallback, refreshDelegatedAuth, revokeDelegatedAuth } from './delegatedAuth';

const metadata: ValidatedAuthMetadata = {
  issuer: 'https://auth.example.test',
  authorization_endpoint: 'https://auth.example.test/authorize',
  token_endpoint: 'https://auth.example.test/token',
  revocation_endpoint: 'https://auth.example.test/revoke',
  registration_endpoint: 'https://auth.example.test/register',
  response_modes_supported: ['query', 'fragment'],
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
};

afterEach(() => vi.unstubAllGlobals());

it('accepts one code or denial and rejects ambiguous delegated callbacks', () => {
  const state = 'A'.repeat(24);
  expect(readDelegatedCallback(new URL(`https://app.example.test/?code=one&state=${state}`)))
    .toEqual({ kind: 'code', code: 'one', state });
  expect(readDelegatedCallback(new URL(`https://app.example.test/#error=access_denied&state=${state}`)))
    .toEqual({ kind: 'error', state });
  expect(readDelegatedCallback(new URL(`https://app.example.test/?code=one&state=${state}#code=two&state=${state}`)))
    .toEqual({ kind: 'invalid' });
  expect(readDelegatedCallback(new URL('https://app.example.test/?code=one&state=short')))
    .toEqual({ kind: 'invalid' });
  expect(readDelegatedCallback(new URL('https://app.example.test/#/room'))).toBeUndefined();
});

it('registers a public client and creates a PKCE authorization URL without exposing the verifier', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe(metadata.registration_endpoint);
    expect(init?.method).toBe('POST');
    return new Response(JSON.stringify({ client_id: 'public-client' }), { status: 201 });
  });
  vi.stubGlobal('fetch', fetcher);
  const result = await beginDelegatedAuth({
    metadata, baseUrl: 'https://matrix.example.test', serverName: 'example.test',
    redirectUri: 'https://app.example.test/', clientUri: 'https://app.example.test/',
    clientName: 'Aimtrix', native: false,
  });
  const url = new URL(result.authorizationUrl);
  expect(url.origin).toBe('https://auth.example.test');
  expect(url.searchParams.get('response_mode')).toBe('fragment');
  expect(url.searchParams.get('state')).toBe(result.pending.state);
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(result.authorizationUrl).not.toContain(result.pending.codeVerifier);
  expect(result.pending.codeVerifier.length).toBeGreaterThanOrEqual(43);
  expect(result.pending.deviceId).toBeTruthy();
  const registration = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
  expect(registration).toMatchObject({ application_type: 'web', redirect_uris: ['https://app.example.test/'] });
});

it('exchanges a code with the exact stored verifier and rotates and revokes delegated tokens', async () => {
  const requests: Array<{ url: string; body: URLSearchParams }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === metadata.registration_endpoint) {
      return new Response(JSON.stringify({ client_id: 'public-client' }), { status: 201 });
    }
    const body = new URLSearchParams(init?.body as string);
    requests.push({ url, body });
    if (url === metadata.revocation_endpoint) return new Response('', { status: 200 });
    return new Response(JSON.stringify({
      access_token: requests.length === 1 ? 'synthetic-access-1' : 'synthetic-access-2',
      refresh_token: requests.length === 1 ? 'synthetic-refresh-1' : 'synthetic-refresh-2',
      token_type: 'Bearer', expires_in: 3600,
    }), { status: 200 });
  }));
  const { pending } = await beginDelegatedAuth({
    metadata, baseUrl: 'https://matrix.example.test', serverName: 'example.test',
    redirectUri: 'https://app.example.test/', clientUri: 'https://app.example.test/',
    clientName: 'Aimtrix', native: false,
  });
  const exchanged = await completeDelegatedAuth(pending, metadata, 'synthetic-code');
  expect(exchanged).toEqual({ accessToken: 'synthetic-access-1', refreshToken: 'synthetic-refresh-1' });
  expect(requests[0]?.url).toBe(metadata.token_endpoint);
  expect(requests[0]?.body.get('grant_type')).toBe('authorization_code');
  expect(requests[0]?.body.get('code_verifier')).toBe(pending.codeVerifier);
  expect(requests[0]?.body.get('redirect_uri')).toBe(pending.redirectUri);
  const renewed = await refreshDelegatedAuth(pending, metadata, exchanged.refreshToken);
  expect(renewed).toMatchObject({ accessToken: 'synthetic-access-2', refreshToken: 'synthetic-refresh-2' });
  expect(requests[1]?.body.get('grant_type')).toBe('refresh_token');
  expect(requests[1]?.body.get('refresh_token')).toBe('synthetic-refresh-1');
  await revokeDelegatedAuth(pending, metadata, renewed.refreshToken);
  expect(requests[2]?.url).toBe(metadata.revocation_endpoint);
  expect(requests[2]?.body.get('token')).toBe('synthetic-refresh-2');
  expect(requests[2]?.body.get('token_type_hint')).toBe('refresh_token');
});

it('rejects changed issuers before sending a code or refresh token', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const pending = {
    kind: 'oauth' as const, baseUrl: 'https://matrix.example.test', serverName: 'example.test',
    clientId: 'public-client', codeVerifier: 'A'.repeat(64), deviceId: 'SYNTHETIC',
    issuer: 'https://other.example.test', redirectUri: 'https://app.example.test/', state: 'B'.repeat(32),
  };
  await expect(completeDelegatedAuth(pending, metadata, 'synthetic-code')).rejects.toThrow(/provider changed/);
  await expect(refreshDelegatedAuth(pending, metadata, 'synthetic-refresh')).rejects.toThrow(/provider changed/);
  expect(fetcher).not.toHaveBeenCalled();
});

it('rejects unsafe provider endpoints before registration or token exchange', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(beginDelegatedAuth({ metadata: { ...metadata, authorization_endpoint: 'javascript:alert(1)' },
    baseUrl: 'https://matrix.example.test', serverName: 'example.test',
    redirectUri: 'https://app.example.test/', clientUri: 'https://app.example.test/',
    clientName: 'Aimtrix', native: false })).rejects.toThrow(/unsafe address/);
  expect(fetcher).not.toHaveBeenCalled();
});

it('marks a rejected refresh credential as terminal but leaves provider outages retryable', async () => {
  const pending = {
    kind: 'oauth' as const, baseUrl: 'https://matrix.example.test', serverName: 'example.test',
    clientId: 'public-client', codeVerifier: 'A'.repeat(64), deviceId: 'SYNTHETIC',
    issuer: metadata.issuer, redirectUri: 'https://app.example.test/', state: 'B'.repeat(32),
  };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 400 }))
    .mockResolvedValueOnce(new Response('', { status: 503 })));
  await expect(refreshDelegatedAuth(pending, metadata, 'synthetic-refresh'))
    .rejects.toBeInstanceOf(TokenRefreshLogoutError);
  await expect(refreshDelegatedAuth(pending, metadata, 'synthetic-refresh'))
    .rejects.toMatchObject({ httpStatus: 503 });
});
