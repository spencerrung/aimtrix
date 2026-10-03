import { OAuth2, type ValidatedAuthMetadata } from 'matrix-js-sdk/lib/oauth/index.js';
import { HTTPError, TokenRefreshLogoutError } from 'matrix-js-sdk/lib/http-api/index.js';
import type { SsoPendingState } from '../platform/platform';

export type DelegatedPendingState = Extract<SsoPendingState, { kind: 'oauth' }>;

function assertSafeProvider(metadata: ValidatedAuthMetadata): void {
  for (const value of [metadata.issuer, metadata.authorization_endpoint, metadata.token_endpoint,
    metadata.registration_endpoint, metadata.revocation_endpoint]) {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('The delegated sign-in provider has an invalid address.'); }
    if (url.username || url.password || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
      throw new Error('The delegated sign-in provider has an unsafe address.');
    }
  }
}

export function readDelegatedCallback(url: URL):
  | { kind: 'code'; code: string; state: string }
  | { kind: 'error'; state: string }
  | { kind: 'invalid' }
  | undefined {
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  const keys = ['code', 'state', 'error'];
  const hasCallback = (params: URLSearchParams) => keys.some((key) => params.has(key));
  const inQuery = hasCallback(url.searchParams);
  const inFragment = hasCallback(fragment);
  if (!inQuery && !inFragment) return undefined;
  if (inQuery && inFragment) return { kind: 'invalid' };
  const params = inQuery ? url.searchParams : fragment;
  const state = params.get('state');
  const code = params.get('code');
  const error = params.get('error');
  if (!state || !/^[A-Za-z0-9_-]{16,128}$/.test(state) || Boolean(code) === Boolean(error)) return { kind: 'invalid' };
  if (code && code.length <= 4096) return { kind: 'code', code, state };
  if (error && /^[A-Za-z0-9_]{1,80}$/.test(error)) return { kind: 'error', state };
  return { kind: 'invalid' };
}

export async function beginDelegatedAuth({
  metadata, baseUrl, serverName, redirectUri, clientUri, clientName, native,
}: {
  metadata: ValidatedAuthMetadata;
  baseUrl: string;
  serverName: string;
  redirectUri: string;
  clientUri: string;
  clientName: string;
  native: boolean;
}): Promise<{ pending: DelegatedPendingState; authorizationUrl: string }> {
  assertSafeProvider(metadata);
  const clientId = await OAuth2.registerClient(metadata, {
    client_uri: clientUri,
    client_name: clientName,
    application_type: native ? 'native' : 'web',
    redirect_uris: [redirectUri],
  });
  const oauth = new OAuth2(metadata, { clientId, redirectUri });
  const state = crypto.randomUUID();
  const authorizationUrl = await oauth.generateAuthorizationCodeGrantUrl(state, native ? 'query' : 'fragment');
  return {
    authorizationUrl,
    pending: {
      kind: 'oauth', baseUrl, serverName, clientId,
      codeVerifier: oauth.context.codeVerifier, deviceId: oauth.context.deviceId,
      issuer: metadata.issuer, redirectUri, state,
    },
  };
}

export async function completeDelegatedAuth(pending: DelegatedPendingState, metadata: ValidatedAuthMetadata, code: string) {
  assertSafeProvider(metadata);
  if (metadata.issuer !== pending.issuer) throw new Error('The sign-in provider changed. Start sign-in again.');
  const oauth = new OAuth2(metadata, pending);
  const tokens = await oauth.completeAuthorizationCodeGrant(code);
  if (!tokens.refresh_token) throw new Error('This provider did not grant a renewable session. Start sign-in with a supported provider.');
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
}

export async function refreshDelegatedAuth(pending: Pick<DelegatedPendingState, 'clientId' | 'issuer' | 'redirectUri' | 'deviceId'>,
  metadata: ValidatedAuthMetadata, refreshToken: string) {
  assertSafeProvider(metadata);
  if (metadata.issuer !== pending.issuer) throw new Error('The sign-in provider changed.');
  const oauth = new OAuth2(metadata, pending);
  let tokens;
  try {
    tokens = await oauth.performRefreshTokenGrant(refreshToken);
  } catch (error) {
    if (error instanceof HTTPError && error.httpStatus !== undefined && [400, 401, 403].includes(error.httpStatus)) {
      throw new TokenRefreshLogoutError(new Error('The delegated session was rejected.'));
    }
    throw error;
  }
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? refreshToken,
    expiry: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : undefined };
}

export async function revokeDelegatedAuth(pending: Pick<DelegatedPendingState, 'clientId' | 'issuer' | 'redirectUri' | 'deviceId'>,
  metadata: ValidatedAuthMetadata, refreshToken: string): Promise<void> {
  assertSafeProvider(metadata);
  if (metadata.issuer !== pending.issuer) return;
  try {
    await new OAuth2(metadata, pending).revokeToken(refreshToken, 'refresh_token');
  } catch (error) {
    // RFC 7009 permits an empty success body; the SDK currently parses it as JSON.
    if (!(error instanceof SyntaxError)) throw error;
  }
}
