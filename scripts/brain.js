/* =====================================================
   ASTRAL BRAIN.JS  v2.0
   – Google OAuth session
   – Image attach + vision
   – Markdown / rich-text rendering
   – Like / Dislike reactions → backend /react
   – Chat persistence → backend /memory (survives refresh + device switch)
   – User stats tracked on every message
   ===================================================== */

const SERVER_URL = 'https://astral-1-sb1i.onrender.com';

/* ══════════════════════════════════════════════════════
   SESSION
══════════════════════════════════════════════════════ */
let session     = null;
let userProfile = null;

function loadSession() {
  try {
    session = JSON.parse(localStorage.getItem('astral_session') || 'null');
    if (!session || !session.email) { window.location.href = 'index.html'; return false; }
    const users = JSON.parse(localStorage.getItem('astral_users') || '{}');
    userProfile = users[session.email] || { ...session, messageCount: 0, imageCount: 0 };
    return true;
  } catch(e) { window.location.href = 'index.html'; return false; }
}

function saveUserProfile() {
  if (!session) return;
  const users = JSON.parse(localStorage.getItem('astral_users') || '{}');
  users[session.email] = userProfile;
  localStorage.setItem('astral_users', JSON.stringify(users));
}

function getUserId() {
  let uid = localStorage.getItem('astral_user_id');
  if (!uid) {
    uid = 'u_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now();
    localStorage.setItem('astral_user_id', uid);
  }
  return uid;
}

/* ══════════════════════════════════════════════════════
   INIT USER UI
══════════════════════════════════════════════════════ */
function initUserUI() {
  if (!session) return;
  const letter = (session.name || 'U').charAt(0).toUpperCase();
  const el = id => document.getElementById(id);
  if (el('avatar-letter')) el('avatar-letter').textContent = letter;
  if (el('dd-name'))       el('dd-name').textContent  = session.name;
  if (el('dd-email'))      el('dd-email').textContent = session.email;
}

window.toggleDropdown = () => document.getElementById('user-dropdown')?.classList.toggle('open');
window.doLogout = () => {
  localStorage.removeItem('astral_session');
  // Also clear cookie so user is fully logged out on PWA
  document.cookie = 'astral_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
  window.location.href = 'index.html';
};
window.goSettings = () => { if (typeof openSettings === 'function') openSettings(); };

document.addEventListener('pointerdown', (e) => {
  const dd = document.getElementById('user-dropdown');
  const ab = document.getElementById('avatar-btn');
  if (dd && !dd.contains(e.target) && !ab?.contains(e.target)) dd.classList.remove('open');
});

/* ══════════════════════════════════════════════════════
   VOICE
══════════════════════════════════════════════════════ */
let voiceEnabled = false;
const voiceToggleBtns  = document.querySelectorAll('.voice-toggle');
const speechToggleBtns = document.querySelectorAll('.speech-toggle');

function updateVoiceButton() {
  voiceToggleBtns.forEach(btn => {
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(voiceEnabled));
    const lbl = btn.querySelector('.btn-label');
    if (lbl) lbl.textContent = lbl.textContent.includes(':') ? (voiceEnabled ? 'Voice : ON' : 'Voice : OFF') : (voiceEnabled ? 'Voice' : 'Voice');
    voiceEnabled ? btn.classList.add('on') : btn.classList.remove('on');
  });
}

voiceToggleBtns.forEach(btn => btn?.addEventListener('click', () => { voiceEnabled = !voiceEnabled; updateVoiceButton(); }));

function speak(text) {
  if (!voiceEnabled || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1; u.pitch = 1; u.volume = 1;
  const v = speechSynthesis.getVoices();
  if (v.length) u.voice = v[0];
  speechSynthesis.speak(u);
}

/* ══════════════════════════════════════════════════════
   SPEECH RECOGNITION
══════════════════════════════════════════════════════ */
let recognition  = null;
let speechEnabled = false;

function updateSpeechButton() {
  speechToggleBtns.forEach(btn => {
    if (!btn) return;
    const lbl = btn.querySelector('.btn-label');
    if (lbl) lbl.textContent = lbl.textContent.includes(':') ? (speechEnabled ? 'Speech : ON' : 'Speech : OFF') : (speechEnabled ? 'Speech' : 'Speech');
    speechEnabled ? btn.classList.add('on') : btn.classList.remove('on');
  });
}

function initSpeechRecognition() {
  speechToggleBtns.forEach(btn => btn.addEventListener('click', handleSpeechClick));
}

function handleSpeechClick(e) {
  e.preventDefault(); e.stopPropagation();
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert('Speech recognition not supported. Use Chrome, Edge, or Safari.'); return; }
  if (speechEnabled && recognition) { recognition.stop(); return; }
  try {
    recognition = new SR();
    recognition.lang = 'en-US'; recognition.continuous = false; recognition.interimResults = false;
    recognition.onstart = () => { speechEnabled = true; speechToggleBtns.forEach(b => { b?.classList.add('listening'); b?.setAttribute('aria-pressed','true'); }); updateSpeechButton(); };
    recognition.onresult = ev => { if (ev.results[0].isFinal) { if (inputEl) inputEl.value = ev.results[0][0].transcript; handleSend(); } };
    recognition.onerror = () => { speechEnabled = false; speechToggleBtns.forEach(b => { b?.classList.remove('listening'); b?.setAttribute('aria-pressed','false'); }); updateSpeechButton(); };
    recognition.onend  = () => { speechEnabled = false; speechToggleBtns.forEach(b => { b?.classList.remove('listening'); b?.setAttribute('aria-pressed','false'); }); updateSpeechButton(); };
    recognition.start();
  } catch(err) { speechEnabled = false; updateSpeechButton(); }
}

