/**
 * TypeTalk — audio.js
 *
 * Synthesized UI sound effects built on the Web Audio API. No audio files are
 * loaded; every sound is generated from oscillators and noise at play time.
 *
 * - The AudioContext is created lazily (browsers require a user gesture before
 *   audio may start). Call `initAudio()` from the first pointerdown/keydown.
 * - All `play*` functions are safe no-ops when the context is unavailable, not
 *   yet running, or when sounds are muted. They never throw.
 * - Volume and mute state come from settings (`soundVolume`, `soundMuted`) and
 *   are kept in sync live via `onSettingsChange`.
 */

import { getSettings, setSetting, onSettingsChange } from './settings.js';

/** @type {AudioContext|null} */
let ctx = null;
/** @type {GainNode|null} */
let master = null;
/** @type {AudioBuffer|null} Cached white-noise buffer for key clicks. */
let noiseBuffer = null;

/** Current volume 0..1 (mirrors settings.soundVolume). */
let volume = 0.5;
/** Current mute flag (mirrors settings.soundMuted). */
let muted = false;

/** Timestamp (ms) of the last key click, used for throttling. */
let lastKeyAt = 0;
const KEY_THROTTLE_MS = 15;

/** How long (seconds) master gain ramps take when volume/mute changes. */
const RAMP_SEC = 0.03;

// ---------------------------------------------------------------------------
// Settings bootstrap
// ---------------------------------------------------------------------------

try {
  const s = getSettings();
  volume = clamp01(s.soundVolume);
  muted = Boolean(s.soundMuted);
} catch (_err) {
  // Settings unavailable (should not happen) — keep defaults.
}

