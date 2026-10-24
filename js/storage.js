/**
 * TypeTalk storage layer.
 * Thin wrapper over localStorage. Every key is prefixed with `typetalk:`
 * and values are stored as JSON. All functions are safe to call when
 * localStorage is unavailable (private mode, quota, disabled).
 */

const PREFIX = 'typetalk:';
const EXPORT_VERSION = 1;

/**
 * Returns the localStorage object or null when it is not accessible.
 * @returns {Storage|null}
 */
function getStore() {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return null;
    return localStorage;
  } catch (err) {
    return null;
  }
}

/**
 * Build the full prefixed key.
 * @param {string} key
 * @returns {string}
 */
function fullKey(key) {
  return PREFIX + String(key);
}

/**
 * Read a JSON value from storage.
 * @param {string} key Key without the `typetalk:` prefix.
 * @param {*} fallback Returned when the key is missing or cannot be parsed.
 * @returns {*}
 */
export function storageGet(key, fallback) {
  const store = getStore();
  if (!store) return fallback;
  let raw = null;
  try {
    raw = store.getItem(fullKey(key));
  } catch (err) {
    return fallback;
  }
  if (raw === null || raw === undefined) return fallback;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

/**
 * Write a JSON-serialisable value to storage. Quota and serialisation
 * errors are swallowed (logged with console.warn).
 * @param {string} key Key without the `typetalk:` prefix.
 * @param {*} value
 * @returns {boolean} true when the write succeeded.
 */
export function storageSet(key, value) {
  const store = getStore();
  if (!store) return false;
  try {
    store.setItem(fullKey(key), JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn('[typetalk] storage write failed for key "' + key + '":', err);
    return false;
  }
}

/**
 * Remove a key from storage.
 * @param {string} key Key without the `typetalk:` prefix.
 */
export function storageRemove(key) {
  const store = getStore();
  if (!store) return;
  try {
    store.removeItem(fullKey(key));
  } catch (err) {
    console.warn('[typetalk] storage remove failed for key "' + key + '":', err);
  }
}

/**
 * List every stored key (without prefix) that belongs to TypeTalk.
 * @returns {string[]}
 */
function listKeys() {
  const store = getStore();
  const keys = [];
  if (!store) return keys;
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.indexOf(PREFIX) === 0) keys.push(k.slice(PREFIX.length));
    }
  } catch (err) {
    /* ignore */
  }
  return keys;
}

/**
 * Serialise all TypeTalk data to a JSON string.
 * Shape: { version: 1, exportedAt: ISO string, data: { key: value } }
 * (keys without the prefix).
 * @returns {string}
 */
export function exportData() {
  const data = {};
  const keys = listKeys();
  for (const key of keys) {
    const value = storageGet(key, undefined);
    if (value !== undefined) data[key] = value;
  }
  const payload = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data
  };
  try {
    return JSON.stringify(payload, null, 2);
  } catch (err) {
    return JSON.stringify({ version: EXPORT_VERSION, exportedAt: new Date().toISOString(), data: {} });
  }
}

/**
 * Import data produced by exportData(). Existing keys are merged/overwritten;
 * keys not present in the import are kept.
 * @param {string} jsonString
 * @returns {boolean} true on success, false on malformed input.
 */
export function importData(jsonString) {
  if (typeof jsonString !== 'string' || !jsonString.trim()) return false;
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    return false;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  if (typeof parsed.version !== 'number') return false;
  const data = parsed.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (!getStore()) return false;

  let ok = true;
  for (const key of Object.keys(data)) {
    if (!key) continue;
    if (!storageSet(key, data[key])) ok = false;
  }
  return ok;
}

/**
 * Remove every `typetalk:*` key from storage.
 */
export function resetData() {
  const keys = listKeys();
  for (const key of keys) storageRemove(key);
}
