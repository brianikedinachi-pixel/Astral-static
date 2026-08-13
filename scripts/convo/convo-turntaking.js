/* ══════════════════════════════════════════════════════════════════════════
   CONVO-TURNTAKING.JS
   ---------------------------------------------------------------------------
   New capability, not currently in brain.js: real turn-taking instead of
   strict alternating Q&A.

   Grounded in conversation-analysis / spoken-dialogue-systems research:

   - Sacks, Schegloff & Jefferson (1974), "A simplest systematics for the
     organization of turn-taking for conversation" — human turn-taking is not
     "wait for total silence then speak." Listeners project when a turn is
     about to end (a "transition-relevance place") and can start early;
     overlap is normal, not an error condition.
   - Meta's hierarchical End-of-Turn model (Helwani et al., 2026) and Voice
     Activity Projection work (Inoue et al. 2024; triadic VAP, 2025) treat
     both parties' activity as continuous signals, predicting turn transitions
     ahead of time rather than gating on a fixed silence timeout.
   - Backchannels ("mm-hm", "right", a nod) let a listener show continued
     attention WITHOUT taking the floor — they are a distinct signal from an
     interruption.

   Astral's current convo mode (brain.js) does none of this: `_speakConvo()`
   calls `_convoStopListening()` and the mic is fully off while the AI talks
   ("no barge-in, no listening at all" — see its own comment). The
   `_startBargeInListening` / `_stopBargeInListening` functions are dead
   no-op stubs. That's why it reads as strict Q&A instead of a conversation.

   This module adds a real, lightweight voice-activity detector (VAD) that
   runs ONLY while the AI is speaking, so the user can cut in — the way
   people actually interrupt each other — without needing a full always-on
   recognizer fighting the TTS audio for the mic.
   ═══════════════════════════════════════════════════════════════════════ */

import { getConvoState, setConvoState } from './convo-state.js';

// Tunables — these map directly onto the CA/VAP concepts above.
const VAD_RMS_THRESHOLD   = 0.045; // energy floor above which we consider it "voice", not room noise/breath.
                                    // Raised slightly from 0.035 — on laptop internal speaker+mic, some
                                    // TTS output still leaks past echo cancellation, and 0.035 was catching it.
const VAD_SUSTAIN_MS      = 220;   // must stay above threshold this long — filters coughs, mic bumps, breath
const VAD_POLL_MS         = 40;    // ~25fps energy sampling, cheap enough to run continuously
const VAD_ARM_DELAY_MS    = 350;   // ignore mic energy for this long after the watch starts — the first
                                    // moment of TTS playback is the loudest echo transient (speaker ramp-up,
                                    // AEC hasn't adapted yet); without this the AI can trip its own barge-in
                                    // on the first word of its own reply.
const EOT_BASE_SILENCE_MS = 400;   // pause before committing an utterance, once results have truly stopped.
                                    // Lowered from 550 — was the main source of the "takes a while to send" feel.
const EOT_TRAILING_EXTENSION_MS = 350; // extra grace when the utterance sounds mid-thought (see below).
                                        // Lowered from 500, same reason — still gives real trailing-off
                                        // sentences room, just doesn't sit on every reply.

// Words/constructs that conversation analysts note as markers of an
// incomplete turn-constructional unit (TCU) — a speaker trailing off on one
// of these is very likely still holding the floor, not done talking.
const TRAILING_INCOMPLETE_RE =
  /\b(and|but|so|because|which|that|um|uh|like|or|if|when|then)$/i;

let _vadAudioCtx   = null;
let _vadAnalyser   = null;
let _vadSource     = null;
let _vadStream     = null;
let _vadRafId      = null;
let _vadAboveSince = null;
let _onBargeIn     = null; // caller-supplied callback, fired once per interruption

/* ── Public: start watching the mic for an interrupting voice ──────────────
   Call this right when AI speech starts (from _speakConvo, in place of the
   old _convoStopListening()-only behavior). It opens its own lightweight
   mic tap purely for energy detection — it does NOT run full speech
   recognition, so it doesn't compete with the TTS <audio> element for
   whatever the always-on recognizer needs, and it's cheap enough to poll
   continuously without burning battery. */
