/**
 * TypeTalk — "See & Type" mode (classic typing test, typing.com style).
 *
 * Exports `mount(root, params)` and `unmount()` per the mode interface in CONTRACT.md §2 / §6.
 * Owns only this file and css/typing.css.
 * @module modes/typing
 */
import { h, toast, icon, formatDuration } from '../ui.js';
import { getSettings, setSetting, onSettingsChange } from '../settings.js';
import { computeWpm, computeAccuracy } from '../stats.js';
import * as textProvider from '../textProvider.js';
import { playKey, playError, playTick } from '../audio.js';
import { createKeyboard } from '../keyboard.js';
import { showResults } from '../results.js';

/** @type {string[]} */
const LEVELS = Array.isArray(textProvider.LEVELS)
  ? textProvider.LEVELS
  : ['beginner', 'intermediate', 'advanced', 'expert'];
/** @type {string[]} */
const KINDS = Array.isArray(textProvider.KINDS)
  ? textProvider.KINDS
  : ['words', 'sentences', 'paragraph', 'quotes', 'numbers'];

/** Duration chips (seconds; 0 = whole passage). */
const DURATIONS = [
  { value: 30, label: '30s' },
  { value: 60, label: '1 min' },
  { value: 180, label: '3 min' },
  { value: 300, label: '5 min' },
  { value: 0, label: 'Passage' }
];

/** Human labels for raw source ids (used when textProvider has no getSourceLabel). */
const SOURCE_LABELS = {
  wikipedia: 'Wikipedia',
  dummyjson: 'DummyJSON Quotes',
  uselessfacts: 'Useless Facts',
  adviceslip: 'Advice Slip',
  randomword: 'Random Word API',
  local: 'TypeTalk library',
  custom: 'Your custom text'
};

const FALLBACK_TEXT =
  'The quick brown fox jumps over the lazy dog. Practice a little every day and ' +
  'your speed and accuracy will follow. Keep your eyes on the text, not on the keys.';

/** Mutable mode state (null when unmounted). */
let S = null;
/** DOM references for the current test UI (null while results are showing / unmounted). */
let els = null;
let keydownHandler = null;
let resizeHandler = null;
let windowBlurHandler = null;
let unsubSettings = null;

/* ------------------------------------------------------------------ */
/* Lifecycle                                                            */
/* ------------------------------------------------------------------ */

/**
 * Mount the See & Type mode.
 * @param {HTMLElement} root Empty container (<main id="app">).
 * @param {Record<string, string>} [params] Query params: level, kind, duration, custom.
 * @returns {Promise<void>}
 */
export async function mount(root, params = {}) {
  const settings = getSettings();
  S = createState(root, params || {}, settings);

  keydownHandler = onKeyDown;
  document.addEventListener('keydown', keydownHandler);
  resizeHandler = () => { if (els && els.text) updateScroll(); };
  window.addEventListener('resize', resizeHandler);
  windowBlurHandler = () => setFocused(false);
  window.addEventListener('blur', windowBlurHandler);
  try {
    unsubSettings = onSettingsChange(handleSettingsChange);
  } catch (err) {
    unsubSettings = null;
  }

  renderTest();
  await loadText();
}

/**
 * Unmount: stop timers, remove listeners, destroy the on-screen keyboard.
 */
export function unmount() {
  if (S) {
    S.loadSeq++;
    stopTimer();
    destroyKeyboard();
  }
  if (keydownHandler) document.removeEventListener('keydown', keydownHandler);
  if (resizeHandler) window.removeEventListener('resize', resizeHandler);
  if (windowBlurHandler) window.removeEventListener('blur', windowBlurHandler);
  if (typeof unsubSettings === 'function') {
    try { unsubSettings(); } catch (err) { /* ignore */ }
  }
  keydownHandler = null;
  resizeHandler = null;
  windowBlurHandler = null;
  unsubSettings = null;
  els = null;
  S = null;
}

