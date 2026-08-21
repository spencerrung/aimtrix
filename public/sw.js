/* global self, caches, fetch, URL, Response */
const CACHE = 'aimtrix-shell-v3';
const SHELL = [
  '/',
  '/aimtrix-mark.svg',
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
  return typeof value === 'string' && pattern.test(value) ? value : undefined;
}

function pushRouteFromPayload(payload) {
  const notification = payload && typeof payload.notification === 'object' ? payload.notification : payload;
  if (!notification || typeof notification !== 'object') return {};
  return {
    roomId: safeRouteValue(notification.room_id ?? notification.roomId, /^!\S{1,255}$/),
    eventId: safeRouteValue(notification.event_id ?? notification.eventId, /^\$\S{1,255}$/),
  };
}

function routeUrl(route) {
  const url = new URL('/', self.location.origin);
  if (route.roomId) url.searchParams.set('room', route.roomId);
  if (route.eventId) url.searchParams.set('event', route.eventId);
  return `${url.pathname}${url.search}`;
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    // Malformed provider data becomes a generic notification with no route.
  }
  const route = pushRouteFromPayload(payload);
  const tag = route.roomId ? `aimtrix-room-${encodeURIComponent(route.roomId)}` : 'aimtrix-matrix';
  event.waitUntil(
    self.registration.showNotification('Aimtrix', {
      body: 'New Matrix activity',
      tag,
      renotify: false,
      data: { ...route, url: routeUrl(route) },
      actions: [{ action: 'open', title: 'Open Aimtrix' }],
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = event.notification.data && typeof event.notification.data === 'object'
    ? pushRouteFromPayload({ notification: event.notification.data })
    : {};
  const url = routeUrl(route);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => 'focus' in client);
      if (existing) {
        existing.postMessage({ type: 'AIMTRIX_PUSH_ROUTE', ...route });
        return existing.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
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
