/* global URL, Response, console */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const listeners = new Map();
const notifications = [];
const messages = [];
const client = {
  focus: async () => undefined,
  postMessage: (message) => messages.push(message),
};
const self = {
  location: { origin: 'https://aimtrix.example' },
  addEventListener: (type, listener) => listeners.set(type, listener),
  clients: {
    matchAll: async () => [client],
    openWindow: async () => undefined,
  },
  registration: {
    showNotification: async (title, options) => notifications.push({ title, options }),
  },
  skipWaiting: async () => undefined,
};
const sandbox = {
  self,
  caches: { keys: async () => [], open: async () => ({ cache: async () => undefined }) },
  fetch: async () => ({ ok: true, clone: () => ({}) }),
  URL,
  Response,
  encodeURIComponent,
  Promise,
};

vm.runInNewContext(fs.readFileSync('public/sw.js', 'utf8'), sandbox, { filename: 'public/sw.js' });

const pushWaits = [];
await listeners.get('push')({
  data: {
    json: () => ({
      room_id: '!room:example.org',
      event_id: '$event/1',
      content: { body: 'private plaintext must not be displayed' },
    }),
  },
  waitUntil: (promise) => pushWaits.push(promise),
});
await Promise.all(pushWaits);

assert.equal(notifications[0].title, 'Aimtrix');
assert.equal(notifications[0].options.body, 'New Matrix activity');
assert.equal(JSON.stringify(notifications[0].options.data), JSON.stringify({
  roomId: '!room:example.org',
  eventId: '$event/1',
  url: '/?room=%21room%3Aexample.org&event=%24event%2F1',
}));
assert.equal(Object.hasOwn(notifications[0].options, 'content'), false);

const clickWaits = [];
await listeners.get('notificationclick')({
  notification: {
    data: notifications[0].options.data,
    close: () => undefined,
  },
  waitUntil: (promise) => clickWaits.push(promise),
});
await Promise.all(clickWaits);

assert.equal(JSON.stringify(messages), JSON.stringify([{
  type: 'AIMTRIX_PUSH_ROUTE',
  roomId: '!room:example.org',
  eventId: '$event/1',
}]));
console.log('Service-worker push proof passed: generic notification and opaque route only.');