/* ══════════════════════════════════════════════════════
   IMAGE ATTACH  (camera-first)
══════════════════════════════════════════════════════ */
let attachedImageBase64 = null;
let attachedImageMime   = null;

window.toggleCameraChoice = function(e) {
  e.stopPropagation();
  const popup = document.getElementById('camera-choice-popup');
  if (!popup) return;
  popup.classList.toggle('show');
};

document.addEventListener('pointerdown', (e) => {
  const popup = document.getElementById('camera-choice-popup');
  const btn   = document.getElementById('attach-btn');
  if (popup && !popup.contains(e.target) && !btn?.contains(e.target)) {
    popup.classList.remove('show');
  }
});

window.openCamera = function() {
  document.getElementById('camera-choice-popup')?.classList.remove('show');
  document.getElementById('file-input').click();
};

window.openGallery = function() {
  document.getElementById('camera-choice-popup')?.classList.remove('show');
  document.getElementById('file-input-gallery').click();
};

window.handleFileSelect = function(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const parts   = dataUrl.split(',');
    attachedImageBase64 = parts[1];
    attachedImageMime   = file.type || 'image/jpeg';
    document.getElementById('img-thumb').src = dataUrl;
    document.getElementById('img-fname').textContent = file.name.length > 34 ? file.name.slice(0,34)+'...' : file.name;
    document.getElementById('img-preview-bar').classList.add('show');
  };
  reader.readAsDataURL(file);
  event.target.value = '';
};

window.removeImage = function() {
  attachedImageBase64 = null;
  attachedImageMime   = null;
  document.getElementById('img-preview-bar').classList.remove('show');
};

/* ══════════════════════════════════════════════════════
   DOM REFS
══════════════════════════════════════════════════════ */
const runBtn           = document.querySelector('.js-chat-answer-button');
const displayContainer = document.querySelector('.js-chat-display-container');
const inputEl          = document.querySelector('.js-chat-response');
const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
const mobileDropdown   = document.querySelector('.mobile-dropdown-menu');
const newChatBtn       = document.querySelector('.new-chat-btn');
const mainElement      = document.querySelector('main');
const chatSidebar      = document.querySelector('.chat-sidebar');
const chatHistoryList  = document.querySelector('.js-chat-history-list');
const sidebarToggle    = document.querySelector('.sidebar-toggle');

let isSending = false;

if (inputEl) {
  inputEl.addEventListener('input', () => autoGrow(inputEl));
  const _origReset = () => { inputEl.style.height = 'auto'; inputEl.dataset.expanded = 'false'; inputEl.style.overflowY = 'hidden'; };
  inputEl._resetHeight = _origReset;
}
let currentController = null;
let sidebarOpen = false;

/* ══════════════════════════════════════════════════════
   SIDEBAR
══════════════════════════════════════════════════════ */
function updateSidebarState() {
  if (!chatSidebar) return;
  sidebarOpen ? chatSidebar.classList.remove('collapsed') : chatSidebar.classList.add('collapsed');
}

sidebarToggle?.addEventListener('click', () => { sidebarOpen = !sidebarOpen; updateSidebarState(); });
mainElement?.addEventListener('pointerdown', () => { if (sidebarOpen) { sidebarOpen = false; updateSidebarState(); } });
document.querySelector('.head')?.addEventListener('pointerdown', (e) => {
  if (sidebarOpen && !sidebarToggle?.contains(e.target)) { sidebarOpen = false; updateSidebarState(); }
});

/* ══════════════════════════════════════════════════════
   CHAT HISTORY  — Saved to BACKEND /memory + localStorage fallback

   We piggy-back on the existing /memory endpoint:
     POST /memory  { role: 'system', text: JSON.stringify(chatHistory), user_id: chatKey }
     GET  /memory?query=&limit=1&user_id=chatKey

   The backend stores up to 1000 items per user_id.  We use a dedicated
   user_id (chatKey) so it never mixes with normal AI conversation memories.
══════════════════════════════════════════════════════ */
let chatHistory   = [];
let currentChatId = null;
let htmlResult    = [];
let _syncTimeout  = null;

// Unique key that identifies THIS user's chat list in the memory store
function backendChatKey() {
  // Replace chars that might cause issues in URL params
  return 'chatlogs__' + (session?.email || 'anon').replace(/[^a-zA-Z0-9]/g, '_');
}

function localStorageKey() { return 'chatHistory_' + (session?.email || 'default'); }

/* ── Persist entire chatHistory to backend ── */
async function saveChatHistoryToBackend() {
  if (!session?.email) return;
  try {
    await fetch(SERVER_URL + '/memory', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role:    'system',
        text:    JSON.stringify(chatHistory),
        user_id: backendChatKey()
      })
    });
  } catch(e) {
    // Backend unreachable — localStorage already has it, that's fine
  }
}

/* ── Debounce: wait 900ms after last save before hitting backend ── */
function scheduleSyncToBackend() {
  clearTimeout(_syncTimeout);
  _syncTimeout = setTimeout(() => saveChatHistoryToBackend(), 900);
}

/* ── Immediate sync: flush to backend right now, no delay ── */
function syncToBackendNow() {
  clearTimeout(_syncTimeout);
  saveChatHistoryToBackend();
}

