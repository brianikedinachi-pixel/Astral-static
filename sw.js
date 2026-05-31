const CACHE = 'astral-cache';

const PRECACHE = [
  '/',
  '/index.html',
  '/chat.html',
  '/landing.html',
  '/manifest.json',
  '/styles/index.css',
  '/styles/response-style.css',
  '/scripts/brain.js',
  '/scripts/apifree.min.js',
  '/img/logo.jpg',
  '/img/icon-192.png',
  '/img/icon-512.png'
];

const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Astral</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0a0f1c;color:#e6f2ff;font-family:Arial,sans-serif;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      min-height:100vh;gap:16px;padding:24px;text-align:center}
    img{width:80px;height:80px;border-radius:16px}
    h2{font-size:1.1rem;color:#fff}
    p{font-size:.82rem;color:#7a8eaa;max-width:260px;line-height:1.6}
    button{padding:10px 28px;border-radius:50px;border:none;cursor:pointer;
      background:linear-gradient(135deg,#6a5cff,#00eaff);color:#fff;font-size:.9rem;font-weight:600;margin-top:4px}
  </style>
</head>
<body>
  <img src="/img/logo.jpg" onerror="this.style.display='none'" alt="Astral"/>
  <h2>No internet connection</h2>
  <p>Open Astral once while online so your chats are saved for offline use.</p>
  <button onclick="location.reload()">Retry</button>
</body>
</html>`;

// ── Install: cache everything, don't block on failures ──
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.allSettled(PRECACHE.map(url => cache.add(url)))
    )
  );
});

// ── Activate: claim clients immediately, keep old cache until new one is ready ──
self.addEventListener('activate', event => {
  self.clients.claim();
  // Don't delete old caches here — let them stay as fallback
});

// ── Fetch ──
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip: non-GET, API calls, auth, external CDNs
  if (
    request.method !== 'GET' ||
    url.host.includes('onrender.com') ||
    url.host.includes('accounts.google.com') ||
    url.host.includes('cdn.jsdelivr.net') ||
    url.host.includes('firebaseapp.com')
  ) return;

  // Google Fonts: cache-first
  if (url.host.includes('fonts.gstatic.com') || url.host.includes('fonts.googleapis.com')) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(request, res.clone()));
        return res;
      }))
    );
    return;
  }

  // Navigation (HTML page loads): network-first so fresh content when online,
  // cached index.html when offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put(request, res.clone()));
          return res;
        })
        .catch(() =>
          // Try the exact URL, then /index.html, then inline HTML
          caches.match(request)
            .then(c => c || caches.match('/index.html'))
            .then(c => c || caches.match('/chat.html'))
            .then(c => c || new Response(OFFLINE_HTML, {
              status: 200,
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            }))
        )
    );
    return;
  }

  // All other assets: cache-first, update cache in background
  event.respondWith(
    caches.match(request).then(cached => {
      const fetchPromise = fetch(request).then(res => {
        if (res.ok && res.type === 'basic') {
          caches.open(CACHE).then(c => c.put(request, res.clone()));
        }
        return res;
      });
      return cached || fetchPromise;
    })
  );
});
