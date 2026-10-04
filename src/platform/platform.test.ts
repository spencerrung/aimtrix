import { expect, it } from 'vitest';
import { nativeSsoCallbackPath, parseSsoPendingState } from './platform';

const oauth = {
  kind: 'oauth',
  baseUrl: 'https://matrix.example.test',
  serverName: 'example.test',
  clientId: 'public-client',
  codeVerifier: 'A'.repeat(64),
  deviceId: 'AIMTRIXDEVICE',
  issuer: 'https://auth.example.test',
  redirectUri: 'https://app.example.test/',
  state: 'B'.repeat(24),
};

it('accepts complete OAuth callback context and existing legacy SSO context', () => {
  expect(parseSsoPendingState(oauth)).toEqual(oauth);
  expect(parseSsoPendingState({ baseUrl: oauth.baseUrl, serverName: oauth.serverName })).toEqual({
    baseUrl: oauth.baseUrl, serverName: oauth.serverName,
  });
});

it('discards incomplete or unsafe OAuth callback context', () => {
  expect(parseSsoPendingState({ ...oauth, codeVerifier: undefined })).toBeUndefined();
  expect(parseSsoPendingState({ ...oauth, state: 'short' })).toBeUndefined();
  expect(parseSsoPendingState({ ...oauth, baseUrl: 'http://remote.example.test' })).toBeUndefined();
  expect(parseSsoPendingState({ ...oauth, issuer: 'https://user:password@auth.example.test' })).toBeUndefined();
  expect(parseSsoPendingState({ ...oauth, redirectUri: 'javascript:alert(1)' })).toBeUndefined();
});

it('accepts only the native SSO callback destination with one unambiguous result', () => {
  expect(nativeSsoCallbackPath(new URL(`aimtrix://sso?code=synthetic-code&state=${oauth.state}`)))
    .toBe(`/?code=synthetic-code&state=${oauth.state}`);
  expect(nativeSsoCallbackPath(new URL(`aimtrix://sso#code=synthetic-code&state=${oauth.state}`)))
    .toBe(`/?code=synthetic-code&state=${oauth.state}`);
  expect(nativeSsoCallbackPath(new URL('aimtrix://sso?loginToken=synthetic-token')))
    .toBe('/?loginToken=synthetic-token');
  expect(nativeSsoCallbackPath(new URL(`aimtrix://sso?error=access_denied&state=${oauth.state}`)))
    .toBe(`/?error=access_denied&state=${oauth.state}`);
  expect(nativeSsoCallbackPath(new URL(`aimtrix://open?code=synthetic-code&state=${oauth.state}`))).toBeUndefined();
  expect(nativeSsoCallbackPath(new URL(`https://example.test/?code=synthetic-code&state=${oauth.state}`))).toBeUndefined();
  expect(nativeSsoCallbackPath(new URL(`aimtrix://sso?code=a&state=${oauth.state}#code=b&state=${oauth.state}`))).toBeUndefined();
  expect(nativeSsoCallbackPath(new URL(`aimtrix://sso?code=first&code=second&state=${oauth.state}`))).toBeUndefined();
  expect(nativeSsoCallbackPath(new URL(`aimtrix://sso?code=first&state=${oauth.state}&state=${oauth.state}`))).toBeUndefined();
  expect(nativeSsoCallbackPath(new URL('aimtrix://sso?loginToken=first&loginToken=second'))).toBeUndefined();
  expect(nativeSsoCallbackPath(new URL(`aimtrix://sso?loginToken=synthetic-token&code=synthetic-code&state=${oauth.state}`))).toBeUndefined();
  expect(nativeSsoCallbackPath(new URL(`aimtrix://sso?loginToken=synthetic-token&error=access_denied&state=${oauth.state}`))).toBeUndefined();
  expect(nativeSsoCallbackPath(new URL(`aimtrix://sso?code=&error=access_denied&state=${oauth.state}`))).toBeUndefined();
});
