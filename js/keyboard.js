/**
 * TypeTalk — on-screen QWERTY keyboard (vanilla ES module).
 *
 * Renders a typing.com-style virtual keyboard into a container and exposes a
 * small API for highlighting the next key, flashing pressed keys and painting
 * a per-key error heatmap.
 *
 * @module keyboard
 */

/**
 * Physical layout. Each entry is either a plain string `"main|shift"` (or just
 * `"main"` when the shifted value is the uppercase letter) or a wide-key
 * descriptor object.
 *
 * Wide key descriptors: `{ key, label, cls, span }`
 *  - key   : logical key id used in `data-key` (e.g. 'Backspace', 'Enter', 'Shift', ' ')
 *  - label : visible label
 *  - cls   : extra CSS class ('vk-wide' | 'vk-shift' | 'vk-space')
 *  - span  : approximate width in key units (used for flex sizing)
 *
 * @type {Array<Array<string|{key: string, label: string, cls: string, span: number}>>}
 */
export const KEY_ROWS = [
  [
    '`|~', '1|!', '2|@', '3|#', '4|$', '5|%', '6|^', '7|&', '8|*', '9|(', '0|)', '-|_', '=|+',
    { key: 'Backspace', label: 'Backspace', cls: 'vk-wide', span: 2 }
  ],
  [
    { key: 'Tab', label: 'Tab', cls: 'vk-wide', span: 1.5 },
    'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[|{', ']|}', '\\||'
  ],
  [
    { key: 'CapsLock', label: 'Caps', cls: 'vk-wide', span: 1.75 },
    'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';|:', '\'|"',
    { key: 'Enter', label: 'Enter', cls: 'vk-wide', span: 2.25 }
  ],
  [
    { key: 'Shift', label: 'Shift', cls: 'vk-shift', span: 2.25 },
    'z', 'x', 'c', 'v', 'b', 'n', 'm', ',|<', '.|>', '/|?',
    { key: 'Shift', label: 'Shift', cls: 'vk-shift', span: 2.75 }
  ],
  [
    { key: ' ', label: '', cls: 'vk-space', span: 7 }
  ]
];

/** Keys that show a raised home-row bump. */
const HOME_BUMPS = new Set(['f', 'j']);

/** Flash duration for pressKey in ms. */
const PRESS_FLASH_MS = 150;

/**
 * Map of shifted symbol -> base key, built from KEY_ROWS.
 * @type {Map<string, string>}
 */
const SHIFT_TO_BASE = new Map();
for (const row of KEY_ROWS) {
  for (const item of row) {
    if (typeof item !== 'string') continue;
    const bar = item.indexOf('|');
    if (bar === -1) continue;
    const main = item.slice(0, bar);
    const shifted = item.slice(bar + 1);
    if (shifted) SHIFT_TO_BASE.set(shifted, main);
  }
}

/**
 * Resolve a typed character to the physical key it lives on and whether Shift
 * is required.
 *
 * Examples: 'a' -> {key:'a', shift:false}; 'A' -> {key:'a', shift:true};
 * '!' -> {key:'1', shift:true}; ' ' -> {key:' ', shift:false};
 * '\n' -> {key:'Enter', shift:false}; '\t' -> {key:'Tab', shift:false}.
 *
 * @param {string} char single character (or a key name such as 'Backspace' / 'Enter')
 * @returns {{ key: string, shift: boolean }} key id as used in data-key
 */
export function charToKey(char) {
  if (char === null || char === undefined) return { key: '', shift: false };
  const c = String(char);
  if (c === '') return { key: '', shift: false };
  if (c === ' ' || c === ' ') return { key: ' ', shift: false };
  if (c === '\n' || c === '\r' || c === 'Enter') return { key: 'Enter', shift: false };
  if (c === '\t' || c === 'Tab') return { key: 'Tab', shift: false };
  if (c === '\b' || c === 'Backspace') return { key: 'Backspace', shift: false };
  if (c === 'Shift') return { key: 'Shift', shift: false };
  if (c.length > 1) return { key: c, shift: false };
  const lower = c.toLowerCase();
  if (lower !== c && /[a-z]/.test(lower)) return { key: lower, shift: true };
  if (/[a-z]/.test(c)) return { key: c, shift: false };
  if (SHIFT_TO_BASE.has(c)) return { key: SHIFT_TO_BASE.get(c), shift: true };
  return { key: c, shift: false };
}

/**
 * Build a single key element.
 * @param {string|{key: string, label: string, cls: string, span: number}} item
 * @returns {HTMLDivElement}
 */
function buildKey(item) {
  const el = document.createElement('div');
  el.className = 'vk-key';
  el.setAttribute('aria-hidden', 'true');

  if (typeof item !== 'string') {
    el.classList.add(item.cls);
    el.dataset.key = item.key;
    el.style.flexGrow = String(item.span);
    el.style.flexBasis =
      'calc(var(--vk-key-size) * ' + item.span +
      ' + var(--vk-gap) * ' + Math.max(0, item.span - 1) + ')';
    const main = document.createElement('span');
    main.className = 'vk-label';
    main.textContent = item.label;
    el.appendChild(main);
    return el;
  }

  const bar = item.indexOf('|');
  const main = bar === -1 ? item : item.slice(0, bar);
  const shifted = bar === -1 ? main.toUpperCase() : item.slice(bar + 1);
  el.dataset.key = main;
  el.dataset.shift = shifted;
  if (bar !== -1) el.classList.add('vk-symbol');
  if (HOME_BUMPS.has(main)) el.classList.add('vk-home');

  if (bar !== -1) {
    const top = document.createElement('span');
    top.className = 'vk-label-shift';
    top.textContent = shifted;
    el.appendChild(top);
  }
  const label = document.createElement('span');
  label.className = 'vk-label';
  label.textContent = main;
  el.appendChild(label);
  return el;
}

