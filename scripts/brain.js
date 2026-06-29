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
   PWA INSTALL PROMPT
   Capture the beforeinstallprompt event so the "get app"
   gate can trigger the native install dialog directly —
   no "tap a button" instructions needed.
══════════════════════════════════════════════════════ */
let _pwaInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();          // stop browser auto-banner
  _pwaInstallPrompt = e;       // save for programmatic trigger
});

window.addEventListener('appinstalled', () => {
  _pwaInstallPrompt = null;    // clear after successful install
});

// ── Wire the "get app" header button once DOM is ready ────────────────────────
// The button lives in the HTML so we attach from here after load.
(function _wireInstallChip() {
  function _doInstall() {
    if (_pwaInstallPrompt) {
      _pwaInstallPrompt.prompt();
      _pwaInstallPrompt.userChoice.then(c => { if (c.outcome === 'accepted') _pwaInstallPrompt = null; });
    } else {
      // Already installed or prompt not yet available — show mini toast, not a modal
      const _toast = document.createElement('div');
      _toast.textContent = /iphone|ipad|ipod/i.test(navigator.userAgent)
        ? 'Tap Share → "Add to Home Screen" in Safari'
        : 'Open browser menu → "Install app" or "Add to Home Screen"';
      Object.assign(_toast.style, {
        position:'fixed', bottom:'80px', left:'50%', transform:'translateX(-50%)',
        background:'rgba(0,0,0,0.85)', color:'#fff', padding:'10px 18px',
        borderRadius:'20px', fontSize:'13px', zIndex:9999,
        backdropFilter:'blur(8px)', whiteSpace:'nowrap',
        boxShadow:'0 4px 20px rgba(0,0,0,0.4)'
      });
      document.body.appendChild(_toast);
      setTimeout(() => _toast.remove(), 4000);
    }
  }
  // Try immediately (if DOM already ready) and on DOMContentLoaded
  function _attach() {
    const chip = document.getElementById('install-chip');
    if (chip && !chip.dataset.installWired) {
      chip.dataset.installWired = '1';
      chip.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); _doInstall(); });
    }
  }
  _attach();
  document.addEventListener('DOMContentLoaded', _attach);
  // Expose globally in case HTML also calls it
  window.triggerPWAInstall = _doInstall;
})();

// ── TTS loading-state CSS injected once ───────────────────────────────────────
(function _injectTTSStyle() {
  if (document.getElementById('_tts_style')) return;
  const s = document.createElement('style');
  s.id = '_tts_style';
  s.textContent = `
    .msg-speak-btn.tts-loading {
      opacity: 0.6;
      pointer-events: none;
    }
    .msg-speak-btn.tts-loading svg {
      animation: _tts_spin 0.9s linear infinite;
    }
    @keyframes _tts_spin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }
  `;
  (document.head || document.documentElement).appendChild(s);
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('_tts_style')) document.head.appendChild(s);
  });
})();

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

// ── Voice cache — picked once and reused ─────────────────────────────────────
let _cachedVoice = null;
let _voicesLoaded = false;

function _pickBestVoice() {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  if (_cachedVoice && voices.includes(_cachedVoice)) return _cachedVoice;

  // Score every voice — highest wins
  // Priority: Online/Neural > Natural label > preferred names > English > anything
  function scoreVoice(v) {
    let s = 0;
    const n = v.name || '';
    const l = (v.lang || '').toLowerCase();
    // Must be English
    if (!l.startsWith('en')) return -1;
    // Cloud/neural voices (highest quality, require network)
    if (n.includes('Online') || n.includes('Neural')) s += 60;
    if (n.includes('Natural'))                         s += 50;
    if (n.includes('Enhanced'))                        s += 40;
    // Specific known-great voices
    const premium = [
      'Microsoft Aria', 'Microsoft Jenny', 'Microsoft Ava', 'Microsoft Emma',
      'Microsoft Guy', 'Microsoft Brian', 'Microsoft Andrew', 'Microsoft Michelle',
      'Google UK English Female', 'Google US English Female',
      'Samantha', 'Karen', 'Moira', 'Serena', 'Joanna', 'Salli',
    ];
    for (const p of premium) { if (n.includes(p)) { s += 30; break; } }
    // US/UK English preferred
    if (l === 'en-us' || l === 'en-gb') s += 10;
    if (l.startsWith('en'))             s += 5;
    // Penalise obviously robotic / compact voices
    if (n.includes('Compact') || n.includes('Zira') || n.includes('David') && !n.includes('Online')) s -= 20;
    return s;
  }

  const scored = voices
    .map(v => ({ v, s: scoreVoice(v) }))
    .filter(x => x.s >= 0)
    .sort((a, b) => b.s - a.s);

  _cachedVoice = scored.length ? scored[0].v : (voices.find(v => v.lang.startsWith('en')) || voices[0]);
  return _cachedVoice;
}

// Invalidate cache when voices list changes
if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.addEventListener('voiceschanged', () => { _cachedVoice = null; _voicesLoaded = true; });
}

/* ══════════════════════════════════════════════════════
   HUMAN-QUALITY TTS ENGINE
   ─────────────────────────────────────────────────────
   Engine cascade — tried in order until one succeeds:

     1. Server /tts proxy  →  Gemini 3.1 Flash TTS  (human-quality, warm)
                           →  Gemini 2.5 Flash TTS  (auto step-down on 429)
                           →  Google Translate TTS  (free fallback, no key)
        The server handles all three internally and returns audio/wav or
        audio/mpeg. The browser never knows which engine ran.

     2. Web Speech API  —  browser built-in, always available, last resort.
        Uses the best available neural voice on the device.

   All engines share the same text-prep pipeline.
   Web Audio EQ (warmth + compression) is applied to all blob audio.
══════════════════════════════════════════════════════ */

// ── Text preparation ──────────────────────────────────────────────────────────
function _prepareTextForSpeech(text) {
  return text
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`{1,3}[\s\S]*?`{1,3}/g, '')
    .replace(/>\s?/g, '')
    .replace(/---+/g, '')
    .replace(/\u2022\s/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function _splitIntoChunks(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const parts = text.match(/[^.!?\n]+[.!?\n]*\s*/g) || [text];
  const out = []; let cur = '';
  for (const p of parts) {
    if (cur.length + p.length > maxLen && cur) { out.push(cur.trim()); cur = p; }
    else cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.length ? out : [text];
}

// Natural prosody — pauses browsers actually honour
function _addProsody(text) {
  return text
    .replace(/\.\s+/g,  '.  ')
    .replace(/\?\s+/g,  '?  ')
    .replace(/!\s+/g,   '!  ')
    .replace(/,\s+/g,   ', ')
    .replace(/\u2014/g,  ' \u2014 ')
    .replace(/\.\.\./g, ' \u2026 ');
}

// ── Web Audio warmth processor ────────────────────────────────────────────────
let _audioCtx = null;
function _getAudioCtx() {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

window._ttsAudioEl = null;

function _playAudioBlob(blob, onDone, signal) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    window._ttsAudioEl = audio;
    const done = () => { URL.revokeObjectURL(url); window._ttsAudioEl = null; resolve(); if (onDone) onDone(); };

    // Web Audio EQ: low-mid warmth + presence boost + light compression
    try {
      const ctx  = _getAudioCtx();
      const src  = ctx.createMediaElementSource(audio);
      const low  = ctx.createBiquadFilter(); low.type = 'peaking'; low.frequency.value = 200; low.gain.value = 3;
      const hi   = ctx.createBiquadFilter(); hi.type  = 'peaking'; hi.frequency.value = 4800; hi.gain.value = 1.5;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.18;
      src.connect(low); low.connect(hi); hi.connect(comp); comp.connect(ctx.destination);
    } catch(e) { /* direct play if Web Audio unavailable */ }

    if (signal) signal.addEventListener('abort', () => { try { audio.pause(); } catch(e){} URL.revokeObjectURL(url); window._ttsAudioEl = null; resolve(); }, { once: true });
    audio.onended = done; audio.onerror = done;
    audio.play().catch(done);
  });
}

// ── Engine 1: Server /tts proxy ───────────────────────────────────────────────
// The server internally cascades: Gemini 3.1 → Gemini 2.5 → Google Translate.
// A 502 response means all three server-side engines are down; we then fall
// through to Web Speech below.
async function _serverTTS(text, signal) {
  const _ttsUrl = (typeof SERVER_URL !== 'undefined' ? SERVER_URL : 'https://astral-1-sb1i.onrender.com') + '/tts';
  try {
    const resp = await fetch(_ttsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, lang: 'en', slow: false }),
      signal,
    });
    // 429 or 502 = all server engines exhausted → fall through to Web Speech
    if (!resp.ok) return false;
    const blob = await resp.blob();
    if (!blob || blob.size < 100) return false;
    await _playAudioBlob(blob, null, signal);
    return true;
  } catch(e) {
    if (e.name === 'AbortError') return 'aborted';
    return false;
  }
}