/* ── Load chats: localStorage FIRST (instant), then sync backend silently ── */
async function loadChatHistoryFromBackend() {
  // Step 1: Load from localStorage immediately — no waiting, no spinner
  let localLoaded = false;
  try {
    const raw = localStorage.getItem(localStorageKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        chatHistory = parsed;
        localLoaded = true;
      }
    }
  } catch {}

  // Step 2: Sync backend in background — won't block or delay the UI
  if (session?.email) {
    (async () => {
      try {
        const url = SERVER_URL + '/memory?query=&limit=100&user_id=' + encodeURIComponent(backendChatKey());
        const r = await fetch(url);
        if (r.ok) {
          const items = await r.json();
          const found = Array.isArray(items)
            ? [...items].reverse().find(m => m.role === 'system')
            : null;
          if (found && found.text) {
            try {
              const parsed = JSON.parse(found.text);
              if (Array.isArray(parsed) && parsed.length > 0) {
                chatHistory = parsed;
                try { localStorage.setItem(localStorageKey(), JSON.stringify(chatHistory)); } catch {}
                // Refresh sidebar quietly with latest data
                const stillCurrent = chatHistory.find(c => c.id === currentChatId);
                if (!stillCurrent && chatHistory.length > 0) {
                  currentChatId = chatHistory[0].id;
                  htmlResult = chatHistory[0].messages || [];
                  renderMessages();
                }
                loadChatsUI();
              }
            } catch {}
          }
        }
      } catch(e) {}
    })();
  }

  return localLoaded || chatHistory.length > 0;
}
function saveChatsToStorage() {
  // Immediate localStorage save
  try { localStorage.setItem(localStorageKey(), JSON.stringify(chatHistory)); } catch {}
  // Debounced backend save
  scheduleSyncToBackend();
}

function createNewChat() {
  const id = Date.now().toString();
  chatHistory.unshift({ id, title: 'New Chat', messages: [], updatedAt: new Date().toISOString() });
  currentChatId = id;
  htmlResult    = [];
  saveChatsToStorage();
  loadChatsUI();
  renderMessages();
}

function loadChatsUI() {
  if (!chatHistoryList) return;
  chatHistoryList.innerHTML = chatHistory.map(c =>
    '<div class="chat-item ' + (c.id === currentChatId ? 'active' : '') + '" data-id="' + c.id + '">' +
    '<span class="chat-item-title">' + escHtml(c.title) + '</span>' +
    '<button class="chat-delete-btn" data-id="' + c.id + '" title="Delete">' +
    '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2" fill="none"/></svg>' +
    '</button></div>'
  ).join('');

  chatHistoryList.querySelectorAll('.chat-item-title').forEach(el => {
    el.addEventListener('click', () => loadChat(el.closest('[data-id]').getAttribute('data-id')));
  });
  chatHistoryList.querySelectorAll('.chat-delete-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deleteChat(btn.getAttribute('data-id')); });
  });
}

function loadChat(id) {
  currentChatId = id;
  const c = chatHistory.find(x => x.id === id);
  if (c) { htmlResult = c.messages; renderMessages(); loadChatsUI(); }
}

function updateChatTitle(id, title) {
  const c = chatHistory.find(x => x.id === id);
  if (c) { c.title = title; c.updatedAt = new Date().toISOString(); saveChatsToStorage(); loadChatsUI(); }
}

function deleteChat(id) {
  chatHistory = chatHistory.filter(c => c.id !== id);
  if (currentChatId === id) {
    if (chatHistory.length > 0) loadChat(chatHistory[0].id);
    else createNewChat();
  }
  saveChatsToStorage(); loadChatsUI();
}

function getCurrentChat() { return chatHistory.find(c => c.id === currentChatId); }

function saveToStorage() {
  const c = getCurrentChat();
  if (c) { c.messages = htmlResult; c.updatedAt = new Date().toISOString(); saveChatsToStorage(); }
}

/* ══════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════ */
function escHtml(t) {
  t = t || '';
  return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function scrollToBottom() { if (displayContainer) displayContainer.scrollTop = displayContainer.scrollHeight; }

function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  const scrollH = el.scrollHeight;
  const maxH    = 160;
  el.style.height = Math.min(scrollH, maxH) + 'px';
  el.dataset.expanded = scrollH > 40 ? 'true' : 'false';
  el.style.overflowY = scrollH > maxH ? 'auto' : 'hidden';
}

function renderMarkdown(text) {
  if (typeof marked === 'undefined') return '<p>' + escHtml(text) + '</p>';
  try {
    marked.setOptions({ breaks: true, gfm: true });
    return marked.parse(text);
  } catch { return '<p>' + escHtml(text) + '</p>'; }
}

/* ══════════════════════════════════════════════════════
   TOP USER HIGHLIGHT — floating toast, zero layout impact
   • Shows "you're #1" toast when user becomes top user
   • Shows "you're no longer #1" toast when they lose the spot
   • Re-checks every 90 seconds so changes are caught live
══════════════════════════════════════════════════════ */

var _topUserInterval = null;  // handle for periodic re-check

async function checkTopUserStatus() {
  if (!session || !session.email) return;

  // Count total messages this user has sent across all chats
  var totalMsgs = 0;
  for (var i = 0; i < chatHistory.length; i++) {
    var msgs = chatHistory[i].messages || [];
    for (var j = 0; j < msgs.length; j++) {
      if (msgs[j].humanText || msgs[j].humanImage) totalMsgs++;
    }
  }

  // Also count userProfile locally tracked messages
  var profileCount = (userProfile && userProfile.messageCount) || 0;
  var localCount = Math.max(totalMsgs, profileCount);

  // Retrieve previous known top-user status for this session
  var storageKey  = 'astral_was_top_' + session.email;
  var wasTop      = localStorage.getItem(storageKey) === 'true';

  // Show toast if user has sent at least 3 messages (they're clearly engaged)
  if (localCount >= 3) {
    // Try backend for accurate cross-device count, fall back to local
    try {
      var r = await fetch(SERVER_URL + '/admin-stats?admin_email=check_top&user_email=' + encodeURIComponent(session.email));
      if (r.ok) {
        var d = await r.json();
        if (d.is_top_user) {
          // Only pop the "you're #1" toast if this is a new achievement
          if (!wasTop) {
            showTopUserToast(d.top_message_count || localCount, false);
            localStorage.setItem(storageKey, 'true');
          }
          return;
        }
        // Backend said not top — if they WERE top before, notify demotion
        if (wasTop) {
          showTopUserToast(0, true);  // true = demotion toast
          localStorage.setItem(storageKey, 'false');
        }
        return;
      }
    } catch(e) {
      // Backend unreachable (server sleeping) — use local count, keep previous state
      if (!wasTop) {
        showTopUserToast(localCount, false);
        localStorage.setItem(storageKey, 'true');
      }
    }
  } else {
    // Not enough messages — if they were top before but got reset somehow, clear flag
    if (wasTop) {
      localStorage.setItem(storageKey, 'false');
    }
  }
}