/* ------------------------------------------------------------------ */
/* State                                                                */
/* ------------------------------------------------------------------ */

/**
 * Build the initial state from params with settings fallbacks.
 * @param {HTMLElement} root
 * @param {Record<string, string>} params
 * @param {object} settings
 * @returns {object}
 */
function createState(root, params, settings) {
  const level = LEVELS.includes(params.level) ? params.level : settings.level;
  const kind = KINDS.includes(params.kind) ? params.kind : settings.kind;
  let duration = settings.duration;
  if (params.duration !== undefined && params.duration !== '') {
    const n = Number(params.duration);
    if (Number.isFinite(n) && n >= 0) duration = Math.round(n);
  }
  if (!Number.isFinite(duration) || duration < 0) duration = 60;
  return {
    root,
    custom: params.custom === '1' || params.custom === 'true',
    level: LEVELS.includes(level) ? level : 'intermediate',
    kind: KINDS.includes(kind) ? kind : 'sentences',
    duration,
    strict: false,
    text: '',
    source: 'local',
    title: '',
    loading: false,
    loadSeq: 0,
    spans: [],
    states: [],
    pos: 0,
    curSpan: null,
    wrongHere: false,
    errors: 0,
    keyErrors: {},
    keystrokes: 0,
    correct: 0,
    startedAt: 0,
    elapsed: 0,
    running: false,
    finished: false,
    timer: 0,
    lastTick: -1,
    tabArmed: false,
    focused: false,
    keyboard: null
  };
}

/** @returns {boolean} strict mode (setting or expert level). */
function isStrict() {
  let strict = false;
  try { strict = !!getSettings().strictMode; } catch (err) { strict = false; }
  return strict || S.level === 'expert';
}

/* ------------------------------------------------------------------ */
/* Rendering                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build a labelled chip-group picker.
 * @param {string} label
 * @param {{value: *, label: string}[]} items
 * @param {*} current
 * @param {(value: *) => void} onPick
 * @returns {HTMLElement}
 */
function chipGroup(label, items, current, onPick) {
  const chips = items.map((it) => h('button', {
    type: 'button',
    class: 'chip' + (it.value === current ? ' active' : ''),
    'aria-pressed': String(it.value === current),
    onClick: () => onPick(it.value)
  }, it.label));
  return h('div', { class: 'typing-control' },
    h('span', { class: 'typing-control-label' }, label),
    h('div', { class: 'chip-group', role: 'group', 'aria-label': label }, ...chips));
}

/**
 * Build a live stat pill.
 * @param {string} label
 * @param {string} initial
 * @returns {{ el: HTMLElement, value: HTMLElement }}
 */
function statPill(label, initial) {
  const value = h('span', { class: 'value' }, initial);
  const el = h('div', { class: 'stat-pill' }, value, h('span', { class: 'label' }, label));
  return { el, value };
}

/**
 * Capitalise the first letter.
 * @param {string} s
 * @returns {string}
 */
function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/**
 * Class list for a character span (without state).
 * @param {string} c
 * @returns {string}
 */
function charClass(c) {
  if (c === ' ') return ' space';
  if (c === '\n') return ' newline';
  return '';
}

/**
 * Render the full test UI into root (header, controls, pills, card, keyboard).
 * Does not build the text; call buildText()/resetRun() or loadText() afterwards.
 */
