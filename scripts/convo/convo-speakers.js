/* ══════════════════════════════════════════════════════════════════════════
   CONVO-SPEAKERS.JS
   ---------------------------------------------------------------------------
   New capability: let more than one person take part in convo mode, the way
   people naturally hand a conversation off — "hang on, my partner wants to
   ask something" — instead of the AI assuming every utterance is the same
   person.

   HONEST SCOPE NOTE — read before wiring this up:
   Real speaker verification (the "Hey Google, is this Alex or Priya" kind)
   uses trained neural voiceprint embeddings (e.g. ECAPA-TDNN, Resemblyzer)
   run against enrolled samples, typically server-side. That is NOT what this
   file does, and claiming otherwise would be misleading. What this file
   does is a much cheaper, browser-only approximation:

     - While the always-on recognizer is capturing an utterance, an
       AnalyserNode samples pitch (via autocorrelation) and spectral
       centroid (via FFT) to build a rough per-utterance "signature."
     - Signatures are clustered against a small in-session roster using
       simple distance — good enough to flag "this sounds like a different
       person than last time," not good enough for security or precise ID.
     - When a signature doesn't match anyone in the roster, we treat it as
       a possible new speaker and surface an introduction prompt, mirroring
       how people actually fold a new voice into an ongoing conversation
       ("sorry, who's this?") rather than silently guessing.

   For real multi-user voice ID (e.g. "always recognize Mom vs. Dad"),
   that belongs in Server.py as a proper embedding model against enrolled
   samples — this module is deliberately the cheap, no-backend-changes-needed
   version. Treat its labels as "voice A / voice B," not identity.
   ═══════════════════════════════════════════════════════════════════════ */

const MATCH_DISTANCE_THRESHOLD = 0.22; // empirical — tune against your own users' voices
const MIN_SAMPLES_TO_TRUST_CLUSTER = 2;
const ROSTER_MAX_SPEAKERS = 4; // matches the participant cap most multi-party diarization work targets

let _roster = []; // [{ id, label, pitchMean, centroidMean, sampleCount, introduced }]
let _nextSpeakerNum = 1;

/* ── Extract a rough per-utterance signature from a recorded Float32 buffer ─
   pitch: autocorrelation-based fundamental frequency estimate.
   centroid: spectral centroid from FFT magnitudes — a cheap proxy for
   "brightness"/timbre that pitch alone doesn't capture. Together these are
   a coarse stand-in for a real voiceprint embedding. */
export function extractSignature(floatBuffer, sampleRate) {
  const pitch = estimatePitchAutocorrelation(floatBuffer, sampleRate);
  const centroid = estimateSpectralCentroid(floatBuffer, sampleRate);
  return { pitch, centroid };
}

function estimatePitchAutocorrelation(buf, sampleRate) {
  const minLag = Math.floor(sampleRate / 400); // ~400Hz upper bound
  const maxLag = Math.floor(sampleRate / 70);  // ~70Hz lower bound
  let bestLag = -1, bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < buf.length - lag; i++) corr += buf[i] * buf[i + lag];
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }
  if (bestLag <= 0) return null;
  return sampleRate / bestLag;
}

function estimateSpectralCentroid(buf, sampleRate) {
  // Simple magnitude spectrum via a small DFT — buf is expected to already
  // be a short (~2048 sample) frame, not the whole utterance, so this stays
  // cheap enough to run per utterance without a real FFT library.
  const N = Math.min(buf.length, 2048);
  let weightedSum = 0, magSum = 0;
  for (let k = 1; k < N / 2; k++) {
    let re = 0, im = 0;
    const freq = (k * sampleRate) / N;
    for (let n = 0; n < N; n++) {
      const angle = (2 * Math.PI * k * n) / N;
      re += buf[n] * Math.cos(angle);
      im -= buf[n] * Math.sin(angle);
    }
    const mag = Math.sqrt(re * re + im * im);
    weightedSum += freq * mag;
    magSum += mag;
  }
  return magSum > 0 ? weightedSum / magSum : 0;
}