try {
  onSettingsChange((s, changedKeys) => {
    const keys = Array.isArray(changedKeys) ? changedKeys : [];
    let dirty = false;
    if (keys.length === 0 || keys.includes('soundVolume')) {
      const v = clamp01(s.soundVolume);
      if (v !== volume) { volume = v; dirty = true; }
    }
    if (keys.length === 0 || keys.includes('soundMuted')) {
      const m = Boolean(s.soundMuted);
      if (m !== muted) { muted = m; dirty = true; }
    }
    if (dirty) applyMasterGain();
  });
} catch (_err) {
  // Subscription failed — live updates disabled, explicit setters still work.
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Clamp a value to 0..1, treating non-numbers as 0.5.
 * @param {*} v
 * @returns {number}
 */
function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

/**
 * Effective master gain given current volume and mute state.
 * @returns {number}
 */
function targetGain() {
  return muted ? 0 : volume;
}

/**
 * Smoothly ramp the master GainNode to the current target gain.
 */
function applyMasterGain() {
  if (!ctx || !master) return;
  try {
    const now = ctx.currentTime;
    const g = master.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(targetGain(), now + RAMP_SEC);
  } catch (_err) {
    // Ignore — gain will simply apply on next ensureContext().
  }
}

/**
 * Resolve the AudioContext constructor across browsers.
 * @returns {typeof AudioContext|null}
 */
function getContextCtor() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

/**
 * Create the context + master gain if needed and try to resume it.
 * Never throws.
 * @returns {boolean} true when the context exists and is running
 */
function ensureContext() {
  try {
    if (!ctx) {
      const Ctor = getContextCtor();
      if (!Ctor) return false;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = targetGain();
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') {
      // resume() returns a promise; swallow rejections (no user gesture yet).
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
    return ctx.state === 'running';
  } catch (_err) {
    return false;
  }
}

/**
 * Whether a sound may be played right now.
 * @returns {boolean}
 */
function canPlay() {
  if (muted) return false;
  if (!ensureContext()) return false;
  return Boolean(ctx && master && ctx.state === 'running');
}

/**
 * Lazily build (and cache) a short buffer of white noise.
 * @returns {AudioBuffer|null}
 */
function getNoiseBuffer() {
  if (!ctx) return null;
  if (noiseBuffer) return noiseBuffer;
  try {
    const len = Math.floor(ctx.sampleRate * 0.1); // 100 ms is plenty
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffer = buf;
    return buf;
  } catch (_err) {
    return null;
  }
}

/**
 * Create a GainNode with an attack/decay envelope, connected to master.
 * @param {number} start   context time to start
 * @param {number} peak    peak gain
 * @param {number} attack  seconds to reach peak
 * @param {number} decay   seconds from peak to silence (exponential)
 * @returns {GainNode}
 */
function envelope(start, peak, attack, decay) {
  const g = ctx.createGain();
  const gain = g.gain;
  gain.setValueAtTime(0.0001, start);
  gain.linearRampToValueAtTime(peak, start + attack);
  gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
  g.connect(master);
  return g;
}

/**
 * Schedule a single oscillator tone with an envelope.
 * @param {object} o
 * @param {OscillatorType} o.type
 * @param {number} o.freq      frequency in Hz
 * @param {number} o.start     context time to start
 * @param {number} o.peak      peak gain
 * @param {number} o.attack    seconds
 * @param {number} o.decay     seconds
 * @param {number} [o.detune]  cents
 * @param {number} [o.freqEnd] optional frequency to glide to by the end
 */
function tone({ type, freq, start, peak, attack, decay, detune = 0, freqEnd }) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (typeof freqEnd === 'number' && freqEnd > 0) {
    osc.frequency.exponentialRampToValueAtTime(freqEnd, start + attack + decay);
  }
  if (detune) osc.detune.setValueAtTime(detune, start);
  const env = envelope(start, peak, attack, decay);
  osc.connect(env);
  osc.start(start);
  osc.stop(start + attack + decay + 0.02);
  osc.onended = () => {
    try { osc.disconnect(); env.disconnect(); } catch (_e) { /* noop */ }
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create and/or resume the AudioContext. Call this from the first user
 * gesture (pointerdown / keydown). Safe to call repeatedly; never throws.
 */
export function initAudio() {
  ensureContext();
  applyMasterGain();
}

/**
 * Soft, short mechanical key click. Throttled to one click per 15 ms so
 * fast typing and key repeat do not pile up. Each click has slight random
 * pitch variation so repeated presses feel natural.
 */
export function playKey() {
  const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (nowMs - lastKeyAt < KEY_THROTTLE_MS) return;
  if (!canPlay()) return;
  lastKeyAt = nowMs;
  try {
    const t = ctx.currentTime;
    const variation = 0.9 + Math.random() * 0.2; // +/-10%

    // Filtered noise burst — the "thock" of the key.
    const buf = getNoiseBuffer();
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(2600 * variation, t);
      bp.Q.setValueAtTime(0.8, t);
      const env = envelope(t, 0.14, 0.002, 0.03);
      src.connect(bp);
      bp.connect(env);
      src.start(t);
      src.stop(t + 0.04);
      src.onended = () => {
        try { src.disconnect(); bp.disconnect(); env.disconnect(); } catch (_e) { /* noop */ }
      };
    }

    // Soft high tick that gives the click its pitch.
    tone({
      type: 'sine',
      freq: 1200 * variation,
      start: t,
      peak: 0.06,
      attack: 0.002,
      decay: 0.03
    });
  } catch (_err) {
    // Never let an audio glitch surface to the caller.
  }
}

/**
 * Low, short thud for a mistake (~90 ms).
 */
export function playError() {
  if (!canPlay()) return;
  try {
    const t = ctx.currentTime;
    tone({
      type: 'triangle',
      freq: 160,
      freqEnd: 110,
      start: t,
      peak: 0.28,
      attack: 0.005,
      decay: 0.085
    });
    // A touch of sawtooth underneath for body, lower in the mix.
    tone({
      type: 'sawtooth',
      freq: 80,
      start: t,
      peak: 0.08,
      attack: 0.005,
      decay: 0.07
    });
  } catch (_err) {
    // ignore
  }
}

/**
 * Gentle three-note rising chime (C5 E5 G5, ~400 ms) for a completed test.
 */
export function playSuccess() {
  if (!canPlay()) return;
  try {
    const t = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99]; // C5 E5 G5
    const step = 0.11;
    notes.forEach((freq, i) => {
      tone({
        type: 'sine',
        freq,
        start: t + i * step,
        peak: 0.22,
        attack: 0.015,
        decay: i === notes.length - 1 ? 0.3 : 0.2
      });
    });
  } catch (_err) {
    // ignore
  }
}

/**
 * Sparkly five-note arpeggio with shimmer (two detuned oscillators per note),
 * ~700 ms. Used for badge unlocks and level ups.
 */
export function playUnlock() {
  if (!canPlay()) return;
  try {
    const t = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51]; // C5 E5 G5 C6 E6
    const step = 0.1;
    notes.forEach((freq, i) => {
      const start = t + i * step;
      const last = i === notes.length - 1;
      const decay = last ? 0.4 : 0.26;
      // Main voice.
      tone({ type: 'sine', freq, start, peak: 0.18, attack: 0.01, decay, detune: -6 });
      // Shimmer voice, slightly detuned and quieter, triangle for sparkle.
      tone({ type: 'triangle', freq, start, peak: 0.07, attack: 0.01, decay, detune: 9 });
    });
    // Soft octave sparkle on top of the final note.
    tone({
      type: 'sine',
      freq: 2637.02, // E7
      start: t + (notes.length - 1) * step + 0.03,
      peak: 0.05,
      attack: 0.01,
      decay: 0.25
    });
  } catch (_err) {
    // ignore
  }
}

/**
 * Short 880 Hz countdown blip (~50 ms).
 */
export function playTick() {
  if (!canPlay()) return;
  try {
    const t = ctx.currentTime;
    tone({
      type: 'sine',
      freq: 880,
      start: t,
      peak: 0.16,
      attack: 0.004,
      decay: 0.046
    });
  } catch (_err) {
    // ignore
  }
}

/**
 * Set the effects volume (0..1). Persists to settings.soundVolume and
 * updates the master gain immediately.
 * @param {number} v
 */
export function setVolume(v) {
  const next = clamp01(v);
  volume = next;
  applyMasterGain();
  try {
    setSetting('soundVolume', next);
  } catch (_err) {
    // ignore persistence failure
  }
}

/**
 * Current effects volume (0..1).
 * @returns {number}
 */
export function getVolume() {
  return volume;
}

/**
 * Mute or unmute effects. Persists to settings.soundMuted and updates the
 * master gain immediately.
 * @param {boolean} bool
 */
export function setMuted(bool) {
  muted = Boolean(bool);
  applyMasterGain();
  try {
    setSetting('soundMuted', muted);
  } catch (_err) {
    // ignore persistence failure
  }
}

/**
 * Whether effects are currently muted.
 * @returns {boolean}
 */
export function isMuted() {
  return muted;
}