function renderTest() {
  const root = S.root;
  destroyKeyboard();
  root.innerHTML = '';
  els = {};

  // Header
  const newBtn = h('button', {
    type: 'button',
    class: 'btn btn-outline btn-sm typing-new-btn',
    'aria-label': 'Load new text',
    title: 'New text (Tab then Enter)',
    onClick: () => newText()
  }, h('span', { class: 'typing-btn-icon', 'aria-hidden': 'true', html: icon('refresh') }), h('span', {}, 'New text'));

  const header = h('div', { class: 'mode-header typing-header' },
    h('div', { class: 'typing-title-wrap' },
      h('h1', { class: 'page-title' }, 'See & Type'),
      h('p', { class: 'page-subtitle' }, 'Type the text as fast and accurately as you can.')),
    newBtn);

  // Controls
  const controls = h('div', { class: 'typing-controls' },
    chipGroup('Duration', DURATIONS, S.duration, (v) => pickChip('duration', v)),
    chipGroup('Level', LEVELS.map((l) => ({ value: l, label: cap(l) })), S.level, (v) => pickChip('level', v)));
  if (!S.custom) {
    controls.appendChild(
      chipGroup('Kind', KINDS.map((k) => ({ value: k, label: cap(k) })), S.kind, (v) => pickChip('kind', v)));
  }

  // Live stats
  const pTime = statPill('Time', S.duration > 0 ? formatDuration(S.duration) : '0:00');
  const pWpm = statPill('WPM', '0');
  const pAcc = statPill('Accuracy', '100%');
  const pErr = statPill('Errors', '0');
  const pills = h('div', { class: 'typing-stats' }, pTime.el, pWpm.el, pAcc.el, pErr.el);

  // Card
  const bar = h('div', { class: 'bar', style: 'width:0%' });
  const progress = h('div', {
    class: 'progress typing-progress',
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': '0',
    'aria-label': 'Text progress'
  }, bar);

  const text = h('div', { class: 'typing-text', 'aria-hidden': 'true' });
  const viewport = h('div', { class: 'typing-viewport' }, text);
  const overlay = h('div', { class: 'typing-focus', role: 'button', 'aria-label': 'Focus the typing test' },
    h('span', { class: 'typing-focus-icon', 'aria-hidden': 'true', html: icon('keyboard') }),
    h('span', { class: 'typing-focus-text' }, 'Click here or start typing'));
  const loading = h('div', { class: 'typing-loading', role: 'status' },
    h('span', { class: 'typing-spinner', 'aria-hidden': 'true' }),
    h('span', {}, 'Loading text…'));
  const srText = h('p', { class: 'sr-only typing-sr-text' });
  // Hidden input: receives focus so phone/tablet virtual keyboards open; desktop keys bubble to the document handler.
  const input = h('input', {
    class: 'typing-hidden-input', type: 'text', autocomplete: 'off', autocapitalize: 'off',
    autocorrect: 'off', spellcheck: 'false', inputmode: 'text', 'aria-label': 'Typing input', tabindex: '-1'
  });
  input.addEventListener('focus', () => setFocused(true));
  input.addEventListener('blur', () => setFocused(false));
  input.addEventListener('input', onHiddenInput);
  const body = h('div', { class: 'typing-body' }, viewport, overlay, loading, srText, input);

  const source = h('span', { class: 'typing-source text-muted' }, 'Source: …');
  const hint = h('div', { class: 'typing-hints text-muted' },
    h('span', { class: 'typing-hint' }, h('span', { class: 'kbd' }, 'Esc'), ' restart'),
    h('span', { class: 'typing-hint typing-hint-new' },
      h('span', { class: 'kbd' }, 'Tab'), ' + ', h('span', { class: 'kbd' }, 'Enter'), ' new text'),
    h('span', { class: 'typing-hint typing-hint-armed' }, 'Press ', h('span', { class: 'kbd' }, 'Enter'), ' for a new text'));
  const footer = h('div', { class: 'typing-footer' }, source, hint);

  const card = h('div', {
    class: 'card typing-card is-loading' + (S.kind === 'numbers' && !S.custom ? ' kind-numbers' : ''),
    tabindex: '0',
    'aria-label': 'Typing test area. Start typing to begin.'
  }, progress, body, footer);
  card.addEventListener('focus', () => setFocused(true));
  card.addEventListener('blur', () => setFocused(false));
  overlay.addEventListener('click', (e) => { e.preventDefault(); focusCard(); });
  body.addEventListener('click', () => focusCard());

  // On-screen keyboard
  const kbWrap = h('div', { class: 'typing-keyboard' });

  root.appendChild(h('div', { class: 'container typing-mode' }, header, controls, pills, card, kbWrap));

  els = {
    root, card, input, text, viewport, overlay, loading, srText, bar, progress, source, hint, kbWrap, newBtn,
    time: pTime.value, wpm: pWpm.value, acc: pAcc.value, err: pErr.value
  };
  setupKeyboard();
}

