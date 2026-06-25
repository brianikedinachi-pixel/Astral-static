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

function _pickBestVoice() {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  // Preference list — natural-sounding voices across platforms
  const prefs = [
    'Samantha','Karen','Moira','Victoria','Fiona',         // macOS/iOS natural
    'Google UK English Female','Google US English',         // Android/Chrome
    'Microsoft Aria Online','Microsoft Jenny Online',       // Windows Edge
    'en-US','en-GB','en-AU',                               // fallback by lang
  ];
  for (const pref of prefs) {
    const v = voices.find(v => v.name.includes(pref) || v.lang === pref);
    if (v) return v;
  }
  return voices.find(v => v.lang.startsWith('en')) || voices[0];
}

function _prepareTextForSpeech(text) {
  // Strip markdown
  let t = text
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/>\s?/g, '')
    .replace(/---+/g, '')
    .replace(/•\s/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // Add natural pauses for punctuation
  t = t
    .replace(/\.\.\./g, ', ')
    .replace(/([.!?])\s+/g, '$1 ')
    .trim();
  return t;
}

window._currentUtterance = null;
window._isSpeaking = false;

function stopSpeaking() {
  speechSynthesis.cancel();
  window._currentUtterance = null;
  window._isSpeaking = false;
  document.querySelectorAll('.msg-speak-btn.speaking').forEach(b => {
    b.classList.remove('speaking');
    b.title = 'Read aloud';
  });
}

function speak(text, onDone) {
  if (!voiceEnabled || !text) { if(onDone) onDone(); return; }
  speechSynthesis.cancel();
  const cleaned = _prepareTextForSpeech(text);
  if (!cleaned) { if(onDone) onDone(); return; }
  const u = new SpeechSynthesisUtterance(cleaned);
  // Natural speech settings
  u.rate   = 1.05;   // slightly brisk — feels more natural than exactly 1
  u.pitch  = 1.05;   // tiny lift — warmer tone
  u.volume = 1;
  const voice = _pickBestVoice();
  if (voice) u.voice = voice;
  u.onend   = () => { window._isSpeaking = false; window._currentUtterance = null; if(onDone) onDone(); };
  u.onerror = () => { window._isSpeaking = false; window._currentUtterance = null; if(onDone) onDone(); };
  window._currentUtterance = u;
  window._isSpeaking = true;
  // Fix bug where voices aren't loaded yet on first call
  if (!speechSynthesis.getVoices().length) {
    speechSynthesis.addEventListener('voiceschanged', function once() {
      speechSynthesis.removeEventListener('voiceschanged', once);
      const v2 = _pickBestVoice(); if (v2) u.voice = v2;
      speechSynthesis.speak(u);
    }, { once: true });
  } else {
    speechSynthesis.speak(u);
  }
}

function speakMessage(idx, btn) {
  const log = htmlResult[idx];
  if (!log || !log.aiText) return;
  if (btn && btn.classList.contains('speaking')) {
    stopSpeaking();
    return;
  }
  stopSpeaking();
  if (btn) {
    btn.classList.add('speaking');
    btn.title = 'Stop';
  }
  speak(log.aiText, () => {
    if (btn) { btn.classList.remove('speaking'); btn.title = 'Read aloud'; }
  });
}
window.speakMessage = speakMessage;

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

function _buildRecognition(opts) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  // Accuracy-boosting settings
  r.lang             = navigator.language || 'en-US';
  r.continuous       = opts.continuous   || false;
  r.interimResults   = opts.interim      || false;
  r.maxAlternatives  = 3;  // pick best alternative
  return r;
}

function _bestTranscript(ev) {
  // Pick the alternative with highest confidence
  let best = '', bestConf = -1;
  for (let i = 0; i < ev.results.length; i++) {
    const result = ev.results[i];
    if (!result.isFinal) continue;
    for (let j = 0; j < result.length; j++) {
      if (result[j].confidence > bestConf) {
        bestConf = result[j].confidence;
        best = result[j].transcript;
      }
    }
  }
  return best.trim();
}