// ── Engine 2: Web Speech API — enhanced with best neural voice ────────────────
// Verified: uses _pickBestVoice() which scores and caches the best available
// neural voice on the device (Microsoft Aria, Google US Female, Samantha etc.)
function _webSpeechTTS(text, onDone, { rate = 1.0, pitch = 0.95, forConvo = false } = {}) {
  speechSynthesis.cancel();
  const chunks = _splitIntoChunks(_addProsody(text), 180);
  let idx = 0; let stopped = false;

  const next = () => {
    if (stopped || idx >= chunks.length) {
      window._isSpeaking = false; window._currentUtterance = null;
      if (!stopped && onDone) onDone(); return;
    }
    const u = new SpeechSynthesisUtterance(chunks[idx++]);
    u.rate = forConvo ? 0.97 : rate; u.pitch = pitch; u.volume = 1;
    u.onend = next;
    u.onerror = (e) => {
      if (e.error === 'interrupted' || e.error === 'canceled') { stopped = true; if (onDone) onDone(); return; }
      next();
    };
    if (forConvo) u.onboundary = (ev) => { if (ev.name === 'word') _triggerWordPulse?.(); };
    window._currentUtterance = u;
    const go = () => { const v = _pickBestVoice(); if (v) u.voice = v; speechSynthesis.speak(u); };
    if (!_voicesLoaded && !speechSynthesis.getVoices().length) {
      speechSynthesis.addEventListener('voiceschanged', go, { once: true });
    } else go();
  };

  window._isSpeaking = true; next();
  return () => { stopped = true; speechSynthesis.cancel(); };
}

// ── Master TTS — Gemini quality only ─────────────────────────────────────────
let _masterAbortCtrl = null;

async function _masterTTS(text, onDone, opts = {}) {
  if (!text) { if (onDone) onDone(); return; }
  text = _prepareTextForSpeech(text);
  if (!text) { if (onDone) onDone(); return; }

  _masterTTSStop();
  _masterAbortCtrl = new AbortController();
  const sig = _masterAbortCtrl.signal;

  // Gemini TTS via server (3.1 → 2.5 → Google Translate internally)
  const result = await _serverTTS(text, sig);
  if (result === 'aborted') return;
  // Server unavailable — complete silently (no Web Speech fallback)
  if (!sig.aborted && onDone) onDone();
}

function _masterTTSStop() {
  if (_masterAbortCtrl) { _masterAbortCtrl.abort(); _masterAbortCtrl = null; }
  if (window._ttsAudioEl) { try { window._ttsAudioEl.pause(); } catch(e){} window._ttsAudioEl = null; }
  speechSynthesis.cancel();
  window._isSpeaking = false; window._currentUtterance = null;
}

// ── Public surface ────────────────────────────────────────────────────────────
window._currentUtterance = null;
window._isSpeaking = false;

function stopSpeaking() {
  _masterTTSStop();
  document.querySelectorAll('.msg-speak-btn.speaking').forEach(b => {
    b.classList.remove('speaking'); b.title = 'Read aloud';
  });
}

function speak(text, onDone, forceSpeak) {
  if (!forceSpeak && !voiceEnabled) { if (onDone) onDone(); return; }
  if (!text) { if (onDone) onDone(); return; }
  window._isSpeaking = true;
  _masterTTS(text, () => { window._isSpeaking = false; if (onDone) onDone(); });
}

// ── TTS Audio Pre-fetch Cache ─────────────────────────────────────────────────
// When an AI message arrives, we immediately request its audio from the server
// in the background. By the time the user taps the speak button (usually
// several seconds later), the audio is already buffered → instant playback.
const _ttsAudioCache = new Map(); // msgIdx → Promise<{url, blob}|null>

function _clearTTSAudioCache() {
  // Cache is keyed by array index, not a stable message id — when the active
  // chat changes, the same index numbers point at completely different
  // messages, so stale cached audio must be dropped or speakMessage() will
  // play the wrong message's audio.
  for (const promise of _ttsAudioCache.values()) {
    promise?.then(r => { try { if (r?.url) URL.revokeObjectURL(r.url); } catch(e) {} });
  }
  _ttsAudioCache.clear();
}

function _prefetchTTSAudio(idx, rawText) {
  if (_ttsAudioCache.has(idx)) return; // already in-flight or cached
  const text = _prepareTextForSpeech(rawText);
  if (!text || text.length < 2) return;
  const promise = (async () => {
    try {
      const resp = await fetch(SERVER_URL + '/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang: 'en', slow: false }),
      });
      if (!resp.ok) return null;
      const blob = await resp.blob();
      if (!blob || blob.size < 100) return null;
      return { url: URL.createObjectURL(blob), blob };
    } catch(e) { return null; }
  })();
  _ttsAudioCache.set(idx, promise);
  // Keep cache bounded to last 25 entries
  if (_ttsAudioCache.size > 25) {
    const oldest = _ttsAudioCache.keys().next().value;
    _ttsAudioCache.get(oldest)?.then(r => { try { if (r?.url) URL.revokeObjectURL(r.url); } catch(e){} });
    _ttsAudioCache.delete(oldest);
  }
}

async function speakMessage(idx, btn) {
  const log = htmlResult[idx];
  if (!log || !log.aiText) return;

  // ── Stop if already speaking this message ────────────────────────────────
  if (btn && btn.classList.contains('speaking')) { stopSpeaking(); return; }
  stopSpeaking();

  const onDone = () => {
    window._isSpeaking = false;
    if (btn) { btn.classList.remove('speaking', 'tts-loading'); btn.title = 'Read aloud'; }
  };

  // ── Helper: mark button as loading while audio is being fetched ──────────
  function _setLoading(on) {
    if (!btn) return;
    if (on) { btn.classList.add('tts-loading'); btn.title = 'Loading…'; }
    else     { btn.classList.remove('tts-loading'); }
  }

  // ── Kick off the fetch now (idempotent — won't double-fetch) ────────────
  _prefetchTTSAudio(idx, log.aiText);

  const cached = _ttsAudioCache.get(idx);

  // Check if it resolved already (instant path) ────────────────────────────
  let resolved = null;
  try {
    resolved = await Promise.race([
      cached,
      Promise.resolve('_pending_')
    ]);
  } catch(e) { resolved = null; }

  if (!resolved || resolved === '_pending_') {
    // Audio still being fetched — show loading state and wait
    _setLoading(true);
    try {
      resolved = await cached;
    } catch(e) { resolved = null; }
    _setLoading(false);
  }

  if (resolved && resolved.url) {
    // ── Play cached/fetched audio ────────────────────────────────────────
    btn && btn.classList.add('speaking') && (btn.title = 'Stop');
    if (btn) { btn.classList.add('speaking'); btn.title = 'Stop'; }
    const audio = new Audio(resolved.url);
    window._ttsAudioEl = audio;
    window._isSpeaking = true;
    audio.onended = onDone;
    audio.onerror = () => {
      window._ttsAudioEl = null;
      _ttsAudioCache.delete(idx);
      speak(log.aiText, onDone, true);
    };
    if (_masterAbortCtrl) {
      _masterAbortCtrl.signal.addEventListener('abort', () => {
        try { audio.pause(); } catch(e) {}
        window._ttsAudioEl = null;
      }, { once: true });
    }
    await audio.play().catch(() => { window._ttsAudioEl = null; onDone(); });
  } else {
    // ── Fallback: stream directly ────────────────────────────────────────
    speak(log.aiText, onDone, true);
  }
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
  // Sync empty state left offset with sidebar
  const es = document.getElementById('empty-state');
  if (es) es.style.left = sidebarOpen ? 'var(--sidebar-w)' : '0';
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
  stopSpeaking();
  _clearTTSAudioCache();
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
  if (id !== currentChatId) { stopSpeaking(); _clearTTSAudioCache(); }
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
  // Stop typewriter when hidden, restart when shown
  if (hasMessages) {
    if (_twTimer) { clearTimeout(_twTimer); _twTimer = null; }
    var tw = document.getElementById('es-typewriter');
    if (tw) tw.textContent = '';
  } else {
    _startTypewriter();
  }
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
          // TTS is fetched on-demand when the speak button is tapped — not proactively
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
    // Voice plays only when the user taps the speak button — not automatically

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
  // Attach to body so fixed positioning works relative to viewport
  const es = document.createElement('div');
  es.id = 'empty-state';
  es.innerHTML = `
    <div class="es-stars">
      <span class="es-star"></span><span class="es-star"></span>
      <span class="es-star"></span><span class="es-star"></span>
      <span class="es-star"></span><span class="es-star"></span>
    </div>
    <div class="es-body" style="margin-top:30px;">
      <div class="es-logo-wrap">
        <div class="es-glow"></div>
      </div>
      <div class="es-greeting" id="es-greeting">Hey there 👋</div>
      <div class="es-title">ASTRAL</div>
      <div class="es-sub"><span class="es-sub-static">Your AI companion —&nbsp;</span><span class="es-typewriter" id="es-typewriter"></span><span class="es-sub-cursor" id="es-sub-cursor"></span></div>
      <div class="es-chips">
        <button class="es-chip" onclick="useChip(this)">💙 I'm struggling today</button>
        <button class="es-chip" onclick="useChip(this)">🔥 Day ${_getStreakDay()} of my recovery</button>
        <button class="es-chip" onclick="useChip(this)">🧠 Help me think through something</button>
        <button class="es-chip" onclick="useChip(this)">📚 Explain something to me</button>
      </div>
    </div>`;
  document.body.appendChild(es);
  _updateEsGreeting();
  _startTypewriter();
}