export async function startBargeInWatch(onBargeIn) {
  stopBargeInWatch(); // never double-open a stream
  _onBargeIn = onBargeIn;

  try {
    // Explicit constraints, not just `audio: true` — leaving these unset means
    // relying on whatever the browser's default happens to be, and that default
    // is what was letting the AI's own TTS output (played through a plain
    // <audio> element, not a WebRTC track) leak into this tap and trigger
    // self-barge-in. Asking for all three directly is the standard mitigation.
    _vadStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  } catch (e) {
    // Mic permission unavailable — degrade gracefully to the old behavior
    // (AI finishes speaking with no interrupt path). Don't throw; a denied
    // mic here shouldn't crash the reply.
    return;
  }

  _vadAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  _vadSource   = _vadAudioCtx.createMediaStreamSource(_vadStream);
  _vadAnalyser = _vadAudioCtx.createAnalyser();
  _vadAnalyser.fftSize = 512;
  _vadSource.connect(_vadAnalyser);

  const buf = new Float32Array(_vadAnalyser.fftSize);
  _vadAboveSince = null;
  const _armAt = performance.now() + VAD_ARM_DELAY_MS;

  const poll = () => {
    _vadAnalyser.getFloatTimeDomainData(buf);
    let sumSquares = 0;
    for (let i = 0; i < buf.length; i++) sumSquares += buf[i] * buf[i];
    const rms = Math.sqrt(sumSquares / buf.length);

    // Still in the arm-delay window — keep sampling (so _vadAboveSince tracking
    // stays consistent) but never let it fire yet. Covers the loudest echo
    // transient right as TTS playback starts, before AEC has adapted.
    if (performance.now() < _armAt) {
      _vadRafId = setTimeout(poll, VAD_POLL_MS);
      return;
    }

    if (rms >= VAD_RMS_THRESHOLD) {
      if (_vadAboveSince == null) _vadAboveSince = performance.now();
      if (performance.now() - _vadAboveSince >= VAD_SUSTAIN_MS) {
        const cb = _onBargeIn;
        stopBargeInWatch(); // one-shot: fire once, caller restarts full listening
        if (cb) cb();
        return;
      }
    } else {
      _vadAboveSince = null;
    }
    _vadRafId = setTimeout(poll, VAD_POLL_MS);
  };
  poll();
}

/* ── Public: tear down the barge-in mic tap ─────────────────────────────── */
export function stopBargeInWatch() {
  if (_vadRafId) { clearTimeout(_vadRafId); _vadRafId = null; }
  _vadAboveSince = null;
  if (_vadSource) { try { _vadSource.disconnect(); } catch (e) {} _vadSource = null; }
  if (_vadAnalyser) { _vadAnalyser = null; }
  if (_vadAudioCtx) { try { _vadAudioCtx.close(); } catch (e) {} _vadAudioCtx = null; }
  if (_vadStream) { _vadStream.getTracks().forEach(t => t.stop()); _vadStream = null; }
}

/* ── Public: how long to wait before treating silence as "done talking" ────
   Instead of one fixed timeout for every utterance, extend it when the
   trailing words look like a mid-thought TCU (see TRAILING_INCOMPLETE_RE
   above). This is a cheap text-level stand-in for the prosodic/syntactic
   completion cues real turn-taking models use — Web Speech API doesn't
   expose pitch contour, so trailing-word heuristics are the practical
   substitute in-browser. */
export function endOfTurnDelayFor(pendingText) {
  const trimmed = (pendingText || '').trim();
  if (TRAILING_INCOMPLETE_RE.test(trimmed)) {
    return EOT_BASE_SILENCE_MS + EOT_TRAILING_EXTENSION_MS;
  }
  return EOT_BASE_SILENCE_MS;
}

/* ── Public: visual-only backchannel while the user is mid-utterance ───────
   Fires a "listening pulse" callback every few seconds during a long user
   turn — meant to drive a subtle orb animation (a nod-equivalent), never
   audio, so it can never step on the user's turn. This is the "I'm still
   here, keep going" signal from CA's backchannel literature, without
   actually taking the floor. */
let _backchannelTimer = null;

export function startBackchannelPulses(onPulse, intervalMs = 3500) {
  stopBackchannelPulses();
  _backchannelTimer = setInterval(() => { if (onPulse) onPulse(); }, intervalMs);
}

export function stopBackchannelPulses() {
  if (_backchannelTimer) { clearInterval(_backchannelTimer); _backchannelTimer = null; }
}
