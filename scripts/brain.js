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

     -1. Fish Audio — called directly from the browser, never
         touches server.py. Only runs if a Fish Audio API key is
         saved in Settings → Voice Engine.
     0. ElevenLabs — also called directly from the browser. Only
        runs if a key is saved AND Fish Audio didn't produce audio.
        Skips straight to step 1 if neither key is configured.

     1. Server /tts proxy  →  Gemini 3.1 Flash TTS  (human-quality, warm)
                           →  Gemini 2.5 Flash TTS  (auto step-down on 429)
                           →  Google Translate TTS  (free fallback, no key)
        The server handles all three internally and returns audio/wav or
        audio/mpeg. The browser never knows which engine ran.
        This only runs when steps -1 and 0 didn't produce audio — i.e. text
        only reaches server.py when the frontend voice systems fail or aren't set up.

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

// ── TTS response shape ─────────────────────────────────────────────────────────
// Every engine (ElevenLabs direct from the browser, or the server/tts proxy)
// resolves to the same shape: { blob, format, engine, spokenText, wordTimings }.
// spokenText/wordTimings are what make Convo Mode's captions track the real
// voice exactly instead of guessing — spokenText is the literal text that was
// actually spoken, and wordTimings — when present — is genuine per-word timing,
// not an estimate.
function _b64ToBlob(b64, mime) {
  const byteChars = atob(b64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  return new Blob([new Uint8Array(byteNumbers)], { type: mime });
}

function _mimeForTTSFormat(fmt) {
  return fmt === 'wav' ? 'audio/wav' : 'audio/mpeg';
}

async function _fetchTTSJsonBackend(body, signal) {
  const _ttsUrl = (typeof SERVER_URL !== 'undefined' ? SERVER_URL : 'https://astral-1-sb1i.onrender.com') + '/tts';
  const resp = await fetch(_ttsUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  if (!data || !data.audio) return null;
  const blob = _b64ToBlob(data.audio, _mimeForTTSFormat(data.format));
  if (!blob || blob.size < 100) return null;
  return {
    blob,
    format:      data.format,
    engine:      data.engine,
    spokenText:  data.spoken_text || '',
    wordTimings: Array.isArray(data.word_timings) ? data.word_timings : null,
  };
}

/* ══════════════════════════════════════════════════════
   ENGINE -1 — Fish Audio, also called straight from the browser
   ─────────────────────────────────────────────────────
   Same idea as ElevenLabs below, hitting Fish Audio's REST API
   directly with the key from Settings → Voice Engine. Tried
   FIRST (before ElevenLabs) since it's the key you actually
   have configured right now, and Fish Audio's s2.1-pro model is
   free under their Fair Use promo as of this writing (through
   end of July 2026 per their announcement — check fish.audio if
   it's been a while since this was written, in case that's changed).

   Fish Audio's plain /v1/tts endpoint doesn't return word-level
   timing (that only exists on their separate streaming/SSE
   endpoint, which is a different response shape than the rest of
   this pipeline). So captions fall back to the same duration-
   estimated pacing already used for the non-Edge backend engines
   — same as before, just a beat less precise than ElevenLabs' path.
══════════════════════════════════════════════════════ */
const _FISH_DEFAULT_MODEL = 's2.1-pro';

// Hardcoded per request — note this key is visible to anyone who views the
// deployed page source, since this is a public static frontend.
const _FISH_HARDCODED_KEY = '0b5927eaa88349028c8992f9dfa38320';

function _getFishAudioConfig() {
  const key   = (localStorage.getItem('astral_fish_key')   || _FISH_HARDCODED_KEY || '').trim();
  const voice = (localStorage.getItem('astral_fish_voice') || '').trim(); // optional reference_id
  return key ? { key, voice } : null;
}

async function _fishAudioTTS(text, signal) {
  const cfg = _getFishAudioConfig();
  if (!cfg) return null; // not configured — caller tries the next engine
  try {
    const body = {
      text,
      format: 'mp3',
      normalize: true,
      latency: 'normal',
    };
    if (cfg.voice) body.reference_id = cfg.voice;
    const resp = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.key}`,
        'Content-Type': 'application/json',
        'model': _FISH_DEFAULT_MODEL,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!resp.ok) return null; // bad key, quota/fair-use limit, offline, etc. — fall through
    const blob = await resp.blob();
    if (!blob || blob.size < 100) return null;
    return { blob, format: 'mp3', engine: 'fishaudio', spokenText: text, wordTimings: null };
  } catch(e) {
    return null; // network error / CORS / aborted — fall through
  }
}

/* ══════════════════════════════════════════════════════
   ENGINE 0 — ElevenLabs, called straight from the browser
   ─────────────────────────────────────────────────────
   This never touches server.py. It hits ElevenLabs' REST API
   directly with fetch(), using the key the person pasted into
   Settings → Voice Engine (stored in localStorage only).

   Why ElevenLabs specifically: its "with-timestamps" endpoint
   returns character-level timing alongside the audio, so the
   word-by-word captions in Convo Mode keep working exactly like
   they do on the server engines — nothing else about the app
   has to change.

   NOTE ON THE API KEY: a key entered here lives in the browser
   and is visible to anyone who opens dev tools / the network
   tab on this device. That's fine for a personal key you don't
   mind being visible on your own devices, but don't share this
   build with a key in it, and set a monthly quota/spend cap on
   the ElevenLabs dashboard so a leaked key can't run up a bill.
══════════════════════════════════════════════════════ */
const _EL_DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM'; // "Rachel" — warm, stable preset voice
const _EL_DEFAULT_MODEL = 'eleven_flash_v2_5';     // low-latency, good enough quality for convo

function _getElevenLabsConfig() {
  const key   = (localStorage.getItem('astral_el_key')   || '').trim();
  const voice = (localStorage.getItem('astral_el_voice') || '').trim() || _EL_DEFAULT_VOICE;
  return key ? { key, voice } : null;
}

// Groups ElevenLabs' per-character timings into per-word timings so the
// existing caption code (which expects one entry per word) needs no changes.
function _elCharTimingsToWords(text, characters, startsSec) {
  const words = []; const timings = [];
  let word = '', wordStartSec = null;
  const flush = () => {
    if (word) { words.push(word); timings.push({ start_ms: Math.round((wordStartSec || 0) * 1000) }); }
    word = ''; wordStartSec = null;
  };
  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    if (/\s/.test(ch)) { flush(); continue; }
    if (wordStartSec === null) wordStartSec = startsSec[i];
    word += ch;
  }
  flush();
  return { words, timings };
}

async function _elevenLabsTTS(text, signal) {
  const cfg = _getElevenLabsConfig();
  if (!cfg) return null; // not configured — caller falls through to backend
  try {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(cfg.voice)}/with-timestamps`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': cfg.key },
      body: JSON.stringify({
        text,
        model_id: _EL_DEFAULT_MODEL,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
      signal,
    });
    if (!resp.ok) return null; // bad key, quota hit, offline, etc. — fall through
    const data = await resp.json();
    if (!data || !data.audio_base64) return null;
    const blob = _b64ToBlob(data.audio_base64, 'audio/mpeg');
    if (!blob || blob.size < 100) return null;

    let wordTimings = null;
    const align = data.alignment || data.normalized_alignment;
    if (align && Array.isArray(align.characters) && Array.isArray(align.character_start_times_seconds)) {
      const { words, timings } = _elCharTimingsToWords(text, align.characters, align.character_start_times_seconds);
      // spokenText must match word-for-word with timings — only use if they align
      wordTimings = timings.length === words.length ? timings : null;
      return { blob, format: 'mp3', engine: 'elevenlabs', spokenText: words.join(' '), wordTimings };
    }
    return { blob, format: 'mp3', engine: 'elevenlabs', spokenText: text, wordTimings: null };
  } catch(e) {
    return null; // network error / CORS / aborted — fall through to backend
  }
}

// ── High Quality Audio setting ────────────────────────────────────────────────
// Off by default. While off, TTS always uses Microsoft Edge TTS (free, no key,
// stable) via the server's /tts proxy — Fish Audio / ElevenLabs / Gemini are
// skipped entirely, both in the browser and on the server. Turning this on
// opts back into the higher-quality-but-experimental cascade (Fish Audio →
// ElevenLabs → server's Gemini/Fish/Edge/Google-Translate chain). See the
// settings row "High Quality Audio" for the user-facing warning copy.
function _isHqAudioEnabled() {
  return localStorage.getItem('astral_hq_audio') === 'true';
}
window._isHqAudioEnabled = _isHqAudioEnabled;

// ── Shared /tts JSON fetch helper — frontend first, backend only if both frontend engines fail ──
// Every caller (speak button, prefetch cache, convo mode chunks, filler audio)
// goes through this one function, so the frontend-first cascade applies everywhere at once.
async function _fetchTTSJson(body, signal) {
  if (!_isHqAudioEnabled()) {
    // High Quality Audio is off (default) — always use Edge TTS via the
    // server, skip Fish Audio / ElevenLabs / Gemini entirely.
    return _fetchTTSJsonBackend(body, signal);
  }
  const fish = await _fishAudioTTS(body.text, signal);
  if (fish) return fish;
  const eleven = await _elevenLabsTTS(body.text, signal);
  if (eleven) return eleven;
  return _fetchTTSJsonBackend(body, signal);
}

// ── Engine 1: Server /tts proxy ───────────────────────────────────────────────
// The server internally cascades: Gemini 3.1 → Gemini 2.5 → Google Translate.
// A 502 response means all three server-side engines are down; we then fall
// through to Web Speech below.
async function _serverTTS(text, signal) {
  try {
    // 429 or 502 = all server engines exhausted → fall through to Web Speech
    const result = await _fetchTTSJson({ text, lang: 'en', slow: false, hq: _isHqAudioEnabled() }, signal);
    if (!result) return false;
    await _playAudioBlob(result.blob, null, signal);
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
      const result = await _fetchTTSJson({ text, lang: 'en', slow: false, hq: _isHqAudioEnabled() });
      if (!result) return null;
      return { url: URL.createObjectURL(result.blob), blob: result.blob };
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
  if (btn && btn.classList.contains('speaking')) { stopSpeaking(); return; }
  stopSpeaking();

  if (btn) { btn.classList.add('speaking'); btn.title = 'Stop'; }

  const onDone = () => {
    window._isSpeaking = false;
    if (btn) { btn.classList.remove('speaking'); btn.title = 'Read aloud'; }
  };

  // ── Path 1: Try pre-fetched cache (quality audio, near-instant) ───────────
  const cached = _ttsAudioCache.get(idx);
  if (cached) {
    try {
      // Wait up to 2.5s for the cache promise; if still loading, fall through
      const result = await Promise.race([
        cached,
        new Promise(r => setTimeout(() => r('_timeout_'), 2500))
      ]);
      if (result && result !== '_timeout_' && result.url) {
        const audio = new Audio(result.url);
        window._ttsAudioEl = audio;
        window._isSpeaking = true;
        audio.onended = onDone;
        audio.onerror = () => {
          window._ttsAudioEl = null;
          // Cache entry failed to play — fall back to live fetch
          _ttsAudioCache.delete(idx);
          speak(log.aiText, onDone, true);
        };
        if (_masterAbortCtrl) {
          _masterAbortCtrl.signal.addEventListener('abort', () => {
            try { audio.pause(); } catch(e) {}
            window._ttsAudioEl = null;
          }, { once: true });
        }
        await audio.play().catch(() => {
          window._ttsAudioEl = null;
          onDone();
        });
        return;
      }
    } catch(e) { /* cache promise rejected — fall through */ }
  }

  // ── Path 2: No cache yet — fetch from server now and play when ready ────
  speak(log.aiText, onDone, true);
  _prefetchTTSAudio(idx, log.aiText);
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

    recognition.onstart = () => {
      speechEnabled = true;
      speechToggleBtns.forEach(b => { b?.classList.add('listening'); b?.setAttribute('aria-pressed','true'); });
      updateSpeechButton();
    };
    recognition.onresult = ev => {
      let finalTranscript = '';
      let interimTranscript = '';
      for (let i = 0; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) {
          finalTranscript += ev.results[i][0].transcript;
        } else {
          interimTranscript += ev.results[i][0].transcript;
        }
      }
      if (inputEl) inputEl.value = finalTranscript + interimTranscript;
      
      // When final result comes in and it's stable (no more interim)
      if (finalTranscript && !interimTranscript) {
        // We stop the recognition to prevent duplicate sends and clear the state
        recognition.stop();
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
let _imageEncodePromise = null; // resolves once attachedImageBase64 is actually populated

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
  // NOTE: this is async, so we clear the previous attachment immediately and track
  // completion via _imageEncodePromise — handleSend() awaits this so a fast tap on
  // "Send" right after picking a photo can never race past the encode and drop the image.
  attachedImageBase64 = null;
  attachedImageMime   = null;
  const previewBar = document.getElementById('img-preview-bar');
  if (previewBar) previewBar.classList.add('img-processing');

  _imageEncodePromise = new Promise((resolve) => {
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
      if (previewBar) previewBar.classList.remove('img-processing');
      resolve(true);
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
        if (previewBar) previewBar.classList.remove('img-processing');
        resolve(true);
      };
      reader.onerror = () => {
        if (previewBar) previewBar.classList.remove('img-processing');
        resolve(false);
      };
      reader.readAsDataURL(file);
    };
    img.src = previewUrl;
  });

  event.target.value = '';
};

window.removeImage = function() {
  attachedImageBase64 = null;
  attachedImageMime   = null;
  _imageEncodePromise = null;
  var bar = document.getElementById('img-preview-bar');
  bar.classList.remove('show');
  bar.classList.remove('img-processing');
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
// Default: open on desktop (matches the un-collapsed CSS the sidebar ships
// with), closed on mobile (opens as an overlay instead). Previously this
// only got applied to the DOM/empty-state once the hamburger was tapped, so
// a fresh page load left the sidebar and #empty-state's positioning out of
// sync until you toggled it twice.
let sidebarOpen = window.innerWidth > 768;

/* ══════════════════════════════════════════════════════
   SIDEBAR
══════════════════════════════════════════════════════ */
const sidebarBackdrop = document.getElementById('sidebar-backdrop');

function updateSidebarState() {
  if (!chatSidebar) return;
  sidebarOpen ? chatSidebar.classList.remove('collapsed') : chatSidebar.classList.add('collapsed');
  // Sync empty state left offset with sidebar
  const es = document.getElementById('empty-state');
  if (es) es.style.left = sidebarOpen ? 'var(--sidebar-w)' : '0';
  // On mobile, the sidebar drops down over the chat like Claude's hamburger
  // menu rather than pushing content — dim everything behind it while open.
  if (sidebarBackdrop) {
    const isMobile = window.innerWidth <= 768;
    sidebarBackdrop.classList.toggle('show', sidebarOpen && isMobile);
  }
}

sidebarToggle?.addEventListener('click', () => { sidebarOpen = !sidebarOpen; updateSidebarState(); });
mainElement?.addEventListener('pointerdown', () => { if (sidebarOpen) { sidebarOpen = false; updateSidebarState(); } });
sidebarBackdrop?.addEventListener('pointerdown', () => { if (sidebarOpen) { sidebarOpen = false; updateSidebarState(); } });
document.querySelector('.head')?.addEventListener('pointerdown', (e) => {
  if (sidebarOpen && !sidebarToggle?.contains(e.target)) { sidebarOpen = false; updateSidebarState(); }
});
window.addEventListener('resize', updateSidebarState);
// Apply the correct sidebar/empty-state layout right away instead of
// waiting for the first toggle — fixes the "squeezed to the right until I
// tap the hamburger twice" issue on page load/refresh.
updateSidebarState();

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
    // Wrap every <table> in a horizontally-scrollable container so wide
    // tables (many columns) never force the whole chat bubble to overflow
    // on narrow phone screens.
    html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
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
          // Pre-fetch TTS so speak button plays instantly (idempotent — won't re-fetch)
          _prefetchTTSAudio(idx, log.aiText);
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

  // If an image was just picked, its compression/encoding runs async and may still
  // be in flight. Wait for it so a quick tap on Send never ships a text-only message
  // and silently drops the attached image.
  if (_imageEncodePromise) {
    try { await _imageEncodePromise; } catch (ex) {}
    _imageEncodePromise = null;
  }

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
var headerNewChatBtn = document.getElementById('header-new-chat-btn');
if (headerNewChatBtn) headerNewChatBtn.addEventListener('click', function() { createNewChat(); });

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
  es.className = 'empty-state';
  es.innerHTML = `
    <div class="es-stars">
      <span class="es-star"></span><span class="es-star"></span>
      <span class="es-star"></span><span class="es-star"></span>
      <span class="es-star"></span><span class="es-star"></span>
    </div>
    <div class="es-body">
      <img class="es-mark" src="img/icon-mark.png" alt="" aria-hidden="true">
      <div class="es-greeting" id="es-greeting">Hey there 👋</div>
      <div class="es-sub"><span class="es-sub-static">Your AI companion —&nbsp;</span><span class="es-typewriter" id="es-typewriter"></span><span class="es-sub-cursor" id="es-sub-cursor"></span></div>
    </div>`;
  document.body.appendChild(es);
  // #empty-state lives directly under <body> (for fixed positioning), not
  // inside <main>, so the CSS rule `.chat-sidebar.collapsed ~ main
  // .empty-state` never actually matches it — positioning depends entirely
  // on the inline left offset set by updateSidebarState(). That function
  // only runs once at script load, before this element exists yet (it's
  // injected later during init), so a fresh page load/login never picked
  // up the correct offset until the sidebar was toggled. Set it here too,
  // right when the element is actually created.
  es.style.left = (typeof sidebarOpen !== 'undefined' && sidebarOpen) ? 'var(--sidebar-w)' : '0';
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
    { text: 'always here, no matter the hour', pause: 2000 },
    { text: 'zero judgment, ever',             pause: 1800 },
    { text: 'a space that stays just yours',   pause: 2000 },
    { text: "what's on your mind?",            pause: 3200 },
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

let _emotionRecorder    = null;
let _emotionAudioChunks = [];
let _lastEmotionResult  = { emotion: 'neutral', confidence: 0.5 };
let _emotionSampleRate  = 16000;

function _startEmotionCapture() {
  // Emotion capture is currently disabled to ensure stable microphone access for speech recognition.
  return;
}

function _stopEmotionCapture() {
  if (_emotionRecorder && _emotionRecorder.state !== 'inactive') {
    try { _emotionRecorder.stop(); } catch(e) {}
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

let _activeConvoBubbleIdx = -1;
let _spokenWords          = [];

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
let _convoKACtx            = null;  // background keep-alive AudioContext
let _convoKAGain           = null;
let _convoKAOsc            = null;
let _convoHistory         = [];
let _convoThinking        = false;
let _convoMuted           = false;
let _convoMinimized       = false;
let _convoWasHidden       = false;
let _convoSpeaking        = false;
let _convoPreflightStream = null; // held-open mic stream from the permission preflight, released once SR actually starts
let _convoMicFailCount    = 0;
let _convoListenTimer     = null;
let _backendTTSAvailable  = null;
let _convoCurrentState    = 'connecting';
let _convoElapsedInterval = null;

const _SERVER_URL_CONVO = (typeof SERVER_URL !== 'undefined' ? SERVER_URL : 'https://astral-1-sb1i.onrender.com') + '/convo-chat';

let _convoTTSPrefetch = null; // Promise<Blob|null> — legacy ref, points at first chunk's promise
let _convoTTSChunks   = [];   // [{text, promise}] — pipelined per-sentence TTS fetches
let _convoTTSChunksFor = '';  // the reply text these chunks were prefetched for (safety check)

/* ── Audio helpers ──────────────────────────────────────────────────────────── */
function _stopConvoAudio() {
  _masterTTSStop();
  _stopFillerAudio();
  _convoSpeaking = false;
  _convoTTSPrefetch = null;
  _convoTTSChunks = [];
  _convoTTSChunksFor = '';
}

function _fetchTTSChunk(text) {
  // Returns the full {blob, spokenText, wordTimings, ...} result (or null) —
  // spokenText/wordTimings are what Convo Mode's captions are keyed off, so
  // this can no longer just hand back a bare audio blob.
  return (async () => {
    try {
      return await _fetchTTSJson({ text, lang: 'en', slow: false, hq: _isHqAudioEnabled() });
    } catch(e) { return null; }
  })();
}

function _prefetchConvoTTS(text) {
  // Split the reply into sentence-sized chunks and kick off ALL of their TTS
  // fetches in parallel immediately, instead of requesting one giant blob for
  // the whole reply. This is what actually cuts "time to first sound" in
  // conversation mode — the audio for the first sentence is usually ready
  // well before the full reply's audio would be, so playback can start much
  // sooner. The server-side engine cascade itself (Gemini / Google Translate /
  // whatever else it runs, including Fish Audio) is completely untouched —
  // we're only asking it to synthesize less text per request.
  const chunks = _splitIntoChunks(_prepareTextForSpeech(text), 200);
  _convoTTSChunks    = chunks.map(t => ({ promise: _fetchTTSChunk(t) }));
  _convoTTSChunksFor = text;
  _convoTTSPrefetch  = _convoTTSChunks[0] ? _convoTTSChunks[0].promise : null; // legacy ref
}

/* ── Filler / thinking sounds ───────────────────────────────────────────────── */
// Kept generic on purpose — these play before we know whether the user asked
// a question, made a statement, or just said something offhand, so nothing
// here should assume "question" (that's why "good question" etc. got cut).
const _CONVO_THINKING_SOUNDS = [
  "Okay, give me a sec.",
  "Hmm, let me think about that.",
  "Let me think for a moment.",
  "Okay, let me work through that.",
  "Right, let me consider that.",
  "One sec, thinking it through.",
  "Got it, give me a moment.",
  "Let's see here.",
  "Okay, one moment.",
  "Hmm, let me think.",
  "Give me just a second.",
  "Let me piece that together.",
  "Alright, thinking on it.",
  "Sure, hold on a sec.",
  "Let me figure that out.",
  "Just a moment, please.",
  "Okay, I'm on it.",
  "Hmm, one sec.",
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
      const result = await _fetchTTSJson({ text: phrase, lang: 'en', slow: false, hq: _isHqAudioEnabled() });
      if (!result) return null;
      const blob = result.blob;
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
  connecting: 'Connecting…',
  thinking:  'Thinking…',
  loading:   'Channeling…',
  speaking:  'Speaking…',
  analyzing: 'Reading your mood…',
  muted:     'Muted — tap mic to resume',
  listening: 'Listening…'
};

function _setConvoState(state) {
  // Guard against redundant no-op transitions (e.g. the mic silently
  // restarting during a long silence keeps calling this with 'listening'
  // while already listening). Without this, every restart tore the
  // 'state-listening' class off and back on, snapping the orb's breathing
  // animation back to frame 0 — which is what read as the orb "coming off
  // and on" during quiet stretches.
  if (_convoCurrentState === state) return;
  _convoCurrentState = state;
  const wrap = document.getElementById('convo-orb-wrap');
  const mini = document.getElementById('convo-orb-mini');
  const label = _CONVO_STATE_LABELS[state] || _CONVO_STATE_LABELS.listening;

  if (wrap) {
    wrap.classList.remove('state-connecting', 'state-listening', 'state-thinking', 'state-loading', 'state-speaking', 'state-analyzing', 'state-muted');
    wrap.classList.add('state-' + state);
  }
  const status = document.getElementById('convo-status-text');
  if (status) status.textContent = label;

  if (mini) {
    mini.classList.remove('state-connecting', 'state-listening', 'state-thinking', 'state-loading', 'state-speaking', 'state-analyzing', 'state-muted');
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

  _setConvoState('loading');
  _convoSpeaking = true;
  _masterTTSStop();
  _stopFillerAudio();

  // Mic is fully OFF while the AI talks — no barge-in, no listening at all.
  // It snaps back on the instant playback finishes (see _finish() below).
  _convoStopListening();

  // Use the pipelined chunk fetches if they were prefetched for this exact
  // text; otherwise (e.g. an error message that skipped _prefetchConvoTTS)
  // fetch one now so it still gets spoken instead of playing silently.
  let chunkPromises = (_convoTTSChunksFor === text && _convoTTSChunks.length)
    ? _convoTTSChunks.map(c => c.promise)
    : [_fetchTTSChunk(_prepareTextForSpeech(text))];
  _convoTTSChunks    = [];
  _convoTTSChunksFor = '';
  _convoTTSPrefetch  = null;

  // IMPORTANT: the caption word list is built ONLY from what the server
  // tells us it actually spoke (result.spokenText per chunk), never from
  // our own guess. The server normalises text before synthesising it
  // (stripping markdown, expanding contractions, etc.), so its word count
  // and content can differ from whatever we sent — using its own account
  // of what it said is the only way the caption can never say something
  // the voice didn't. This list grows as each chunk resolves.
  let words = [];
  let wordIdx = 0;

  const _finish = () => {
    // Flush any remaining words into the bubble
    while (wordIdx < words.length) { _convoAppendWord(words[wordIdx++]); }
    _convoFinaliseBubble(text);
    _convoThinking = false;
    _convoSpeaking = false;
    if (_convoMode && !_convoMuted) {
      _setConvoState('listening');
      // Snap the mic back on immediately — no delay, like ChatGPT voice mode.
      _convoStartListening();
      // Flush any speech the user said while the AI was thinking/speaking
      const buffered = _aonBufferedWhileThinking.trim();
      _aonBufferedWhileThinking = '';
      if (buffered) {
        setTimeout(() => _convoSendToAI(buffered), 80);
      } else {
        _aonUpdateStatus();
      }
    }
  };

  _masterAbortCtrl = new AbortController();
  const sig = _masterAbortCtrl.signal;

  let playedAny = false;
  for (let ci = 0; ci < chunkPromises.length; ci++) {
    if (sig.aborted || !_convoMode) break;

    let result = null;
    let pulse = (ci === 0) ? setInterval(_triggerWordPulse, 180) : null;
    try { result = await chunkPromises[ci]; } catch(e) {}
    if (pulse) clearInterval(pulse);
    if (sig.aborted || !_convoMode) break;
    if (!result || !result.blob) continue; // this sentence's synthesis failed — keep going with the rest

    playedAny = true;

    // Append this chunk's real spoken words — exactly as the server says
    // it spoke them — to the running caption word list.
    const chunkWords = (result.spokenText || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const baseIdx   = words.length;
    words = words.concat(chunkWords);
    const targetIdx = words.length;

    // Real, ground-truth per-word timestamps if the engine/alignment gave
    // us any (native from Edge TTS, or forced-aligned server-side against
    // the actual generated audio for every other engine) — these are exact,
    // not a guess. Only fall back to a duration-weighted estimate for this
    // chunk if the server genuinely couldn't produce real timing.
    const realTimings = (result.wordTimings && result.wordTimings.length === chunkWords.length)
      ? result.wordTimings
      : null;

    let cueMs        = null; // real ms offsets, used when realTimings is present
    let cueFractions = null; // 0..1 fractions, used for the estimated fallback only
    if (realTimings) {
      cueMs = realTimings.map(w => w.start_ms);
    } else {
      // Duration-weighted estimate — longer words and words followed by
      // punctuation get proportionally more of the chunk's audio duration,
      // the same idea real subtitle timing uses when no ground truth exists.
      const weights = chunkWords.map(w => {
        let weight = Math.max(w.length, 2);
        if (/[.!?]$/.test(w))        weight += 5; // sentence-end pause
        else if (/[,;:—–-]$/.test(w)) weight += 2; // clause/comma pause
        return weight;
      });
      const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
      cueFractions = [];
      let running = 0;
      for (let i = 0; i < weights.length; i++) {
        cueFractions.push(running / totalWeight);
        running += weights[i];
      }
    }

    await new Promise((resolve) => {
      const url = URL.createObjectURL(result.blob);
      const audio = new Audio(url);
      window._ttsAudioEl = audio;

      let rafId          = null;
      let fallbackTicker = null;
      let started        = false;
      const FALLBACK_WORDS_PER_SEC = 3.2; // only used for the brief pre-metadata window on the estimated path

      const revealThrough = (localIdx) => {
        const target = baseIdx + localIdx;
        while (wordIdx < target && wordIdx < targetIdx) {
          _convoAppendWord(words[wordIdx++]);
          _triggerWordPulse();
        }
      };

      const cleanup = () => {
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        if (fallbackTicker) { clearInterval(fallbackTicker); fallbackTicker = null; }
        URL.revokeObjectURL(url);
        window._ttsAudioEl = null;
        resolve();
      };

      // Frame-by-frame loop synced to actual audio playback position.
      const tick = () => {
        if (realTimings) {
          // Ground truth: reveal every word whose real timestamp has passed
          // — no dependency on audio.duration at all, so this is accurate
          // from the very first frame, no metadata wait needed.
          const nowMs = audio.currentTime * 1000;
          let localIdx = 0;
          while (localIdx < cueMs.length && cueMs[localIdx] <= nowMs) localIdx++;
          revealThrough(localIdx);
        } else if (audio.duration && isFinite(audio.duration)) {
          if (fallbackTicker) { clearInterval(fallbackTicker); fallbackTicker = null; }
          const frac = Math.min(1, audio.currentTime / audio.duration);
          let localIdx = 0;
          while (localIdx < cueFractions.length && cueFractions[localIdx] <= frac) localIdx++;
          revealThrough(localIdx);
        }
        if (!audio.paused && !audio.ended) rafId = requestAnimationFrame(tick);
      };

      // Fallback pacing covers the brief window before duration metadata is
      // available — only relevant on the estimated path, since the real-
      // timestamp path doesn't need duration at all.
      const start = () => {
        if (started) return;
        started = true;
        _setConvoState('speaking');
        if (!realTimings) {
          fallbackTicker = setInterval(() => {
            if (audio.duration && isFinite(audio.duration)) {
              clearInterval(fallbackTicker); fallbackTicker = null; return;
            }
            if (wordIdx < targetIdx) { _convoAppendWord(words[wordIdx++]); _triggerWordPulse(); }
          }, 1000 / FALLBACK_WORDS_PER_SEC);
        }
        rafId = requestAnimationFrame(tick);
      };
      audio.addEventListener('playing', start, { once: true });
      audio.addEventListener('canplay', start, { once: true }); // fires earlier on Android

      audio.addEventListener('ended', cleanup);
      audio.addEventListener('error', cleanup);
      sig.addEventListener('abort', () => { try { audio.pause(); } catch(e) {} cleanup(); }, { once: true });
      audio.play().catch(cleanup);
    });

    wordIdx = targetIdx; // make sure we've reached this chunk's boundary even if timing lagged
  }

  if (!playedAny) { _finish(); return; }
  _finish();
}

/* ── Chat bubble management ─────────────────────────────────────────────────── */
function _convoAddBubble(role, text) {
  _convoHistory.push({ role: role === 'user' ? 'user' : 'model', text });
  if (role === 'user') {
    htmlResult.push({ humanText: text, aiText: '', thinking: false, likes: 0, dislikes: 0 });
  } else {
    htmlResult.push({ humanText: '', aiText: '', thinking: false, likes: 0, dislikes: 0 });
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

  // Mic is fully OFF while the AI thinks — resumes the instant it starts speaking back.
  _convoStopListening();

  _convoAddBubble('user', userText);
  _setConvoState('thinking');
  _convoThinkFiller();

  // Emotion analysis is disabled to prevent mic conflicts
  // _setConvoState('analyzing');
  // _stopEmotionCapture();
  // const acousticFeatures = await _getAcousticFeatures().catch(() => null);
  // const emotionData      = await _detectEmotion(userText, acousticFeatures);
  const emotionData = { emotion: 'neutral', confidence: 0.5 };
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
    // Mic resumes automatically via _finish() -> _convoStartListening() once speech ends.

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

let _alwaysOnRec          = null;   // the single persistent SR instance
let _aonPendingFinal      = '';     // accumulated finals for current utterance
let _aonSilenceTimer      = null;   // fires _commitAon after silence
let _aonInterimLatest     = '';     // latest interim for status display
let _aonLang              = 'en-US'; // may fall back to navigator.language
let _aonLangFallbackTried = false;
let _aonWatchdog          = null;
let _aonWatchdogStream    = null;
let _aonLastFinalIdx      = -1;    // high-water mark: last result index we committed as final
let _aonBufferedWhileThinking = ''; // speech heard while AI is thinking — sent after reply

/* ── Trim word-level overlap when appending a new final chunk ────────────────
   Continuous-mode recognizers (esp. Chrome/Android) often re-finalize a
   segment that repeats the tail end of the previous one ("hello" then
   "hello how" then "how are you"). Each arrives at a genuinely new result
   index, so the index-based duplicate guard can't catch it. This trims any
   leading words of `incoming` that already match the trailing words of
   `existing` before appending, which kills the "hello hello how how" stutter. */
function _dedupAppend(existing, incoming) {
  const existWords = existing.trim().split(/\s+/).filter(Boolean);
  const incWords   = incoming.trim().split(/\s+/).filter(Boolean);
  if (!existWords.length || !incWords.length) return (existing.trim() + ' ' + incoming.trim()).trim();
  const maxOverlap = Math.min(existWords.length, incWords.length);
  let overlap = 0;
  for (let n = maxOverlap; n > 0; n--) {
    const tail = existWords.slice(existWords.length - n).join(' ').toLowerCase();
    const head = incWords.slice(0, n).join(' ').toLowerCase();
    if (tail === head) { overlap = n; break; }
  }
  return (existing.trim() + ' ' + incWords.slice(overlap).join(' ')).trim();
}

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
  }

  // If AI is still thinking, buffer this — we will send it once the reply comes back
  if (_convoThinking) {
    _aonBufferedWhileThinking = text; // last utterance wins
    return;
  }

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
    _aonLastFinalIdx   = -1; // new session — reset duplicate-final guard
    _aonLastResultTime = Date.now(); // fresh session — give the watchdog a clean baseline
    _setConvoState(_convoSpeaking ? 'speaking' : 'listening');
    // Mic is active and listening. Status is updated via _aonUpdateStatus().
    // Now that recognition has genuinely taken hold of the mic, it's safe to
    // release the permission-preflight stream from startConvoMode() — see the
    // comment there for why this couldn't happen earlier.
    if (_convoPreflightStream) {
      _convoPreflightStream.getTracks().forEach(t => t.stop());
      _convoPreflightStream = null;
    }
  };

  // onsoundstart/onaudiostart fire whenever the engine actually picks up
  // audio, even before it has a transcript. Previously the watchdog's "is
  // this session still alive" clock (_aonLastResultTime) only moved on
  // onresult — so a normal pause in conversation (nobody has said anything
  // in 18s, which is completely ordinary) looked identical to a session the
  // OS silently killed, and got restarted the same way. Crediting audio
  // activity here means the mic doesn't get needlessly cycled just because
  // the user's been quiet for a bit.
  r.onsoundstart = () => { _aonLastResultTime = Date.now(); };
  r.onaudiostart = () => { _aonLastResultTime = Date.now(); };

  r.onresult = (ev) => {
    if (!_convoMode || _convoMuted) return;
    _aonLastResultTime = Date.now(); // feed the watchdog
    let gotFinal = false;
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const res = ev.results[i];
      const transcript = (res[0]?.transcript || '').trim();
      if (!transcript) continue; // ignore empty noise events
      if (res.isFinal) {
        // High-water mark: skip any finals we already committed in a previous event.
        // Chrome Android redelivers all finals from index 0 on every new event.
        if (i <= _aonLastFinalIdx) continue;
        _aonLastFinalIdx = i;
        _aonPendingFinal = _dedupAppend(_aonPendingFinal, transcript) + ' ';
        gotFinal = true;
        if (_aonSilenceTimer) clearTimeout(_aonSilenceTimer);
        _aonSilenceTimer = setTimeout(_commitAon, 900);
        _aonInterimLatest = '';
      } else {
        _aonInterimLatest = transcript;
      }
    }
    _aonUpdateStatus();
    if (gotFinal) _convoMicFailCount = 0;
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
    // Commit any buffered speech before restarting
    if (_aonPendingFinal.trim()) { _commitAon(); }
    _alwaysOnRec = null;
    // If committing speech put us into thinking/speaking, the mic should stay
    // OFF — _convoStartListening() will be called explicitly once that's done.
    if (_convoThinking || _convoSpeaking) return;
    // Restart immediately — mic should stay live whenever we're not busy,
    // in the foreground or backgrounded (see visibilitychange comment above).
    _scheduleConvoRestart(_convoMicFailCount > 0 ? _convoMicRetryDelay() : 150);
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
    // Skip while thinking (no results expected) AND while the AI is speaking —
    // restarting recognition here would open a fresh mic stream and can steal
    // audio focus from the TTS <audio> element on Android, cutting it off
    // mid-sentence. _finish() resets _aonLastResultTime once speech ends, so
    // the watchdog stays accurate as soon as listening resumes.
    if (!_convoMode || _convoMuted || _convoThinking || _convoSpeaking) return;
    // 45s, not 18s: the known OEM bug this guards against (Samsung Internet,
    // MIUI browser silently killing recognition) shows up around ~60s of
    // dead air, but 18s of silence is completely normal mid-conversation —
    // people pause to think. The old threshold restarted a perfectly
    // healthy mic session every time someone went quiet for a few seconds,
    // which is what read as the mic "going on and off". 45s stays safely
    // under the ~60s failure window while giving real pauses room to breathe.
    if (Date.now() - _aonLastResultTime > 45000) {
      // Stale — poke it
      _aonLastResultTime = Date.now();
      if (_alwaysOnRec) {
        try { _alwaysOnRec.onend = null; _alwaysOnRec.onerror = null; _alwaysOnRec.abort(); } catch(e) {}
        _alwaysOnRec = null;
      }
      _scheduleConvoRestart(200);
    }
  }, 5000);
}

function _stopAonWatchdog() {
  if (_aonWatchdog) { clearInterval(_aonWatchdog); _aonWatchdog = null; }
}


/* ── Full stop: turns the mic completely off (used while thinking/speaking) ──── */
function _convoStopListening() {
  if (_convoListenTimer) { clearTimeout(_convoListenTimer); _convoListenTimer = null; }
  _stopAonWatchdog();
  if (_aonSilenceTimer) { clearTimeout(_aonSilenceTimer); _aonSilenceTimer = null; }
  _aonPendingFinal  = '';
  _aonInterimLatest = '';
  if (_alwaysOnRec) {
    try { _alwaysOnRec.onend = null; _alwaysOnRec.onerror = null; _alwaysOnRec.abort(); } catch(e) {}
    _alwaysOnRec = null;
  }
  _convoRecognition = null;
  _stopEmotionCapture();
  // Whenever a recognition session gets torn down before it reached onstart
  // (e.g. the greeting's _speakConvo() aborting the very first listen ~400ms
  // after startConvoMode() opened it), the preflight stream from
  // startConvoMode() would otherwise sit open until its 5s safety timeout —
  // right through the next, real _convoStartListening() call. Two live mic
  // handles at once is exactly what made recognition go deaf while still
  // firing onstart (UI says "Listening", no audio ever arrives). Release it
  // here too so it can never outlive the session it was held open for.
  if (_convoPreflightStream) {
    _convoPreflightStream.getTracks().forEach(t => t.stop());
    _convoPreflightStream = null;
  }
}

/* ── Legacy stubs — listening is now explicitly start/stopped, kept as no-ops
   so any stray old call-sites don't break. ────────────────────────────────── */
function _startBargeInListening() { /* no-op: see _convoStopListening / _convoStartListening */ }
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

/* ── Installed-app detection ──────────────────────────────────────────────────
   Shared by the "install nudge" toast and by the background-listening gate
   below. True background listening (mic surviving the screen turning off /
   the app being backgrounded) is not something a browser tab can reliably
   promise — iOS Safari suspends mic access the instant a standalone PWA is
   backgrounded, and even Android only tolerates it via an "audible tab"
   workaround, not a real guarantee. Rather than pretend otherwise on the open
   website, we only attempt background continuation (mini orb + notification +
   keep-alive) when running as the installed app. ── */
function _convoIsInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    document.referrer.includes('android-app://');
}

/* ── Start conversation mode ────────────────────────────────────────────────── */

async function startConvoMode() {
  // Don't stack sessions
  if (_convoMode) return;

  // Convo Mode needs the installed app — background mic/notifications can't
  // be promised from a plain browser tab (see _convoIsInstalled comment
  // above). Only a single test account is excused from this gate; everyone
  // else gets pointed at Get App instead of a half-working session.
  const _convoWebExempt = !!(session && session.email === 'bukanwoko@gmail.com');
  if (!_convoIsInstalled() && !_convoWebExempt) {
    showToast('🎙️ Convo Mode is only available in the installed app — tap ⋮ → Get App to install Astral.');
    return;
  }

  // Speech recognition check first — clearest blocker
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    _showConvoError('Voice conversation requires Chrome, Edge, or Safari on Android/desktop, or Safari on iOS.');
    return;
  }

  // Request mic permission explicitly so we surface a clean error before touching SR.
  // IMPORTANT: don't stop the tracks yet — releasing the mic and immediately
  // starting SpeechRecognition races on some Android/Chrome builds (the OS
  // hasn't fully freed the hardware yet), so recognition fires 'onstart' and
  // the UI shows "Listening" but no audio ever reaches it until the mode is
  // toggled off/on. Instead we hold the preflight stream open and only stop
  // it once SpeechRecognition itself has actually started (see onstart in
  // _buildAlwaysOnRec), or after a short safety timeout if that never fires.
  try {
    _convoPreflightStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch(e) {
    _showConvoError('Microphone access is required. Please allow mic access in your browser settings and try again.');
    return;
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
  _convoMicFailCount    = 0;
  _convoCurrentState    = 'connecting';
  _activeConvoBubbleIdx = -1;
  _spokenWords          = [];
  _lastEmotionResult    = { emotion: 'neutral', confidence: 0.5 };
  _backendTTSAvailable  = null;
  // Reset always-on mic state
  _alwaysOnRec              = null;
  _aonPendingFinal          = '';
  _aonInterimLatest         = '';
  _aonLangFallbackTried     = false;
  _aonLastResultTime        = 0;
  _aonLastFinalIdx          = -1;
  _aonBufferedWhileThinking = '';
  if (_aonSilenceTimer) { clearTimeout(_aonSilenceTimer); _aonSilenceTimer = null; }

  // Pre-warm filler audio (non-blocking)
  _prefetchFillerAudio();

  // UI
  document.body.classList.add('convo-mode');
  document.body.classList.remove('convo-minimized');
  _injectConvoOrb();
  _startConvoElapsedTicker();
  _updateConvoElapsedDisplays();

  // Wake lock — keep screen on (best-effort). Note: per spec this is
  // released automatically the moment the tab is backgrounded — it only
  // covers the very common case of the screen auto-locking while the user
  // is actively mid-conversation and not touching the screen.
  if ('wakeLock' in navigator) {
    navigator.wakeLock.request('screen').then(wl => { _convoWakeLock = wl; }).catch(() => {});
  }

  // Prime the background keep-alive tone now, while we're still inside a
  // user-gesture call stack (autoplay policies require that). It starts
  // silent (gain 0) and only gets turned audible once the tab is actually
  // backgrounded — see _enableBackgroundKeepAlive().
  _primeBackgroundKeepAlive();

  // Ask for notification permission now, tied to the moment the user
  // actually starts a feature that needs it — this was previously defined
  // but never invoked anywhere, so the background "still going" notice
  // could never fire for anyone who hadn't granted permission some other
  // way (which was effectively no one).
  if (window._requestNotifPermission) window._requestNotifPermission();

  // Background notification support
  _registerConvoNotification();

  // Start mic immediately so user can speak before the greeting — no
  // artificial delay, since the orb DOM above is already in place.
  _convoStartListening();

  // Safety net: if recognition never fires onstart (unsupported edge case,
  // permission revoked mid-flight, etc.) don't leave the preflight stream —
  // and thus the browser's mic-in-use indicator — open forever.
  setTimeout(() => {
    if (_convoPreflightStream) {
      _convoPreflightStream.getTracks().forEach(t => t.stop());
      _convoPreflightStream = null;
    }
  }, 5000);

  // Greet the user after the orb has rendered
  setTimeout(() => {
    const greeting = _pickConvoGreeting();
    _prefetchConvoTTS(greeting);
    _convoAddBubble('ai', greeting);
    _speakConvo(greeting);
  }, 400);
}

// A big, varied pool of opening lines for conversation mode so it never
// feels like the same canned "Hey, I'm listening" every time. Most are
// generic/casual and can fire any time; a handful are written for a
// specific stretch of the day and only enter the pool when it's actually
// that time for the user.
function _pickConvoGreeting() {
  const hour = new Date().getHours();
  const isMorning   = hour >= 5  && hour < 12;
  const isAfternoon = hour >= 12 && hour < 17;
  const isEvening   = hour >= 17 && hour < 22;
  const isLateNight = hour >= 22 || hour < 5;

  const anytime = [
    "Hey, I'm listening. What's on your mind?",
    "I'm here. Talk to me.",
    "Go ahead, I'm all ears.",
    "What's going on with you?",
    "Alright, I'm tuned in — what's up?",
    "Talk to me — what's on your mind right now?",
    "I'm here and listening. Whenever you're ready.",
    "Okay, I'm with you. What's up?",
    "So, what's on your mind today?",
    "I'm listening — go ahead, whatever it is.",
    "Here we go — what do you want to talk about?",
    "I'm all yours. What's up?",
    "Alright, spill it — what's going on?",
    "I'm here, no rush. What's on your mind?",
    "Okay, I'm locked in. Talk to me.",
    "What's up? I'm listening.",
    "Go on, I've got you. What's up?",
    "I'm here for whatever this is. Go ahead.",
  ];

  const morning = [
    "Morning. How are you feeling so far today?",
    "Hey, good morning — what's on your mind?",
    "Morning! What's today looking like for you?",
  ];
  const afternoon = [
    "Hey, how's your day going so far?",
    "Afternoon — what's on your mind?",
    "Hope your day's treating you alright. What's up?",
  ];
  const evening = [
    "Evening. How'd today go?",
    "Hey, how was your day?",
    "Good evening — what's on your mind tonight?",
  ];
  const lateNight = [
    "Hey, it's late — what's keeping you up?",
    "Still up, huh? I'm here. What's on your mind?",
    "Late one tonight. What's going on?",
  ];

  let pool = anytime.slice();
  if (isMorning)   pool = pool.concat(morning);
  if (isAfternoon) pool = pool.concat(afternoon);
  if (isEvening)   pool = pool.concat(evening);
  if (isLateNight) pool = pool.concat(lateNight);

  return pool[Math.floor(Math.random() * pool.length)];
}

/* ── Stop conversation mode ─────────────────────────────────────────────────── */
function stopConvoMode() {
  if (!_convoMode) return;
  _convoMode      = false;
  _convoMinimized = false;
  _convoMuted     = false;
  _convoWasHidden = false;
  _convoThinking  = false;
  _convoSpeaking  = false;

  if (_convoListenTimer)  { clearTimeout(_convoListenTimer);  _convoListenTimer  = null; }
  if (_aonSilenceTimer)   { clearTimeout(_aonSilenceTimer);   _aonSilenceTimer   = null; }
  if (_convoPreflightStream) { _convoPreflightStream.getTracks().forEach(t => t.stop()); _convoPreflightStream = null; }
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
  _stopBackgroundKeepAlive();

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
  wrap.className = 'state-connecting';
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
  mini.className = 'state-connecting';
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

/* ── Background keep-alive tone ─────────────────────────────────────────────
   Chrome (desktop and Android) exempts tabs it considers "audible" from its
   background timer throttling and Energy-Saver tab-freezing — this is how
   music/dashboard sites keep running when you switch away. A silent
   (gain=0) stream does NOT count as audible, so we play a genuinely
   near-inaudible low tone (20Hz, ~2% gain) only while the tab is actually
   hidden during an active conversation. This is what makes the "still
   going / tap to return" notification heartbeat fire reliably instead of
   getting silently frozen a minute or two into being backgrounded — it
   does not, and cannot, keep the microphone itself capturing while
   backgrounded (that's a platform limitation no web page can override
   without a native wrapper), but it keeps the app's own JS alive so it can
   notice, notify, and cleanly resume the moment the user comes back. ── */
function _primeBackgroundKeepAlive() {
  if (_convoKACtx) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    _convoKACtx  = new Ctx();
    _convoKAGain = _convoKACtx.createGain();
    _convoKAGain.gain.value = 0; // silent while foregrounded
    _convoKAOsc  = _convoKACtx.createOscillator();
    _convoKAOsc.frequency.value = 20; // sub-bass, effectively inaudible at low gain
    _convoKAOsc.connect(_convoKAGain);
    _convoKAGain.connect(_convoKACtx.destination);
    _convoKAOsc.start();
  } catch(e) { _convoKACtx = null; }
}

function _enableBackgroundKeepAlive() {
  if (!_convoKACtx) _primeBackgroundKeepAlive();
  if (!_convoKACtx || !_convoKAGain) return;
  try {
    if (_convoKACtx.state === 'suspended') _convoKACtx.resume();
    _convoKAGain.gain.setTargetAtTime(0.02, _convoKACtx.currentTime, 0.1);
  } catch(e) {}
}

function _disableBackgroundKeepAlive() {
  if (!_convoKACtx || !_convoKAGain) return;
  try { _convoKAGain.gain.setTargetAtTime(0, _convoKACtx.currentTime, 0.1); } catch(e) {}
}

function _stopBackgroundKeepAlive() {
  if (_convoKAOsc)  { try { _convoKAOsc.stop(); } catch(e) {} _convoKAOsc = null; }
  if (_convoKACtx)  { try { _convoKACtx.close(); } catch(e) {} _convoKACtx = null; }
  _convoKAGain = null;
}

/* ── Visibility change — keep listening in the background ────────────────────
   Earlier versions proactively killed the recognizer the instant the tab
   went hidden, on the assumption the browser blocks the mic anyway once
   backgrounded. That assumption was never actually confirmed — Chrome only
   documents throttling *timers*, not mic access itself, and explicitly
   exempts real-time connections (which is what SpeechRecognition's
   server-based engine uses under the hood) from that throttling. Combined
   with the background keep-alive tone above (which stops the page's JS
   from freezing in the first place), we now let recognition keep running:
   if it does get killed by the OS/browser, the existing onerror/onend
   restart logic and the AudioContext watchdog just bring it back — the
   same self-healing they already do in the foreground — instead of us
   giving up pre-emptively. If a device truly can't sustain it, the
   existing _convoMicFailCount circuit breaker still cleanly stops things
   after repeated failures rather than looping forever. ── */
document.addEventListener('visibilitychange', () => {
  if (!_convoMode) return;
  if (document.hidden) {
    _convoWasHidden = true;

    if (!_convoIsInstalled()) {
      // Website (not installed): don't promise background listening we can't
      // reliably keep, and don't leave a mini orb / notification implying the
      // mic is still live with no on-screen way to check. Pause cleanly —
      // it resumes automatically the moment the tab is visible again (see the
      // 'else if' branch below, which runs for both web and app).
      _convoStopListening();
      _setConvoState('muted');
      return;
    }

    _stopBargeInListening();
    _stopEmotionCapture();
    _minimizeConvo();
    _registerConvoNotification();
    _startConvoNotifHeartbeat();
    _enableBackgroundKeepAlive();
    // Recognition itself, and its watchdog, are deliberately left running —
    // see comment above.
  } else if (_convoWasHidden) {
    _convoWasHidden = false;
    _unregisterConvoNotification();
    _stopConvoNotifHeartbeat();
    _disableBackgroundKeepAlive();
    if ('wakeLock' in navigator && !_convoWakeLock) {
      navigator.wakeLock.request('screen').then(wl => { _convoWakeLock = wl; }).catch(() => {});
    }
    // Restore the full orb so user sees it when they come back (not minimized)
    _restoreConvo();
    // Recognition should already still be alive from before backgrounding —
    // only (re)start it here if it actually died while hidden and nothing
    // has restarted it yet.
    if (!_alwaysOnRec && !_convoThinking && !_convoMuted) setTimeout(_convoStartListening, 600);
  }
});

/* ── Page Lifecycle 'freeze' — fires right before Chrome actually suspends
   a backgrounded page (the point our own JS timers stop being reliable).
   Squeeze in one last ping so the service worker's independent notification
   loop has the freshest possible state to keep going from. ── */
document.addEventListener('freeze', () => {
  if (!_convoMode || !_convoIsInstalled()) return;
  try {
    navigator.serviceWorker.ready.then(reg => {
      if (reg.active) reg.active.postMessage({ type: 'CONVO_PING', startTime: _convoStartTime });
    }).catch(() => {});
  } catch(e) {}
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

init();
