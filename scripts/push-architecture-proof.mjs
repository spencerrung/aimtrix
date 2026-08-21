/* global Buffer, console, fetch */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const received = [];
const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/_matrix/push/v1/notify') {
    response.writeHead(404).end();
    return;
  }

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ rejected: [] }));
});

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The proof gateway did not bind to a TCP port.');

  const payload = {
    notification: {
      id: 'proof-notification-1',
      room_id: '!private-room:example.org',
      event_id: '$encrypted-event:example.org',
      type: 'm.room.encrypted',
      counts: { unread: 1, missed_calls: 0 },
      devices: [{
        app_id: 'dev.alucard.aimtrix',
        pushkey: 'disposable-proof-pushkey',
        data: { format: 'event_id_only' },
      }],
    },
  };
  const response = await fetch(`http://127.0.0.1:${address.port}/_matrix/push/v1/notify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { rejected: [] });
  assert.equal(received.length, 1);
  assert.equal(received[0].notification.type, 'm.room.encrypted');
  assert.equal(received[0].notification.event, undefined);
  assert.equal(received[0].notification.access_token, undefined);
  assert.equal(JSON.stringify(received[0]).includes('content'), false);
  assert.equal(JSON.stringify(received[0]).includes('access_token'), false);
  console.log('Push architecture proof passed: event_id_only contains no content or access_token.');
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