function showTopUserToast(count, demoted) {
  // Remove any existing toast first
  var existing = document.getElementById('top-user-toast');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

  // Inject keyframe + responsive CSS once
  if (!document.getElementById('top-toast-style')) {
    var styleEl = document.createElement('style');
    styleEl.id = 'top-toast-style';
    styleEl.textContent = [
      '@keyframes toastSlideIn{from{opacity:0;transform:translateY(-18px) scale(0.96)}to{opacity:1;transform:translateY(0) scale(1)}}',
      '@keyframes toastSlideOut{from{opacity:1;transform:translateY(0) scale(1)}to{opacity:0;transform:translateY(-14px) scale(0.96)}}',
      '#top-user-toast{',
        'position:fixed;top:14px;left:50%;transform:translateX(-50%);',
        'z-index:99999;',
        'display:flex;align-items:center;gap:12px;',
        'padding:13px 18px;',
        'border-radius:999px;',
        'color:#fde68a;',
        'font-size:0.84rem;font-weight:500;',
        'white-space:nowrap;',
        'animation:toastSlideIn 0.38s cubic-bezier(0.34,1.4,0.64,1) forwards;',
        'backdrop-filter:blur(14px);',
        'max-width:calc(100vw - 28px);',
      '}',
      '#top-user-toast.toast-top{',
        'background:linear-gradient(135deg,rgba(10,14,28,0.97),rgba(14,10,28,0.97));',
        'border:1px solid rgba(251,191,36,0.45);',
        'box-shadow:0 0 0 1px rgba(251,191,36,0.1),0 4px 32px rgba(0,0,0,0.55),0 0 40px rgba(251,191,36,0.08);',
      '}',
      '#top-user-toast.toast-demoted{',
        'background:linear-gradient(135deg,rgba(14,8,24,0.97),rgba(10,12,22,0.97));',
        'border:1px solid rgba(148,163,184,0.35);',
        'box-shadow:0 0 0 1px rgba(148,163,184,0.08),0 4px 32px rgba(0,0,0,0.55);',
        'color:#cbd5e1;',
      '}',
      '#top-user-toast .t-icon{',
        'width:30px;height:30px;border-radius:50%;flex-shrink:0;',
        'display:flex;align-items:center;justify-content:center;',
        'font-size:1rem;',
      '}',
      '#top-user-toast.toast-top .t-icon{',
        'background:linear-gradient(135deg,rgba(251,191,36,0.25),rgba(245,158,11,0.15));',
        'border:1px solid rgba(251,191,36,0.35);',
        'box-shadow:0 0 12px rgba(251,191,36,0.2);',
      '}',
      '#top-user-toast.toast-demoted .t-icon{',
        'background:rgba(148,163,184,0.1);',
        'border:1px solid rgba(148,163,184,0.2);',
      '}',
      '#top-user-toast .t-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;}',
      '#top-user-toast .t-text strong{color:#fbbf24;}',
      '#top-user-toast.toast-demoted .t-text strong{color:#94a3b8;}',
      '#top-user-toast .t-close{',
        'background:none;border:none;color:#a3724a;cursor:pointer;',
        'font-size:1rem;padding:0 0 0 4px;flex-shrink:0;',
        'line-height:1;opacity:0.7;transition:opacity 0.15s;',
      '}',
      '#top-user-toast .t-close:hover{opacity:1;}',
      /* ── Mobile (≤ 600px): pill → card, anchored to bottom, full readable text ── */
      '@media(max-width:600px){',
        '#top-user-toast{',
          'top:auto;bottom:72px;',        /* above any bottom nav */
          'left:14px;right:14px;',
          'transform:none;',
          'border-radius:18px;',
          'padding:14px 16px;',
          'gap:10px;',
          'white-space:normal;',          /* allow text to wrap on small screens */
          'align-items:flex-start;',
        '}',
        '#top-user-toast .t-icon{width:36px;height:36px;font-size:1.1rem;flex-shrink:0;margin-top:1px;}',
        '#top-user-toast .t-text{font-size:0.82rem;line-height:1.45;overflow:visible;text-overflow:clip;}',
        '#top-user-toast .t-close{align-self:flex-start;font-size:1.1rem;}',
      '}',
      /* ── Very small (≤ 360px): keep it tight ── */
      '@media(max-width:360px){',
        '#top-user-toast{bottom:60px;left:10px;right:10px;padding:12px 13px;}',
        '#top-user-toast .t-text{font-size:0.79rem;}',
      '}',
    ].join('');
    document.head.appendChild(styleEl);
  }

  var toast = document.createElement('div');
  toast.id = 'top-user-toast';

  if (demoted) {
    toast.className = 'toast-demoted';
    toast.innerHTML =
      '<div class="t-icon">📉</div>' +
      '<span class="t-text">You\'re no longer Astral\'s <strong>#1 user</strong> — keep chatting to reclaim the top spot! 💪</span>' +
      '<button class="t-close" title="Dismiss">✕</button>';
  } else {
    toast.className = 'toast-top';
    toast.innerHTML =
      '<div class="t-icon">🏆</div>' +
      '<span class="t-text">You\'re Astral\'s <strong>#1 user</strong> — ' + count + ' messages! Thank you, we\'re grateful you\'re here 💙</span>' +
      '<button class="t-close" title="Dismiss">✕</button>';
  }

  document.body.appendChild(toast);

  function dismissToast() {
    if (!toast.parentNode) return;
    toast.style.animation = 'toastSlideOut 0.28s ease forwards';
    setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
  }

  toast.querySelector('.t-close').addEventListener('click', dismissToast);

  // Auto-dismiss: 8 s for demotion (more to read), 6 s for #1
  setTimeout(dismissToast, demoted ? 8000 : 6000);
}
/* ══════════════════════════════════════════════════════
   COMMENT KEY — unique per AI message
══════════════════════════════════════════════════════ */
function commentKey(idx) {
  return (currentChatId || 'default') + '_' + idx;
}