function handleSpeechClick(e) {
  e.preventDefault(); e.stopPropagation();
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert('Speech recognition not supported. Use Chrome, Edge, or Safari.'); return; }
  if (speechEnabled && recognition) { recognition.stop(); return; }
  try {
    recognition = _buildRecognition({ continuous: false, interim: true });
    if (!recognition) return;

    let interimText = '';
    recognition.onstart = () => {
      speechEnabled = true;
      speechToggleBtns.forEach(b => { b?.classList.add('listening'); b?.setAttribute('aria-pressed','true'); });
      updateSpeechButton();
    };
    recognition.onresult = ev => {
      // Show interim text in input while user speaks
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) {
          interimText += ev.results[i][0].transcript;
        } else {
          interim += ev.results[i][0].transcript;
        }
      }
      if (inputEl) inputEl.value = interimText + interim;
      // When final result comes in, send
      if (interimText && !interim) {
        if (inputEl) inputEl.value = interimText.trim();
        handleSend();
      }
    };
    recognition.onerror = (ev) => {
      // Ignore no-speech errors silently
      if (ev.error !== 'no-speech') {
        speechEnabled = false;
        speechToggleBtns.forEach(b => { b?.classList.remove('listening'); b?.setAttribute('aria-pressed','false'); });
        updateSpeechButton();
      }
    };
    recognition.onend = () => {
      speechEnabled = false;
      speechToggleBtns.forEach(b => { b?.classList.remove('listening'); b?.setAttribute('aria-pressed','false'); });
      updateSpeechButton();
    };
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

  // Show preview immediately so user sees feedback right away
  const previewUrl = URL.createObjectURL(file);
  document.getElementById('img-thumb').src = previewUrl;
  document.getElementById('img-fname').textContent = file.name.length > 34 ? file.name.slice(0,34)+'...' : file.name;
  document.getElementById('img-preview-bar').classList.add('show');

  // Compress via canvas before encoding — phone camera photos can be 8–15 MB raw.
  // This resizes to max 1024px on the longest side and re-encodes as JPEG at 0.82 quality.
  // Result is typically 100–250 KB, sending in ~0.2s instead of 3–8s.
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(previewUrl);
    const MAX = 1024;
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (w > MAX || h > MAX) {
      if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
      else        { w = Math.round(w * MAX / h); h = MAX; }
    }
    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    attachedImageBase64 = dataUrl.split(',')[1];
    attachedImageMime   = 'image/jpeg';
    // Update thumb with compressed version
    document.getElementById('img-thumb').src = dataUrl;
  };
  img.onerror = () => {
    // Fallback to raw if image fails to load into canvas
    URL.revokeObjectURL(previewUrl);
    const reader = new FileReader();
    reader.onload = (e) => {
      const parts = e.target.result.split(',');
      attachedImageBase64 = parts[1];
      attachedImageMime   = file.type || 'image/jpeg';
      document.getElementById('img-thumb').src = e.target.result;
    };
    reader.readAsDataURL(file);
  };
  img.src = previewUrl;

  event.target.value = '';
};

window.removeImage = function() {
  attachedImageBase64 = null;
  attachedImageMime   = null;
  document.getElementById('img-preview-bar').classList.remove('show');
};

// ── CONVERT IMAGE TO DOC ─────────────────────────────────────────────────────
// Formats that go straight to download (binary / not previewable as text)
const DIRECT_DOWNLOAD_FMTS = new Set(['zip', 'docx', 'pdf']);

// In-memory store: fileId → { blob, filename, fmt, textContent }
const _convertedFiles = {};

function _fileIcon(fmt) {
  const map = { docx:'📝', txt:'📄', html:'🌐', md:'📋', js:'📜', py:'🐍', json:'📦', css:'🎨', zip:'🗜️' };
  return map[fmt] || '📄';
}

// Inject a file card into the current chat as a special log entry
function _injectFileCard(fileId, filename, fmt) {
  var entry = { humanText: '', aiText: '', _fileCard: { fileId: fileId, filename: filename, fmt: fmt } };
  htmlResult.push(entry);
  var chat = getCurrentChat();
  if (chat) { chat.messages = htmlResult; }
  saveToStorage();
  renderMessages();
}

// Called when user clicks a file card
window.openFilePreview = function(fileId) {
  var entry = _convertedFiles[fileId];
  if (!entry) return;

  // ZIP / DOCX / binary → straight download
  if (DIRECT_DOWNLOAD_FMTS.has(entry.fmt)) {
    _triggerDownload(entry.blob, entry.filename);
    return;
  }

  // Text-based → show preview modal
  _ensureFilePreviewModal();
  var modal   = document.getElementById('file-preview-modal');
  var title   = document.getElementById('fpm-title');
  var content = document.getElementById('fpm-content');
  var dlBtn   = document.getElementById('fpm-download-btn');

  title.textContent   = entry.filename;
  content.textContent = entry.textContent || '(empty)';
  dlBtn.onclick       = function() { _triggerDownload(entry.blob, entry.filename); };
  modal.classList.add('show');
};

window.closeFilePreview = function() {
  var m = document.getElementById('file-preview-modal');
  if (m) m.classList.remove('show');
};

function _triggerDownload(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a   = document.createElement('a');
  a.href  = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function() { URL.revokeObjectURL(url); }, 2000);
}

function _ensureFilePreviewModal() {
  if (document.getElementById('file-preview-modal')) return;
  var m = document.createElement('div');
  m.id  = 'file-preview-modal';
  m.innerHTML =
    '<div class="fpm-backdrop" onclick="closeFilePreview()"></div>' +
    '<div class="fpm-box">' +
      '<div class="fpm-header">' +
        '<span id="fpm-title" class="fpm-title"></span>' +
        '<div class="fpm-header-btns">' +
          '<button id="fpm-download-btn" class="fpm-dl-btn">⬇ Download</button>' +
          '<button class="fpm-close-btn" onclick="closeFilePreview()">✕</button>' +
        '</div>' +
      '</div>' +
      '<pre id="fpm-content" class="fpm-content"></pre>' +
    '</div>';
  document.body.appendChild(m);
}