/**
 * Create an on-screen keyboard inside `container`.
 *
 * @param {HTMLElement} container element to render into (gets class `vkeyboard`)
 * @param {{ compact?: boolean }} [options] compact = smaller keys (dashboard heatmap)
 * @returns {{
 *   highlightNext: (char: string) => void,
 *   pressKey: (char: string, correct: boolean) => void,
 *   clearHighlight: () => void,
 *   setHeatmap: (map: Record<string, number>) => void,
 *   destroy: () => void
 * }}
 */
export function createKeyboard(container, { compact = false } = {}) {
  if (!container) throw new Error('createKeyboard: container is required');

  container.innerHTML = '';
  container.classList.add('vkeyboard');
  container.classList.toggle('vkeyboard-compact', !!compact);
  container.setAttribute('aria-hidden', 'true');

  /** @type {Map<string, HTMLDivElement[]>} key id -> elements (Shift has two) */
  const keyMap = new Map();
  /** @type {Set<ReturnType<typeof setTimeout>>} pending timeouts */
  const timers = new Set();
  /** @type {HTMLElement[]} keys currently carrying .key-next */
  let highlighted = [];
  let destroyed = false;

  for (const row of KEY_ROWS) {
    const rowEl = document.createElement('div');
    rowEl.className = 'vk-row';
    for (const item of row) {
      const el = buildKey(item);
      rowEl.appendChild(el);
      const id = el.dataset.key;
      if (!keyMap.has(id)) keyMap.set(id, []);
      keyMap.get(id).push(el);
    }
    container.appendChild(rowEl);
  }

  /**
   * Resolve a char to its key element(s) plus the Shift keys when needed.
   * @param {string} char
   * @returns {HTMLDivElement[]}
   */
  function targetsFor(char) {
    const { key, shift } = charToKey(char);
    const els = keyMap.get(key);
    if (!els || !els.length) return [];
    const targets = [els[0]];
    if (shift) targets.push(...(keyMap.get('Shift') || []));
    return targets;
  }

  /** Remove .key-next from all keys. */
  function clearHighlight() {
    for (const el of highlighted) el.classList.remove('key-next');
    highlighted = [];
  }

  /**
   * Mark the key for `char` (and both Shift keys when shift is required) as next.
   * @param {string} char
   */
  function highlightNext(char) {
    if (destroyed) return;
    clearHighlight();
    const targets = targetsFor(char);
    for (const el of targets) {
      el.classList.add('key-next');
      highlighted.push(el);
    }
  }

  /**
   * Flash the key for `char` green (correct) or red (wrong) for ~150ms.
   * @param {string} char
   * @param {boolean} correct
   */
  function pressKey(char, correct) {
    if (destroyed) return;
    const targets = targetsFor(char);
    if (!targets.length) return;
    const cls = correct ? 'key-correct' : 'key-wrong';
    const other = correct ? 'key-wrong' : 'key-correct';
    for (const el of targets) {
      el.classList.remove(other, cls);
      // Force a reflow so a repeated press restarts the CSS animation.
      void el.offsetWidth;
      el.classList.add(cls);
    }
    const id = setTimeout(() => {
      timers.delete(id);
      for (const el of targets) el.classList.remove(cls);
    }, PRESS_FLASH_MS);
    timers.add(id);
  }

  /**
   * Colour keys by error intensity. Counts are aggregated per physical key
   * (so 'A' and 'a' both land on the A key) and bucketed 0..4 relative to the
   * max count. The count is exposed via the title attribute.
   * @param {Record<string, number>} map { char: count }
   */
  function setHeatmap(map) {
    if (destroyed) return;
    /** @type {Map<string, number>} */
    const perKey = new Map();
    if (map && typeof map === 'object') {
      for (const [ch, raw] of Object.entries(map)) {
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) continue;
        const { key } = charToKey(ch);
        if (!keyMap.has(key)) continue;
        perKey.set(key, (perKey.get(key) || 0) + n);
      }
    }
    let max = 0;
    for (const v of perKey.values()) if (v > max) max = v;

    for (const [id, els] of keyMap) {
      const count = perKey.get(id) || 0;
      let heat = 0;
      if (count > 0 && max > 0) heat = Math.max(1, Math.min(4, Math.ceil((count / max) * 4)));
      for (const el of els) {
        el.dataset.heat = String(heat);
        if (count > 0) {
          const name = id === ' ' ? 'Space' : id;
          el.title = name + ': ' + count + (count === 1 ? ' mistake' : ' mistakes');
        } else {
          el.removeAttribute('title');
        }
      }
    }
    container.classList.toggle('vkeyboard-heat', max > 0);
  }

  /** Clear timers and empty the container. */
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const id of timers) clearTimeout(id);
    timers.clear();
    highlighted = [];
    keyMap.clear();
    container.innerHTML = '';
    container.classList.remove('vkeyboard', 'vkeyboard-compact', 'vkeyboard-heat');
    container.removeAttribute('aria-hidden');
  }

  return { highlightNext, pressKey, clearHighlight, setHeatmap, destroy };
}