let _twTimer = null;
function _startTypewriter() {
  const el = document.getElementById('es-typewriter');
  if (!el) return;
  if (_twTimer) { clearTimeout(_twTimer); _twTimer = null; }

  // Phrases with how long to pause after fully typed (ms)
  const phrases = [
    { text: 'always here',          pause: 1800 },
    { text: 'never judging',        pause: 1800 },
    { text: "what's on your mind?", pause: 3200 },
  ];
  let pi = 0, ci = 0, deleting = false;

  function tick() {
    const { text, pause } = phrases[pi];
    if (!deleting) {
      // Typing
      ci++;
      el.textContent = text.slice(0, ci);
      if (ci < text.length) {
        _twTimer = setTimeout(tick, 55);
      } else {
        // Done typing — wait then start deleting
        _twTimer = setTimeout(() => { deleting = true; tick(); }, pause);
      }
    } else {
      // Deleting
      ci--;
      el.textContent = text.slice(0, ci);
      if (ci > 0) {
        _twTimer = setTimeout(tick, 32);
      } else {
        // Done deleting — move to next phrase
        deleting = false;
        pi = (pi + 1) % phrases.length;
        _twTimer = setTimeout(tick, 420);
      }
    }
  }
  // Small initial delay before first phrase starts
  _twTimer = setTimeout(tick, 900);
  // Show cursor
  const cur = document.getElementById('es-sub-cursor');
  if (cur) cur.style.display = 'inline-block';
}

function _getStreakDay() { return '1'; }

function _updateEsGreeting() {
  const el = document.getElementById('es-greeting');
  if (!el) return;
  const h = new Date().getHours();
  const session = (() => { try { return JSON.parse(localStorage.getItem('astral_session') || 'null'); } catch(e){return null;} })();
  const name = session?.name ? ', ' + session.name.split(' ')[0] : '';
  let greet, timeClass;
  if (h < 12) {
    greet = 'Good morning' + name + ' ☀️';
    timeClass = 'time-morning';
  } else if (h < 18) {
    greet = 'Good afternoon' + name + ' 👋';
    timeClass = 'time-afternoon';
  } else {
    greet = 'Good evening' + name + ' 🌙';
    timeClass = 'time-night';
  }
  el.textContent = greet;
  el.classList.remove('time-morning', 'time-afternoon', 'time-night');
  el.classList.add(timeClass);
}


/* ══════════════════════════════════════════════════════
   EMOTION DETECTION  — AI-backed, runs on every user voice turn
   Pipeline:
     1. MediaRecorder captures raw audio alongside SpeechRecognition
     2. OfflineAudioContext decodes it → pitch / energy / ZCR features
     3. POST /detect-emotion  sends transcript + acoustic features
     4. Server classifies emotion via Gemini-Lite (~50-120ms)
     5. Detected emotion + confidence forwarded to /convo-chat
     6. Server injects tone-override into Gemini system prompt
══════════════════════════════════════════════════════ */

function _extractAcousticFeatures(samples, sampleRate) {
  if (!samples || samples.length === 0) return null;

  // RMS energy
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const energy = Math.sqrt(sum / samples.length);

  // Zero-crossing rate — high in trembling / crying voices
  let zc = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) zc++;
  }
  const zcr = zc / samples.length;

  // Rough pitch via autocorrelation (human voice: 80-400 Hz)
  const minPeriod = Math.floor(sampleRate / 400);
  const maxPeriod = Math.floor(sampleRate / 80);
  let bestCorr = -Infinity, bestPeriod = 0;
  for (let lag = minPeriod; lag <= maxPeriod; lag++) {
    let corr = 0;
    const n = Math.min(2048, samples.length - lag);
    for (let i = 0; i < n; i++) corr += samples[i] * samples[i + lag];
    if (corr > bestCorr) { bestCorr = corr; bestPeriod = lag; }
  }
  const pitch = bestPeriod > 0 ? sampleRate / bestPeriod : 0;

  return {
    pitch:  Math.round(pitch),
    energy: parseFloat(energy.toFixed(4)),
    zcr:    parseFloat(zcr.toFixed(4)),
  };
}

let _emotionRecorder      = null;
let _emotionAudioChunks   = [];
let _lastEmotionResult    = { emotion: 'neutral', confidence: 0.5 };
let _emotionSampleRate    = 16000;
let _emotionCaptureActive = false; // guards against duplicate/overlapping getUserMedia streams

function _startEmotionCapture() {
  // Never open this mic while the AI is talking. On Android, having a
  // recording stream active at the same time media is playing is what was
  // making AI playback go quiet/silent — the OS shifts to a lower-volume
  // "communication" audio route whenever a mic capture overlaps playback.
  // The always-on recognizer restarts very often, and used to call this on
  // every restart (even mid-speech), opening a new stream each time without
  // ever closing the previous one — so also guard against re-entry here.
  if (_convoSpeaking || _emotionCaptureActive) return;
  _emotionCaptureActive = true;
  _emotionAudioChunks = [];
  if (!navigator.mediaDevices) { _emotionCaptureActive = false; return; }
  navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: 16000,
      channelCount: 1,
      // Raw signal is what the pitch/energy/zcr analysis wants anyway, and
      // disabling these keeps Android from treating this as a "call" stream.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    }
  })
    .then(stream => {
      _emotionSampleRate = stream.getAudioTracks()[0]?.getSettings()?.sampleRate || 16000;
      const mr = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg' });
      _emotionRecorder = mr;
      mr.ondataavailable = e => { if (e.data && e.data.size > 0) _emotionAudioChunks.push(e.data); };
      mr.onstop = () => { try { stream.getTracks().forEach(t => t.stop()); } catch(e){} _emotionCaptureActive = false; };
      mr.start(100);
    })
    .catch(() => { _emotionCaptureActive = false; });
}

function _stopEmotionCapture() {
  if (_emotionRecorder && _emotionRecorder.state !== 'inactive') {
    try { _emotionRecorder.stop(); } catch(e) {} // onstop clears _emotionCaptureActive
  } else {
    _emotionCaptureActive = false;
  }
  _emotionRecorder = null;
}

async function _getAcousticFeatures() {
  if (!_emotionAudioChunks.length) return null;
  try {
    const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
    const blob     = new Blob(_emotionAudioChunks, { type: mimeType });
    const arrayBuf = await blob.arrayBuffer();
    const ctx      = new OfflineAudioContext(1, _emotionSampleRate * 10, _emotionSampleRate);
    const decoded  = await ctx.decodeAudioData(arrayBuf);
    return _extractAcousticFeatures(decoded.getChannelData(0), _emotionSampleRate);
  } catch(e) { return null; }
}

async function _detectEmotion(transcript, acousticFeatures) {
  try {
    const resp = await fetch(SERVER_URL + '/detect-emotion', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: transcript, features: acousticFeatures || null }),
    });
    if (!resp.ok) return _lastEmotionResult;
    const data = await resp.json();
    if (data.emotion) {
      _lastEmotionResult = { emotion: data.emotion, confidence: data.confidence || 0.7 };
    }
  } catch(e) {}
  return _lastEmotionResult;
}

/* ══════════════════════════════════════════════════════
   WORD-BY-WORD BUBBLE SYSTEM
   Words appear in the AI chat bubble in real-time as
   Gemini speaks them — full bubble persists after speech.
══════════════════════════════════════════════════════ */

let _activeConvoBubbleIdx  = -1;
let _activeConvoHistoryIdx = -1; // index into _convoHistory of the AI turn currently being spoken
let _spokenWords           = [];

function _convoStartAiBubble() {
  _spokenWords          = [];
  _activeConvoBubbleIdx = htmlResult.length - 1;
}

function _convoAppendWord(word) {
  if (_activeConvoBubbleIdx < 0 || !word) return;
  _spokenWords.push(word);
  const entry = htmlResult[_activeConvoBubbleIdx];
  if (!entry) return;
  entry.aiText = _spokenWords.join(' ');
  // Targeted DOM update — skip full re-render for speed
  const node = displayContainer?.querySelector(
    `.chatlog[data-idx="${_activeConvoBubbleIdx}"] .ai-content`
  );
  if (node) {
    node.innerHTML = renderMarkdown(entry.aiText);
  } else {
    renderMessages();
  }
  scrollToBottom();
}

function _convoFinaliseBubble(fullText) {
  if (_activeConvoBubbleIdx < 0) return;
  const entry = htmlResult[_activeConvoBubbleIdx];
  if (entry) {
    entry.aiText   = fullText;
    entry.thinking = false;
    entry.likes    = entry.likes    || 0;
    entry.dislikes = entry.dislikes || 0;
  }
  _activeConvoBubbleIdx = -1;
  _spokenWords = [];
  saveToStorage();
  renderMessages();
}

