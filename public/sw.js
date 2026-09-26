/* global self, caches, fetch, URL, Response, importScripts */
importScripts('/notification-policy.js');
const CACHE = 'aimtrix-shell-v3';
const SHELL = [
  '/',
  '/aimtrix-mark.svg',
  '/notification-policy.js',
  '/manifest.webmanifest',
  '/icons/aimtrix-192.png',
  '/icons/aimtrix-512.png',
  '/icons/aimtrix-512-maskable.png',
  '/icons/apple-touch-icon.png',
  '/screenshots/aimtrix-desktop.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting();
});

function safeRouteValue(value, pattern) {
  return typeof value === 'string' && !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) && pattern.test(value) ? value : undefined;
}

function pushRouteFromPayload(payload) {
  const notification = payload && typeof payload.notification === 'object' ? payload.notification : payload;
  if (!notification || typeof notification !== 'object') return {};
  const room = Object.hasOwn(notification, 'room_id') ? notification.room_id : notification.roomId;
  const event = Object.hasOwn(notification, 'event_id') ? notification.event_id : notification.eventId;
  const roomId = safeRouteValue(room, /^!\S{1,255}$/);
  const eventId = safeRouteValue(event, /^\$\S{1,255}$/);
  // A malformed explicit target must never become a different destination.
  if (room !== undefined && !roomId || event !== undefined && !eventId) return {};
  return { roomId, eventId };
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    // Malformed provider data becomes a generic notification with no route.
  }
  const route = pushRouteFromPayload(payload);
  event.waitUntil((async () => {
    let owner;
    try {
      owner = await globalThis.aimtrixNotificationPolicy.transaction((state) => {
        if (!state?.owner || globalThis.aimtrixNotificationPolicy.paused(state.policy)) return { state: state ?? {}, result: undefined };
        const claimed = globalThis.aimtrixNotificationPolicy.claim(state.seen ?? [], route.eventId ? `${state.owner}:${route.eventId}` : undefined);
        return { state: { ...state, seen: claimed.seen }, result: claimed.accepted ? state.owner : undefined };
      });
    } catch { return; } // Unknown policy/account: do not bypass local silence.
    if (!owner) return;
    await self.registration.showNotification('Aimtrix', {
      body: 'New Matrix activity',
      tag: `aimtrix-${owner}`,
      renotify: false,
      // Provider identifiers cannot prove which signed-in account they belong to.
      // A provider push can open Aimtrix, never choose a conversation/account.
      data: { owner, url: '/' },
      actions: [{ action: 'open', title: 'Open Aimtrix' }],
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const owner = event.notification.data?.owner;
  event.waitUntil((async () => {
    let current;
    try { current = await globalThis.aimtrixNotificationPolicy.transaction((state) => ({ state: state ?? {}, result: typeof owner === 'string' && state?.owner === owner })); }
    catch { return; }
    if (!current) return;
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = clients.find((client) => 'focus' in client);
    if (existing) return existing.focus();
    return self.clients.openWindow('/');
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname === '/config.json') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/stickers/') ||
    url.pathname.startsWith('/emoji/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/screenshots/')
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }).catch(() => new Response('', { status: 503, statusText: 'Offline' })),
      ),
    );
  }
});
