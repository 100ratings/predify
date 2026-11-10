const CACHE = 'predify-shell-1.3.10-20261110220357361';
const FILES = ['./', './index.html', './style.css', './app.js', './engine.js', './catalog-search.js', './catalog-import.js', './catalog-actions.js', './inject.js', './remote.js', './diagnostics.js', './playlist-cache.js', './keep-awake.js', './playlist-cover.js', './viewport.js', './zoom.js', './updates.js', './version.js', './spotify.js', './suggestions.js', './manifest.webmanifest', './icons/icon.svg', './icons/favicon-32x32.png', './icons/favicon-16x16.png', './icons/aleatoriedades-demian.webp', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(path => new Request(new URL(path, self.registration.scope), { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('predify-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  if (url.pathname === new URL('./version.json', self.registration.scope).pathname) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request, { cache: 'no-cache' }).catch(() => caches.match(new URL('./index.html', self.registration.scope))));
    return;
  }
  if (!FILES.some(path => new URL(path, self.registration.scope).pathname === url.pathname)) return;
  event.respondWith(fetch(event.request, { cache: 'no-cache' }).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)));  }
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || caches.match(new URL(url.pathname, self.location.origin)))));
});