/** Focus the test card without scrolling the page. */
function focusCard() {
  if (!els || !els.card) return;
  const target = els.input || els.card;
  try { target.focus({ preventScroll: true }); } catch (err) { target.focus(); }
}

/**
 * Fallback for virtual keyboards (Android/iOS) that fire 'input' events with key 'Unidentified'.
 * Desktop keystrokes are consumed by onKeyDown (preventDefault), so they never reach here.
 * @param {InputEvent} e
 */
function onHiddenInput(e) {
  if (!S || !els || !els.input) return;
  const inputEl = els.input;
  const type = e.inputType || '';
  if (!S.finished && !S.loading) {
    if (type === 'deleteContentBackward') {
      handleBackspace();
    } else if (type.startsWith('insert')) {
      const data = typeof e.data === 'string' && e.data.length ? e.data : (type === 'insertLineBreak' ? '\n' : '');
      for (const ch of data) {
        if (ch === '\n') { if (S.text[S.pos] === '\n') handleChar('\n'); }
        else handleChar(ch);
      }
    }
  }
  inputEl.value = '';
}

/**
 * Track focus of the test area; shows/hides the "Click here or start typing" overlay.
 * @param {boolean} v
 */
function setFocused(v) {
  if (!S || !els) return;
  S.focused = !!v;
  els.card.classList.toggle('is-unfocused', !S.focused && !S.loading && !S.finished);
}

/**
 * Chip handler: update settings, then reload a fresh text.
 * @param {'duration'|'level'|'kind'} key
 * @param {*} value
 */
function pickChip(key, value) {
  if (!S) return;
  if (S[key] === value) { focusCard(); return; }
  S[key] = value;
  try { setSetting(key, value); } catch (err) { /* settings unavailable; continue */ }
  renderTest();
  loadText();
}

/**
 * Build the <span class="ch"> elements for the current text.
 */
function buildText() {
  const frag = document.createDocumentFragment();
  S.spans = [];
  S.states = [];
  for (let i = 0; i < S.text.length; i++) {
    const c = S.text[i];
    const span = document.createElement('span');
    span.className = 'ch pending' + charClass(c);
    span.textContent = c === '\n' ? '↵' : c;
    frag.appendChild(span);
    if (c === '\n') frag.appendChild(document.createElement('br'));
    S.spans.push(span);
    S.states.push('pending');
  }
  els.text.innerHTML = '';
  els.text.appendChild(frag);
  els.srText.textContent = S.text;
  els.card.classList.toggle('kind-numbers', S.kind === 'numbers' && !S.custom);
  els.source.textContent = 'Source: ' + sourceLabel(S.source) + (S.title ? ' · ' + S.title : '');
}

/**
 * Friendly label for a source id.
 * @param {string} source
 * @returns {string}
 */
function sourceLabel(source) {
  if (typeof textProvider.getSourceLabel === 'function') {
    try {
      const l = textProvider.getSourceLabel(source);
      if (l) return String(l);
    } catch (err) { /* fall through */ }
  }
  return SOURCE_LABELS[source] || cap(String(source || 'local'));
}

/* ------------------------------------------------------------------ */
/* Text loading / run control                                           */
/* ------------------------------------------------------------------ */

/**
 * Fetch a new text via textProvider.getText and reset the run.
 * @returns {Promise<void>}
 */
