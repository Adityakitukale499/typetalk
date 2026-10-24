/**
 * TypeTalk user settings.
 * Settings are persisted under the storage key `settings`; unknown stored
 * keys are ignored and missing keys fall back to DEFAULTS.
 */

import { storageGet, storageSet, storageRemove } from './storage.js';

const STORAGE_KEY = 'settings';

/** Default settings. */
export const DEFAULTS = {
  theme: 'auto',            // 'auto' | 'light' | 'dark'
  soundVolume: 0.5,         // 0..1  key click / fx volume
  soundMuted: false,
  ttsVolume: 1,             // 0..1
  ttsRate: 1,               // 0.5..1.5
  ttsPitch: 1,              // 0.5..2
  ttsVoiceURI: '',          // '' = browser default
  lang: 'en-US',            // 'en-US' | 'en-GB' | 'en-IN' | 'en-AU'
  showKeyboard: true,
  duration: 60,             // default seconds; 0 = whole passage
  level: 'intermediate',    // 'beginner' | 'intermediate' | 'advanced' | 'expert'
  kind: 'sentences',        // 'words' | 'sentences' | 'paragraph' | 'quotes' | 'numbers'
  strictMode: false,        // true = must fix errors before continuing (expert forces true)
  dailyGoal: 5,             // tests per day
  customText: '',
  dictationChunk: 'sentence', // 'word' | 'sentence' | 'paragraph'
  reduceMotion: false
};

/** @type {Set<Function>} */
const listeners = new Set();

/**
 * Merge stored values over DEFAULTS, dropping unknown keys.
 * @param {*} stored
 * @returns {object}
 */
function merge(stored) {
  const out = Object.assign({}, DEFAULTS);
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    for (const key of Object.keys(DEFAULTS)) {
      if (Object.prototype.hasOwnProperty.call(stored, key) && stored[key] !== undefined) {
        out[key] = stored[key];
      }
    }
  }
  return out;
}

/**
 * Load settings from storage (merged with defaults).
 * @returns {object}
 */
function load() {
  return merge(storageGet(STORAGE_KEY, null));
}

/**
 * Persist a full settings object.
 * @param {object} settings
 */
function save(settings) {
  storageSet(STORAGE_KEY, settings);
}

/**
 * Loose equality for settings values (handles NaN and plain objects).
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
function isEqual(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch (err) {
      return false;
    }
  }
  return false;
}

/**
 * Notify listeners; listener errors are isolated so one bad subscriber
 * cannot break the others.
 * @param {object} settings
 * @param {string[]} changedKeys
 */
function notify(settings, changedKeys) {
  if (!changedKeys.length) return;
  const snapshot = Object.assign({}, settings);
  for (const cb of Array.from(listeners)) {
    try {
      cb(snapshot, changedKeys.slice());
    } catch (err) {
      console.warn('[typetalk] settings listener failed:', err);
    }
  }
}

/**
 * Get the full settings object (DEFAULTS merged with stored values).
 * @returns {object} A fresh copy; mutating it has no effect.
 */
export function getSettings() {
  return load();
}

/**
 * Get a single setting value.
 * @param {string} key
 * @returns {*}
 */
export function getSetting(key) {
  const settings = load();
  return settings[key];
}

/**
 * Set several settings at once. Persists and emits a single notification
 * listing only the keys whose value actually changed. Unknown keys are ignored.
 * @param {object} partialObject
 */
export function setSettings(partialObject) {
  if (!partialObject || typeof partialObject !== 'object') return;
  const current = load();
  const next = Object.assign({}, current);
  const changed = [];
  for (const key of Object.keys(partialObject)) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) continue;
    const value = partialObject[key];
    if (value === undefined) continue;
    if (!isEqual(current[key], value)) {
      next[key] = value;
      changed.push(key);
    }
  }
  if (!changed.length) return;
  save(next);
  notify(next, changed);
}

/**
 * Set a single setting. Persists via storage and notifies listeners.
 * @param {string} key
 * @param {*} value
 */
export function setSetting(key, value) {
  const partial = {};
  partial[key] = value;
  setSettings(partial);
}

/**
 * Restore every setting to its default value and notify listeners with
 * all keys marked as changed.
 */
export function resetSettings() {
  storageRemove(STORAGE_KEY);
  const settings = Object.assign({}, DEFAULTS);
  save(settings);
  notify(settings, Object.keys(DEFAULTS));
}

/**
 * Subscribe to settings changes.
 * @param {(settings: object, changedKeys: string[]) => void} cb
 * @returns {() => void} Unsubscribe function.
 */
export function onSettingsChange(cb) {
  if (typeof cb !== 'function') return () => {};
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