/* ══════════════════════════════════════════════════════
   COMMENT MODAL
══════════════════════════════════════════════════════ */
// ── Define closeCommentModal FIRST so event listeners can always reference it ──
window.closeCommentModal = function() {
  var modal = document.getElementById('astral-comment-modal');
  if (modal) modal.style.display = 'none';
};

window.openCommentModal = function(idx) {
  ensureCommentModal();

  var input    = document.getElementById('astral-comment-input');
  var status   = document.getElementById('astral-comment-status');
  var prevWrap = document.getElementById('astral-comment-prev-wrap');
  var submitBtn = document.getElementById('astral-comment-submit');

  // Reset state
  if (input)  { input.value = ''; }
  if (status) { status.style.display = 'none'; status.textContent = ''; status.style.color = '#34d399'; }

  // Show existing comments for this message
  var log      = htmlResult[idx];
  var existing = (log && log.comments) || [];
  if (existing.length > 0) {
    prevWrap.innerHTML =
      '<div style="font-size:0.72rem;color:#475569;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:8px;">' +
        existing.length + ' comment' + (existing.length > 1 ? 's' : '') + ' so far' +
      '</div>' +
      existing.map(function(c) {
        return '<div style="background:rgba(0,212,255,0.04);border:1px solid rgba(0,212,255,0.1);border-radius:10px;padding:8px 12px;margin-bottom:6px;">' +
          '<span style="font-size:0.75rem;color:#00d4ff;font-weight:600;">' + escHtml(c.user_name || c.user_email || 'anon') + '</span>' +
          '<span style="font-size:0.7rem;color:#475569;margin-left:8px;">' + (c.ts || '').slice(0, 10) + '</span>' +
          '<div style="font-size:0.83rem;color:#94a3b8;margin-top:4px;">' + escHtml(c.text) + '</div>' +
          '</div>';
      }).join('');
    prevWrap.style.display = 'block';
  } else {
    prevWrap.innerHTML = '';
    prevWrap.style.display = 'none';
  }

  // Wire submit button fresh each open
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Post Comment';
    submitBtn.onclick = function() { window.submitComment(idx); };
  }

  // Show modal
  document.getElementById('astral-comment-modal').style.display = 'block';
  setTimeout(function() { var el = document.getElementById('astral-comment-input'); if (el) el.focus(); }, 80);
};

window.submitComment = async function(idx) {
  var input     = document.getElementById('astral-comment-input');
  var status    = document.getElementById('astral-comment-status');
  var submitBtn = document.getElementById('astral-comment-submit');
  var text      = input ? input.value.trim() : '';
  if (!text) {
    if (status) { status.textContent = 'Please write something first.'; status.style.color = '#fb7185'; status.style.display = 'block'; }
    return;
  }

  var log = htmlResult[idx];
  var key = commentKey(idx);

  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Posting…'; }

  var newComment = {
    id:         Date.now().toString(),
    ts:         new Date().toISOString(),
    user_email: (session && session.email) || '',
    user_name:  (session && session.name)  || '',
    text:       text
  };

  try {
    var resp = await fetch(SERVER_URL + '/comment', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comment_key:     key,
        user_email:      newComment.user_email,
        user_name:       newComment.user_name,
        text:            text,
        chat_id:         currentChatId || '',
        msg_idx:         idx,
        ai_text_preview: (log && log.aiText ? log.aiText.slice(0, 100) : '')
      })
    });
    var data = resp.ok ? await resp.json() : null;
    // Use server comment if available, otherwise use local one
    var saved = (data && data.ok && data.comment) ? data.comment : newComment;
    if (!log.comments) log.comments = [];
    log.comments.push(saved);
    saveToStorage();
    renderMessages();
    if (status) { status.textContent = '✅ Comment posted!'; status.style.color = '#34d399'; status.style.display = 'block'; }
    if (input) input.value = '';
    setTimeout(window.closeCommentModal, 1200);
  } catch(e) {
    // Backend offline — save locally anyway
    if (!log.comments) log.comments = [];
    log.comments.push(newComment);
    saveToStorage();
    renderMessages();
    if (status) { status.textContent = '💾 Saved locally (no connection).'; status.style.color = '#fbbf24'; status.style.display = 'block'; }
    if (input) input.value = '';
    setTimeout(window.closeCommentModal, 1400);
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Post Comment'; }
  }
};