async function loadText() {
  if (!S || !els) return;
  const seq = ++S.loadSeq;
  stopTimer();
  S.loading = true;
  S.finished = false;
  els.card.classList.add('is-loading');
  els.card.classList.remove('is-unfocused');
  els.text.classList.remove('is-active');
  els.newBtn.disabled = true;

  const maxChars = S.duration > 0 ? Math.min(2000, Math.max(300, S.duration * 12)) : 600;
  let text = '';
  let source = 'local';
  let title = '';
  try {
    const res = await textProvider.getText({ level: S.level, kind: S.kind, maxChars, custom: S.custom });
    if (!S || !els || seq !== S.loadSeq) return;
    text = res && typeof res.text === 'string' ? res.text.trim() : '';
    source = (res && res.source) || 'local';
    title = (res && res.title) || '';
    if (!text) throw new Error('Empty text');
  } catch (err) {
    if (!S || !els || seq !== S.loadSeq) return;
    console.warn('[typing] getText failed, using fallback text', err);
    try { toast('Could not load a new text. Using a built-in passage.', { type: 'error' }); } catch (e) { /* ignore */ }
    text = FALLBACK_TEXT;
    source = 'local';
    title = '';
  }
  S.text = text;
  S.source = source;
  S.title = title;
  S.loading = false;
  els.newBtn.disabled = false;
  els.card.classList.remove('is-loading');
  buildText();
  resetRun();
}

/** Reload a fresh text (New text button / Tab+Enter). */
function newText() {
  if (!S || !els) return;
  loadText();
}

/**
 * Reset the current run on the same text (Esc / Try again).
 */
function resetRun() {
  stopTimer();
  for (let i = 0; i < S.spans.length; i++) {
    S.spans[i].className = 'ch pending' + charClass(S.text[i]);
    delete S.spans[i].dataset.typed;
    S.states[i] = 'pending';
  }
  S.pos = 0;
  S.curSpan = null;
  S.wrongHere = false;
  S.errors = 0;
  S.keyErrors = {};
  S.keystrokes = 0;
  S.correct = 0;
  S.startedAt = 0;
  S.elapsed = 0;
  S.running = false;
  S.finished = false;
  S.lastTick = -1;
  S.strict = isStrict();
  setArmed(false);
  els.text.classList.remove('is-active');
  els.text.style.transform = '';
  updateCursor();
  updateStats();
  updateProgress();
  kbHighlight(S.text[0]);
  focusCard();
  setFocused(document.activeElement === els.card || document.activeElement === els.input);
}

/** Restart the same text. */
function restart() {
  if (!S || !els || S.loading) return;
  resetRun();
}

/** Start the run timer (first keystroke). */
function startTimer() {
  S.startedAt = Date.now();
  S.elapsed = 0;
  S.running = true;
  S.lastTick = -1;
  els.text.classList.add('is-active');
  S.timer = setInterval(tick, 100);
}

/** Stop the interval timer. */
function stopTimer() {
  if (S && S.timer) {
    clearInterval(S.timer);
    S.timer = 0;
  }
  if (S) S.running = false;
}

/** Interval callback: update elapsed, countdown ticks, live stats, finish on timeout. */
function tick() {
  if (!S || !els || !S.running) return;
  S.elapsed = (Date.now() - S.startedAt) / 1000;
  if (S.duration > 0) {
    const remaining = S.duration - S.elapsed;
    if (remaining <= 0) {
      S.elapsed = S.duration;
      updateStats();
      finish();
      return;
    }
    const sec = Math.ceil(remaining);
    if (sec <= 5 && sec !== S.lastTick) {
      S.lastTick = sec;
      try { playTick(); } catch (err) { /* ignore */ }
    }
  }
  updateStats();
}

/* ------------------------------------------------------------------ */
/* Input                                                                */
/* ------------------------------------------------------------------ */