window.convertImageToDoc = async function() {
  if (!attachedImageBase64) return;

  const fmt = document.getElementById('convert-format-select')?.value || 'docx';
  const btn = document.getElementById('convert-doc-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Converting…'; }

  try {
    const resp = await fetch(SERVER_URL + '/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: attachedImageBase64,
        image_mime:   attachedImageMime || 'image/jpeg',
        format:       fmt,
        user_email:   (session && session.email) || ''
      })
    });

    if (!resp.ok) {
      const err = await resp.json().catch(function() { return { detail: resp.statusText }; });
      throw new Error(err.detail || 'Conversion failed');
    }

    const blob     = await resp.blob();
    const filename = 'converted.' + fmt;
    const fileId   = 'f_' + Date.now();

    // For text formats, read the text content for preview
    let textContent = null;
    if (!DIRECT_DOWNLOAD_FMTS.has(fmt)) {
      textContent = await blob.text();
    }

    _convertedFiles[fileId] = { blob, filename, fmt, textContent };

    if (btn) { btn.disabled = false; btn.textContent = '📄 Convert'; }
    window.removeImage();

    // Inject card — user clicks it to preview or download, no auto-download
    _injectFileCard(fileId, filename, fmt);
    // Auto-open preview for text-based formats
    if (!DIRECT_DOWNLOAD_FMTS.has(fmt)) {
      setTimeout(function() { window.openFilePreview(fileId); }, 150);
    }

  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '📄 Convert'; }
    alert('Convert failed: ' + e.message);
  }
};
// ─────────────────────────────────────────────────────────────────────────────

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
                // Refresh sidebar quietly with latest data.
                // NEVER overwrite htmlResult while a message is being sent —
                // doing so wipes the current user message + AI reply + file card.
                const stillCurrent = chatHistory.find(c => c.id === currentChatId);
                if (!stillCurrent && chatHistory.length > 0 && !isSending) {
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
  if (typeof _convoMode !== 'undefined' && _convoMode && !_convoMinimized) _minimizeConvo();
  const id = Date.now().toString();
  chatHistory.unshift({ id, title: 'New Chat', messages: [], updatedAt: new Date().toISOString() });
  currentChatId = id;
  htmlResult    = [];
  saveChatsToStorage();
  loadChatsUI();
  renderMessages();
  // Brief glow intro on empty state
  var es = document.getElementById('empty-state');
  if (es) {
    es.classList.remove('es-intro');
    void es.offsetWidth; // force reflow
    es.classList.add('es-intro');
    setTimeout(function() { es.classList.remove('es-intro'); }, 900);
  }
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
  if (typeof _convoMode !== 'undefined' && _convoMode && !_convoMinimized) _minimizeConvo();
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

/* ══════════════════════════════════════════════════════
   EMPTY STATE
══════════════════════════════════════════════════════ */
function updateEmptyState() {
  var es = document.getElementById('empty-state');
  if (!es) return;
  var hasMessages = htmlResult.some(function(l) {
    return (l.humanText || l.humanImage || l.aiText || l._fileCard);
  });
  es.classList.toggle('hidden', hasMessages);
}

window.useChip = function(btn) {
  if (!inputEl) return;
  inputEl.value = btn.textContent.replace(/^[^\s]+\s/, '').trim();
  inputEl.focus();
  autoGrow(inputEl);
};

/* ══════════════════════════════════════════════════════
   ACTIVITY LOG STRIP  (SSE from /stream-log)
══════════════════════════════════════════════════════ */
var _activitySSE    = null;
var _activityTimer  = null;
var _activityActive = false;

var _STAGE_LABELS = {
  'web':     '🌐 Searching the web for',
  'filegen': '📄 Creating your file',
  'gemini':  '',
  'mem':     '',
};

function _setInlineLog(text) {
  // Find the active thinking-log in the DOM and update its text
  var tlTexts = document.querySelectorAll('.tl-text');
  if (tlTexts.length) {
    var last = tlTexts[tlTexts.length - 1];
    last.textContent = text;
    // Hide/show the text container based on whether there's a label
    if (!text) {
      last.style.display = 'none';
    } else {
      last.style.display = 'inline';
    }
  }
}

function _startActivitySSE() {
  if (_activitySSE) { try { _activitySSE.close(); } catch(e){} }
  _activitySSE = new EventSource(SERVER_URL + '/stream-log');
  _activitySSE.onmessage = function(e) {
    if (!_activityActive) return;
    try {
      var data  = JSON.parse(e.data);
      var label = _STAGE_LABELS[data.stage];
      if (!label) return;
      var snippet = '';
      if (data.stage === 'web' && data.msg) {
        // Show query in parens, cut at 32 chars so the whole line stays short
        var q = data.msg.trim();
        if (q.length > 32) q = q.slice(0, 32) + '…';
        snippet = ' (' + q + ')';
      }
      _setInlineLog(label + snippet);
    } catch(ex) {}
  };
  _activitySSE.onerror = function() {
    setTimeout(function() { if (_activityActive) _startActivitySSE(); }, 5000);
  };
}

function _startActivity() {
  _activityActive = true;
  _setInlineLog('');  // arc spins silently until a real stage fires
  _startActivitySSE();
  clearTimeout(_activityTimer);
  _activityTimer = setTimeout(_stopActivity, 60000);
}

function _stopActivity() {
  _activityActive = false;
  clearTimeout(_activityTimer);
  if (_activitySSE) { try { _activitySSE.close(); } catch(e){} _activitySSE = null; }
  // Clear the UI text so it doesn't leak into the next message
  _setInlineLog('');
}
/* ─────────────────────────────────────────────────────────────────────────── */

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
    var html = marked.parse(text);
    // Wrap every <pre><code> in a code-block-wrap with a copy button
    html = html.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g, function(match, attrs, code) {
      var lang = '';
      var m = attrs.match(/class="language-([^"]+)"/);
      if (m) lang = m[1];
      return '<div class="code-block-wrap">' +
        (lang ? '<span class="code-lang">' + lang + '</span>' : '') +
        '<button class="copy-code-btn" onclick="copyCode(this)" title="Copy code">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
          'Copy' +
        '</button>' +
        '<pre><code' + attrs + '>' + code + '</code></pre>' +
      '</div>';
    });
    return html;
  } catch { return '<p>' + escHtml(text) + '</p>'; }
}

