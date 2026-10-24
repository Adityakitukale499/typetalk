/**
 * TypeTalk statistics: result history, totals, daily counts, personal bests
 * and streaks. All data lives in localStorage via storage.js.
 *
 * Storage keys (without the `typetalk:` prefix):
 *   history  - Result[] newest first, capped at 500
 *   totals   - { tests, words, chars, seconds, errors, byMode }
 *   daily    - { 'YYYY-MM-DD': testsCount }
 *   bests    - { [mode]: { wpm, accuracy } }
 */

import { storageGet, storageSet } from './storage.js';
import { getSetting } from './settings.js';

const HISTORY_KEY = 'history';
const TOTALS_KEY = 'totals';
const DAILY_KEY = 'daily';
const BESTS_KEY = 'bests';

const HISTORY_CAP = 500;
const MODES = ['typing', 'dictation', 'speaking', 'shadowing'];
const PB_MIN_ACCURACY = 80;
const PB_MIN_CHARS = 25;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Coerce to a finite number, returning `fallback` for NaN/Infinity/non-numbers.
 * @param {*} v
 * @param {number} [fallback=0]
 * @returns {number}
 */
function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Pad a number to two digits.
 * @param {number} n
 * @returns {string}
 */
function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

/**
 * Local YYYY-MM-DD key for a Date.
 * @param {Date} d
 * @returns {string}
 */
function dateKey(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/**
 * Parse a YYYY-MM-DD key into a local Date at midnight (null if invalid).
 * @param {string} key
 * @returns {Date|null}
 */
function parseDayKey(key) {
  if (typeof key !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Shift a local midnight Date by `days` (DST-safe via setDate).
 * @param {Date} d
 * @param {number} days
 * @returns {Date}
 */
function addDays(d, days) {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + days);
  return out;
}

/**
 * Create an empty totals object.
 * @returns {{tests:number, words:number, chars:number, seconds:number, errors:number, byMode:object}}
 */
function emptyTotals() {
  const byMode = {};
  for (const m of MODES) byMode[m] = 0;
  return { tests: 0, words: 0, chars: 0, seconds: 0, errors: 0, byMode };
}

/**
 * Create an empty personal-bests object.
 * @returns {object}
 */
function emptyBests() {
  const out = {};
  for (const m of MODES) out[m] = { wpm: 0, accuracy: 0 };
  return out;
}

/**
 * Read history array (sanitised).
 * @returns {object[]}
 */
function readHistory() {
  const h = storageGet(HISTORY_KEY, []);
  return Array.isArray(h) ? h.filter((r) => r && typeof r === 'object') : [];
}

/**
 * Read totals (merged with empty shape).
 * @returns {object}
 */
function readTotals() {
  const base = emptyTotals();
  const stored = storageGet(TOTALS_KEY, null);
  if (stored && typeof stored === 'object') {
    base.tests = num(stored.tests);
    base.words = num(stored.words);
    base.chars = num(stored.chars);
    base.seconds = num(stored.seconds);
    base.errors = num(stored.errors);
    if (stored.byMode && typeof stored.byMode === 'object') {
      for (const m of Object.keys(stored.byMode)) {
        base.byMode[m] = num(stored.byMode[m]);
      }
    }
  }
  return base;
}

/**
 * Read daily counts.
 * @returns {{[key:string]: number}}
 */
function readDaily() {
  const stored = storageGet(DAILY_KEY, {});
  const out = {};
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    for (const k of Object.keys(stored)) {
      const n = num(stored[k]);
      if (parseDayKey(k) && n > 0) out[k] = n;
    }
  }
  return out;
}

/**
 * Read personal bests (merged with empty shape).
 * @returns {object}
 */
function readBests() {
  const base = emptyBests();
  const stored = storageGet(BESTS_KEY, null);
  if (stored && typeof stored === 'object') {
    for (const m of Object.keys(stored)) {
      const b = stored[m];
      if (b && typeof b === 'object') {
        base[m] = { wpm: num(b.wpm), accuracy: num(b.accuracy) };
      }
    }
  }
  return base;
}

/**
 * Generate a reasonably unique id.
 * @returns {string}
 */
function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Net words-per-minute.
 * @param {number} correctChars
 * @param {number} seconds
 * @returns {number} Rounded integer; 0 when seconds <= 0.
 */
export function computeWpm(correctChars, seconds) {
  const s = num(seconds);
  const c = num(correctChars);
  if (s <= 0 || c <= 0) return 0;
  const wpm = Math.round((c / 5) / (s / 60));
  return Number.isFinite(wpm) && wpm > 0 ? wpm : 0;
}

/**
 * Accuracy percentage.
 * @param {number} correctChars
 * @param {number} totalChars
 * @returns {number} 0..100 with one decimal; 0 when totalChars <= 0.
 */
export function computeAccuracy(correctChars, totalChars) {
  const total = num(totalChars);
  const correct = num(correctChars);
  if (total <= 0 || correct <= 0) return 0;
  const pct = Math.round((correct / total) * 1000) / 10;
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, pct));
}

