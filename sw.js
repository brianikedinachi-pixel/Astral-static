const CACHE_NAME = 'astral-v4';
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
  <title>Astral — Offline</title>
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

// ── Conversation mode state ──────────────────────────────────────────────────
let _convoActive    = false;
let _convoStartTime = null;
let _notifInterval  = null;
let _notifCount     = 0;

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(PRECACHE.map(url => cache.add(url)))
    )
  );
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (
    request.method !== 'GET' ||
    url.host.includes('onrender.com') ||
    url.host.includes('accounts.google.com') ||
    url.host.includes('cdn.jsdelivr.net') ||
    url.host.includes('firebaseapp.com') ||
    url.host.includes('googleapis.com')
  ) return;

  if (url.host.includes('fonts.gstatic.com') || url.host.includes('fonts.googleapis.com')) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(res => {
        if (res.ok) caches.open(CACHE_NAME).then(c => c.put(request, res.clone()));
        return res;
      }))
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) caches.open(CACHE_NAME).then(c => c.put(request, res.clone()));
          return res;
        })
        .catch(() =>
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

  event.respondWith(
    caches.match(request).then(cached => {
      const fetchPromise = fetch(request).then(res => {
        if (res.ok && res.type === 'basic') {
          caches.open(CACHE_NAME).then(c => c.put(request, res.clone()));
        }
        return res;
      });
      return cached || fetchPromise;
    })
  );
});

// ── Messages from app ─────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'CONVO_START') {
    _convoActive    = true;
    _convoStartTime = data.startTime || Date.now();
    _notifCount     = 0;
    _startConvoNotifications();
  }

  if (data.type === 'CONVO_STOP') {
    _convoActive = false;
    _stopConvoNotifications();
  }
});

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const action = event.action;

  if (action === 'stop') {
    // Tell all clients to stop convo
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
        clients.forEach(c => c.postMessage({ type: 'STOP_CONVO' }));
        _convoActive = false;
        _stopConvoNotifications();
      })
    );
    return;
  }

  // Default: focus or open the app
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ('focus' in client) { client.focus(); return; }
      }
      if (self.clients.openWindow) self.clients.openWindow('/chat.html');
    })
  );
});

// ── Background notification loop ──────────────────────────────────────────────
function _startConvoNotifications() {
  _stopConvoNotifications(); // clear any existing

  // Fire immediately if app is hidden
  _maybeShowConvoNotif();

  // Then repeat every 30 seconds while convo is active and app is hidden
  _notifInterval = setInterval(_maybeShowConvoNotif, 30000);
}

function _stopConvoNotifications() {
  if (_notifInterval) { clearInterval(_notifInterval); _notifInterval = null; }
  // Clear any existing convo notifications
  self.registration.getNotifications({ tag: 'astral-convo' })
    .then(notifs => notifs.forEach(n => n.close()))
    .catch(() => {});
}

async function _maybeShowConvoNotif() {
  if (!_convoActive) { _stopConvoNotifications(); return; }

  // Check if app is visible — if any client is focused, skip
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const anyFocused = clients.some(c => c.visibilityState === 'visible');
  if (anyFocused) return;

  _notifCount++;
  const elapsed = _convoStartTime ? Math.floor((Date.now() - _convoStartTime) / 60000) : 0;
  const bodies = [
    "Astral is still listening. Tap to return to your conversation.",
    "Your conversation is still going. Come back anytime.",
    "Astral is here, waiting. Tap to continue talking.",
    "Still here with you. Tap to resume your conversation.",
  ];
  const body = bodies[(_notifCount - 1) % bodies.length];

  try {
    await self.registration.showNotification('Astral — Conversation Active', {
      body: elapsed > 0 ? `${body} (${elapsed}m ago)` : body,
      icon: '/img/icon-192.png',
      badge: '/img/icon-192.png',
      tag: 'astral-convo',      // replaces previous — no notification spam
      renotify: true,
      silent: false,
      requireInteraction: false,
      actions: [
        { action: 'open',  title: '💬 Return' },
        { action: 'stop',  title: '✕ End Convo' },
      ],
      data: { url: '/chat.html' }
    });
  } catch(e) {
    // Notification API might not support actions on this platform — try plain
    try {
      await self.registration.showNotification('Astral — Listening', {
        body,
        icon: '/img/icon-192.png',
        badge: '/img/icon-192.png',
        tag: 'astral-convo',
        renotify: true,
        data: { url: '/chat.html' }
      });
    } catch(e2) {}
  }
}
