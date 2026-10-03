/* global AbortSignal, fetch */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { command, freePort, invariant, until } from './stack.mjs';

const livekitImage = 'livekit/livekit-server:v1.13.4@sha256:189f7c81b704a36642bc5c7e2d3e1ae83744627c11978a23a251bf19fbec64e0';
const base64url = (value) => Buffer.from(value).toString('base64url');
const roomAlias = (roomId) => createHash('sha256').update(JSON.stringify([roomId, 'm.call#ROOM'])).digest('base64').replace(/=+$/, '');

async function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
}

export async function startRtcStack(stack, roomId) {
  const directory = await mkdtemp(join(tmpdir(), 'aimtrix-rtc-'));
  const name = `${stack.project}-livekit`;
  const port = await freePort();
  const tcpPort = await freePort();
  const secret = randomBytes(32).toString('hex');
  const uid = process.getuid();
  const gid = process.getgid();
  invariant(uid > 0 && gid > 0, 'rtc-owner');
  const origin = `ws://127.0.0.1:${port}`;
  const keyId = 'devkey';
  let containerId;
  let server;

  const respond = (response, status, data) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': stack.origins.app, 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' });
    response.end(JSON.stringify(data));
  };
  const stop = async () => {
    const results = await Promise.allSettled([
      new Promise((resolve) => server?.listening ? server.close(resolve) : resolve()),
      containerId ? command('docker', ['rm', '--force', containerId]) : Promise.resolve(),
    ]);
    await rm(directory, { recursive: true, force: true });
    invariant(results.every((result) => result.status === 'fulfilled'), 'rtc-cleanup');
  };

  try {
    const config = `port: ${port}\nbind_addresses:\n  - 127.0.0.1\nrtc:\n  tcp_port: ${tcpPort}\n  port_range_start: 50100\n  port_range_end: 50200\n  use_external_ip: false\nkeys:\n  ${keyId}: ${secret}\nroom:\n  auto_create: true\n`;
    const configPath = join(directory, 'livekit.yaml');
    await writeFile(configPath, config, { mode: 0o600 });
    await command('docker', ['pull', livekitImage]);
    const owner = process.env.AIMTRIX_LIVE_OWNER || stack.project;
    containerId = await command('docker', ['run', '--detach', '--network', 'host', '--name', name, '--label', `dev.aimtrix.test-owner=${owner}`, '--user', `${uid}:${gid}`, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--log-driver', 'none', '--tmpfs', `/tmp:uid=${uid},gid=${gid},mode=0700`, '--mount', `type=bind,src=${configPath},dst=/etc/livekit.yaml,readonly`, livekitImage, '--dev', '--config', '/etc/livekit.yaml']);
    await until(() => portOpen(port), 'livekit-readiness', 45000);

    server = createServer(async (request, response) => {
      if (request.method === 'OPTIONS') { respond(response, 204, {}); return; }
      if (request.method !== 'POST' || request.url !== '/sfu/get') { respond(response, 404, {}); return; }
      try {
        let raw = '';
        for await (const chunk of request) { raw += chunk; if (raw.length > 8192) throw new Error('too-large'); }
        const body = JSON.parse(raw);
        if (body.room !== roomId || body.openid_token?.matrix_server_name !== 'aimtrix.test' || typeof body.device_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(body.device_id)) throw new Error('invalid-request');
        const token = body.openid_token.access_token;
        if (typeof token !== 'string' || token.length > 4096) throw new Error('invalid-token');
        const userinfo = await fetch(`${stack.origins.synapse}/_matrix/federation/v1/openid/userinfo?access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(5000) });
        if (!userinfo.ok) throw new Error('invalid-openid');
        const { sub } = await userinfo.json();
        if (!['@alice:aimtrix.test', '@bob:aimtrix.test'].includes(sub)) throw new Error('invalid-subject');
        const now = Math.floor(Date.now() / 1000);
        const subject = `${sub}:${body.device_id}`;
        const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
        const payload = base64url(JSON.stringify({ iss: keyId, sub: subject, nbf: now - 10, exp: now + 600, video: { room: roomAlias(roomId), roomJoin: true, canPublish: true, canSubscribe: true } }));
        const input = `${header}.${payload}`;
        const signature = createHmac('sha256', secret).update(input).digest('base64url');
        respond(response, 200, { url: origin, jwt: `${input}.${signature}` });
      } catch { respond(response, 403, { errcode: 'M_FORBIDDEN' }); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return { origin, authOrigin: `http://127.0.0.1:${server.address().port}`, stop };
  } catch (error) { await stop(); throw error; }
}
