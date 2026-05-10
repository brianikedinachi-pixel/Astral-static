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
window.doLogout = () => { localStorage.removeItem('astral_session'); window.location.href = 'index.html'; };
window.goSettings = () => alert('Settings\n\nName: ' + session.name + '\nEmail: ' + session.email + '\nMessages sent: ' + (userProfile.messageCount||0) + '\nImages sent: ' + (userProfile.imageCount||0));

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
      method: 'POST',
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

/* ── Load chats: backend first, localStorage fallback ── */
async function loadChatHistoryFromBackend() {
  if (session?.email) {
    try {
      const url = SERVER_URL + '/memory?query=&limit=5&user_id=' + encodeURIComponent(backendChatKey());
      const r = await fetch(url);
      if (r.ok) {
        const items = await r.json();
        // Our payload is stored as role='system'; find it
        const found = Array.isArray(items)
          ? items.find(m => m.role === 'system')
          : null;
        if (found && found.text) {
          try {
            const parsed = JSON.parse(found.text);
            if (Array.isArray(parsed) && parsed.length > 0) {
              chatHistory = parsed;
              // Mirror to localStorage so we're never fully offline-blind
              try { localStorage.setItem(localStorageKey(), JSON.stringify(chatHistory)); } catch {}
              return true;
            }
          } catch {}
        }
      }
    } catch(e) {}
  }

  // Fall back to localStorage
  try {
    const raw = localStorage.getItem(localStorageKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        chatHistory = parsed;
        return true;
      }
    }
  } catch {}

  return false;
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
        aiPart += '<div class="ai-content">' + renderMarkdown(log.aiText || '') + '</div>' +
          '<div class="reaction-row">' +
          '<button class="react-btn ' + (log.reaction==='like'?'liked':'') + '" onclick="reactMsg(' + idx + ',\'like\')">' +
            '&#128077; <span>' + (log.likes||0) + '</span></button>' +
          '<button class="react-btn ' + (log.reaction==='dislike'?'disliked':'') + '" onclick="reactMsg(' + idx + ',\'dislike\')">' +
            '&#128078; <span>' + (log.dislikes||0) + '</span></button>' +
          '</div>';
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
async function handleSend() {
  var text = (inputEl && inputEl.value.trim()) || '';
  if (!text && !attachedImageBase64) return;

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
    var body = {
      text:       text,
      user_id:    getUserId(),
      user_email: (session && session.email) || '',
      user_name:  (session && session.name)  || ''
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
    saveToStorage();
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

  // Show a loading indicator in the sidebar
  if (chatHistoryList) {
    chatHistoryList.innerHTML = '<div style="color:#4a6a88;font-size:0.82rem;padding:12px 14px;">Loading chats\u2026</div>';
  }

  // Pull from backend (or fall back to localStorage)
  var loaded = await loadChatHistoryFromBackend();

  if (!loaded || chatHistory.length === 0) {
    createNewChat();
  } else {
    currentChatId = chatHistory[0].id;
    htmlResult    = chatHistory[0].messages || [];
    loadChatsUI();
    renderMessages();
  }
}

init();
