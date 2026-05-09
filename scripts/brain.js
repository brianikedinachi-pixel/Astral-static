/* =====================================================
   ASTRAL BRAIN.JS
   – Google OAuth session
   – Image attach + vision
   – Markdown / rich-text rendering
   – Like / Dislike reactions
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

function getUserId() { return localStorage.getItem('astral_user_id') || 'anon'; }

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
window.goSettings = () => alert(`Settings\n\nName: ${session.name}\nEmail: ${session.email}\nMessages sent: ${userProfile.messageCount||0}\nImages sent: ${userProfile.imageCount||0}`);

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
    if (lbl) lbl.textContent = lbl.textContent.includes(':') ? (voiceEnabled ? 'Voice : ON' : 'Voice : OFF') : (voiceEnabled ? '✓ Voice' : 'Voice');
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
    if (lbl) lbl.textContent = lbl.textContent.includes(':') ? (speechEnabled ? 'Speech : ON' : 'Speech : OFF') : (speechEnabled ? '✓ Speech' : 'Speech');
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

/* Toggle the camera/gallery choice popup */
window.toggleCameraChoice = function(e) {
  e.stopPropagation();
  const popup = document.getElementById('camera-choice-popup');
  if (!popup) return;
  popup.classList.toggle('show');
};

/* Close popup on outside click */
document.addEventListener('pointerdown', (e) => {
  const popup = document.getElementById('camera-choice-popup');
  const btn   = document.getElementById('attach-btn');
  if (popup && !popup.contains(e.target) && !btn?.contains(e.target)) {
    popup.classList.remove('show');
  }
});

/* Open camera directly (capture="environment" = rear camera) */
window.openCamera = function() {
  document.getElementById('camera-choice-popup')?.classList.remove('show');
  document.getElementById('file-input').click();
};

/* Open gallery / file picker */
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
    document.getElementById('img-fname').textContent = file.name.length > 34 ? file.name.slice(0,34)+'…' : file.name;
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

// Wire textarea auto-grow
if (inputEl) {
  inputEl.addEventListener('input', () => autoGrow(inputEl));
  // Reset height after send
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
   CHAT HISTORY  (per-user, keyed by email)
══════════════════════════════════════════════════════ */
let chatHistory   = [];
let currentChatId = null;
let htmlResult    = [];

function storageKey() { return 'chatHistory_' + (session?.email || 'default'); }

function createNewChat() {
  const id = Date.now().toString();
  chatHistory.unshift({ id, title: 'New Chat', messages: [] });
  currentChatId = id;
  htmlResult    = [];
  saveChatsToStorage();
  loadChatsUI();
  renderMessages();
}

function loadChatsFromStorage() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) {
      chatHistory = JSON.parse(raw);
      if (chatHistory.length > 0 && !currentChatId) currentChatId = chatHistory[0].id;
    }
  } catch { chatHistory = []; }
  if (chatHistory.length === 0) createNewChat();
}

function saveChatsToStorage() {
  try { localStorage.setItem(storageKey(), JSON.stringify(chatHistory)); } catch {}
}

function loadChatsUI() {
  if (!chatHistoryList) return;
  chatHistoryList.innerHTML = chatHistory.map(c => `
    <div class="chat-item ${c.id === currentChatId ? 'active' : ''}" data-id="${c.id}">
      <span class="chat-item-title">${escHtml(c.title)}</span>
      <button class="chat-delete-btn" data-id="${c.id}" title="Delete">
        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2" fill="none"/></svg>
      </button>
    </div>
  `).join('');

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
  if (c) { c.title = title; saveChatsToStorage(); loadChatsUI(); }
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
function saveToStorage() { const c = getCurrentChat(); if (c) { c.messages = htmlResult; saveChatsToStorage(); } }

/* ══════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════ */
function escHtml(t = '') {
  return t.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}

function scrollToBottom() { if (displayContainer) displayContainer.scrollTop = displayContainer.scrollHeight; }

/* ── Auto-grow textarea ── */
function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';           // collapse first so shrink works
  const scrollH = el.scrollHeight;
  const maxH    = 160;                // matches CSS max-height
  el.style.height = Math.min(scrollH, maxH) + 'px';
  el.dataset.expanded = scrollH > 40 ? 'true' : 'false';
  // Keep overflow hidden until we hit the max, then let it scroll
  el.style.overflowY = scrollH > maxH ? 'auto' : 'hidden';
}

