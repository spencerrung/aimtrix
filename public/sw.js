/* global self, caches, fetch, URL, Response */
const CACHE = 'aimtrix-shell-v2';
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