/**
 * Normalise a raw result object into the contract shape.
 * @param {object} result
 * @returns {object}
 */
function normalizeResult(result) {
  const r = Object.assign({}, result);
  r.id = typeof r.id === 'string' && r.id ? r.id : makeId();
  r.timestamp = num(r.timestamp) > 0 ? num(r.timestamp) : Date.now();
  r.mode = MODES.includes(r.mode) ? r.mode : (typeof r.mode === 'string' && r.mode ? r.mode : 'typing');
  r.level = typeof r.level === 'string' && r.level ? r.level : 'intermediate';
  r.kind = typeof r.kind === 'string' && r.kind ? r.kind : 'sentences';
  r.wpm = Math.max(0, Math.round(num(r.wpm)));
  r.rawWpm = Math.max(0, Math.round(num(r.rawWpm, r.wpm)));
  r.accuracy = Math.min(100, Math.max(0, Math.round(num(r.accuracy) * 10) / 10));
  r.durationSec = Math.max(0, num(r.durationSec));
  r.chars = Math.max(0, Math.round(num(r.chars)));
  r.correctChars = Math.max(0, Math.round(num(r.correctChars)));
  r.errors = Math.max(0, Math.round(num(r.errors)));
  r.words = Math.max(0, Math.round(num(r.words)));
  r.keyErrors = r.keyErrors && typeof r.keyErrors === 'object' && !Array.isArray(r.keyErrors) ? r.keyErrors : {};
  r.source = typeof r.source === 'string' ? r.source : 'local';
  r.text = typeof r.text === 'string' ? r.text.slice(0, 500) : '';
  return r;
}

/**
 * Record a finished test. Assigns id and timestamp when missing, stores it in
 * history (newest first, capped at 500), and updates totals, daily counts and
 * personal bests.
 * @param {object} result Result object produced by a mode.
 * @returns {object} The stored result with an added `isNewPb` boolean.
 */
export function recordResult(result) {
  const r = normalizeResult(result || {});

  // Personal bests (a PB requires accuracy >= 80 and at least 25 chars)
  const bests = readBests();
  const prev = bests[r.mode] || { wpm: 0, accuracy: 0 };
  const qualifies = r.accuracy >= PB_MIN_ACCURACY && r.chars >= PB_MIN_CHARS;
  const isNewPb = qualifies && r.wpm > num(prev.wpm);
  bests[r.mode] = {
    wpm: qualifies ? Math.max(num(prev.wpm), r.wpm) : num(prev.wpm),
    accuracy: Math.max(num(prev.accuracy), r.accuracy)
  };
  storageSet(BESTS_KEY, bests);

  // History (newest first)
  const history = readHistory();
  history.unshift(r);
  if (history.length > HISTORY_CAP) history.length = HISTORY_CAP;
  storageSet(HISTORY_KEY, history);

  // Totals
  const totals = readTotals();
  totals.tests += 1;
  totals.words += r.words;
  totals.chars += r.chars;
  totals.seconds += r.durationSec;
  totals.errors += r.errors;
  totals.byMode[r.mode] = num(totals.byMode[r.mode]) + 1;
  storageSet(TOTALS_KEY, totals);

  // Daily counts (local date)
  const daily = readDaily();
  const key = dateKey(new Date(r.timestamp));
  daily[key] = num(daily[key]) + 1;
  storageSet(DAILY_KEY, daily);

  return Object.assign({}, r, { isNewPb });
}

