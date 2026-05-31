const CACHE_NAME = 'astral-v3';

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

// Install: cache each asset individually so one failure doesn't kill the whole install
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(
        ASSETS.map(url =>
          cache.add(url).catch(() => {
            // Log but don't abort install if one asset fails
            console.warn('[SW] Failed to cache:', url);
          })
        )
      )
    )
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

self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Don't intercept: API, auth, or external CDNs we don't control
  if (
    url.includes('googleapis.com/oauth2') ||
    url.includes('accounts.google.com') ||
    url.includes('onrender.com') ||
    url.includes('cdn.jsdelivr.net') ||
    url.includes('firebaseapp.com') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  // Google Fonts: cache-first
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
          }).catch(() => cached);
        })
      )
    );
    return;
  }

  // Everything else: cache-first, network fallback, cache as we go
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback: serve chat for logged-in users, index for everyone else
        if (event.request.destination === 'document') {
          return caches.match('./chat.html').then(r => r || caches.match('./index.html'));
        }
      });
    })
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