/* ══════════════════════════════════════════════════════
   CONVERSATION MODE
   A floating orb replaces the input bar — no "on a call"
   screen takeover. The chat itself stays visible behind it,
   just gently recoloured (see CSS). Step away within the app
   (switch chats, open a new one, background the tab) and a
   tiny draggable bubble keeps watch up top until you tap it.

   Emotion detection adapts Gemini tone per turn.
   Words appear in chat bubble as AI speaks them.
══════════════════════════════════════════════════════ */

/* ── State ──────────────────────────────────────────────────────────────────── */
let _convoMode            = false;
let _convoRecognition     = null;
let _convoBargeInRec      = null;  // always-on recognition during AI speech for barge-in
let _convoStartTime       = null;
let _convoWakeLock        = null;
let _convoHistory         = [];
let _convoThinking        = false;
let _convoMuted           = false;
let _convoMinimized       = false;
let _convoWasHidden       = false;
let _convoSpeaking        = false;
let _convoTTSPlaying      = false; // true while TTS audio is playing; suppresses mic restart
let _convoMicFailCount    = 0;
let _convoListenTimer     = null;
let _backendTTSAvailable  = null;
let _convoCurrentState    = 'listening';
let _convoElapsedInterval = null;

const _SERVER_URL_CONVO = (typeof SERVER_URL !== 'undefined' ? SERVER_URL : 'https://astral-1-sb1i.onrender.com') + '/convo-chat';
const _SERVER_URL_TTS   = (typeof SERVER_URL !== 'undefined' ? SERVER_URL : 'https://astral-1-sb1i.onrender.com') + '/tts';

let _convoTTSPrefetch = null; // Promise<Blob|null> — starts the moment AI reply arrives

/* ── Audio helpers ──────────────────────────────────────────────────────────── */
function _stopConvoAudio() {
  _masterTTSStop();
  _stopFillerAudio();
  _convoSpeaking = false;
  _convoTTSPrefetch = null;
}

function _prefetchConvoTTS(text) {
  _convoTTSPrefetch = (async () => {
    try {
      const resp = await fetch(_SERVER_URL_TTS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang: 'en', slow: false }),
      });
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return (blob && blob.size >= 100) ? blob : null;
    } catch(e) { return null; }
  })();
}

/* ── Filler / thinking sounds ───────────────────────────────────────────────── */
const _CONVO_THINKING_SOUNDS = [
  "Hmm, let me think about that.",
  "Good question, give me a sec.",
  "Let me think on that for a moment.",
  "Okay, let me work through that.",
  "Right, let me consider that.",
  "One sec, thinking it through.",
  "Got it, give me a moment.",
  "Let's see here.",
  "Okay, one moment.",
  "Hmm, interesting — let me think.",
  "Give me just a second.",
  "Let me piece that together.",
  "Alright, thinking on it.",
  "Sure, hold on a sec.",
  "Let me figure that out.",
  "Just a moment, please.",
  "Okay, I'm on it.",
  "Hmm, good one — one sec.",
  "Let me mull that over.",
  "Right, give me a moment.",
];

const _FILLER_CACHE_NAME = 'astral-filler-tts-v1';
const _fillerAudioCache  = new Map();
let   _fillerPrefetchDone = false;
let   _lastFillerPhrase   = null;

function _fillerCacheKey(phrase) {
  return '/__filler_tts__/' + encodeURIComponent(phrase);
}

async function _getFillerAudioBlob(phrase) {
  if (_fillerAudioCache.has(phrase)) return _fillerAudioCache.get(phrase);
  const promise = (async () => {
    try {
      if ('caches' in window) {
        const cache = await caches.open(_FILLER_CACHE_NAME);
        const hit   = await cache.match(_fillerCacheKey(phrase));
        if (hit) { const blob = await hit.blob(); if (blob && blob.size >= 100) return blob; }
      }
    } catch(e) {}
    try {
      const resp = await fetch(_SERVER_URL_TTS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: phrase, lang: 'en', slow: false }),
      });
      if (!resp.ok) return null;
      const blob = await resp.blob();
      if (!blob || blob.size < 100) return null;
      try {
        if ('caches' in window) {
          const cache = await caches.open(_FILLER_CACHE_NAME);
          await cache.put(_fillerCacheKey(phrase), new Response(blob.slice(0), {
            headers: { 'Content-Type': blob.type || 'audio/mpeg' }
          }));
        }
      } catch(e) {}
      return blob;
    } catch(e) { return null; }
  })();
  _fillerAudioCache.set(phrase, promise);
  return promise;
}

function _prefetchFillerAudio() {
  if (_fillerPrefetchDone) return;
  _fillerPrefetchDone = true;
  for (const phrase of _CONVO_THINKING_SOUNDS) _getFillerAudioBlob(phrase);
}

function _stopFillerAudio() {
  if (window._fillerAudioEl) {
    try { window._fillerAudioEl.pause(); } catch(e) {}
    window._fillerAudioEl = null;
  }
}

async function _convoThinkFiller() {
  const keys = _CONVO_THINKING_SOUNDS;
  let phrase = keys[Math.floor(Math.random() * keys.length)];
  if (keys.length > 1) {
    let guard = 0;
    while (phrase === _lastFillerPhrase && guard++ < 5)
      phrase = keys[Math.floor(Math.random() * keys.length)];
  }
  _lastFillerPhrase = phrase;
  try {
    const blob = await _getFillerAudioBlob(phrase);
    if (!blob || !_convoThinking) return;
    _stopFillerAudio();
    const url   = URL.createObjectURL(blob);
    const audio = new Audio(url);
    window._fillerAudioEl = audio;
    const cleanup = () => { URL.revokeObjectURL(url); if (window._fillerAudioEl === audio) window._fillerAudioEl = null; };
    audio.onended = cleanup;
    audio.onerror = cleanup;
    await audio.play().catch(cleanup);
  } catch(e) {}
}

/* ── Orb state display ──────────────────────────────────────────────────────── */
const _CONVO_STATE_LABELS = {
  thinking:  'Thinking…',
  speaking:  'Speaking…',
  analyzing: 'Reading your mood…',
  muted:     'Muted — tap mic to resume',
  listening: 'Listening…'
};

function _setConvoState(state) {
  _convoCurrentState = state;
  const wrap = document.getElementById('convo-orb-wrap');
  const mini = document.getElementById('convo-orb-mini');
  const label = _CONVO_STATE_LABELS[state] || _CONVO_STATE_LABELS.listening;

  if (wrap) {
    wrap.classList.remove('state-listening', 'state-thinking', 'state-speaking', 'state-analyzing', 'state-muted');
    wrap.classList.add('state-' + state);
  }
  const status = document.getElementById('convo-status-text');
  if (status) status.textContent = label;

  if (mini) {
    mini.classList.remove('state-listening', 'state-thinking', 'state-speaking', 'state-analyzing', 'state-muted');
    mini.classList.add('state-' + state);
  }
  _updateConvoElapsedDisplays(); // refresh mini label immediately so it doesn't wait a full second
}

function _formatConvoElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

/* Ticks once a second while convo mode is active — keeps the mini orb's
   label current ("Listening… · 2:14") whether or not it's actually visible. */
function _updateConvoElapsedDisplays() {
  const miniText = document.getElementById('convo-mini-text');
  if (!miniText) return;
  const shortLabel = (_CONVO_STATE_LABELS[_convoCurrentState] || 'Listening…').replace('…', '');
  const elapsed = _convoStartTime ? _formatConvoElapsed(Date.now() - _convoStartTime) : '0:00';
  miniText.textContent = `${shortLabel} · ${elapsed}`;
}

function _startConvoElapsedTicker() {
  _stopConvoElapsedTicker();
  _convoElapsedInterval = setInterval(_updateConvoElapsedDisplays, 1000);
}

function _stopConvoElapsedTicker() {
  if (_convoElapsedInterval) { clearInterval(_convoElapsedInterval); _convoElapsedInterval = null; }
}

function _triggerWordPulse() {
  const orb = document.getElementById('convo-orb-btn');
  if (orb) { orb.classList.remove('word-pulse'); void orb.offsetWidth; orb.classList.add('word-pulse'); }
  const ripple = document.getElementById('convo-orb-ripple');
  if (ripple) { ripple.classList.remove('ping'); void ripple.offsetWidth; ripple.classList.add('ping'); }
  const miniDot = document.querySelector('#convo-orb-mini .mini-orb-dot');
  if (miniDot) { miniDot.classList.remove('word-pulse'); void miniDot.offsetWidth; miniDot.classList.add('word-pulse'); }
}