window.copyCode = function(btn) {
  var pre = btn.parentElement.querySelector('pre code');
  if (!pre) return;
  var text = pre.innerText || pre.textContent || '';
  navigator.clipboard.writeText(text).then(function() {
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Copied!';
    btn.classList.add('copied');
    setTimeout(function() {
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy';
      btn.classList.remove('copied');
    }, 2000);
  }).catch(function() {
    // fallback
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta);
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy'; }, 2000);
  });
};

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
    // NOTE: _fileCard entries no longer get an early-return here.
    // They are rendered inline inside the AI bubble further below,
    // so the AI text and file card appear together in one message.

    var humanPart = '';
    if (log.humanText || log.humanImage) {
      humanPart = '<div class="human-response">' +
        (log.humanImage ? '<img class="chat-img" src="' + log.humanImage + '" alt="Attached image">' : '') +
        (log.humanText  ? '<p class="text">' + escHtml(log.humanText) + '</p>' : '') +
        '</div>';
    }

    var aiPart = '';
    if (log.thinking || (log.aiText !== undefined && log.aiText !== '') || log._fileCard) {
      aiPart = '<div class="ai-response">';
      if (log.thinking) {
        aiPart += '<div class="thinking-log" id="thinking-log-' + idx + '">' +
          '<div class="tl-row"><span class="tl-arc"><span></span></span><span class="tl-text" id="tl-text-' + idx + '" style="display:none;"></span></div>' +
        '</div>';
      } else {
        // AI content
        if (log.aiText) {
          aiPart += '<div class="ai-content">' + renderMarkdown(log.aiText) + '</div>';
        }

        // ── File card inside AI response ──
        if (log._fileCard) {
          var fc  = log._fileCard;
          var ico = _fileIcon(fc.fmt);
          var isBinary = DIRECT_DOWNLOAD_FMTS.has(fc.fmt);
          var hint = isBinary ? 'Click to download' : 'Click to preview & download';
          aiPart += '<div class="file-card" onclick="openFilePreview(\'' + fc.fileId + '\')" title="' + hint + '" style="margin-top:10px;">' +
              '<span class="fc-icon">' + ico + '</span>' +
              '<div class="fc-info">' +
                '<span class="fc-name">' + escHtml(fc.filename) + '</span>' +
                '<span class="fc-hint">' + hint + '</span>' +
              '</div>' +
              '<span class="fc-arrow">' + (isBinary ? '⬇' : '👁') + '</span>' +
            '</div>';
        }

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
          '<button class="react-btn msg-speak-btn" onclick="speakMessage(' + idx + ', this)" title="Read aloud">' +
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 5L6 9H3v6h3l5 4z" fill="currentColor" stroke="none"/><path d="M16 8a4 4 0 0 1 0 8" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>' +
          '</button>' +
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
  updateEmptyState();
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
    document.body.classList.add('is-offline');
    if (sendArea) sendArea.classList.add('offline-mode');
    if (runBtnEl) { runBtnEl.disabled = true; runBtnEl.title = 'No internet connection'; }
  } else {
    banner.classList.remove('visible');
    document.body.classList.remove('is-offline');
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

// Banner only appears/disappears when connection actually changes during use
var _pageLoadTime = Date.now();
window.addEventListener('online', function() {
  setOfflineBanner(false);
  showToast('✅ Back online — you can send messages again', 'online');
});
window.addEventListener('offline', function() {
  // Ignore offline events in the first 2s — browsers sometimes fire these
  // spuriously when the service worker serves the page from cache
  if (Date.now() - _pageLoadTime < 2000) return;
  setOfflineBanner(true);
  showToast('📡 You\'re offline — chats are still viewable', 'offline');
});

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
  _startActivity();

  try {
    // Build last 20 messages as conversation history for full context (prevents response cuts)
    var convHistory = [];
    var histSlice = htmlResult.slice(-21, -1);
    for (var h = 0; h < histSlice.length; h++) {
      var entry = histSlice[h];
      if (entry.humanText) convHistory.push({ role: 'user',  text: entry.humanText });
      if (entry.aiText) {
        var aiMsg = entry.aiText;
        if (entry._fileCard) aiMsg += "\n\n[File Generated: " + entry._fileCard.filename + "]";
        convHistory.push({ role: 'model', text: aiMsg });
      }
    }

    var body = {
      text:                 text,
      user_id:              getUserId(),
      user_email:           (session && session.email) || '',
      user_name:            (session && session.name)  || '',
      conversation_history: convHistory
    };
    if (hasImage) { body.image_base64 = imgData; body.image_mime = imgMime; }

    // Capture the target message index and chat ID to prevent race conditions
    var targetIdx = htmlResult.length - 1;
    var targetChatId = currentChatId;

    var resp = await fetch(SERVER_URL + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!resp.ok) throw new Error('Server error');
    var data  = await resp.json();
    var reply = data.reply || '[No response]';

    // Verify we are still in the same chat and message before applying updates
    if (currentChatId !== targetChatId) {
      console.warn('Chat switched during request. Finding target chat to update.');
      var targetChat = chatHistory.find(c => c.id === targetChatId);
      if (targetChat) {
        var targetMsg = targetChat.messages[targetIdx];
        if (targetMsg) {
          targetMsg.thinking = false;
          targetMsg.aiText = reply;
          targetMsg.likes = 0;
          targetMsg.dislikes = 0;
        }
      }
    } else {
      htmlResult[targetIdx].thinking = false;
      htmlResult[targetIdx].aiText   = reply;
      htmlResult[targetIdx].likes    = 0;
      htmlResult[targetIdx].dislikes = 0;
    }

    // ── Auto file card from AI ───────────────────────────────────────────────
    if (data.file_card) {
      console.log('File card received:', data.file_card.filename);
      var fc      = data.file_card;
      var fileId  = 'f_' + Date.now();

      // Decode base64 → Blob (chunked — faster on large files)
      var _fcBlob = (function(b64, mime) {
        try {
          var bin = atob(b64), len = bin.length, CHUNK = 8192, parts = [];
          for (var o = 0; o < len; o += CHUNK) {
            var sz = Math.min(CHUNK, len - o), arr = new Uint8Array(sz);
            for (var j = 0; j < sz; j++) arr[j] = bin.charCodeAt(o + j);
            parts.push(arr);
          }
          return new Blob(parts, { type: mime });
        } catch(e) { console.error('Base64 decode failed:', e); return null; }
      })(fc.data_b64, fc.mime);

      if (_fcBlob) {
        var _fcName = (fc.filename && fc.filename.trim())
          ? fc.filename
          : (text.trim().replace(/[^\w\s]/g, '').split(/\s+/).slice(0, 5).join('_').toLowerCase() || 'document') + '.' + fc.ext;

        _convertedFiles[fileId] = {
          blob:        _fcBlob,
          filename:    _fcName,
          fmt:         fc.ext,
          textContent: fc.text_preview || null
        };

        // Attach card to the correct chat/message even if user switched away
        var targetChat = chatHistory.find(c => c.id === targetChatId);
        if (targetChat && targetChat.messages[targetIdx]) {
          targetChat.messages[targetIdx]._fileCard = { fileId: fileId, filename: _fcName, fmt: fc.ext };
          // If we are still in this chat, htmlResult is a reference to targetChat.messages
          // but we save the whole history anyway
          saveChatsToStorage();
        }
      }
    }
    // ────────────────────────────────────────────────────────────────────────

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
    _stopActivity();
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
/* ══════════════════════════════════════════════════════
   EMPTY STATE — Task 6
══════════════════════════════════════════════════════ */
function _injectEmptyState() {
  if (document.getElementById('empty-state')) return;
  const mainEl = document.querySelector('main');
  if (!mainEl) return;
  const es = document.createElement('div');
  es.id = 'empty-state';
  es.innerHTML = `
    <div class="es-stars">
      <span class="es-star"></span><span class="es-star"></span>
      <span class="es-star"></span><span class="es-star"></span>
      <span class="es-star"></span><span class="es-star"></span>
    </div>
    <div class="es-body">
      <div class="es-logo-wrap">
        <img class="es-logo" src="img/logo.jpg" alt="Astral">
        <div class="es-glow"></div>
      </div>
      <div class="es-greeting" id="es-greeting">Hey there 👋</div>
      <div class="es-title">ASTRAL</div>
      <div class="es-sub">Your AI companion — always here, never judging. What's on your mind?</div>
      <div class="es-chips">
        <button class="es-chip" onclick="useChip(this)">💙 I'm struggling today</button>
        <button class="es-chip" onclick="useChip(this)">🔥 Day ${_getStreakDay()} of my recovery</button>
        <button class="es-chip" onclick="useChip(this)">🧠 Help me think through something</button>
        <button class="es-chip" onclick="useChip(this)">📚 Explain something to me</button>
      </div>
    </div>`;
  mainEl.appendChild(es);
  _updateEsGreeting();
}

function _getStreakDay() { return '1'; }

function _updateEsGreeting() {
  const el = document.getElementById('es-greeting');
  if (!el) return;
  const h = new Date().getHours();
  const session = (() => { try { return JSON.parse(localStorage.getItem('astral_session') || 'null'); } catch(e){return null;} })();
  const name = session?.name ? ', ' + session.name.split(' ')[0] : '';
  let greet = h < 12 ? 'Good morning' + name + ' ☀️'
            : h < 18 ? 'Hey' + name + ' 👋'
            : 'Good evening' + name + ' 🌙';
  el.textContent = greet;
}

/* ══════════════════════════════════════════════════════
   CONVERSATION MODE
   A floating orb replaces the input bar — no "on a call"
   screen takeover. The chat itself stays visible behind it,
   just gently recoloured (see CSS). Step away within the app
   (switch chats, open a new one, background the tab) and a
   tiny draggable bubble keeps watch up top until you tap it.
══════════════════════════════════════════════════════ */
let _convoMode       = false;
let _convoRecognition = null;
let _convoStartTime  = null;
let _convoWakeLock   = null;
let _convoHistory    = [];
let _convoThinking   = false;
let _convoMuted      = false;
let _convoMinimized  = false;
let _convoWasHidden  = false;
const _SERVER_URL_CONVO = (typeof SERVER_URL !== 'undefined' ? SERVER_URL : 'https://astral-1-sb1i.onrender.com') + '/convo-chat';

// Thinking fillers Astral says while processing (and, now, while it's web-searching)
const _CONVO_THINKING_SOUNDS = [
  "Hmmmm...", "Let me think...", "Interesting...", "Give me a sec...",
  "Hmm, okay...", "Right, so...", "I hear you..."
];

function _convoThinkFiller() {
  const r = _CONVO_THINKING_SOUNDS[Math.floor(Math.random() * _CONVO_THINKING_SOUNDS.length)];
  _speakConvo(r, true); // true = filler, don't add to history, don't change orb state
}

// ── Orb state + the per-word glow ───────────────────────────────────────────
function _setConvoState(state) {
  const wrap = document.getElementById('convo-orb-wrap');
  if (!wrap) return;
  wrap.classList.remove('state-listening', 'state-thinking', 'state-speaking');
  wrap.classList.add('state-' + state);
  const status = document.getElementById('convo-status-text');
  if (status) {
    status.textContent = state === 'thinking' ? 'Thinking…' : state === 'speaking' ? '' : 'Listening…';
  }
}

function _triggerWordPulse() {
  const orb = document.getElementById('convo-orb-btn');
  if (!orb) return;
  orb.classList.remove('word-pulse');
  void orb.offsetWidth; // restart the CSS animation
  orb.classList.add('word-pulse');
}

function _speakConvo(text, isFiller) {
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05; u.pitch = 1.05; u.volume = 1;
  const voice = _pickBestVoice ? _pickBestVoice() : null;
  if (voice) u.voice = voice;

  if (!isFiller) _setConvoState('speaking');

  // Glow pulses on each word as Astral speaks. Chrome/Edge fire real word
  // boundaries; browsers that don't support it fall back to a steady rhythm
  // so the orb still feels alive while talking.
  let gotBoundary = false;
  let fallbackPulse = null;
  u.onboundary = () => { gotBoundary = true; _triggerWordPulse(); };
  u.onstart = () => {
    setTimeout(() => {
      if (!gotBoundary && !fallbackPulse) fallbackPulse = setInterval(_triggerWordPulse, 260);
    }, 300);
  };
  const stopFallback = () => { if (fallbackPulse) { clearInterval(fallbackPulse); fallbackPulse = null; } };

  if (!isFiller) {
    u.onend = () => {
      stopFallback();
      _convoThinking = false;
      // Resume listening after AI finishes speaking
      if (_convoMode) { _setConvoState('listening'); _convoStartListening(); }
    };
  } else {
    u.onend = stopFallback;
  }

  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function _convoAddBubble(role, text) {
  // Add to convo history for backend
  _convoHistory.push({ role: role === 'user' ? 'user' : 'model', text });
  // Add to main htmlResult as a real message
  if (role === 'user') {
    htmlResult.push({ humanText: text, aiText: '', thinking: false, likes: 0, dislikes: 0 });
  } else {
    var li = htmlResult.length - 1;
    if (li >= 0 && htmlResult[li].aiText === '' && !htmlResult[li].humanText) {
      htmlResult[li].aiText = text;
    } else {
      htmlResult.push({ humanText: '', aiText: text, thinking: false, likes: 0, dislikes: 0 });
    }
  }
  var chat = getCurrentChat();
  if (chat) { chat.messages = htmlResult; chat.updatedAt = new Date().toISOString(); }
  renderMessages();
  scrollToBottom();
}

async function _convoSendToAI(userText) {
  if (_convoThinking) return;
  _convoThinking = true;
  _setConvoState('thinking');

  // Add user bubble
  _convoAddBubble('user', userText);

  // Say thinking filler immediately
  _convoThinkFiller();

  try {
    const session = (() => { try { return JSON.parse(localStorage.getItem('astral_session') || 'null'); } catch(e){return null;} })();
    const body = {
      text: userText,
      user_id: session?.email || 'anon',
      user_email: session?.email || '',
      user_name: session?.name || '',
      // Backend still runs web search when the question needs it — only the
      // reply length/style is optimised for voice, not the information used.
      conversation_history: _convoHistory.slice(-12)
    };
    const resp = await fetch(_SERVER_URL_CONVO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    const reply = data.reply || "Hmm, I missed that.";
    _convoAddBubble('ai', reply);
    speechSynthesis.cancel();
    _speakConvo(reply, false);
  } catch(e) {
    _convoThinking = false;
    _speakConvo("Sorry, something went wrong. Say it again?", false);
  }
}

function _convoStartListening() {
  if (!_convoMode || _convoThinking || _convoMuted) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  if (_convoRecognition) { try { _convoRecognition.abort(); } catch(e){} }
  _setConvoState('listening');
  const r = new SR();
  r.lang = navigator.language || 'en-US';
  r.continuous = false;
  r.interimResults = true;
  r.maxAlternatives = 3;
  _convoRecognition = r;

  r.onresult = (ev) => {
    let interim = '', final_ = '';
    for (let i = 0; i < ev.results.length; i++) {
      if (ev.results[i].isFinal) {
        let best = '', bestC = -1;
        for (let j = 0; j < ev.results[i].length; j++) {
          if (ev.results[i][j].confidence > bestC) { bestC = ev.results[i][j].confidence; best = ev.results[i][j].transcript; }
        }
        final_ += best;
      } else {
        interim += ev.results[i][0].transcript;
      }
    }
    const status = document.getElementById('convo-status-text');
    if (status) status.textContent = interim || final_ || 'Listening…';
    if (final_.trim()) {
      if (status) status.textContent = '';
      _convoSendToAI(final_.trim());
    }
  };
  r.onerror = (ev) => {
    if (ev.error === 'no-speech') {
      // restart quietly
      if (_convoMode && !_convoMuted) setTimeout(_convoStartListening, 300);
    }
  };
  r.onend = () => {
    // Auto-restart unless we're thinking, muted, or mode is off
    if (_convoMode && !_convoThinking && !_convoMuted) setTimeout(_convoStartListening, 300);
  };
  try { r.start(); } catch(e) {}
}

function _toggleConvoMute() {
  _convoMuted = !_convoMuted;
  const wrap = document.getElementById('convo-orb-wrap');
  const status = document.getElementById('convo-status-text');
  if (_convoMuted) {
    wrap?.classList.add('state-muted');
    if (_convoRecognition) { try { _convoRecognition.abort(); } catch(e){} }
    if (status) status.textContent = 'Muted';
  } else {
    wrap?.classList.remove('state-muted');
    _convoStartListening();
  }
}

async function startConvoMode() {
  // Check if this is PWA/app or website
  const isPWA = window.matchMedia('(display-mode: standalone)').matches
             || window.navigator.standalone === true
             || document.referrer.includes('android-app://');
  if (!isPWA) {
    _showGetAppPopup();
    return;
  }
  _convoMode      = true;
  _convoHistory   = [];
  _convoStartTime = Date.now();
  _convoThinking  = false;
  _convoMuted     = false;
  _convoMinimized = false;
  _convoWasHidden = false;
  document.body.classList.add('convo-mode');
  document.body.classList.remove('convo-minimized');
  _injectConvoOrb();
  // Try wake lock to keep screen on
  if ('wakeLock' in navigator) {
    try { _convoWakeLock = await navigator.wakeLock.request('screen'); } catch(e) {}
  }
  // Register background notification via service worker (covers truly leaving the app)
  _registerConvoNotification();
  // Brief intro then start listening
  setTimeout(() => {
    _speakConvo("Hey, I'm listening. What's on your mind?", false);
  }, 400);
}

function stopConvoMode() {
  _convoMode      = false;
  _convoMinimized = false;
  _convoMuted     = false;
  _convoWasHidden = false;
  speechSynthesis.cancel();
  if (_convoRecognition) { try { _convoRecognition.abort(); } catch(e){} _convoRecognition = null; }
  if (_convoWakeLock) { try { _convoWakeLock.release(); } catch(e){} _convoWakeLock = null; }
  document.body.classList.remove('convo-mode', 'convo-minimized');
  _hideConvoPopovers();
  _removeConvoUI();
  _unregisterConvoNotification();
}
window.stopConvoMode = stopConvoMode;

// ── The orb itself + the tiny "still going" bubble ──────────────────────────
function _injectConvoOrb() {
  document.getElementById('convo-orb-wrap')?.remove();
  document.getElementById('convo-orb-mini')?.remove();
  _hideConvoPopovers();

  const wrap = document.createElement('div');
  wrap.id = 'convo-orb-wrap';
  wrap.className = 'state-listening';
  wrap.innerHTML = `
    <div id="convo-status-text"></div>
    <div class="convo-orb-stack">
      <button id="convo-orb-btn" class="convo-orb-btn" type="button" aria-label="Conversation active — tap to stop"></button>
      <button id="convo-mute-btn" class="convo-mute-btn" type="button" aria-label="Mute microphone">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 19v3M8 22h8"/>
        </svg>
      </button>
    </div>`;
  document.body.appendChild(wrap);

  const mini = document.createElement('button');
  mini.id = 'convo-orb-mini';
  mini.type = 'button';
  mini.setAttribute('aria-label', 'Conversation active — tap for options');
  document.body.appendChild(mini);

  document.getElementById('convo-orb-btn').addEventListener('click', () => {
    document.querySelector('.convo-popover') ? _hideConvoPopovers() : _showOrbPopover();
  });
  document.getElementById('convo-mute-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    _toggleConvoMute();
  });
  _makeMiniDraggable(mini);
}

function _removeConvoUI() {
  document.getElementById('convo-orb-wrap')?.remove();
  document.getElementById('convo-orb-mini')?.remove();
}

function _hideConvoPopovers() {
  document.querySelectorAll('.convo-popover').forEach(el => el.remove());
}

function _showOrbPopover() {
  _hideConvoPopovers();
  const wrap = document.getElementById('convo-orb-wrap');
  if (!wrap) return;
  const pop = document.createElement('div');
  pop.className = 'convo-popover convo-popover--orb';
  pop.innerHTML = `<p>Stop the conversation?</p>
    <div class="convo-popover-row">
      <button type="button" class="convo-popover-btn convo-popover-cancel">Keep going</button>
      <button type="button" class="convo-popover-btn convo-popover-stop">Stop</button>
    </div>`;
  wrap.appendChild(pop);
  pop.querySelector('.convo-popover-stop').addEventListener('click', stopConvoMode);
  pop.querySelector('.convo-popover-cancel').addEventListener('click', () => pop.remove());
}

function _showMiniPopover() {
  _hideConvoPopovers();
  const mini = document.getElementById('convo-orb-mini');
  if (!mini) return;
  const rect = mini.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'convo-popover convo-popover--mini';
  pop.innerHTML = `<p>Conversation is still going</p>
    <div class="convo-popover-row">
      <button type="button" class="convo-popover-btn convo-popover-cancel">Resume</button>
      <button type="button" class="convo-popover-btn convo-popover-stop">Stop</button>
    </div>`;
  document.body.appendChild(pop);

  const popW = 208;
  let left = rect.left + rect.width / 2 - popW / 2;
  left = Math.max(8, Math.min(window.innerWidth - popW - 8, left));
  let top = rect.bottom + 10;
  if (top + 96 > window.innerHeight) top = Math.max(8, rect.top - 100);
  pop.style.left = left + 'px';
  pop.style.top  = top + 'px';

  pop.querySelector('.convo-popover-stop').addEventListener('click', stopConvoMode);
  pop.querySelector('.convo-popover-cancel').addEventListener('click', () => { pop.remove(); _restoreConvo(); });
}

function _makeMiniDraggable(el) {
  let dragging = false, moved = false, startX = 0, startY = 0, origX = 0, origY = 0;
  el.addEventListener('pointerdown', (e) => {
    dragging = true; moved = false;
    startX = e.clientX; startY = e.clientY;
    const rect = el.getBoundingClientRect();
    origX = rect.left; origY = rect.top;
    try { el.setPointerCapture(e.pointerId); } catch(err) {}
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    if (!moved) return;
    let nx = origX + dx, ny = origY + dy;
    nx = Math.max(6, Math.min(window.innerWidth - el.offsetWidth - 6, nx));
    ny = Math.max(6, Math.min(window.innerHeight - el.offsetHeight - 6, ny));
    el.style.left = nx + 'px'; el.style.top = ny + 'px'; el.style.right = 'auto';
  });
  el.addEventListener('pointerup', () => {
    dragging = false;
    if (!moved) {
      document.querySelector('.convo-popover') ? _hideConvoPopovers() : _showMiniPopover();
    }
  });
}

// ── Minimize / restore — used when the user steps away from the live view ──
function _minimizeConvo() {
  if (!_convoMode || _convoMinimized) return;
  _convoMinimized = true;
  _hideConvoPopovers();
  document.body.classList.add('convo-minimized');
  document.getElementById('convo-orb-mini')?.classList.add('show');
}

function _restoreConvo() {
  if (!_convoMode) return;
  _convoMinimized = false;
  document.body.classList.remove('convo-minimized');
  document.getElementById('convo-orb-mini')?.classList.remove('show');
  _hideConvoPopovers();
}
window._restoreConvo = _restoreConvo;

// Tab/app backgrounded then returned to → show the mini bubble rather than
// dropping the full orb back in the user's face.
document.addEventListener('visibilitychange', () => {
  if (!_convoMode) return;
  if (document.hidden) {
    _convoWasHidden = true;
  } else if (_convoWasHidden) {
    _convoWasHidden = false;
    _minimizeConvo();
  }
});

function _showGetAppPopup() {
  let popup = document.getElementById('get-app-popup');
  if (popup) { popup.classList.add('show'); return; }
  popup = document.createElement('div');
  popup.id = 'get-app-popup';
  popup.innerHTML = `
    <div class="gap-backdrop" onclick="document.getElementById('get-app-popup').classList.remove('show')"></div>
    <div class="gap-box">
      <div class="gap-icon">📱</div>
      <h3 class="gap-title">Get the Astral App</h3>
      <p class="gap-sub">Conversation mode is only available in the Astral app for the best experience — continuous listening, background mode, and real notifications.</p>
      <button class="gap-btn" onclick="_installOrClose()">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v13M5 9l7 7 7-7"/><path d="M3 20h18" stroke-linecap="round"/></svg>
        Install App
      </button>
      <button class="gap-close" onclick="document.getElementById('get-app-popup').classList.remove('show')">Maybe later</button>
    </div>`;
  document.body.appendChild(popup);
  setTimeout(() => popup.classList.add('show'), 10);
}

function _installOrClose() {
  if (typeof installApp === 'function') {
    installApp();
  }
  document.getElementById('get-app-popup')?.classList.remove('show');
}
window._installOrClose = _installOrClose;

function _registerConvoNotification() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then(reg => {
    // Post message to SW to track conversation mode
    reg.active?.postMessage({ type: 'CONVO_START', startTime: _convoStartTime });
  }).catch(() => {});
}

function _unregisterConvoNotification() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then(reg => {
    reg.active?.postMessage({ type: 'CONVO_STOP' });
  }).catch(() => {});
}

window.startConvoMode = startConvoMode;


async function init() {
  if (!loadSession()) return;
  initUserUI();
  updateVoiceButton();
  updateSpeechButton();
  updateSidebarState();
  initSpeechRecognition();
  _injectEmptyState();

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

// Listen for messages from service worker (e.g. stop convo from notification)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (ev) => {
    if (ev.data?.type === 'STOP_CONVO' && _convoMode) {
      stopConvoMode();
    }
  });
  // Request notification permission when needed
  window._requestNotifPermission = function() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  };
}

init();