/**
 * Get stored results, newest first.
 * @param {{mode?: string, limit?: number}} [options]
 * @returns {object[]}
 */
export function getHistory({ mode, limit } = {}) {
  let history = readHistory();
  if (mode) history = history.filter((r) => r.mode === mode);
  const n = num(limit, 0);
  if (n > 0 && history.length > n) history = history.slice(0, Math.floor(n));
  return history;
}

/**
 * Personal bests per mode (0s when none).
 * @returns {{typing:{wpm:number,accuracy:number}, dictation:object, speaking:object, shadowing:object}}
 */
export function getPersonalBests() {
  return readBests();
}

/**
 * Aggregate totals.
 * @returns {{tests:number, words:number, chars:number, seconds:number, errors:number, byMode:object}}
 */
export function getTotals() {
  return readTotals();
}

/**
 * Tests completed per local day.
 * @returns {{[date:string]: number}}
 */
export function getDailyCounts() {
  return readDaily();
}

/**
 * Local YYYY-MM-DD for today.
 * @returns {string}
 */
export function getTodayKey() {
  return dateKey(new Date());
}

/**
 * Streak information. A day counts when it has at least one test. The
 * current streak runs backwards from today, or from yesterday when today has
 * no tests yet.
 * @returns {{current:number, longest:number, todayCount:number, goal:number, goalMet:boolean}}
 */
export function getStreak() {
  const daily = readDaily();
  const todayKey = getTodayKey();
  const todayCount = num(daily[todayKey]);

  const today = parseDayKey(todayKey);
  let cursor = todayCount > 0 ? today : addDays(today, -1);
  let current = 0;
  while (cursor && num(daily[dateKey(cursor)]) > 0) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  const days = Object.keys(daily)
    .map((k) => parseDayKey(k))
    .filter((d) => d !== null)
    .map((d) => d.getTime())
    .sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let prevTime = null;
  for (const t of days) {
    if (prevTime !== null && Math.round((t - prevTime) / DAY_MS) === 1) {
      run += 1;
    } else {
      run = 1;
    }
    if (run > longest) longest = run;
    prevTime = t;
  }
  if (current > longest) longest = current;

  let goal = Math.round(num(getSetting('dailyGoal'), 5));
  if (goal < 1) goal = 1;

  return {
    current,
    longest,
    todayCount,
    goal,
    goalMet: todayCount >= goal
  };
}

/**
 * Per-key error counts aggregated over the whole history.
 * @returns {{[char:string]: number}}
 */
export function getKeyErrorTotals() {
  const out = {};
  for (const r of readHistory()) {
    const ke = r.keyErrors;
    if (!ke || typeof ke !== 'object' || Array.isArray(ke)) continue;
    for (const ch of Object.keys(ke)) {
      const n = num(ke[ch]);
      if (n > 0) out[ch] = num(out[ch]) + n;
    }
  }
  return out;
}

/**
 * Distinct modes practised today (local date).
 * @returns {string[]}
 */
export function getModesToday() {
  const todayKey = getTodayKey();
  const seen = new Set();
  for (const r of readHistory()) {
    const ts = num(r.timestamp);
    if (ts <= 0) continue;
    if (dateKey(new Date(ts)) === todayKey && typeof r.mode === 'string') seen.add(r.mode);
  }
  return Array.from(seen);
}
