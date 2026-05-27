const CACHE_NAME = 'astral-v1';
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
  // Don't intercept Google OAuth or API calls
  const url = event.request.url;
  if (url.includes('googleapis.com') || url.includes('accounts.google.com') || url.includes('onrender.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        // Cache new valid responses
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // Offline fallback for HTML pages
      if (event.request.destination === 'document') {
        return caches.match('./index.html');
      }
    })
  );
});