/**
 * @param {Element|null} el
 * @returns {boolean} true when el is a text-entry form field.
 */
function isFormField(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el.isContentEditable === true;
}

/**
 * Document keydown handler.
 * @param {KeyboardEvent} e
 */
function onKeyDown(e) {
  if (!S || !els) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (S.finished || S.loading) return;
  const key = e.key;
  if (typeof key !== 'string' || /^F\d{1,2}$/.test(key)) return;

  const ae = document.activeElement;
  if (isFormField(ae) && ae !== els.input) return;
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot && modalRoot.childElementCount > 0) return;
  // Let focused buttons/links (chips, topbar) keep their native Space/Enter activation.
  if (ae && ae !== els.card && ae !== els.input && (ae.tagName === 'BUTTON' || ae.tagName === 'A') && (key === ' ' || key === 'Enter')) {
    if (key === 'Enter' && S.tabArmed) {
      e.preventDefault();
      setArmed(false);
      newText();
    }
    return;
  }

  if (key === 'Tab') {
    e.preventDefault();
    setArmed(true);
    return;
  }
  if (key === 'Escape') {
    e.preventDefault();
    setArmed(false);
    restart();
    return;
  }
  if (key === 'Enter') {
    if (S.tabArmed) {
      e.preventDefault();
      setArmed(false);
      newText();
      return;
    }
    if (S.text[S.pos] === '\n') {
      e.preventDefault();
      handleChar('\n');
    }
    return;
  }
  if (key === 'Backspace') {
    e.preventDefault();
    setArmed(false);
    handleBackspace();
    return;
  }
  if (key.length === 1) {
    e.preventDefault();
    setArmed(false);
    handleChar(key);
    return;
  }
  if (key !== 'Shift' && key !== 'CapsLock') setArmed(false);
}

/**
 * Toggle the "Tab then Enter" armed state on the hint row.
 * @param {boolean} v
 */
function setArmed(v) {
  S.tabArmed = !!v;
  if (els && els.hint) els.hint.classList.toggle('armed', S.tabArmed);
}

/**
 * Normalise an expected char for keyErrors bookkeeping.
 * @param {string} c
 * @returns {string}
 */
function keyFor(c) {
  if (c === ' ') return ' ';
  if (c === '\n') return 'Enter';
  return /[A-Za-z]/.test(c) ? c.toLowerCase() : c;
}

/**
 * Set a char position's state and update its classes.
 * @param {number} i
 * @param {'pending'|'correct'|'wrong'} state
 * @param {string} [typed]
 */
function setState(i, state, typed) {
  const prev = S.states[i];
  if (prev === 'correct') S.correct--;
  if (state === 'correct') S.correct++;
  S.states[i] = state;
  const span = S.spans[i];
  span.className = 'ch ' + state + charClass(S.text[i]);
  if (typed !== undefined) span.dataset.typed = typed;
  else delete span.dataset.typed;
}

/**
 * Handle a printable character keystroke.
 * @param {string} ch
 */
function handleChar(ch) {
  if (!S.text || S.pos >= S.text.length) return;
  if (!S.running) startTimer();
  if (!S.focused) focusCard();
  const expected = S.text[S.pos];
  S.keystrokes++;
  if (ch === expected) {
    if (S.wrongHere) {
      S.wrongHere = false;
      S.spans[S.pos].classList.remove('wrong');
      delete S.spans[S.pos].dataset.typed;
    }
    setState(S.pos, 'correct');
    S.pos++;
    try { playKey(); } catch (err) { /* ignore */ }
    kbPress(ch, true);
  } else {
    S.errors++;
    const k = keyFor(expected);
    S.keyErrors[k] = (S.keyErrors[k] || 0) + 1;
    try { playError(); } catch (err) { /* ignore */ }
    kbPress(ch, false);
    if (S.strict) {
      // Strict: show the error on the current char but do not advance.
      S.wrongHere = true;
      S.spans[S.pos].classList.add('wrong');
      S.spans[S.pos].dataset.typed = ch;
    } else {
      setState(S.pos, 'wrong', ch);
      S.pos++;
    }
  }
  afterKey();
}

