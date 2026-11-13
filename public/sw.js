// Service worker: site abre rápido e funciona com internet instável.
// API nunca é cacheada (horários precisam estar sempre atualizados).
const VERSION = 'v1';
const CACHE = `olivers-${VERSION}`;
const CORE = ['/', '/conta', '/css/base.css', '/css/home.css', '/css/booking.css', '/css/account.css',
  '/js/core.js', '/js/home.js', '/js/booking.js', '/js/account.js', '/img/logo.jpg', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  // Imagens: cache primeiro. Páginas, CSS e JS: rede primeiro, cache se offline.
  if (url.pathname.startsWith('/img/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => put(e.request, res))));
    return;
  }
  e.respondWith(fetch(e.request).then((res) => put(e.request, res)).catch(() => caches.match(e.request).then((hit) => hit || caches.match('/'))));
});

function put(req, res) {
  if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
  return res;
}
