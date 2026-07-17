/* ══════════════════════════════════════════════════════════════════════════
   CONVO-STATE.JS
   ---------------------------------------------------------------------------
   Minimal shared state so convo-turntaking.js and convo-speakers.js don't
   need to reach into brain.js's globals directly. brain.js calls setConvoState()
   wherever it currently calls its own _setConvoState(), so both stay in sync.
   Kept deliberately tiny — this is a bridge, not a rewrite of brain.js's
   existing state management.
   ═══════════════════════════════════════════════════════════════════════ */

let _state = 'connecting'; // connecting | listening | thinking | analyzing | loading | speaking | muted

export function getConvoState() { return _state; }

export function setConvoState(next) {
  _state = next;
  document.dispatchEvent(new CustomEvent('convo:state', { detail: { state: next } }));
}