/* ── TTS playback with word-by-word subtitles ───────────────────────────────── */
async function _speakConvo(text) {
  if (!_convoMode) return;

  _setConvoState('speaking');
  _convoSpeaking = true;
  _masterTTSStop();
  _stopFillerAudio();

  // ── Pause always-on mic during TTS ─────────────────────────────────────────
  // On mobile (Android/iOS), holding a SpeechRecognition mic session open while
  // audio plays causes the OS to switch to a "voice call" audio route — TTS
  // crackles, drops in volume, or both.  We suspend the mic here and restart
  // it cleanly after audio ends in _finish().  Stale buffered speech is cleared
  // so it can't auto-fire against the wrong turn.
  _convoTTSPlaying = true;
  if (_alwaysOnRec) {
    try { _alwaysOnRec.onend = null; _alwaysOnRec.onerror = null; _alwaysOnRec.abort(); } catch(e) {}
    _alwaysOnRec = null;
    _convoRecognition = null;
  }
  _stopAonWatchdog();
  if (_aonSilenceTimer) { clearTimeout(_aonSilenceTimer); _aonSilenceTimer = null; }
  _aonPendingFinal  = '';
  _aonInterimLatest = '';

  _startBargeInListening(); // no-op stub — barge-in handled by mic restart after TTS

  let blob = null;
  if (_convoTTSPrefetch) {
    let pulse = setInterval(_triggerWordPulse, 180);
    try { blob = await _convoTTSPrefetch; } catch(e) {}
    clearInterval(pulse);
    _convoTTSPrefetch = null;
  }

  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  let wordIdx = 0;
  let interrupted = false; // set true if the user barges in and we cut playback short

  const _finish = () => {
    if (interrupted) {
      // User cut in mid-sentence — leave the bubble, and what we remember of
      // this turn, at only the words that were actually spoken. Don't
      // silently complete it with the rest of the unspoken reply.
      let spokenText = _spokenWords.join(' ').trim();
      spokenText = spokenText ? spokenText.replace(/[.!?]+$/, '') + '…' : '…';
      _convoFinaliseBubble(spokenText);
      if (_activeConvoHistoryIdx >= 0 && _convoHistory[_activeConvoHistoryIdx]) {
        _convoHistory[_activeConvoHistoryIdx].text = spokenText;
      }
    } else {
      // Flush any remaining words the ticker hadn't caught up to yet
      while (wordIdx < words.length) { _convoAppendWord(words[wordIdx++]); }
      _convoFinaliseBubble(text);
    }
    _activeConvoHistoryIdx = -1;
    _convoTTSPlaying = false;
    _convoSpeaking = false;
    _stopBargeInListening(); // no-op stub
    // If a barge-in already kicked off a new turn (_convoThinking is true by
    // now), don't stomp its 'thinking'/'analyzing' state back to 'listening'.
    if (_convoMode && !_convoMuted && !_convoThinking) {
      _setConvoState('listening');
      // Mic was paused for TTS — restart it now that the audio route is free.
      // 700 ms gives Android time to fully release the audio session so the
      // new SR instance gets the normal (not "voice call") audio route.
      _scheduleConvoRestart(700);
    }
  };

  if (!blob) { _finish(); return; }

  _masterAbortCtrl = new AbortController();
  const sig = _masterAbortCtrl.signal;
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  window._ttsAudioEl = audio;

  await new Promise((resolve) => {
    let wordTicker = null;
    const WORDS_PER_SEC = 2.6;

    const cleanup = () => {
      if (wordTicker) { clearInterval(wordTicker); wordTicker = null; }
      URL.revokeObjectURL(url);
      window._ttsAudioEl = null;
      resolve();
    };

    // Start word ticker the instant audio begins — words appear immediately
    // rather than waiting for timeupdate (which fires 250ms+ into playback).
    audio.addEventListener('playing', () => {
      if (wordTicker) return;
      // Show the first word the instant audio is audible instead of waiting
      // for the first interval tick — closes the caption/audio gap.
      if (wordIdx < words.length) { _convoAppendWord(words[wordIdx++]); _triggerWordPulse(); }
      wordTicker = setInterval(() => {
        if (wordIdx < words.length) {
          _convoAppendWord(words[wordIdx++]);
          _triggerWordPulse();
        }
      }, 1000 / WORDS_PER_SEC);
    }, { once: true });

    // timeupdate corrects drift: if audio is ahead of ticker, catch up
    audio.addEventListener('timeupdate', () => {
      if (!audio.duration) return;
      const target = Math.floor((audio.currentTime / audio.duration) * words.length);
      while (wordIdx < target && wordIdx < words.length) {
        _convoAppendWord(words[wordIdx++]);
      }
    });

    audio.addEventListener('ended', cleanup);
    audio.addEventListener('error', cleanup);
    sig.addEventListener('abort', () => { interrupted = true; try { audio.pause(); } catch(e) {} cleanup(); }, { once: true });
    audio.play().catch(cleanup);
  });

  _finish();
}

/* ── Chat bubble management ─────────────────────────────────────────────────── */
function _convoAddBubble(role, text) {
  _convoHistory.push({ role: role === 'user' ? 'user' : 'model', text });
  if (role === 'user') {
    htmlResult.push({ humanText: text, aiText: '', thinking: false, likes: 0, dislikes: 0 });
  } else {
    htmlResult.push({ humanText: '', aiText: '', thinking: false, likes: 0, dislikes: 0 });
    _activeConvoHistoryIdx = _convoHistory.length - 1;
    _convoStartAiBubble();
  }
  const chat = getCurrentChat();
  if (chat) { chat.messages = htmlResult; chat.updatedAt = new Date().toISOString(); }
  saveToStorage();
  renderMessages();
  scrollToBottom();
}