/* ── Markdown → HTML using marked.js ── */
function renderMarkdown(text) {
  if (typeof marked === 'undefined') return `<p>${escHtml(text)}</p>`;
  try {
    marked.setOptions({ breaks: true, gfm: true });
    return marked.parse(text);
  } catch { return `<p>${escHtml(text)}</p>`; }
}

/* ══════════════════════════════════════════════════════
   RENDER ALL MESSAGES
══════════════════════════════════════════════════════ */
function renderMessages() {
  if (!displayContainer) return;
  displayContainer.innerHTML = htmlResult.map((log, idx) => `
    <div class="chatlog" data-idx="${idx}">

      ${log.humanText || log.humanImage ? `
        <div class="human-response">
          ${log.humanImage ? `<img class="chat-img" src="${log.humanImage}" alt="Attached image">` : ''}
          ${log.humanText ? `<p class="text">${escHtml(log.humanText)}</p>` : ''}
        </div>` : ''}

      ${(log.thinking || (log.aiText !== undefined && log.aiText !== '')) ? `
        <div class="ai-response">
          ${log.thinking ? `
            <div class="thinking">
              <span>A</span><span>S</span><span>T</span><span>R</span><span>A</span><span>L</span>
            </div>` : ''}
          ${!log.thinking ? `
            <div class="ai-content">${renderMarkdown(log.aiText || '')}</div>
            <div class="reaction-row">
              <button class="react-btn ${log.reaction==='like'?'liked':''}" onclick="reactMsg(${idx},'like')">
                👍 <span>${log.likes||0}</span>
              </button>
              <button class="react-btn ${log.reaction==='dislike'?'disliked':''}" onclick="reactMsg(${idx},'dislike')">
                👎 <span>${log.dislikes||0}</span>
              </button>
            </div>` : ''}
        </div>` : ''}

    </div>
  `).join('');
  scrollToBottom();
}

/* ══════════════════════════════════════════════════════
   REACTIONS
══════════════════════════════════════════════════════ */
window.reactMsg = function(idx, type) {
  const log = htmlResult[idx];
  if (!log) return;
  const prev = log.reaction;
  if (prev === type) {
    log.reaction = null;
    if (type === 'like') log.likes = Math.max(0,(log.likes||0)-1);
    else log.dislikes = Math.max(0,(log.dislikes||0)-1);
  } else {
    if (prev === 'like')    log.likes    = Math.max(0,(log.likes||0)-1);
    if (prev === 'dislike') log.dislikes = Math.max(0,(log.dislikes||0)-1);
    log.reaction = type;
    if (type === 'like') log.likes = (log.likes||0)+1;
    else log.dislikes = (log.dislikes||0)+1;
  }
  saveToStorage();
  renderMessages();

  // Send to backend (fire and forget)
  fetch(`${SERVER_URL}/react`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      user_id: getUserId(),
      user_email: session?.email || '',
      msg_idx: idx,
      reaction: log.reaction,
      likes: log.likes || 0,
      dislikes: log.dislikes || 0,
      chat_id: currentChatId,
      ai_text_preview: (log.aiText || '').slice(0, 100)
    })
  }).catch(()=>{});
};

