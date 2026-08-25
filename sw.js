// Show of Force service worker.
//
// - navigations: network-first so new deploys are picked up immediately,
//   cached shell as offline fallback
// - hashed build assets (/assets/): cache-first (immutable by filename)
// - everything else (models, icons, manifest): stale-while-revalidate
const VERSION = 'sof-v2';
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, clone));
        }
        return res;
      }).catch(() =>
        caches.match(e.request, { ignoreSearch: true }).then((m) => m ?? caches.match('./index.html'))
      )
    );
    return;
  }

  if (url.pathname.includes('/assets/')) {
    e.respondWith(
      caches.match(e.request).then((cached) => cached ?? fetch(e.request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, clone));
        }
        return res;
      }))
    );
    return;
  }

  // stale-while-revalidate for models, icons, manifest
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const refresh = fetch(e.request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached ?? refresh;
    })
  );
});