function ensureCommentModal() {
  if (document.getElementById('astral-comment-modal')) return;
  var modal = document.createElement('div');
  modal.id = 'astral-comment-modal';
  modal.style.display = 'none'; // hidden until openCommentModal shows it
  modal.innerHTML =
    '<div id="astral-comment-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);z-index:9998;"></div>' +
    '<div id="astral-comment-box" style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9999;background:#0c1120;border:1px solid rgba(0,212,255,0.25);border-radius:18px;padding:1.6rem 1.5rem;width:min(480px,92vw);box-shadow:0 24px 60px rgba(0,0,0,0.7);">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">' +
        '<h3 style="font-size:0.95rem;font-weight:700;color:#e2eeff;margin:0;">💬 Leave a comment</h3>' +
        '<button id="astral-comment-close" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1.3rem;padding:4px;line-height:1;">✕</button>' +
      '</div>' +
      '<div id="astral-comment-prev-wrap" style="max-height:180px;overflow-y:auto;margin-bottom:1rem;display:none;"></div>' +
      '<textarea id="astral-comment-input" placeholder="Write your comment here…" style="width:100%;min-height:90px;padding:0.85rem 1rem;background:rgba(0,212,255,0.04);border:1px solid rgba(0,212,255,0.18);border-radius:12px;color:#e2eeff;font-family:inherit;font-size:0.875rem;resize:vertical;outline:none;line-height:1.5;box-sizing:border-box;"></textarea>' +
      '<div style="display:flex;gap:10px;margin-top:0.9rem;justify-content:flex-end;">' +
        '<button id="astral-comment-cancel" style="padding:0.6rem 1.2rem;border-radius:10px;background:none;border:1px solid rgba(0,212,255,0.18);color:#94a3b8;cursor:pointer;font-family:inherit;font-size:0.85rem;">Cancel</button>' +
        '<button id="astral-comment-submit" style="padding:0.6rem 1.4rem;border-radius:10px;background:linear-gradient(135deg,#00d4ff,#a855f7);border:none;color:#000;font-family:inherit;font-size:0.85rem;font-weight:700;cursor:pointer;">Post Comment</button>' +
      '</div>' +
      '<div id="astral-comment-status" style="display:none;margin-top:0.7rem;font-size:0.8rem;padding:6px 10px;border-radius:8px;background:rgba(52,211,153,0.08);"></div>' +
    '</div>';
  document.body.appendChild(modal);

  // Use arrow functions so they always call the current window.closeCommentModal
  document.getElementById('astral-comment-overlay').addEventListener('click', function() { window.closeCommentModal(); });
  document.getElementById('astral-comment-close').addEventListener('click',   function() { window.closeCommentModal(); });
  document.getElementById('astral-comment-cancel').addEventListener('click',  function() { window.closeCommentModal(); });
}

/* ══════════════════════════════════════════════════════
   REACTIONS — Restore per-message likes/dislikes from backend
   Called on startup so reactions survive server sleep/restart
══════════════════════════════════════════════════════ */
async function loadReactionsFromBackend() {
  if (!session || !session.email) return;
  try {
    var url = SERVER_URL + '/reactions?user_email=' + encodeURIComponent(session.email);
    var r = await fetch(url);
    if (!r.ok) return;
    var d = await r.json();
    var rxnMap = d.reactions || {};
    if (!Object.keys(rxnMap).length) return;

    // Apply to all messages across all chats
    for (var ci = 0; ci < chatHistory.length; ci++) {
      var chat = chatHistory[ci];
      var msgs = chat.messages || [];
      for (var mi = 0; mi < msgs.length; mi++) {
        var key = (chat.id || '') + '_' + mi;
        if (rxnMap[key]) {
          var saved = rxnMap[key];
          // Only update if backend has higher counts (authoritative)
          if ((saved.likes || 0) >= (msgs[mi].likes || 0)) {
            msgs[mi].likes    = saved.likes    || 0;
            msgs[mi].dislikes = saved.dislikes || 0;
            msgs[mi].reaction = saved.reaction || null;
          }
        }
      }
    }
    // Re-save and re-render to show restored counts
    saveChatsToStorage();
    htmlResult = (chatHistory.find(function(c){ return c.id === currentChatId; }) || {}).messages || htmlResult;
    renderMessages();
  } catch(e) {
    // Backend offline — localStorage values already shown, no action needed
  }
}

/* ── Load comments from backend into current messages (on startup) ── */
async function loadCommentsFromBackend() {
  for (var i = 0; i < htmlResult.length; i++) {
    var log = htmlResult[i];
    if (!log.aiText || log.thinking) continue;
    try {
      var key = commentKey(i);
      var r = await fetch(SERVER_URL + '/comments?comment_key=' + encodeURIComponent(key));
      if (r.ok) {
        var d = await r.json();
        if (d.comments && d.comments.length > 0) {
          log.comments = d.comments;
        }
      }
    } catch(e) {}
  }
  renderMessages();
}

