/* ==========================================================================
   SetTimer - Progressive Web App Service Worker (sw.js)
   Required by Android Chrome WebAPK installer so "Install App" / "Add to Home
   Screen" installs and opens SetTimer as a standalone Android App without
   "Could not open app" launch errors.
   ========================================================================== */

const CACHE_NAME = 'settimer-pwa-cache-v3';
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
      return Promise.all(
        ASSETS_TO_CACHE.map(function (assetUrl) {
          return cache.add(assetUrl).catch(function () {
            return null;
          });
        })
      );
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

  let requestUrl;
  try {
    requestUrl = new URL(event.request.url);
  } catch (e) {
    return;
  }

  // Only handle same-origin requests; let external CDNs pass through directly
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(function (networkResponse) {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(function () {
        return caches.match(event.request, { ignoreSearch: true })
          .then(function (cachedResponse) {
            if (cachedResponse) return cachedResponse;
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html', { ignoreSearch: true })
                .then(function (indexRes) {
                  return indexRes || caches.match('./', { ignoreSearch: true });
                });
            }
            return null;
          })
          .then(function (fallbackResponse) {
            return fallbackResponse || new Response('Offline', {
              status: 503,
              statusText: 'Offline',
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
          });
      })
  );
});
