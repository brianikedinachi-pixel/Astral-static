const CACHE_NAME = 'astral-v18-pwa';
// Caches that must survive every SW activation (i.e. every deploy), not just the
// current precache version. Must stay in sync with _FILLER_CACHE_NAME in brain.js —
// that cache holds the one-time-generated "thinking" filler audio for convo mode;
// wiping it on every update would defeat the whole point of it being "preset".
const PERSISTENT_CACHES = ['astral-filler-tts-v1'];
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
  '/img/icon-512.png',
  '/img/icon-badge.png',
  '/img/icon-action-return.png',
  '/img/icon-action-stop.png'
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
        keys
          .filter(k => k !== CACHE_NAME && !PERSISTENT_CACHES.includes(k))
          .map(k => caches.delete(k))
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

  // Page-driven heartbeat. A service worker's own setInterval is unreliable for
  // background timing — idle SWs can be terminated by the browser at any point,
  // silently killing any timers registered inside them. The page (still alive
  // while the tab is backgrounded, not fully closed) pings us periodically
  // instead; each ping re-activates this SW and checks if a notification is due.
  if (data.type === 'CONVO_PING') {
    _convoActive = true;
    if (!_convoStartTime) _convoStartTime = data.startTime || Date.now();
    _maybeShowConvoNotif();
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

function _formatNotifElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

async function _maybeShowConvoNotif() {
  if (!_convoActive) { _stopConvoNotifications(); return; }

  // Check if app is visible — if any client is focused, skip
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const anyFocused = clients.some(c => c.visibilityState === 'visible');
  if (anyFocused) return;

  _notifCount++;
  const isFirst = _notifCount === 1;
  const elapsedStr = _formatNotifElapsed(_convoStartTime ? Date.now() - _convoStartTime : 0);
  const nudges = [
    "Tap to return to your conversation.",
    "Come back anytime — Astral's still here.",
    "Tap to continue talking.",
    "Tap to resume, or end it from here.",
  ];
  const nudge = nudges[(_notifCount - 1) % nudges.length];
  const body  = `Conversation still going · ${elapsedStr}\n${nudge}`;

  const baseOptions = {
    body,
    icon: '/img/icon-192.png',
    badge: '/img/icon-badge.png',  // transparent white silhouette — renders cleanly in the status bar
    tag: 'astral-convo',           // replaces previous — no notification spam
    renotify: isFirst,             // only re-alert (sound/vibrate) the first time; later pings just refresh the text quietly
    silent: !isFirst,
    vibrate: isFirst ? [180, 90, 180] : [],
    requireInteraction: true,      // behaves like an ongoing call — stays put until the user acts or convo ends
    timestamp: _convoStartTime || Date.now(),
    data: { url: '/chat.html' }
  };

  try {
    await self.registration.showNotification('Astral — Conversation Active', {
      ...baseOptions,
      actions: [
        { action: 'open',  title: '💬 Return',    icon: '/img/icon-action-return.png' },
        { action: 'stop',  title: '✕ End Convo',  icon: '/img/icon-action-stop.png' },
      ]
    });
  } catch(e) {
    // Notification API might not support actions on this platform — try plain
    try {
      await self.registration.showNotification('Astral — Listening', baseOptions);
    } catch(e2) {}
  }
}