/* ══════════════════════════════════════════════════════
   RENDER ALL MESSAGES
══════════════════════════════════════════════════════ */
function renderMessages() {
  if (!displayContainer) return;
  displayContainer.innerHTML = htmlResult.map(function(log, idx) {
    var humanPart = '';
    if (log.humanText || log.humanImage) {
      humanPart = '<div class="human-response">' +
        (log.humanImage ? '<img class="chat-img" src="' + log.humanImage + '" alt="Attached image">' : '') +
        (log.humanText  ? '<p class="text">' + escHtml(log.humanText) + '</p>' : '') +
        '</div>';
    }

    var aiPart = '';
    if (log.thinking || (log.aiText !== undefined && log.aiText !== '')) {
      aiPart = '<div class="ai-response">';
      if (log.thinking) {
        aiPart += '<div class="thinking"><span>A</span><span>S</span><span>T</span><span>R</span><span>A</span><span>L</span></div>';
      } else {
        // AI content
        aiPart += '<div class="ai-content">' + renderMarkdown(log.aiText || '') + '</div>';

        // Reaction + Comment row
        var commentCount = (log.comments && log.comments.length) || 0;
        aiPart +=
          '<div class="reaction-row">' +
          '<button class="react-btn ' + (log.reaction==='like'?'liked':'') + '" onclick="reactMsg(' + idx + ',\'like\')">' +
            '&#128077; <span>' + (log.likes||0) + '</span></button>' +
          '<button class="react-btn ' + (log.reaction==='dislike'?'disliked':'') + '" onclick="reactMsg(' + idx + ',\'dislike\')">' +
            '&#128078; <span>' + (log.dislikes||0) + '</span></button>' +
          '<button class="react-btn comment-btn" onclick="openCommentModal(' + idx + ')" title="Leave a comment">' +
            '&#128172; <span>' + (commentCount > 0 ? commentCount : '') + '</span></button>' +
          '</div>';

        // Show existing comments inline
        if (commentCount > 0) {
          aiPart += '<div class="inline-comments">';
          log.comments.forEach(function(c) {
            aiPart +=
              '<div class="inline-comment">' +
                '<span class="ic-author">' + escHtml(c.user_name || c.user_email || 'User') + '</span>' +
                '<span class="ic-date">' + (c.ts||'').slice(0,10) + '</span>' +
                '<div class="ic-text">' + escHtml(c.text) + '</div>' +
              '</div>';
          });
          aiPart += '</div>';
        }
      }
      aiPart += '</div>';
    }

    return '<div class="chatlog" data-idx="' + idx + '">' + humanPart + aiPart + '</div>';
  }).join('');
  scrollToBottom();
}

/* ══════════════════════════════════════════════════════
   REACTIONS  → backend /react
══════════════════════════════════════════════════════ */
window.reactMsg = function(idx, type) {
  var log = htmlResult[idx];
  if (!log) return;
  var prev = log.reaction;

  if (prev === type) {
    // Toggle off
    log.reaction = null;
    if (type === 'like') log.likes = Math.max(0,(log.likes||0)-1);
    else log.dislikes = Math.max(0,(log.dislikes||0)-1);
  } else {
    // Switch reaction
    if (prev === 'like')    log.likes    = Math.max(0,(log.likes||0)-1);
    if (prev === 'dislike') log.dislikes = Math.max(0,(log.dislikes||0)-1);
    log.reaction = type;
    if (type === 'like') log.likes = (log.likes||0)+1;
    else log.dislikes = (log.dislikes||0)+1;
  }

  saveToStorage();
  renderMessages();

  // Fire to backend
  fetch(SERVER_URL + '/react', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id:         getUserId(),
      user_email:      (session && session.email)  || '',
      user_name:       (session && session.name)   || '',
      msg_idx:         idx,
      reaction:        log.reaction,
      likes:           log.likes    || 0,
      dislikes:        log.dislikes || 0,
      chat_id:         currentChatId,
      ai_text_preview: (log.aiText || '').slice(0, 100)
    })
  }).catch(function(){});
};

/* ══════════════════════════════════════════════════════
   SEND MESSAGE
══════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════
   OFFLINE / ONLINE DETECTION
══════════════════════════════════════════════════════ */
function setOfflineBanner(isOffline) {
  var banner = document.getElementById('offline-banner');
  var sendArea = document.querySelector('.chat-initiate-response');
  var runBtnEl = document.querySelector('.js-chat-answer-button');
  if (!banner) return;
  if (isOffline) {
    banner.classList.add('visible');
    if (sendArea) sendArea.classList.add('offline-mode');
    if (runBtnEl) { runBtnEl.disabled = true; runBtnEl.title = 'No internet connection'; }
  } else {
    banner.classList.remove('visible');
    if (sendArea) sendArea.classList.remove('offline-mode');
    if (runBtnEl) { runBtnEl.disabled = false; runBtnEl.title = ''; }
  }
}

