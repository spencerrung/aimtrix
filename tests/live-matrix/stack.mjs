/* global AbortSignal, fetch */
import { setTimeout, clearTimeout } from 'node:timers';
import process from 'node:process';
import { randomBytes, createHmac } from 'node:crypto';
import { mkdtemp, mkdir, chmod, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

export const images = {
  synapse: 'ghcr.io/element-hq/synapse:v1.160.0@sha256:78de1d10bef02e375f861d1cc99f8bedd9381d4f9083ea8b2c22a053477b205f',
  dex: 'ghcr.io/dexidp/dex:v2.45.1@sha256:8499afd690c437f52301efd2b05b2455da5bd2dfc20332cd697dc9937f808462',
};
export const secret = () => randomBytes(24).toString('hex');
export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function invariant(condition, code) { if (!condition) throw new Error(code); }
export async function until(check, code, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await pause(250); }
  throw new Error(code);
}
// Never forward subprocess output: even disposable server logs can contain tokens.
export function command(binary, args, { input, timeout = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let bytes = 0;
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('subprocess-timeout')); }, timeout);
    child.stdout.on('data', (chunk) => { bytes += chunk.length; if (bytes < 1024 * 1024) stdout += chunk; });
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timer); reject(new Error('subprocess-start')); });
    child.on('close', (code) => { clearTimeout(timer); if (code === 0) resolve(stdout.trim()); else reject(new Error('subprocess-exit')); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}
export async function createStack() {
  const directory = await mkdtemp(join(tmpdir(), 'aimtrix-matrix-'));
  const project = `aimtrix-matrix-${randomBytes(6).toString('hex')}`;
  const ports = { synapse: await freePort(), dex: await freePort(), app: await freePort() };
  invariant(new Set(Object.values(ports)).size === 3, 'port-allocation');
  const origins = Object.fromEntries(Object.entries(ports).map(([key, port]) => [key, `http://127.0.0.1:${port}`]));
  const credentials = { password: secret(), registration: secret(), oidc: secret() };
  const configDirectory = join(directory, 'config');
  await mkdir(configDirectory, { mode: 0o755 });
  await chmod(configDirectory, 0o755);
  const owner = process.env.AIMTRIX_LIVE_OWNER || project;
  invariant(/^[a-zA-Z0-9-]{1,100}$/.test(owner), 'test-owner');
  const uid = Number(process.env.AIMTRIX_LIVE_UID || 1000);
  invariant(Number.isInteger(uid) && uid > 0 && uid <= 65535, 'test-uid');
  const composePath = join(directory, 'compose.json');
  let prepared = false;
  const compose = (...args) => command('docker', ['compose', '--project-name', project, '--file', composePath, ...args]);
  const write = async (name, value) => {
    const target = name === 'compose.json' ? composePath : join(configDirectory, name);
    await writeFile(target, JSON.stringify(value, null, 2), { mode: 0o600 });
    // Preserve host privacy through the 0700 parent; support services with another
    // UID even on hosts using umask 077. Docker binds only the readable child.
    if (name !== 'compose.json') await chmod(target, 0o444);
  };
  const stack = { directory, project, origins, credentials, compose };
  stack.stop = async () => {
    try {
      const removeHashHelper = async () => {
        const ids = await command('docker', ['ps', '-aq', '--filter', `name=^/${project}-hash$`]);
        if (ids) await command('docker', ['rm', '--force', ...ids.split('\n')]);
      };
      const results = await Promise.allSettled([prepared ? compose('down', '--volumes', '--remove-orphans', '--timeout', '5') : Promise.resolve(), removeHashHelper()]);
      invariant(results.every((result) => result.status === 'fulfilled'), 'service-cleanup');
      invariant(!(await command('docker', ['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`])), 'container-cleanup');
      invariant(!(await command('docker', ['network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`])), 'network-cleanup');
    } finally { await rm(directory, { recursive: true, force: true }); }
  };
  stack.start = async () => {
    await command('docker', ['version', '--format', '{{.Server.Version}}']);
    // Pull before hashing: Python/bcrypt comes from the pinned Synapse image.
    await command('docker', ['pull', images.synapse]);
    await command('docker', ['pull', images.dex]);
    const hash = await command('docker', ['run', '--rm', '-i', '--network', 'none', '--log-driver', 'none', '--label', `dev.aimtrix.test-owner=${owner}`, '--name', `${project}-hash`, '--user', `${uid}:${uid}`, '--entrypoint', 'python', images.synapse, '-c', 'import bcrypt,sys; print(bcrypt.hashpw(sys.stdin.buffer.read(), bcrypt.gensalt()).decode())'], { input: credentials.password });
    await write('logging.json', { version: 1, disable_existing_loggers: true, handlers: { discard: { class: 'logging.NullHandler' } }, root: { level: 'CRITICAL', handlers: ['discard'] } });
    await write('synapse.json', {
      server_name: 'aimtrix.test', public_baseurl: `${origins.synapse}/`, report_stats: false,
      pid_file: '/data/homeserver.pid', signing_key_path: '/data/signing.key', media_store_path: '/data/media',
      database: { name: 'sqlite3', args: { database: '/data/homeserver.db' } },
      // Reload journeys need a fresh initial snapshot, not replay of cached
      // incremental sync responses from this same disposable device.
      caches: { sync_response_cache_duration: '0s' },
      log_config: '/config/logging.json', enable_registration: false, registration_shared_secret: credentials.registration,
      macaroon_secret_key: secret(), form_secret: secret(), trusted_key_servers: [], federation_domain_whitelist: [],
      listeners: [{ port: 8008, type: 'http', tls: false, bind_addresses: ['0.0.0.0'], resources: [{ names: ['client'], compress: false }] }],
      rc_message: { per_second: 100, burst_count: 1000 }, rc_login: { address: { per_second: 100, burst_count: 1000 }, account: { per_second: 100, burst_count: 1000 } },
      suppress_key_server_warning: true, url_preview_enabled: false,
      sso: { client_whitelist: [`${origins.app}/`] },
      oidc_providers: [{ idp_id: 'dex', idp_name: 'Disposable test SSO', discover: false, skip_verification: true,
        issuer: `${origins.dex}/dex`, client_id: 'aimtrix-test', client_secret: credentials.oidc,
        authorization_endpoint: `${origins.dex}/dex/auth`, token_endpoint: 'http://dex:5556/dex/token',
        jwks_uri: 'http://dex:5556/dex/keys', userinfo_endpoint: 'http://dex:5556/dex/userinfo',
        scopes: ['openid', 'profile', 'email'], user_mapping_provider: { config: { localpart_template: '{{ user.name }}', display_name_template: '{{ user.name }}' } },
      }],
    });
    await write('dex.json', {
      issuer: `${origins.dex}/dex`, storage: { type: 'sqlite3', config: { file: '/data/dex.db' } },
      web: { http: '0.0.0.0:5556' }, logger: { level: 'error', format: 'json' },
      oauth2: { skipApprovalScreen: true }, enablePasswordDB: true,
      staticClients: [{ id: 'aimtrix-test', name: 'Aimtrix disposable test', secret: credentials.oidc, redirectURIs: [`${origins.synapse}/_synapse/client/oidc/callback`] }],
      staticPasswords: [{ email: 'sso@aimtrix.test', hash, username: 'sso', userID: 'aimtrix-disposable-sso' }],
    });
    const isolation = { labels: { 'dev.aimtrix.test-owner': owner }, user: `${uid}:${uid}`, read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], logging: { driver: 'none' },
      tmpfs: [`/data:uid=${uid},gid=${uid},mode=0700`, `/tmp:uid=${uid},gid=${uid},mode=0700`],
      volumes: [{ type: 'bind', source: configDirectory, target: '/config', read_only: true }], networks: ['test'],
    };
    await write('compose.json', { services: {
      dex: { ...isolation, image: images.dex, command: ['dex', 'serve', '/config/dex.json'], ports: [`127.0.0.1:${ports.dex}:5556`] },
      synapse: { ...isolation, image: images.synapse, entrypoint: ['python', '-m', 'synapse.app.homeserver'], command: ['-c', '/config/synapse.json'], ports: [`127.0.0.1:${ports.synapse}:8008`] },
    }, networks: { test: { driver: 'bridge', labels: { 'dev.aimtrix.test-owner': owner } } } });
    prepared = true;
    await compose('up', '--detach');
    await until(async () => {
      try { return (await fetch(`${origins.synapse}/health`, { signal: AbortSignal.timeout(2000) })).ok && (await fetch(`${origins.dex}/dex/.well-known/openid-configuration`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
    }, 'stack-readiness', 60000);
    const ids = (await compose('ps', '-q')).split('\n');
    invariant(ids.length === 2, 'service-count');
    for (const id of ids) {
      const [info] = JSON.parse(await command('docker', ['inspect', id]));
      invariant(info.HostConfig.CapDrop?.includes('ALL') && info.HostConfig.SecurityOpt?.includes('no-new-privileges:true'), 'container-capabilities');
      invariant(info.Config.User === `${uid}:${uid}` && info.HostConfig.ReadonlyRootfs && info.HostConfig.LogConfig.Type === 'none', 'container-isolation');
      invariant(Object.values(info.NetworkSettings.Ports).flat().filter(Boolean).every((binding) => binding.HostIp === '127.0.0.1'), 'loopback-bindings');
    }
  };
  return stack;
}
export function matrixApi(stack) {
  return async (path, { token, method = 'GET', body, status = 200, binary = false } = {}) => {
    invariant(path.startsWith('/_matrix/') || path.startsWith('/_synapse/'), 'api-path');
    const response = await fetch(`${stack.origins.synapse}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    invariant(response.status === status, 'matrix-http-status');
    return binary ? new Uint8Array(await response.arrayBuffer()) : response.json();
  };
}
export async function register(api, stack, username) {
  const { nonce } = await api('/_synapse/admin/v1/register');
  const mac = createHmac('sha1', stack.credentials.registration).update([nonce, username, stack.credentials.password, 'notadmin'].join('\0')).digest('hex');
  return api('/_synapse/admin/v1/register', { method: 'POST', body: { nonce, username, password: stack.credentials.password, admin: false, mac, displayname: username } });
}
