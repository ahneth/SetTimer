/* ==========================================================================
   SetTimer - Progressive Web App Service Worker (sw.js)
   Required by Android Chrome WebAPK installer so "Install App" / "Add to Home
   Screen" installs and opens SetTimer as a standalone Android App without
   "Could not open app" launch errors.
   ========================================================================== */

const CACHE_NAME = 'settimer-pwa-cache-v2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './storage.js',
  './dragdrop.js',
  './excel.js',
  './timer.js',
  './app.js',
  './manifest.json',
  './favicon.ico',
  './favicon.png',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS_TO_CACHE).catch(function () {
        // Ignore individual asset cache failures on first load
      });
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return null;
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(function (cachedResponse) {
      const fetchPromise = fetch(event.request)
        .then(function (networkResponse) {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(function () {
          if (cachedResponse) return cachedResponse;
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html') || caches.match('./');
          }
          return cachedResponse;
        });

      return cachedResponse || fetchPromise;
    })
  );
});