/* ── Send user speech to AI ─────────────────────────────────────────────────── */
async function _convoSendToAI(userText) {
  // Barge-in: cut off AI if it's still speaking
  if (_convoSpeaking) {
    _stopConvoAudio();
    speechSynthesis.cancel();
  }
  // Debounce: ignore if already mid-reply
  if (_convoThinking) return;
  _convoThinking = true;

  _convoAddBubble('user', userText);
  _setConvoState('thinking');
  _convoThinkFiller();

  // Emotion analysis runs while we prepare the request
  _setConvoState('analyzing');
  _stopEmotionCapture();
  const acousticFeatures = await _getAcousticFeatures().catch(() => null);
  const emotionData      = await _detectEmotion(userText, acousticFeatures);
  _setConvoState('thinking');

  try {
    let sessionObj = null;
    try { sessionObj = JSON.parse(localStorage.getItem('astral_session') || 'null'); } catch(e) {}

    const body = {
      text:                 userText,
      user_id:              sessionObj?.email || 'anon',
      user_email:           sessionObj?.email || '',
      user_name:            sessionObj?.name  || '',
      conversation_history: _convoHistory.slice(-10),
      user_emotion:         emotionData.emotion,
      emotion_confidence:   emotionData.confidence,
    };

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 20000);

    const resp = await fetch(_SERVER_URL_CONVO, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data  = await resp.json();
    const reply = (data.reply || '').trim() || "Hmm, I missed that — say it again?";

    // Kick off TTS fetch NOW while we set up the bubble
    _prefetchConvoTTS(reply);
    _convoThinking = false;
    _convoAddBubble('ai', reply);
    speechSynthesis.cancel();
    _speakConvo(reply);
    // NOTE: do NOT start emotion capture here — it holds the mic open
    // during speaking and blocks SpeechRecognition from starting afterward.
    // Emotion detection uses text-only analysis (acousticFeatures=null) — no getUserMedia needed.

  } catch(e) {
    _convoThinking = false;
    const errText = e.name === 'AbortError'
      ? "Sorry, that took too long. Could you say it again?"
      : "Sorry, something went wrong. Say that again?";
    _convoAddBubble('ai', errText);
    _speakConvo(errText);
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   UNIFIED ALWAYS-ON MIC ENGINE
   ────────────────────────────────────────────────────────────────────────────
   One continuous recognition session runs the ENTIRE time convo mode is active.
   It never stops — not while AI is speaking, not while thinking. This means:
   • User can interrupt AI at any time (barge-in)
   • No dead-air gap between sessions (common cause of "noises only" on Samsung,
     Firefox for Android, and other OEM browsers)
   • Empty interim results from noise are ignored; only final transcripts with
     meaningful text trigger a send
   Cross-browser fixes included:
   • lang falls back to device language if en-US produces no finals
   • Empty/whitespace finals are silently discarded
   • AudioContext voice-activity watchdog re-starts recognition if the browser
     silently kills it (happens on some Android OEMs after ~60 s)
   ══════════════════════════════════════════════════════════════════════════════ */

const _CONVO_MIC_MAX_FAILS = 8;

let _alwaysOnRec       = null;   // the single persistent SR instance
let _aonPendingFinal   = '';     // accumulated finals for current utterance
let _aonSilenceTimer   = null;   // fires _commitAon after silence
let _aonInterimLatest  = '';     // latest interim for status display
let _aonLang           = 'en-US'; // may fall back to navigator.language
let _aonLangFallbackTried = false;
let _aonWatchdog       = null;   // AudioContext-based watchdog timer
let _aonWatchdogStream = null;
let _aonMaxFinalIndex  = -1;     // highest SR result index already committed (de-dupes re-fired finals)

/* ── Commit accumulated speech → send to AI ─────────────────────────────────── */
function _commitAon() {
  if (_aonSilenceTimer) { clearTimeout(_aonSilenceTimer); _aonSilenceTimer = null; }
  const text = _aonPendingFinal.trim();
  _aonPendingFinal   = '';
  _aonInterimLatest  = '';
  if (!text || !_convoMode || _convoMuted) return;

  // If AI is speaking, cut it off (barge-in)
  if (_convoSpeaking) {
    _stopConvoAudio();
    speechSynthesis.cancel();
    // _convoSpeaking is now false after _stopConvoAudio
  }

  // If still thinking from a previous turn, drop this (user spoke while waiting)
  // — avoids double-send race. The user can speak again after AI replies.
  if (_convoThinking) return;

  _convoSendToAI(text);
}

/* ── Update status bar with live transcript ─────────────────────────────────── */
function _aonUpdateStatus() {
  if (_convoThinking) return;
  const full = (_aonPendingFinal + _aonInterimLatest).trim();
  const el = document.getElementById('convo-status-text');
  if (!el) return;
  if (full) {
    el.textContent = `"${full}…"`;
  } else if (_convoSpeaking) {
    el.textContent = 'Listening for you…';
  } else {
    el.textContent = 'Listening…';
  }
}

/* ── Merge a newly-finalised transcript into the pending buffer ──────────────
   The index guard above only catches a result re-firing within the SAME
   recognizer instance. After a forced restart (new SR object, index resets
   to 0), the new instance can briefly re-hear audio the old one already
   transcribed, producing what looks like a fresh, legitimately-indexed
   final that's actually a repeat or partial repeat of what we already have.
   This collapses any overlap between the tail of what's accumulated and the
   head of the new piece before appending, so only genuinely new words land
   in the buffer — whether the repeat came from the same instance or a new
   one after a restart. ─────────────────────────────────────────────────── */
function _aonMergeFinal(transcript) {
  const pendingWords = _aonPendingFinal.trim().split(/\s+/).filter(Boolean);
  const newWords      = transcript.trim().split(/\s+/).filter(Boolean);
  if (!newWords.length) return;
  if (!pendingWords.length) { _aonPendingFinal = transcript + ' '; return; }

  const maxOverlap = Math.min(pendingWords.length, newWords.length);
  let overlap = 0;
  for (let len = maxOverlap; len > 0; len--) {
    const tail = pendingWords.slice(pendingWords.length - len).join(' ').toLowerCase();
    const head = newWords.slice(0, len).join(' ').toLowerCase();
    if (tail === head) { overlap = len; break; }
  }
  const extra = newWords.slice(overlap).join(' ');
  if (extra) _aonPendingFinal += extra + ' ';
}

/* ── Build and start the persistent recognition instance ─────────────────────── */
function _buildAlwaysOnRec() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang            = _aonLang;
  r.continuous      = true;
  r.interimResults  = true;
  // maxAlternatives=1 is most stable on continuous+cross-browser
  r.maxAlternatives = 1;

  r.onstart = () => {
    _convoMicFailCount = 0;
    _aonMaxFinalIndex = -1; // fresh SR instance → fresh result-index space
    _setConvoState(_convoSpeaking ? 'speaking' : 'listening');
    // NOTE: do NOT call _startEmotionCapture() here.
    // Opening a getUserMedia stream while webkitSpeechRecognition is active
    // creates two concurrent audio capture sessions. On Android Chrome this
    // triggers "voice call" audio routing and SR silently stops delivering
    // onresult events — the mic appears to be "listening" but nothing fires.
    // Emotion features fall back to text-only analysis (acousticFeatures=null).
  };

  r.onresult = (ev) => {
    if (!_convoMode || _convoMuted) return;
    _aonLastResultTime = Date.now(); // feed the watchdog
    let gotFinal = false;
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const res = ev.results[i];
      const transcript = (res[0]?.transcript || '').trim();
      if (!transcript) continue; // ignore empty noise events
      if (res.isFinal) {
        // Several Android browsers re-fire the SAME result index as "final"
        // more than once — each re-fire re-recognises the phrase, usually
        // a little longer than before. Without this guard every re-fire got
        // appended again, snowballing into "nothing nothing nothing really
        // I'm nothing really I'm just..." type garbling. Only accept a given
        // result index the first time it finalises.
        if (i <= _aonMaxFinalIndex) continue;
        _aonMaxFinalIndex = i;
        _aonMergeFinal(transcript);
        gotFinal = true;
        // Reset silence window — more speech might follow
        if (_aonSilenceTimer) clearTimeout(_aonSilenceTimer);
        _aonSilenceTimer = setTimeout(_commitAon, 1400);
        _aonInterimLatest = '';
      } else {
        _aonInterimLatest = transcript;
      }
    }
    _aonUpdateStatus();
    if (gotFinal) _convoMicFailCount = 0; // good result — reset fail counter
  };

  r.onerror = (ev) => {
    if (!_convoMode) return;
    if (ev.error === 'aborted') return;
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
      stopConvoMode(); return;
    }
    if (ev.error === 'network') {
      // Network blip — retry quickly
      _convoMicFailCount++;
      _scheduleConvoRestart(600); return;
    }
    if (ev.error === 'no-speech') {
      // Completely normal in always-on mode — browser just reset; we'll restart in onend
      return;
    }
    // language-not-supported or audio-capture — try fallback language once
    if ((ev.error === 'language-not-supported' || ev.error === 'audio-capture') && !_aonLangFallbackTried) {
      _aonLangFallbackTried = true;
      _aonLang = navigator.language || 'en-GB';
      _scheduleConvoRestart(300); return;
    }
    _convoMicFailCount++;
    if (_convoMicFailCount >= _CONVO_MIC_MAX_FAILS) { _convoGiveUpListening(); return; }
    _scheduleConvoRestart(_convoMicRetryDelay());
  };

  r.onend = () => {
    if (!_convoMode || _convoMuted) return;
    // Don't restart while the tab is hidden — the browser blocks mic anyway,
    // and visibilitychange will restart when the user comes back.
    if (_convoWasHidden) return;
    // TTS is playing — we deliberately aborted the mic; _finish() will restart
    // it after audio ends so the OS audio route is free first.
    if (_convoTTSPlaying) return;
    // Commit any buffered speech before restarting
    if (_aonPendingFinal.trim()) { _commitAon(); }
    _alwaysOnRec = null;
    // Restart, but not instantly — on Android, tearing down and reacquiring
    // the mic back-to-back too fast can produce a session that silently
    // captures nothing for the first utterance (no error, just dead air).
    _scheduleConvoRestart(_convoMicFailCount > 0 ? _convoMicRetryDelay() : 350);
  };

  return r;
}

/* ── Start the always-on mic (or restart it) ─────────────────────────────────── */
function _convoStartListening() {
  if (!_convoMode || _convoMuted) return;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    const s = document.getElementById('convo-status-text');
    if (s) s.textContent = 'Speech recognition not supported in this browser.';
    return;
  }

  // Tear down stale instance
  if (_alwaysOnRec) {
    try { _alwaysOnRec.onend = null; _alwaysOnRec.onerror = null; _alwaysOnRec.abort(); } catch(e) {}
    _alwaysOnRec = null;
  }
  // Legacy refs — keep null so old call-sites are no-ops
  _convoRecognition = null;
  _convoBargeInRec  = null;

  const r = _buildAlwaysOnRec();
  if (!r) return;
  _alwaysOnRec      = r;
  _convoRecognition = r; // keep legacy ref for stop/cleanup call-sites

  try {
    r.start();
    _startAonWatchdog();
  } catch(e) {
    _alwaysOnRec = null;
    _convoMicFailCount++;
    if (_convoMicFailCount >= _CONVO_MIC_MAX_FAILS) { _convoGiveUpListening(); return; }
    _scheduleConvoRestart(_convoMicRetryDelay());
  }
}

/* ── AudioContext watchdog — re-starts mic if browser silently kills it ───────── */
// Some Android OEMs (Samsung Internet, Xiaomi MIUI browser) quietly stop
// delivering results after ~60 s without throwing an error or firing onend.
// We watch for AudioContext time advancing; if SR stops producing events for
// 18 s we restart it proactively.
let _aonLastResultTime = 0;

function _startAonWatchdog() {
  _stopAonWatchdog();
  _aonLastResultTime = Date.now();
  _aonWatchdog = setInterval(() => {
    if (!_convoMode || _convoMuted || _convoThinking) return;
    if (Date.now() - _aonLastResultTime > 7000) {
      // Stale — poke it
      _aonLastResultTime = Date.now();
      if (_alwaysOnRec) {
        try { _alwaysOnRec.onend = null; _alwaysOnRec.onerror = null; _alwaysOnRec.abort(); } catch(e) {}
        _alwaysOnRec = null;
      }
      _scheduleConvoRestart(200);
    }
  }, 2000);
}

function _stopAonWatchdog() {
  if (_aonWatchdog) { clearInterval(_aonWatchdog); _aonWatchdog = null; }
}


/* ── Barge-in: now handled automatically by the always-on recognizer ─────────── */
// These stubs exist so legacy call-sites (in _speakConvo / _finish) are no-ops.
function _startBargeInListening() { /* no-op: always-on mic already handles this */ }
function _stopBargeInListening()  { /* no-op */ }

