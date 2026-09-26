/* global URL, Response, console */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const listeners = new Map(), notifications = [], messages = [];
let focused = 0;
let metadata = { owner: 'synthetic-owner-001', policy: { pauseUntil: 0, quietHours: { enabled: false, startMinute: 0, endMinute: 0 } }, seen: [] };
let storageDenied = false;
let ledger = Promise.resolve();
const client = { focus: async () => { focused++; }, postMessage: (message) => messages.push(message) };
const self = {
  location: { origin: 'https://aimtrix.example' },
  addEventListener: (type, listener) => listeners.set(type, listener),
  clients: { matchAll: async () => [client], openWindow: async () => undefined },
  registration: { showNotification: async (title, options) => notifications.push({ title, options }) },
  skipWaiting: async () => undefined,
};
const sandbox = { self, caches: { keys: async () => [], open: async () => ({ cache: async () => undefined }) },
  fetch: async () => ({ ok: true, clone: () => ({}) }), URL, Response, encodeURIComponent, Promise,
  importScripts: (path) => {
    assert.equal(path, '/notification-policy.js');
    vm.runInContext(fs.readFileSync('public/notification-policy.js', 'utf8'), context);
    sandbox.aimtrixNotificationPolicy = { ...sandbox.aimtrixNotificationPolicy, transaction: (change) => {
      const next = ledger.then(() => { if (storageDenied) throw new Error('Synthetic denied metadata'); const changed = change(metadata); metadata = changed.state; return changed.result; });
      ledger = next.catch(() => undefined); return next;
    } };
  },
};
const context = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('public/sw.js', 'utf8'), context, { filename: 'public/sw.js' });
async function emit(type, event) {
  const waits = []; listeners.get(type)({ ...event, waitUntil: (promise) => waits.push(promise) });
  await Promise.all(waits);
}
const payload = { room_id: '!room:example.org', event_id: '$event/1', content: { body: 'Synthetic private content must not be displayed' } };
await Promise.all([emit('push', { data: { json: () => payload } }), emit('push', { data: { json: () => payload } })]);
assert.equal(notifications.length, 1, 'Concurrent deliveries share bounded atomic dedup');
assert.equal(notifications[0].title, 'Aimtrix');
assert.equal(notifications[0].options.body, 'New Matrix activity');
assert.equal(JSON.stringify(notifications[0].options.data), JSON.stringify({ owner: 'synthetic-owner-001', url: '/' }));
assert.equal(JSON.stringify(notifications).includes('private content'), false);
await emit('notificationclick', { notification: { data: notifications[0].options.data, close: () => undefined } });
assert.equal(focused, 1);
assert.deepEqual(messages, [], 'Unproven provider ownership never routes to a conversation');
metadata = { ...metadata, owner: 'synthetic-owner-002' };
await emit('notificationclick', { notification: { data: notifications[0].options.data, close: () => undefined } });
assert.equal(focused, 1, 'Prior-account notifications cannot reopen an account destination');
metadata.policy.pauseUntil = Date.now() + 60000;
await emit('push', { data: { json: () => ({ ...payload, event_id: '$paused' }) } });
assert.equal(notifications.length, 1);
metadata.policy.pauseUntil = 0;
await emit('push', { data: { json: () => ({ ...payload, event_id: '$paused' }) } });
assert.equal(notifications.length, 2, 'A paused event did not consume its dedup slot');
for (const invalidEvent of ['broken', '', null, 42, '$bad\u0000event']) {
  const route = sandbox.pushRouteFromPayload({ room_id: '!room:example.org', event_id: invalidEvent });
  assert.equal(route.roomId, undefined); assert.equal(route.eventId, undefined);
}
metadata = {};
await emit('push', { data: { json: () => ({ ...payload, event_id: '$logged-out' }) } });
assert.equal(notifications.length, 2);
storageDenied = true;
await emit('push', { data: { json: () => payload } });
assert.equal(notifications.length, 2, 'Unknown account/policy cannot bypass local silence');
console.log('Service-worker push proof passed: shared policy, atomic dedup, generic private display, stale-owner rejection, malformed-route rejection.');
