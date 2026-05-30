const CACHE_NAME = 'astral-v2';
const ASSETS = [
  './',
  './index.html',
  './chat.html',
  './landing.html',
  './manifest.json',
  './styles/index.css',
  './styles/response-style.css',
  './scripts/brain.js',
  './scripts/apifree.min.js',
  './img/logo.jpg',
  './img/icon-192.png',
  './img/icon-512.png'
];

// Install: cache all core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: serve from cache, fall back to network
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Don't intercept API calls or auth
  if (
    url.includes('googleapis.com/oauth2') ||
    url.includes('accounts.google.com') ||
    url.includes('onrender.com') ||
    url.includes('cdn.jsdelivr.net')
  ) {
    return;
  }

  // Google Fonts: cache-first (they rarely change)
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(() => cached); // serve stale if network fails
        })
      )
    );
    return;
  }

  // Everything else: cache-first, network fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        // Cache new valid responses for app assets
        if (
          response &&
          response.status === 200 &&
          response.type === 'basic'
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // Offline fallback for HTML pages
      if (event.request.destination === 'document') {
        return caches.match('./chat.html') || caches.match('./index.html');
      }
    })
  );
});

// Notify all open clients when connectivity changes (triggered from network events)
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