/* ══════════════════════════════════════════════════════
   SEND MESSAGE
══════════════════════════════════════════════════════ */
async function handleSend() {
  const text = inputEl?.value.trim() || '';
  if (!text && !attachedImageBase64) return;

  if (inputEl) { inputEl.value = ''; autoGrow(inputEl); if (inputEl._resetHeight) inputEl._resetHeight(); }

  userProfile.messageCount = (userProfile.messageCount || 0) + 1;

  const hasImage  = !!attachedImageBase64;
  const imgData   = attachedImageBase64;
  const imgMime   = attachedImageMime;
  let   humanImgSrc = null;
  if (hasImage) {
    humanImgSrc = `data:${imgMime};base64,${imgData}`;
    userProfile.imageCount = (userProfile.imageCount || 0) + 1;
  }
  saveUserProfile();
  removeImage();

  htmlResult.push({ humanText: text, humanImage: humanImgSrc, aiText: '', thinking: true });

  if (htmlResult.length === 1) {
    updateChatTitle(currentChatId, (text.slice(0, 42) || 'Image message') + (text.length > 42 ? '…' : ''));
  }

  saveToStorage();
  renderMessages();

  const controller = new AbortController();
  currentController = controller;
  isSending = true;
  runBtn?.classList.add('sending');
  try { const lbl = runBtn?.querySelector('.btn-label'); if (lbl) lbl.textContent = 'Stop'; } catch{}

  try {
    const body = {
      text,
      user_id: getUserId(),
      user_email: session?.email || '',
      user_name:  session?.name  || '',
    };
    if (hasImage) { body.image_base64 = imgData; body.image_mime = imgMime; }

    const resp = await fetch(`${SERVER_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) throw new Error('Server error');
    const data = await resp.json();
    const reply = data.reply || '[No response]';

    const li = htmlResult.length - 1;
    htmlResult[li].thinking = false;
    htmlResult[li].aiText   = reply;
    htmlResult[li].likes    = 0;
    htmlResult[li].dislikes = 0;

    renderMessages();
    speak(reply);

  } catch (err) {
    const li = htmlResult.length - 1;
    htmlResult[li].thinking = false;
    if (err?.name === 'AbortError') {
      htmlResult[li].aiText = '[Cancelled]';
    } else {
      htmlResult[li].aiText = text.length < 6
        ? 'Tell me a bit more so I can help 🙂'
        : `I hear you — "${text}". Would you like advice or just to talk more?`;
    }
    htmlResult[li].likes    = 0;
    htmlResult[li].dislikes = 0;
    renderMessages();
  } finally {
    isSending = false;
    currentController = null;
    runBtn?.classList.remove('sending');
    try { const lbl = runBtn?.querySelector('.btn-label'); if (lbl) lbl.textContent = 'Send'; } catch{}
    saveToStorage();
  }
}

/* ══════════════════════════════════════════════════════
   EVENTS
══════════════════════════════════════════════════════ */
runBtn?.addEventListener('click', () => {
  if (isSending) { currentController?.abort(); runBtn.classList.remove('sending'); isSending = false; currentController = null; }
  else handleSend();
});

document.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } });
newChatBtn?.addEventListener('click', () => createNewChat());

// ── Mobile ⋮ menu ──────────────────────────────────────────────
if (mobileMenuToggle && mobileDropdown) {
  mobileMenuToggle.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    const isOpen = mobileDropdown.classList.contains('active');
    // Close everything else first
    document.getElementById('camera-choice-popup')?.classList.remove('show');
    document.getElementById('user-dropdown')?.classList.remove('open');
    // Toggle this one
    mobileDropdown.classList.toggle('active', !isOpen);
  });
}

// Close mobile dropdown when tapping anywhere else
document.addEventListener('pointerdown', e => {
  if (!mobileDropdown) return;
  const clickedToggle   = mobileMenuToggle?.contains(e.target);
  const clickedDropdown = mobileDropdown.contains(e.target);
  if (!clickedToggle && !clickedDropdown) {
    mobileDropdown.classList.remove('active');
  }
}, true); // capture phase so it fires before stopPropagation in children

// Prevent all input-area buttons from stealing focus / inserting text
document.querySelector('.chat-initiate-response')?.addEventListener('pointerdown', e => {
  if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
    e.preventDefault(); // keeps keyboard open, prevents focus shift
  }
});

// ── Responsive: force ⋮ button visible below 600px ──────────────
function applyMobileLayout() {
  const isMobile = window.innerWidth < 600;
  if (mobileMenuToggle) mobileMenuToggle.style.display = isMobile ? 'flex' : 'none';
  const desktopBtns = document.querySelector('.desktop-buttons');
  if (desktopBtns) desktopBtns.style.display = isMobile ? 'none' : 'flex';
}
applyMobileLayout();
window.addEventListener('resize', applyMobileLayout);

/* ══════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════ */
if (loadSession()) {
  initUserUI();
  loadChatsFromStorage();
  loadChatsUI();
  renderMessages();
  updateVoiceButton();
  updateSpeechButton();
  updateSidebarState();
  initSpeechRecognition();
}
