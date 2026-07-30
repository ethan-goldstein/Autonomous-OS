// Service worker for the installed app.
//
// Scope is deliberately narrow: cache the built shell so launching from the
// home-screen icon is instant, and get out of the way for everything else.
//
// NEVER cache /api/*, /files/* or /events. Those are live agent data behind a
// session cookie — caching an authenticated response would both show stale
// numbers and leave private data sitting in the cache after logout.
const CACHE = 'core-shell-v2'; // bump to purge an old cached bundle
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  // Live/private surfaces: straight to network, never cached.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/') || url.pathname === '/events') return;

  // Navigation: network first so a rebuild is picked up immediately, falling
  // back to the cached shell only when genuinely offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || Response.error()))
    );
    return;
  }

  // Hashed build assets are immutable — cache-first is safe and fast.
  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit || fetch(e.request).then((res) => {
        if (res.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/'))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
    )
  );
});
