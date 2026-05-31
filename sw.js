const CACHE_NAME = 'astral-v4';

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

// Inline offline page — always available, no cache needed
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Astral – Offline</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0a0f1c;color:#e6f2ff;font-family:'DM Sans',Arial,sans-serif;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      min-height:100vh;gap:20px;padding:24px;text-align:center}
    img{width:90px;height:90px;border-radius:18px;opacity:.9}
    h1{font-size:1.2rem;font-weight:600;color:#fff}
    p{font-size:.85rem;color:#8899bb;max-width:260px;line-height:1.6}
    button{margin-top:8px;padding:10px 28px;border-radius:50px;border:none;
      background:linear-gradient(135deg,#6a5cff,#00eaff);color:#fff;
      font-size:.9rem;font-weight:600;cursor:pointer}
  </style>
</head>
<body>
  <img src="./img/logo.jpg" alt="Astral"/>
  <h1>You're offline</h1>
  <p>Open Astral once with internet so your chats can load offline next time.</p>
  <button onclick="location.reload()">Try again</button>
</body>
</html>`;

// Install: cache each asset individually — one failure won't abort the whole install
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(
        ASSETS.map(url =>
          cache.add(url).catch(() => console.warn('[SW] Could not cache:', url))
        )
      )
    )
  );
  self.skipWaiting();
});

// Activate: remove old caches
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

  // Don't intercept: API, auth, non-GET
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
          return fetch(event.request).then(res => {
            if (res && res.status === 200) cache.put(event.request, res.clone());
            return res;
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

      return fetch(event.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, res.clone()));
        }
        return res;
      }).catch(() => {
        // Always serve something for HTML page requests
        if (event.request.destination === 'document') {
          return new Response(OFFLINE_HTML, {
            headers: { 'Content-Type': 'text/html' }
          });
        }
      });
    })
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
