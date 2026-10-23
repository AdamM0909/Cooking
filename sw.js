// Network first, so updates show up as soon as you are online; falls back to the cache offline.
// Requests bypass the browser's own HTTP cache (GitHub Pages keeps files for 10 minutes), so a new
// version is picked up on the next visit. The version in CACHE_NAME is kept in step by `npm run bump`.
var CACHE_NAME = 'our-kitchen-2026.10.23-3';
var SHELL = ['./', 'index.html', 'assets/style.css', 'assets/lib.js', 'assets/app.js', 'assets/icon.svg',
             'assets/icon-192.png', 'assets/icon-512.png', 'manifest.webmanifest', 'recipes/index.json'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE_NAME).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(new Request(u, { cache: 'reload' })).catch(function () { /* optional file */ }); }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match('index.html'); });
    })
  );
});