/** Handle Backspace. */
function handleBackspace() {
  if (!S.text) return;
  if (S.wrongHere) {
    S.wrongHere = false;
    S.spans[S.pos].classList.remove('wrong');
    delete S.spans[S.pos].dataset.typed;
  } else if (S.pos > 0) {
    S.pos--;
    setState(S.pos, 'pending');
  } else {
    return;
  }
  if (!S.focused) focusCard();
  try { playKey(); } catch (err) { /* ignore */ }
  kbPress('Backspace', true);
  afterKey();
}

/** Common post-keystroke updates. */
function afterKey() {
  updateCursor();
  updateStats();
  updateProgress();
  updateScroll();
  if (S.pos >= S.text.length) {
    finish();
    return;
  }
  kbHighlight(S.text[S.pos]);
}

/* ------------------------------------------------------------------ */
/* Visual updates                                                       */
/* ------------------------------------------------------------------ */

/** Move the .current class to the cursor position. */
function updateCursor() {
  if (S.curSpan) S.curSpan.classList.remove('current');
  const span = S.spans[S.pos] || null;
  if (span) span.classList.add('current');
  S.curSpan = span;
}

/** Refresh the live stat pills. */
function updateStats() {
  if (!els) return;
  const elapsed = S.running || S.finished ? S.elapsed : 0;
  let timeText;
  if (S.duration > 0) {
    const remaining = S.running || S.finished ? Math.max(0, Math.ceil(S.duration - elapsed)) : S.duration;
    timeText = formatDuration(remaining);
  } else {
    timeText = formatDuration(Math.floor(elapsed));
  }
  els.time.textContent = timeText;
  els.wpm.textContent = String(computeWpm(S.correct, elapsed));
  const attempts = S.correct + S.errors;
  els.acc.textContent = (attempts > 0 ? computeAccuracy(S.correct, attempts) : 100) + '%';
  els.err.textContent = String(S.errors);
}

/** Refresh the thin progress bar. */
function updateProgress() {
  if (!els) return;
  const pct = S.text.length ? Math.min(100, (S.pos / S.text.length) * 100) : 0;
  els.bar.style.width = pct.toFixed(1) + '%';
  els.progress.setAttribute('aria-valuenow', String(Math.round(pct)));
}

/**
 * Keep the current line visible in the 3-line viewport (typing.com style translateY):
 * the active line is held as the second visible line once past the first line.
 */
function updateScroll() {
  if (!els || !S.spans.length) return;
  const span = S.spans[Math.min(S.pos, S.spans.length - 1)];
  const lh = parseFloat(getComputedStyle(els.text).lineHeight) || 40;
  const line = Math.round(span.offsetTop / lh);
  const target = Math.max(0, line - 1);
  els.text.style.transform = target > 0 ? 'translateY(' + (-target * lh) + 'px)' : '';
}

/* ------------------------------------------------------------------ */
/* On-screen keyboard                                                   */
/* ------------------------------------------------------------------ */

/** Create or remove the on-screen keyboard according to settings.showKeyboard. */
function setupKeyboard() {
  if (!S || !els) return;
  destroyKeyboard();
  let show = true;
  try { show = getSettings().showKeyboard !== false; } catch (err) { show = true; }
  els.kbWrap.hidden = !show;
  els.kbWrap.innerHTML = '';
  if (!show) return;
  try {
    S.keyboard = createKeyboard(els.kbWrap);
    if (S.text && !S.finished && !S.loading) kbHighlight(S.text[S.pos]);
  } catch (err) {
    console.warn('[typing] keyboard unavailable', err);
    S.keyboard = null;
    els.kbWrap.hidden = true;
  }
}