/* ── Mic helpers (keep legacy call-sites working) ────────────────────────────── */
function _convoMicRetryDelay() {
  return Math.min(400 * Math.pow(2, _convoMicFailCount), 10000);
}

function _convoGiveUpListening() {
  _convoMicFailCount = 0;
  _convoMuted = true;
  _setConvoState('muted');
  document.getElementById('convo-orb-wrap')?.classList.add('state-muted');
  const status = document.getElementById('convo-status-text');
  if (status) status.textContent = 'Lost the mic — tap the mic button to try again.';
}

function _scheduleConvoRestart(delay) {
  if (_convoListenTimer) { clearTimeout(_convoListenTimer); _convoListenTimer = null; }
  _convoListenTimer = setTimeout(() => { _convoListenTimer = null; _convoStartListening(); }, delay);
}

/* ── Mute toggle ────────────────────────────────────────────────────────────── */
function _toggleConvoMute() {
  _convoMuted = !_convoMuted;
  if (_convoMuted) {
    if (_alwaysOnRec) {
      try { _alwaysOnRec.onend = null; _alwaysOnRec.onerror = null; _alwaysOnRec.abort(); } catch(e) {}
      _alwaysOnRec = null;
    }
    _convoRecognition = null;
    if (_convoListenTimer) { clearTimeout(_convoListenTimer); _convoListenTimer = null; }
    if (_aonSilenceTimer)  { clearTimeout(_aonSilenceTimer);  _aonSilenceTimer  = null; }
    _stopAonWatchdog();
    _stopEmotionCapture();
    _setConvoState('muted');
  } else {
    _aonPendingFinal  = '';
    _aonInterimLatest = '';
    setTimeout(_convoStartListening, 150);
  }
}

/* ── Start conversation mode ────────────────────────────────────────────────── */
/* ── VIP list — these users bypass the "get app" gate ──────────────────────── */
const _CONVO_VIP_EMAILS = ['bukanwoko@gmail.com'];

let _convoStarting = false; // mutex: prevents concurrent startConvoMode calls

async function startConvoMode() {
  // Don't stack sessions — also guard against concurrent calls during the
  // async mic-permission await (the race that causes triple greeting bubbles)
  if (_convoMode || _convoStarting) return;
  _convoStarting = true;

  // ── "Get the app" gate — browser users only, VIPs excluded ─────────────────
  const _isPWA = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  if (!_isPWA) {
    let _currentEmail = '';
    try { _currentEmail = (JSON.parse(localStorage.getItem('astral_session') || '{}').email || '').toLowerCase().trim(); } catch(e) {}
    if (!_CONVO_VIP_EMAILS.includes(_currentEmail)) {
      // Trigger the native install prompt directly — no button-hunting needed
      if (_pwaInstallPrompt) {
        window.triggerPWAInstall();
        _convoStarting = false; return;
      }
      // Install prompt not available yet (already installed, dismissed, or iOS)
      window.triggerPWAInstall(); // shows the toast fallback
      _convoStarting = false; return;
    }
  }

  // Speech recognition check first — clearest blocker
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    _showConvoError('Voice conversation requires Chrome, Edge, or Safari on Android/desktop, or Safari on iOS.');
    _convoStarting = false; return;
  }

  // Request mic permission explicitly so we surface a clean error before touching SR
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
  } catch(e) {
    _showConvoError('Microphone access is required. Please allow mic access in your browser settings and try again.');
    _convoStarting = false; return;
  }

  // Optional: notifications (non-blocking — don't let failure prevent mode starting)
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }

  // ── All clear: initialise state ──
  _convoMode            = true;
  _convoHistory         = [];
  _convoStartTime       = Date.now();
  _convoThinking        = false;
  _convoMuted           = false;
  _convoMinimized       = false;
  _convoWasHidden       = false;
  _convoSpeaking        = false;
  _convoTTSPlaying      = false;
  _convoMicFailCount    = 0;
  _activeConvoBubbleIdx = -1;
  _activeConvoHistoryIdx = -1;
  _spokenWords          = [];
  _lastEmotionResult    = { emotion: 'neutral', confidence: 0.5 };
  _backendTTSAvailable  = null;
  // Reset always-on mic state
  _alwaysOnRec          = null;
  _aonPendingFinal      = '';
  _aonInterimLatest     = '';
  _aonLangFallbackTried = false;
  _aonLastResultTime    = 0;
  _aonMaxFinalIndex     = -1;
  if (_aonSilenceTimer) { clearTimeout(_aonSilenceTimer); _aonSilenceTimer = null; }

  // Pre-warm filler audio (non-blocking)
  _prefetchFillerAudio();

  // UI
  document.body.classList.add('convo-mode');
  document.body.classList.remove('convo-minimized');
  _injectConvoOrb();
  _startConvoElapsedTicker();
  _updateConvoElapsedDisplays();

  // Wake lock — keep screen on (best-effort)
  if ('wakeLock' in navigator) {
    navigator.wakeLock.request('screen').then(wl => { _convoWakeLock = wl; }).catch(() => {});
  }

  // Background notification support
  _registerConvoNotification();

  // Start mic immediately so user can speak before/during greeting
  setTimeout(_convoStartListening, 200);

  _convoStarting = false; // release mutex — mode is fully initialised

  // Greet the user after the orb has rendered
  setTimeout(() => {
    const greeting = "Hey, I'm listening. What's on your mind?";
    _prefetchConvoTTS(greeting);
    _convoAddBubble('ai', greeting);
    _speakConvo(greeting);
  }, 400);
}

/* ── Stop conversation mode ─────────────────────────────────────────────────── */
function stopConvoMode() {
  _convoStarting  = false; // reset mutex in case stop is called during startup
  if (!_convoMode) return;
  _convoMode      = false;
  _convoMinimized = false;
  _convoMuted     = false;
  _convoWasHidden = false;
  _convoThinking  = false;
  _convoSpeaking  = false;
  _convoTTSPlaying = false;

  if (_convoListenTimer)  { clearTimeout(_convoListenTimer);  _convoListenTimer  = null; }
  if (_aonSilenceTimer)   { clearTimeout(_aonSilenceTimer);   _aonSilenceTimer   = null; }
  _stopAonWatchdog();
  if (_alwaysOnRec) {
    try { _alwaysOnRec.onend = null; _alwaysOnRec.onerror = null; _alwaysOnRec.abort(); } catch(e) {}
    _alwaysOnRec = null;
  }
  if (_convoRecognition)  {
    try { _convoRecognition.onend = null; _convoRecognition.onerror = null; _convoRecognition.abort(); } catch(e) {}
    _convoRecognition = null;
  }
  _aonPendingFinal  = '';
  _aonInterimLatest = '';
  _stopBargeInListening();
  if (_convoWakeLock)     { try { _convoWakeLock.release(); } catch(e) {} _convoWakeLock = null; }

  _stopConvoAudio();
  _stopEmotionCapture();
  _stopConvoElapsedTicker();
  _hideConvoPopovers();
  _removeConvoUI();
  document.body.classList.remove('convo-mode', 'convo-minimized');
  _unregisterConvoNotification();
  _stopConvoNotifHeartbeat();
}
window.stopConvoMode = stopConvoMode;

/* ── Error display (replaces alert()) ──────────────────────────────────────── */
function _showConvoError(msg) {
  let el = document.getElementById('convo-error-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'convo-error-toast';
    el.style.cssText = [
      'position:fixed','bottom:100px','left:50%','transform:translateX(-50%)',
      'background:rgba(255,60,80,0.92)','color:#fff','padding:12px 20px',
      'border-radius:12px','font-size:0.9rem','z-index:9999',
      'max-width:320px','text-align:center','box-shadow:0 4px 20px rgba(0,0,0,0.4)',
      'transition:opacity 0.3s'
    ].join(';');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  el.style.display = 'block';
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => { el.style.display = 'none'; }, 300);
  }, 5000);
}