function distance(sigA, sigB) {
  if (!sigA.pitch || !sigB.pitch) return Infinity;
  const pitchDiff = Math.abs(sigA.pitch - sigB.pitch) / Math.max(sigA.pitch, sigB.pitch);
  const centroidDiff = Math.abs(sigA.centroid - sigB.centroid) / Math.max(sigA.centroid, sigB.centroid, 1);
  return (pitchDiff * 0.7) + (centroidDiff * 0.3); // pitch is the stronger cue at this resolution
}

/* ── Public: match (or provisionally register) a speaker for one utterance ─
   Returns { speaker, isNewSpeaker }. `speaker.introduced` starts false —
   the caller is expected to ask "who am I speaking with?" once, then call
   markIntroduced() with whatever name comes back, so we don't re-ask every
   turn for the same voice. */
export function matchOrRegisterSpeaker(signature) {
  let best = null, bestDist = Infinity;
  for (const s of _roster) {
    const d = distance(signature, { pitch: s.pitchMean, centroid: s.centroidMean });
    if (d < bestDist) { bestDist = d; best = s; }
  }

  if (best && bestDist <= MATCH_DISTANCE_THRESHOLD) {
    // Running average — lets the cluster drift gently as more samples come in.
    best.pitchMean = (best.pitchMean * best.sampleCount + signature.pitch) / (best.sampleCount + 1);
    best.centroidMean = (best.centroidMean * best.sampleCount + signature.centroid) / (best.sampleCount + 1);
    best.sampleCount++;
    return { speaker: best, isNewSpeaker: false };
  }

  if (_roster.length >= ROSTER_MAX_SPEAKERS) {
    // Roster full — fall back to the closest match rather than growing
    // unbounded; most real conversations this module targets (a couple
    // joining a call, a kid chiming in) stay well under this cap.
    return { speaker: best, isNewSpeaker: false };
  }

  const fresh = {
    id: `speaker-${Date.now()}-${_nextSpeakerNum}`,
    label: `Speaker ${_nextSpeakerNum++}`,
    pitchMean: signature.pitch,
    centroidMean: signature.centroid,
    sampleCount: 1,
    introduced: false,
  };
  _roster.push(fresh);
  // First-ever speaker in a session isn't "new" from the user's point of
  // view — they started the conversation. Only flag as new (and worth an
  // introduction prompt) once someone ELSE has already been talking.
  const isNewSpeaker = _roster.length > 1;
  return { speaker: fresh, isNewSpeaker };
}

/* ── Public: record a name once the AI has asked and gotten an answer ─────── */
export function markIntroduced(speakerId, name) {
  const s = _roster.find(r => r.id === speakerId);
  if (s) { s.introduced = true; if (name) s.label = name; }
}

/* ── Public: should we prompt for an introduction right now? ─────────────── */
export function needsIntroduction(speaker) {
  return !!speaker && !speaker.introduced && speaker.sampleCount >= MIN_SAMPLES_TO_TRUST_CLUSTER;
}

/* ── Public: a natural-sounding line for the AI to open with, CA-style ─────
   Adjacency-pair shaped on purpose (Sacks/Schegloff/Jefferson): the AI's
   question sets up a slot the new speaker is expected to fill next, exactly
   like a real "oh, hi — who's this?" handoff. */
export function introductionPrompt() {
  const openers = [
    "Sounds like someone new joined — who am I talking with?",
    "Hi there — I don't think we've met yet. What's your name?",
    "Oh, hello! Who's this?",
  ];
  return openers[Math.floor(Math.random() * openers.length)];
}

/* ── Public: current roster, for tagging transcript bubbles with a label ─── */
export function getRoster() { return _roster.slice(); }

export function resetRoster() { _roster = []; _nextSpeakerNum = 1; }