/** Destroy the on-screen keyboard if present. */
function destroyKeyboard() {
  if (S && S.keyboard) {
    try { S.keyboard.destroy(); } catch (err) { /* ignore */ }
    S.keyboard = null;
  }
}

/**
 * Highlight the next expected key on the on-screen keyboard.
 * @param {string|undefined} ch
 */
function kbHighlight(ch) {
  if (!S || !S.keyboard) return;
  try {
    if (ch === undefined || ch === null) S.keyboard.clearHighlight();
    else S.keyboard.highlightNext(ch);
  } catch (err) { /* ignore */ }
}

/**
 * Flash a key on the on-screen keyboard.
 * @param {string} ch
 * @param {boolean} correct
 */
function kbPress(ch, correct) {
  if (!S || !S.keyboard) return;
  try { S.keyboard.pressKey(ch, correct); } catch (err) { /* ignore */ }
}

/**
 * React to live settings changes from the drawer.
 * @param {object} settings
 * @param {string[]} changedKeys
 */
function handleSettingsChange(settings, changedKeys) {
  if (!S || !els) return;
  const keys = Array.isArray(changedKeys) ? changedKeys : [];
  if (keys.includes('showKeyboard')) setupKeyboard();
  if (keys.includes('strictMode')) S.strict = isStrict();
}

/* ------------------------------------------------------------------ */
/* Finish                                                               */
/* ------------------------------------------------------------------ */

/**
 * Count words (runs of non-space chars) fully typed with every char correct.
 * @returns {number}
 */
function countCorrectWords() {
  let words = 0;
  let inWord = false;
  let ok = true;
  for (let i = 0; i <= S.text.length; i++) {
    const c = S.text[i];
    const isSpace = c === undefined || c === ' ' || c === '\n';
    if (!isSpace) {
      if (!inWord) { inWord = true; ok = true; }
      if (S.states[i] !== 'correct') ok = false;
    } else if (inWord) {
      if (ok) words++;
      inWord = false;
    }
  }
  return words;
}

/**
 * Finish the test: build the Result object (CONTRACT §5) and hand off to showResults.
 */
function finish() {
  if (!S || !els || S.finished) return;
  S.finished = true;
  if (S.running) S.elapsed = (Date.now() - S.startedAt) / 1000;
  if (S.duration > 0 && S.elapsed > S.duration) S.elapsed = S.duration;
  stopTimer();
  setArmed(false);
  els.text.classList.remove('is-active');
  els.card.classList.remove('is-unfocused');
  updateStats();

  const elapsed = Math.max(0.1, S.elapsed);
  const correct = S.correct;
  const attempts = correct + S.errors;
  const result = {
    mode: 'typing',
    level: S.level,
    kind: S.custom ? 'custom' : S.kind,
    wpm: computeWpm(correct, elapsed),
    rawWpm: computeWpm(S.keystrokes, elapsed),
    accuracy: attempts > 0 ? computeAccuracy(correct, attempts) : 0,
    durationSec: Math.max(1, Math.round(elapsed)),
    chars: S.pos,
    correctChars: correct,
    errors: S.errors,
    words: countCorrectWords(),
    keyErrors: Object.assign({}, S.keyErrors),
    timestamp: Date.now(),
    source: S.source,
    text: S.text.slice(0, 500)
  };

  destroyKeyboard();
  const root = S.root;
  els = null;
  Promise.resolve()
    .then(() => showResults(root, result, {
      onRetry: () => {
        if (!S) return;
        renderTest();
        buildText();
        resetRun();
      },
      onNext: () => {
        if (!S) return;
        renderTest();
        loadText();
      }
    }))
    .catch((err) => {
      console.error('[typing] showResults failed', err);
      try { toast('Could not show results.', { type: 'error' }); } catch (e) { /* ignore */ }
      if (!S) return;
      renderTest();
      buildText();
      resetRun();
    });
}