/* ── Orb UI ─────────────────────────────────────────────────────────────────── */
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
      <div class="convo-orb-halo" aria-hidden="true"></div>
      <button id="convo-orb-btn" class="convo-orb-btn" type="button" aria-label="Conversation active — tap for options">
        <svg class="convo-orb-wave-svg" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
          <defs>
            <clipPath id="orb-clip"><circle cx="32" cy="32" r="32"/></clipPath>
            <radialGradient id="orb-sheen" cx="35%" cy="26%" r="60%">
              <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.55"/>
              <stop offset="55%"  stop-color="#ffffff" stop-opacity="0.05"/>
              <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <g clip-path="url(#orb-clip)">
            <path class="convo-orb-wave convo-orb-wave--1" fill="rgba(0,220,255,0.5)"
              d="M-16,40 C0,24 16,54 32,40 C48,24 64,54 80,40 L80,80 L-16,80 Z">
              <animate attributeName="d" dur="3.4s" repeatCount="indefinite"
                values="M-16,40 C0,24 16,54 32,40 C48,24 64,54 80,40 L80,80 L-16,80 Z;
                        M-16,46 C0,32 16,60 32,46 C48,32 64,60 80,46 L80,80 L-16,80 Z;
                        M-16,40 C0,24 16,54 32,40 C48,24 64,54 80,40 L80,80 L-16,80 Z"/>
            </path>
            <path class="convo-orb-wave convo-orb-wave--2" fill="rgba(0,160,200,0.35)"
              d="M-16,48 C8,36 24,60 40,48 C56,36 72,58 80,48 L80,80 L-16,80 Z">
              <animate attributeName="d" dur="2.7s" repeatCount="indefinite"
                values="M-16,48 C8,36 24,60 40,48 C56,36 72,58 80,48 L80,80 L-16,80 Z;
                        M-16,42 C8,56 24,32 40,52 C56,64 72,42 80,52 L80,80 L-16,80 Z;
                        M-16,48 C8,36 24,60 40,48 C56,36 72,58 80,48 L80,80 L-16,80 Z"/>
            </path>
            <path class="convo-orb-wave convo-orb-wave--3" fill="rgba(255,255,255,0.12)"
              d="M-16,54 C12,46 28,62 44,54 C60,46 72,60 80,54 L80,80 L-16,80 Z">
              <animate attributeName="d" dur="4.1s" repeatCount="indefinite"
                values="M-16,54 C12,46 28,62 44,54 C60,46 72,60 80,54 L80,80 L-16,80 Z;
                        M-16,50 C12,60 28,44 44,58 C60,68 72,48 80,58 L80,80 L-16,80 Z;
                        M-16,54 C12,46 28,62 44,54 C60,46 72,60 80,54 L80,80 L-16,80 Z"/>
            </path>
            <circle cx="32" cy="32" r="32" fill="url(#orb-sheen)"/>
          </g>
          <circle cx="32" cy="32" r="31" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="1"/>
        </svg>
      </button>
      <span id="convo-orb-ripple" class="convo-orb-ripple" aria-hidden="true"></span>
      <button id="convo-mute-btn" class="convo-mute-btn" type="button" aria-label="Mute microphone">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 19v3M8 22h8"/>
        </svg>
      </button>
    </div>`;
  document.body.appendChild(wrap);

  const mini = document.createElement('button');
  mini.id   = 'convo-orb-mini';
  mini.type = 'button';
  mini.className = 'state-listening';
  mini.setAttribute('aria-label', 'Conversation active — tap for options');
  mini.innerHTML = `
    <span id="convo-mini-text" class="mini-orb-text"></span>
    <span class="mini-orb-dot" aria-hidden="true"><span class="mini-orb-core"></span></span>`;
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
  const pop  = document.createElement('div');
  pop.className = 'convo-popover convo-popover--mini';
  pop.innerHTML = `<p>Conversation is still going</p>
    <div class="convo-popover-row">
      <button type="button" class="convo-popover-btn convo-popover-cancel">Go to app</button>
      <button type="button" class="convo-popover-btn convo-popover-stop">End talk</button>
    </div>`;
  document.body.appendChild(pop);
  const popW = 208;
  let left = rect.left + rect.width / 2 - popW / 2;
  left = Math.max(8, Math.min(window.innerWidth - popW - 8, left));
  let top = rect.bottom + 10;
  if (top + 96 > window.innerHeight) top = Math.max(8, rect.top - 100);
  pop.style.left = left + 'px';
  pop.style.top  = top  + 'px';
  pop.querySelector('.convo-popover-stop').addEventListener('click', stopConvoMode);
  pop.querySelector('.convo-popover-cancel').addEventListener('click', () => { pop.remove(); _restoreConvo(); });
}

function _makeMiniDraggable(el) {
  let dragging = false, moved = false, armed = false, startX = 0, startY = 0, origX = 0, origY = 0;
  const DISMISS_ZONE = 90; // px from the bottom edge that counts as "drag down to end"

  el.addEventListener('pointerdown', (e) => {
    dragging = true; moved = false; armed = false;
    startX = e.clientX; startY = e.clientY;
    const rect = el.getBoundingClientRect();
    origX = rect.left; origY = rect.top;
    el.style.transition = 'none';
    try { el.setPointerCapture(e.pointerId); } catch(err) {}
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    if (!moved) return;
    let nx = origX + dx, ny = origY + dy;
    nx = Math.max(6, Math.min(window.innerWidth  - el.offsetWidth  - 6, nx));
    // Let it travel slightly past the normal clamp once inside the dismiss zone,
    // so the gesture feels like it's reaching for the edge of the screen.
    const dismissMaxY = window.innerHeight - el.offsetHeight * 0.4;
    ny = Math.max(6, Math.min(dismissMaxY, ny));
    el.style.left = nx + 'px'; el.style.top = ny + 'px'; el.style.right = 'auto';

    const reallyInZone = (window.innerHeight - (ny + el.offsetHeight)) <= DISMISS_ZONE;
    if (reallyInZone !== armed) {
      armed = reallyInZone;
      el.classList.toggle('mini-dismiss-armed', armed);
    }
  });
  el.addEventListener('pointerup', () => {
    dragging = false;
    el.style.transition = '';
    if (!moved) {
      document.querySelector('.convo-popover') ? _hideConvoPopovers() : _showMiniPopover();
      return;
    }
    if (armed) {
      el.classList.remove('mini-dismiss-armed');
      el.classList.add('mini-dismiss-out');
      setTimeout(stopConvoMode, 180);
      return;
    }
    // Not released in the dismiss zone — snap back up onto screen normally.
    const rect = el.getBoundingClientRect();
    const maxY = window.innerHeight - el.offsetHeight - 6;
    if (rect.top > maxY) el.style.top = maxY + 'px';
  });
  el.addEventListener('pointercancel', () => {
    dragging = false; armed = false;
    el.style.transition = '';
    el.classList.remove('mini-dismiss-armed');
  });
}

/* ── Minimize / restore (background tab) ────────────────────────────────────── */
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

/* ── Visibility change — pause/resume mic on tab switch ─────────────────────── */
document.addEventListener('visibilitychange', () => {
  if (!_convoMode) return;
  if (document.hidden) {
    _convoWasHidden = true;
    // Kill the always-on recognizer cleanly
    if (_alwaysOnRec) {
      try { _alwaysOnRec.onend = null; _alwaysOnRec.onerror = null; _alwaysOnRec.abort(); } catch(e) {}
      _alwaysOnRec = null;
    }
    if (_convoRecognition) {
      try { _convoRecognition.onend = null; _convoRecognition.onerror = null; _convoRecognition.abort(); } catch(e) {}
      _convoRecognition = null;
    }
    _stopBargeInListening();
    if (_convoListenTimer) { clearTimeout(_convoListenTimer); _convoListenTimer = null; }
    if (_aonSilenceTimer)  { clearTimeout(_aonSilenceTimer);  _aonSilenceTimer  = null; }
    _stopAonWatchdog();
    // Commit any buffered speech so it's not lost
    if (_aonPendingFinal.trim()) { _commitAon(); }
    _stopEmotionCapture();
    _minimizeConvo();
    _registerConvoNotification();
    _startConvoNotifHeartbeat();
  } else if (_convoWasHidden) {
    _convoWasHidden = false;
    _unregisterConvoNotification();
    _stopConvoNotifHeartbeat();
    if ('wakeLock' in navigator && !_convoWakeLock) {
      navigator.wakeLock.request('screen').then(wl => { _convoWakeLock = wl; }).catch(() => {});
    }
    // Restore the full orb so user sees it when they come back (not minimized)
    _restoreConvo();
    if (!_convoThinking && !_convoMuted) setTimeout(_convoStartListening, 600);
  }
});

/* ── Stop convo cleanly when the tab/app is closed or navigated away ─────────── */
window.addEventListener('pagehide', () => {
  if (!_convoMode) return;
  try {
    navigator.serviceWorker.ready.then(reg => {
      if (reg.active) reg.active.postMessage({ type: 'CONVO_STOP' });
    }).catch(() => {});
  } catch(e) {}
});

/* ── Background notification helpers ────────────────────────────────────────── */
async function _registerConvoNotification() {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg.active) reg.active.postMessage({ type: 'CONVO_START', startTime: _convoStartTime });
  } catch(e) {}
}

function _unregisterConvoNotification() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then(reg => {
    if (reg.active) reg.active.postMessage({ type: 'CONVO_STOP' });
  }).catch(() => {});
}

let _convoNotifHeartbeat = null;

function _startConvoNotifHeartbeat() {
  _stopConvoNotifHeartbeat();
  if (!('serviceWorker' in navigator)) return;
  _convoNotifHeartbeat = setInterval(() => {
    if (!_convoMode) { _stopConvoNotifHeartbeat(); return; }
    navigator.serviceWorker.ready.then(reg => {
      if (reg.active) reg.active.postMessage({ type: 'CONVO_PING', startTime: _convoStartTime });
    }).catch(() => {});
  }, 25000);
}

function _stopConvoNotifHeartbeat() {
  if (_convoNotifHeartbeat) { clearInterval(_convoNotifHeartbeat); _convoNotifHeartbeat = null; }
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

// ── Proactively request notification permission shortly after page load ────────
// This ensures it's already granted before the user starts convo mode,
// so the orb notification fires immediately when they leave the app.
setTimeout(() => {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}, 3000);

init();