function showToast(msg, type) {
  var toast = document.getElementById('network-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = 'network-toast show ' + (type || '');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function() { toast.className = 'network-toast'; }, 3500);
}

window.addEventListener('online',  function() { setOfflineBanner(false); showToast('✅ Back online — you can send messages again', 'online'); });
window.addEventListener('offline', function() { setOfflineBanner(true);  showToast('📡 You\'re offline — chats are still viewable', 'offline'); });

// Set initial state on load
document.addEventListener('DOMContentLoaded', function() { setOfflineBanner(!navigator.onLine); });
if (document.readyState !== 'loading') { setOfflineBanner(!navigator.onLine); }

async function handleSend() {
  var text = (inputEl && inputEl.value.trim()) || '';
  if (!text && !attachedImageBase64) return;

  // Block sending when offline
  if (!navigator.onLine) {
    showToast('📡 No internet — can\'t send messages offline', 'offline');
    return;
  }

  if (inputEl) { inputEl.value = ''; autoGrow(inputEl); if (inputEl._resetHeight) inputEl._resetHeight(); }

  userProfile.messageCount = (userProfile.messageCount || 0) + 1;

  var hasImage    = !!attachedImageBase64;
  var imgData     = attachedImageBase64;
  var imgMime     = attachedImageMime;
  var humanImgSrc = null;
  if (hasImage) {
    humanImgSrc = 'data:' + imgMime + ';base64,' + imgData;
    userProfile.imageCount = (userProfile.imageCount || 0) + 1;
  }
  saveUserProfile();
  removeImage();

  htmlResult.push({ humanText: text, humanImage: humanImgSrc, aiText: '', thinking: true });

  if (htmlResult.length === 1) {
    updateChatTitle(currentChatId, (text.slice(0, 42) || 'Image message') + (text.length > 42 ? '...' : ''));
  }

  saveToStorage();
  renderMessages();

  var controller = new AbortController();
  currentController = controller;
  isSending = true;
  if (runBtn) runBtn.classList.add('sending');
  try { var lbl = runBtn && runBtn.querySelector('.btn-label'); if (lbl) lbl.textContent = 'Stop'; } catch(ex){}

  try {
    // Build last 20 messages as conversation history for full context (prevents response cuts)
    var convHistory = [];
    var histSlice = htmlResult.slice(-21, -1);
    for (var h = 0; h < histSlice.length; h++) {
      var entry = histSlice[h];
      if (entry.humanText) convHistory.push({ role: 'user',  text: entry.humanText });
      if (entry.aiText)    convHistory.push({ role: 'model', text: entry.aiText });
    }

    var body = {
      text:                 text,
      user_id:              getUserId(),
      user_email:           (session && session.email) || '',
      user_name:            (session && session.name)  || '',
      conversation_history: convHistory
    };
    if (hasImage) { body.image_base64 = imgData; body.image_mime = imgMime; }

    var resp = await fetch(SERVER_URL + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!resp.ok) throw new Error('Server error');
    var data  = await resp.json();
    var reply = data.reply || '[No response]';

    var li = htmlResult.length - 1;
    htmlResult[li].thinking = false;
    htmlResult[li].aiText   = reply;
    htmlResult[li].likes    = 0;
    htmlResult[li].dislikes = 0;

    renderMessages();
    speak(reply);

  } catch (err) {
    var li2 = htmlResult.length - 1;
    htmlResult[li2].thinking = false;
    if (err && err.name === 'AbortError') {
      htmlResult[li2].aiText = '[Cancelled]';
    } else {
      htmlResult[li2].aiText = text.length < 6
        ? 'Tell me a bit more so I can help.'
        : 'I hear you. Would you like advice or just to talk more?';
    }
    htmlResult[li2].likes    = 0;
    htmlResult[li2].dislikes = 0;
    renderMessages();
  } finally {
    isSending = false;
    currentController = null;
    if (runBtn) runBtn.classList.remove('sending');
    try { var lbl2 = runBtn && runBtn.querySelector('.btn-label'); if (lbl2) lbl2.textContent = 'Send'; } catch(ex2){}
    // Save to localStorage immediately, then flush to backend with no debounce delay
    const _c = getCurrentChat();
    if (_c) { _c.messages = htmlResult; _c.updatedAt = new Date().toISOString(); }
    try { localStorage.setItem(localStorageKey(), JSON.stringify(chatHistory)); } catch(e2){}
    syncToBackendNow();
  }
}

/* ══════════════════════════════════════════════════════
   EVENTS
══════════════════════════════════════════════════════ */
if (runBtn) {
  runBtn.addEventListener('click', function() {
    if (isSending) { if (currentController) currentController.abort(); runBtn.classList.remove('sending'); isSending = false; currentController = null; }
    else handleSend();
  });
}

document.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } });
if (newChatBtn) newChatBtn.addEventListener('click', function() { createNewChat(); });

if (mobileMenuToggle && mobileDropdown) {
  mobileMenuToggle.addEventListener('click', function(e) {
    e.preventDefault(); e.stopPropagation();
    var isOpen = mobileDropdown.classList.contains('active');
    var cpop = document.getElementById('camera-choice-popup');
    var udd  = document.getElementById('user-dropdown');
    if (cpop) cpop.classList.remove('show');
    if (udd)  udd.classList.remove('open');
    mobileDropdown.classList.toggle('active', !isOpen);
  });
}

document.addEventListener('pointerdown', function(e) {
  if (!mobileDropdown) return;
  var clickedToggle   = mobileMenuToggle && mobileMenuToggle.contains(e.target);
  var clickedDropdown = mobileDropdown.contains(e.target);
  if (!clickedToggle && !clickedDropdown) mobileDropdown.classList.remove('active');
}, true);

var chatInitArea = document.querySelector('.chat-initiate-response');
if (chatInitArea) {
  chatInitArea.addEventListener('pointerdown', function(e) {
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) e.preventDefault();
  });
}

function applyMobileLayout() {
  var isMobile = window.innerWidth < 600;
  if (mobileMenuToggle) mobileMenuToggle.style.display = isMobile ? 'flex' : 'none';
  var desktopBtns = document.querySelector('.desktop-buttons');
  if (desktopBtns) desktopBtns.style.display = isMobile ? 'none' : 'flex';
}
applyMobileLayout();
window.addEventListener('resize', applyMobileLayout);

/* ══════════════════════════════════════════════════════
   INIT  — loads chats from backend first, localStorage fallback
══════════════════════════════════════════════════════ */
async function init() {
  if (!loadSession()) return;
  initUserUI();
  updateVoiceButton();
  updateSpeechButton();
  updateSidebarState();
  initSpeechRecognition();

  // Chats load instantly from localStorage — no spinner needed
  var loaded = await loadChatHistoryFromBackend();

  if (!loaded || chatHistory.length === 0) {
    createNewChat();
  } else {
    currentChatId = chatHistory[0].id;
    htmlResult    = chatHistory[0].messages || [];
    loadChatsUI();
    renderMessages();
    // Restore likes/dislikes/comments from backend (survives server sleep)
    loadReactionsFromBackend();
    loadCommentsFromBackend();
  }

  // Check if this user is the top user (non-blocking, slight delay so page settles)
  setTimeout(checkTopUserStatus, 1500);

  // Periodically re-check top-user status every 90 seconds
  // so the user is notified if they gain or lose the #1 spot during the session
  if (_topUserInterval) clearInterval(_topUserInterval);
  _topUserInterval = setInterval(checkTopUserStatus, 90000);
}

init();
