/**
 * TypeTalk — "Listen & Type" dictation mode.
 *
 * Sentences are spoken via TTS (text hidden); the user types what they hear
 * and presses Enter. Each chunk is scored with a per-word diff, then the next
 * chunk auto-plays. See CONTRACT.md section 6 "dictation".
 *
 * @module modes/dictation
 */
import { h, toast, icon } from '../ui.js';
import { getSettings, setSetting, setSettings, onSettingsChange } from '../settings.js';
import { computeWpm, computeAccuracy } from '../stats.js';
import { getSentences, LEVELS } from '../textProvider.js';
import {
  isTtsSupported,
  ACCENTS,
  getVoiceGroups,
  voiceDisplayName,
  speak,
  stopSpeaking,
  compareWords,
  normalizeWords
} from '../speech.js';
import { initAudio } from '../audio.js';
import { showResults } from '../results.js';

/** Milliseconds the per-chunk diff stays visible before auto-advancing. */
const FEEDBACK_MS = 1200;
/** Number of sentences fetched per session. */
const SENTENCE_COUNT = 8;
/** Cap on chunks when chunking by word so a session stays short. */
const MAX_WORD_CHUNKS = 30;
/** Max key errors counted per wrong word. */
const KEY_ERRORS_PER_WORD = 3;
const CHUNK_MODES = ['word', 'sentence', 'paragraph'];
const CHUNK_LABELS = { word: 'Words', sentence: 'Sentences', paragraph: 'Paragraph' };
const FALLBACK_SENTENCES = [
  'The quick brown fox jumps over the lazy dog.',
  'Practice makes progress, one sentence at a time.',
  'Listen carefully and type exactly what you hear.'
];

/** @type {HTMLElement|null} */
let rootEl = null;
/** @type {Record<string, any>|null} DOM references */
let els = null;
/** @type {Record<string, any>|null} session state */
let state = null;
let mounted = false;
let feedbackTimer = 0;
let unsubSettings = null;
let keydownBound = false;
/** Incremented per voice-list rebuild so stale async results are ignored. */
let voiceLoadToken = 0;

/* ------------------------------------------------------------------------ */
/* Lifecycle                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * Mount the dictation mode into the given root element.
 * @param {HTMLElement} root  Empty <main id="app">.
 * @param {Object} [params]   Query params: level, custom ('1').
 * @returns {Promise<void>}
 */
export async function mount(root, params = {}) {
  rootEl = root;
  mounted = true;
  const settings = getSettings();
  state = {
    level: LEVELS.includes(params.level) ? params.level : settings.level,
    custom: params.custom === '1' || params.custom === 'true',
    chunkMode: CHUNK_MODES.includes(settings.dictationChunk) ? settings.dictationChunk : 'sentence',
    sentences: [],
    chunks: [],
    index: 0,
    started: false,
    phase: 'idle', // 'idle' | 'listen' | 'feedback' | 'done'
    loading: false,
    replays: 0,
    played: false,
    revealed: false,
    revealVisible: false,
    chunkStart: 0,
    speakToken: 0,
    records: []
  };

  if (!isTtsSupported()) {
    renderUnsupported();
    return;
  }

  renderShell();
  unsubSettings = onSettingsChange(handleSettingsChange);
  bindKeydown();
  await loadSentences(false);
}

/**
 * Unmount: stop speech, remove listeners, clear timers.
 */
export function unmount() {
  mounted = false;
  clearFeedbackTimer();
  try { stopSpeaking(); } catch (_) { /* ignore */ }
  unbindKeydown();
  if (unsubSettings) {
    try { unsubSettings(); } catch (_) { /* ignore */ }
    unsubSettings = null;
  }
  els = null;
  state = null;
  rootEl = null;
}

/* ------------------------------------------------------------------------ */
/* Data                                                                      */
/* ------------------------------------------------------------------------ */

/**
 * Fetch a fresh set of sentences, rebuild chunks and reset the session.
 * @param {boolean} autoplay  Start playing chunk 1 immediately after load.
 * @returns {Promise<void>}
 */
async function loadSentences(autoplay) {
  if (!state) return;
  state.loading = true;
  clearFeedbackTimer();
  try { stopSpeaking(); } catch (_) { /* ignore */ }
  updateLoadingUi();

  let sentences = [];
  try {
    sentences = await getSentences({ level: state.level, count: SENTENCE_COUNT, custom: state.custom });
  } catch (_) {
    sentences = [];
  }
  if (!mounted || !state) return;

  sentences = (Array.isArray(sentences) ? sentences : [])
    .map((s) => String(s || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!sentences.length) {
    sentences = FALLBACK_SENTENCES.slice();
    toast('Could not load sentences, using a short fallback set.', { type: 'warning' });
  }

  state.sentences = sentences;
  state.chunks = buildChunks(sentences, state.chunkMode);
  state.loading = false;
  resetSession(autoplay);
}

/**
 * Split sentences into chunks according to the chunk mode.
 * @param {string[]} sentences
 * @param {'word'|'sentence'|'paragraph'} mode
 * @returns {string[]}
 */
function buildChunks(sentences, mode) {
  if (mode === 'word') {
    const words = [];
    for (const s of sentences) {
      for (const w of s.split(/\s+/)) {
        if (w) words.push(w);
      }
    }
    return words.slice(0, MAX_WORD_CHUNKS);
  }
  if (mode === 'paragraph') {
    return [sentences.join(' ')];
  }
  return sentences.slice();
}

/* ------------------------------------------------------------------------ */
/* Session control                                                           */
/* ------------------------------------------------------------------------ */

/**
 * Reset progress and scores (keeping the current sentences).
 * @param {boolean} autoplay  If true, start immediately and play chunk 1.
 */
function resetSession(autoplay) {
  if (!state || !els) return;
  clearFeedbackTimer();
  try { stopSpeaking(); } catch (_) { /* ignore */ }
  state.speakToken++;
  state.index = 0;
  state.records = [];
  state.replays = 0;
  state.played = false;
  state.revealed = false;
  state.revealVisible = false;
  state.chunkStart = 0;
  state.started = !!autoplay;
  state.phase = autoplay ? 'listen' : 'idle';
  els.input.value = '';
  els.play.classList.remove('is-speaking');
  renderChunkState();
  if (autoplay) {
    els.input.focus();
    playCurrent(false);
  }
}

/** Begin the session from the Start screen (user gesture). */
function startSession() {
  if (!state || !els || state.loading || state.started) return;
  try { initAudio(); } catch (_) { /* ignore */ }
  resetSession(true);
}

/**
 * Speak the current chunk.
 * @param {boolean} isReplay  Whether this counts as a replay.
 */
function playCurrent(isReplay) {
  if (!state || !els || state.phase !== 'listen') return;
  const text = state.chunks[state.index];
  if (!text) return;
  if (isReplay && state.played) state.replays++;
  state.played = true;
  const settings = getSettings();
  const token = ++state.speakToken;
  els.play.classList.add('is-speaking');
  updatePlayUi();
  let p;
  try {
    p = speak(text, {
      rate: settings.ttsRate,
      pitch: settings.ttsPitch,
      volume: settings.ttsVolume,
      voiceURI: settings.ttsVoiceURI,
      lang: settings.lang
    });
  } catch (_) {
    p = Promise.resolve();
  }
  Promise.resolve(p).catch(() => {}).then(() => {
    if (mounted && els && state && state.speakToken === token) {
      els.play.classList.remove('is-speaking');
    }
  });
}

/** Submit the typed text for the current chunk and show the diff. */
function submitChunk() {
  if (!state || !els || state.phase !== 'listen') return;
  const expected = state.chunks[state.index] || '';
  const typed = els.input.value.replace(/\s+/g, ' ').trim();
  const seconds = state.chunkStart ? Math.max(0, (performance.now() - state.chunkStart) / 1000) : 0;
  const record = scoreChunk(expected, typed, seconds);
  state.records.push(record);
  state.phase = 'feedback';
  state.speakToken++;
  try { stopSpeaking(); } catch (_) { /* ignore */ }
  els.play.classList.remove('is-speaking');
  renderFeedback(record);
  els.progressBar.style.width = `${((state.index + 1) / state.chunks.length) * 100}%`;
  clearFeedbackTimer();
  feedbackTimer = window.setTimeout(advance, FEEDBACK_MS);
}

/** Move to the next chunk (or finish) and auto-play it. */
function advance() {
  clearFeedbackTimer();
  if (!state || !els || state.phase !== 'feedback') return;
  state.index++;
  if (state.index >= state.chunks.length) {
    finish();
    return;
  }
  state.phase = 'listen';
  state.replays = 0;
  state.played = false;
  state.revealVisible = false;
  state.chunkStart = 0;
  els.input.value = '';
  renderChunkState();
  els.input.focus();
  playCurrent(false);
}

/** Finish the session: build the result object and show the results screen. */
function finish() {
  if (!state || !rootEl) return;
  state.phase = 'done';
  clearFeedbackTimer();
  try { stopSpeaking(); } catch (_) { /* ignore */ }
  unbindKeydown();

  const result = buildResult();
  const extraContent = buildSummary();
  const sentences = state.sentences.slice();
  const root = rootEl;

  Promise.resolve(showResults(root, result, {
    onRetry: () => {
      if (!mounted || !state) return;
      state.sentences = sentences;
      state.chunks = buildChunks(sentences, state.chunkMode);
      renderShell();
      bindKeydown();
      resetSession(true);
    },
    onNext: () => {
      if (!mounted || !state) return;
      renderShell();
      bindKeydown();
      loadSentences(true);
    },
    extraContent
  })).catch((err) => {
    console.warn('[dictation] showResults failed', err);
  });
}

/* ------------------------------------------------------------------------ */
/* Scoring                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Score a single chunk.
 * @param {string} expected
 * @param {string} typed
 * @param {number} seconds  Typing time from first keystroke to Enter.
 * @returns {{expected:string, typed:string, tokens:Array, accuracy:number, chars:number,
 *   correctChars:number, errors:number, words:number, keyErrors:Object, seconds:number}}
 */
function scoreChunk(expected, typed, seconds) {
  let cmp;
  try {
    cmp = compareWords(expected, typed);
  } catch (_) {
    cmp = null;
  }
  const tokens = cmp && Array.isArray(cmp.tokens)
    ? cmp.tokens
    : expected.split(/\s+/).filter(Boolean).map((word) => ({ word, status: 'missed' }));

  let okLen = 0;
  let ok = 0;
  let wrong = 0;
  let missed = 0;
  const keyErrors = {};
  for (const t of tokens) {
    if (t.status === 'ok') {
      ok++;
      okLen += t.word.length;
    } else if (t.status === 'wrong') {
      wrong++;
      collectKeyErrors(t, keyErrors);
    } else {
      missed++;
    }
  }
  const chars = expected.length;
  const correctChars = Math.min(chars, okLen + Math.max(0, ok - 1));
  return {
    expected,
    typed,
    tokens,
    accuracy: cmp && Number.isFinite(cmp.accuracy) ? cmp.accuracy : computeAccuracy(correctChars, chars),
    chars,
    correctChars,
    errors: wrong + missed,
    words: ok,
    keyErrors,
    seconds
  };
}

/**
 * Positional char compare of expected word vs what was typed; counts the
 * first differing expected chars (capped per word).
 * @param {{word:string, heard?:string}} token
 * @param {Object<string, number>} map  Mutated.
 */
function collectKeyErrors(token, map) {
  let exp = '';
  try {
    exp = normalizeWords(token.word)[0] || '';
  } catch (_) {
    exp = '';
  }
  if (!exp) exp = String(token.word || '').toLowerCase();
  const heard = String(token.heard || '').toLowerCase();
  let n = 0;
  for (let i = 0; i < exp.length && n < KEY_ERRORS_PER_WORD; i++) {
    if (heard[i] !== exp[i]) {
      const ch = exp[i];
      map[ch] = (map[ch] || 0) + 1;
      n++;
    }
  }
}

/**
 * Aggregate chunk records into a contract Result object.
 * @returns {Object}
 */
function buildResult() {
  let chars = 0;
  let correctChars = 0;
  let errors = 0;
  let words = 0;
  let typedChars = 0;
  let seconds = 0;
  const keyErrors = {};
  for (const r of state.records) {
    chars += r.chars;
    correctChars += r.correctChars;
    errors += r.errors;
    words += r.words;
    typedChars += r.typed.length;
    seconds += r.seconds;
    for (const k of Object.keys(r.keyErrors)) {
      keyErrors[k] = (keyErrors[k] || 0) + r.keyErrors[k];
    }
  }
  const durationSec = Math.max(1, Math.round(seconds));
  const text = state.sentences.join(' ').slice(0, 500);
  let source = 'local';
  if (state.custom) source = 'custom';
  else if (typeof navigator !== 'undefined' && navigator.onLine !== false) source = 'mixed';

  return {
    mode: 'dictation',
    level: state.level,
    kind: state.custom ? 'custom' : 'sentences',
    wpm: computeWpm(correctChars, durationSec),
    rawWpm: computeWpm(typedChars, durationSec),
    accuracy: computeAccuracy(correctChars, chars),
    durationSec,
    chars,
    correctChars,
    errors,
    words,
    keyErrors,
    timestamp: Date.now(),
    source,
    text
  };
}

/* ------------------------------------------------------------------------ */
/* Rendering                                                                 */
/* ------------------------------------------------------------------------ */

/** Render the "TTS not supported" notice. */
function renderUnsupported() {
  rootEl.innerHTML = '';
  rootEl.append(
    h('div', { class: 'container dictation-page' },
      h('div', { class: 'mode-header dictation-header' },
        h('div', { class: 'dictation-title' },
          h('span', { class: 'mode-icon', html: icon('headphones') }),
          h('h1', { class: 'page-title' }, 'Listen & Type')
        )
      ),
      h('div', { class: 'card dictation-card' },
        h('div', { class: 'notice notice-warning' },
          'Text-to-speech is not supported in this browser. Please use a recent version of Chrome, Edge, Safari or Firefox to practise dictation.'
        ),
        h('div', { class: 'flex-center mt' },
          h('button', {
            class: 'btn btn-primary',
            type: 'button',
            onClick: () => { location.hash = '#/'; }
          }, 'Home')
        )
      )
    )
  );
}

/** Build the whole mode UI into the root element. */
function renderShell() {
  const settings = getSettings();
  els = {};
  rootEl.innerHTML = '';

  /* --- header --- */
  els.levelChips = {};
  const headerRight = h('div', { class: 'flex gap dictation-header-controls' });
  if (state.custom) {
    headerRight.append(h('span', { class: 'badge badge-primary' }, 'Custom text'));
  } else {
    const chipGroup = h('div', { class: 'chip-group', role: 'group', 'aria-label': 'Level' });
    for (const lvl of LEVELS) {
      const chip = h('button', {
        class: 'chip' + (lvl === state.level ? ' active' : ''),
        type: 'button',
        'aria-pressed': lvl === state.level ? 'true' : 'false',
        onClick: () => setLevel(lvl)
      }, capitalize(lvl));
      els.levelChips[lvl] = chip;
      chipGroup.append(chip);
    }
    headerRight.append(chipGroup);
  }

  els.segButtons = {};
  const segmented = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Chunk size' });
  for (const mode of CHUNK_MODES) {
    const btn = h('button', {
      type: 'button',
      class: mode === state.chunkMode ? 'active' : '',
      'aria-pressed': mode === state.chunkMode ? 'true' : 'false',
      onClick: () => setChunkMode(mode, true)
    }, CHUNK_LABELS[mode]);
    els.segButtons[mode] = btn;
    segmented.append(btn);
  }
  headerRight.append(segmented);

  els.newBtn = h('button', {
    class: 'btn btn-ghost',
    type: 'button',
    'aria-label': 'New sentences',
    title: 'New sentences',
    html: icon('refresh') + '<span>New</span>',
    onClick: () => loadSentences(state.started)
  });
  headerRight.append(els.newBtn);

  const header = h('div', { class: 'mode-header dictation-header' },
    h('div', { class: 'dictation-title' },
      h('span', { class: 'mode-icon', html: icon('headphones') }),
      h('h1', { class: 'page-title' }, 'Listen & Type')
    ),
    headerRight
  );

  /* --- progress --- */
  els.progressText = h('span', { class: 'dict-progress-text' }, 'Chunk 1 / 1');
  els.progressBar = h('div', { class: 'bar', style: 'width:0%' });
  const progress = h('div', { class: 'dict-progress' },
    h('div', { class: 'flex-between' },
      els.progressText,
      h('span', { class: 'text-muted dict-progress-caption' }, 'Listen, then type')
    ),
    h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Session progress' }, els.progressBar)
  );

  /* --- play stage --- */
  els.play = h('button', {
    class: 'dict-play',
    type: 'button',
    'aria-label': 'Play sentence',
    html: icon('play'),
    onClick: onPlayClick
  });
  els.playCaption = h('div', { class: 'dict-play-caption' }, 'Play');
  els.replayCount = h('div', { class: 'dict-replays text-muted', 'aria-live': 'polite' }, '');
  els.reveal = h('p', { class: 'dict-reveal text-muted', hidden: '' });
  const stage = h('div', { class: 'dict-stage' }, els.play, els.playCaption, els.replayCount, els.reveal);

  /* --- start panel --- */
  els.startBtn = h('button', {
    class: 'btn btn-primary btn-lg',
    type: 'button',
    onClick: startSession
  }, 'Start');
  els.startPanel = h('div', { class: 'dict-start' },
    h('p', { class: 'dict-start-text' }, 'Press Start to hear the first sentence'),
    els.startBtn
  );

  /* --- controls --- */
  els.rateLabel = h('span', { class: 'dict-control-value' }, formatRate(settings.ttsRate));
  els.rate = h('input', {
    type: 'range', class: 'range', min: '0.5', max: '1.5', step: '0.1',
    value: String(settings.ttsRate), 'aria-label': 'Speech speed',
    onInput: (e) => {
      const v = clamp(parseFloat(e.target.value), 0.5, 1.5);
      els.rateLabel.textContent = formatRate(v);
      setSetting('ttsRate', v);
    }
  });
  els.volumeLabel = h('span', { class: 'dict-control-value' }, formatPercent(settings.ttsVolume));
  els.volume = h('input', {
    type: 'range', class: 'range', min: '0', max: '1', step: '0.05',
    value: String(settings.ttsVolume), 'aria-label': 'Speech volume',
    onInput: (e) => {
      const v = clamp(parseFloat(e.target.value), 0, 1);
      els.volumeLabel.textContent = formatPercent(v);
      setSetting('ttsVolume', v);
    }
  });
  /* accent chips (bound to settings.lang) */
  els.accentChips = {};
  const accentGroup = h('div', { class: 'chip-group dict-accent-chips', role: 'group', 'aria-label': 'Voice accent' });
  for (const a of ACCENTS) {
    const active = a.code === settings.lang;
    const chip = h('button', {
      class: 'chip' + (active ? ' active' : ''),
      type: 'button',
      title: a.label,
      'aria-pressed': active ? 'true' : 'false',
      onClick: () => setAccent(a.code)
    }, `${a.flag} ${shortAccentLabel(a.label)}`);
    els.accentChips[a.code] = chip;
    accentGroup.append(chip);
  }
  const accentRow = h('div', { class: 'dict-accent-row' },
    h('span', { class: 'dict-control-label dict-accent-label' }, 'Accent'),
    accentGroup
  );

  els.voice = h('select', {
    class: 'select', 'aria-label': 'Voice',
    onChange: (e) => setSetting('ttsVoiceURI', e.target.value)
  }, h('option', { value: '' }, 'Auto (best for accent)'));
  els.revealBtn = h('button', {
    class: 'btn btn-outline dict-reveal-btn',
    type: 'button',
    'aria-pressed': 'false',
    'aria-label': 'Show text',
    html: icon('eye') + '<span>Show text</span>',
    onClick: toggleReveal
  });
  const controls = h('div', { class: 'dict-controls' },
    h('label', { class: 'dict-control' },
      h('span', { class: 'dict-control-label' }, h('span', {}, 'Speed'), els.rateLabel),
      els.rate
    ),
    h('label', { class: 'dict-control' },
      h('span', { class: 'dict-control-label' }, h('span', {}, 'Volume'), els.volumeLabel),
      els.volume
    ),
    h('label', { class: 'dict-control' },
      h('span', { class: 'dict-control-label' }, h('span', {}, 'Voice')),
      els.voice
    ),
    h('div', { class: 'dict-control dict-control-btn' }, els.revealBtn)
  );

  /* --- input + feedback --- */
  els.input = h('input', {
    class: 'input dict-input',
    type: 'text',
    placeholder: 'Type what you hear, then press Enter',
    autocomplete: 'off',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    autofocus: '',
    'aria-label': 'Type what you hear',
    onInput: onInputChange
  });
  els.feedback = h('div', { class: 'dict-feedback', hidden: '', 'aria-live': 'polite' });
  els.inputWrap = h('div', { class: 'dict-input-wrap', hidden: '' }, els.input, els.feedback);

  const hints = h('div', { class: 'dict-hints text-muted' },
    h('span', {}, h('span', { class: 'kbd' }, 'Enter'), ' submit'),
    h('span', {}, h('span', { class: 'kbd' }, 'Ctrl'), ' + ', h('span', { class: 'kbd' }, 'Space'), ' replay'),
    h('span', {}, h('span', { class: 'kbd' }, 'Esc'), ' restart')
  );

  const card = h('section', { class: 'card dictation-card' },
    progress, stage, els.startPanel, accentRow, controls, els.inputWrap, hints
  );

  rootEl.append(h('div', { class: 'container dictation-page' }, header, card));
  populateVoices();
  renderChunkState();
}

/**
 * Fill the voice <select> from getVoiceGroups(): one <optgroup> per accent
 * group (settings.lang first), options labelled via voiceDisplayName().
 */
function populateVoices() {
  const select = els && els.voice;
  if (!select) return;
  const token = ++voiceLoadToken;
  Promise.resolve()
    .then(() => getVoiceGroups())
    .then((groups) => {
      if (!mounted || !els || els.voice !== select || token !== voiceLoadToken) return;
      const current = getSettings().ttsVoiceURI || '';
      select.innerHTML = '';
      select.append(h('option', { value: '' }, 'Auto (best for accent)'));
      for (const g of groups || []) {
        if (!g || !Array.isArray(g.voices) || !g.voices.length) continue;
        const optgroup = h('optgroup', { label: `${g.flag ? g.flag + ' ' : ''}${g.label}` });
        for (const v of g.voices) {
          if (!v || !v.voiceURI) continue;
          optgroup.append(h('option', { value: v.voiceURI }, voiceDisplayName(v) || v.name || v.voiceURI));
        }
        select.append(optgroup);
      }
      select.value = current;
      if (select.value !== current) select.value = '';
    })
    .catch(() => { /* leave the Auto option */ });
}

/** Reflect settings.lang on the accent chips. */
function updateAccentChips(lang) {
  if (!els || !els.accentChips) return;
  for (const code of Object.keys(els.accentChips)) {
    const active = code === lang;
    els.accentChips[code].classList.toggle('active', active);
    els.accentChips[code].setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

/** Sync the whole card with the current session state. */
function renderChunkState() {
  if (!state || !els) return;
  const total = state.chunks.length;
  const n = Math.min(state.index + 1, Math.max(total, 1));
  els.progressText.textContent = state.loading ? 'Loading sentences…' : `Chunk ${n} / ${total}`;
  els.progressBar.style.width = total ? `${(state.index / total) * 100}%` : '0%';

  els.startPanel.hidden = state.started;
  els.startBtn.disabled = state.loading;
  els.inputWrap.hidden = !state.started;
  els.feedback.hidden = true;
  els.feedback.innerHTML = '';
  els.input.disabled = false;

  updatePlayUi();
  updateRevealUi();
}

/** Update the play button label/icon and replay caption. */
function updatePlayUi() {
  if (!state || !els) return;
  const replayState = state.started && state.played;
  els.play.classList.toggle('is-replay', replayState);
  els.play.disabled = state.loading;
  els.play.innerHTML = icon(replayState ? 'repeat' : 'play');
  els.play.setAttribute('aria-label', replayState ? 'Replay sentence' : 'Play sentence');
  els.playCaption.textContent = replayState ? 'Replay' : 'Play';
  els.replayCount.textContent = state.replays > 0
    ? `Replayed ${state.replays}×`
    : (state.started ? 'Ctrl + Space to replay' : '');
}

/** Update the reveal text and eye button. */
function updateRevealUi() {
  if (!state || !els) return;
  const show = state.started && state.revealVisible && state.phase === 'listen';
  els.reveal.hidden = !show;
  els.reveal.textContent = show ? (state.chunks[state.index] || '') : '';
  els.revealBtn.setAttribute('aria-pressed', show ? 'true' : 'false');
  els.revealBtn.setAttribute('aria-label', show ? 'Hide text' : 'Show text');
  els.revealBtn.innerHTML = icon(show ? 'eye-off' : 'eye') + `<span>${show ? 'Hide text' : 'Show text'}</span>`;
  els.revealBtn.disabled = !state.started || state.phase !== 'listen';
}

/** Update the UI for the loading state. */
function updateLoadingUi() {
  if (!els) return;
  els.progressText.textContent = 'Loading sentences…';
  els.startBtn.disabled = true;
  els.play.disabled = true;
}

/**
 * Build the per-word diff element for a chunk record.
 * @param {Array<{word:string, status:string, heard?:string}>} tokens
 * @returns {HTMLElement}
 */
function renderDiff(tokens) {
  const diff = h('div', { class: 'dict-diff' });
  for (const t of tokens) {
    const span = h('span', { class: `w-${t.status}` }, t.word);
    if (t.status === 'wrong' && t.heard) {
      span.title = `You typed: ${t.heard}`;
      span.append(h('span', { class: 'w-heard' }, `(${t.heard})`));
    } else if (t.status === 'missed') {
      span.title = 'Missed';
    }
    diff.append(span);
  }
  return diff;
}

/**
 * Show the diff of the chunk just submitted.
 * @param {Object} record
 */
function renderFeedback(record) {
  if (!els) return;
  const badgeClass = record.errors === 0
    ? 'badge-success'
    : (record.accuracy >= 70 ? 'badge-warning' : 'badge-error');
  els.feedback.innerHTML = '';
  els.feedback.append(
    h('div', { class: 'flex-between dict-feedback-head' },
      h('span', { class: 'dict-feedback-title' },
        record.errors === 0 ? 'Perfect!' : `${record.errors} ${record.errors === 1 ? 'mistake' : 'mistakes'}`
      ),
      h('span', { class: `badge ${badgeClass}` }, `${Math.round(record.accuracy)}%`)
    ),
    renderDiff(record.tokens),
    h('div', { class: 'dict-typed' }, 'You typed: ', h('b', {}, record.typed || '(nothing)')),
    h('div', { class: 'dict-feedback-hint text-muted' }, h('span', { class: 'kbd' }, 'Enter'), ' to continue')
  );
  els.feedback.hidden = false;
  updateRevealUi();
}

/**
 * Build the results-screen summary of every chunk.
 * @returns {HTMLElement}
 */
function buildSummary() {
  const list = h('ol', { class: 'dictation-summary-list' });
  state.records.forEach((r, i) => {
    list.append(
      h('li', { class: 'dictation-summary-item' },
        h('div', { class: 'flex-between dictation-summary-head' },
          h('span', { class: 'text-muted' }, `Chunk ${i + 1}`),
          h('span', { class: 'badge ' + (r.errors === 0 ? 'badge-success' : 'badge-error') }, `${Math.round(r.accuracy)}%`)
        ),
        renderDiff(r.tokens),
        h('div', { class: 'dict-typed' }, 'You typed: ', h('b', {}, r.typed || '(nothing)'))
      )
    );
  });
  return h('div', { class: 'dictation-summary' },
    h('div', { class: 'flex-between dictation-summary-title' },
      h('h3', {}, 'Dictation review'),
      state.revealed ? h('span', { class: 'badge badge-warning' }, 'Text was revealed') : null
    ),
    list
  );
}

/* ------------------------------------------------------------------------ */
/* Event handlers                                                            */
/* ------------------------------------------------------------------------ */

/** Play button: Start on the idle screen, replay while listening. */
function onPlayClick() {
  if (!state || !els || state.loading) return;
  if (!state.started) {
    startSession();
    return;
  }
  if (state.phase === 'listen') {
    playCurrent(true);
    els.input.focus();
  }
}

/** First keystroke of a chunk starts its timer. */
function onInputChange() {
  if (!state || !els || state.phase !== 'listen') return;
  if (!state.chunkStart && els.input.value.length > 0) {
    state.chunkStart = performance.now();
  }
}

/** Toggle revealing the current chunk's text (flags the session). */
function toggleReveal() {
  if (!state || !els || !state.started || state.phase !== 'listen') return;
  state.revealVisible = !state.revealVisible;
  if (state.revealVisible) state.revealed = true;
  updateRevealUi();
  els.input.focus();
}

/**
 * Choose a voice accent: sets settings.lang, clears the explicit voice so
 * "Auto" picks the best voice for that accent, and rebuilds the voice list.
 * @param {string} code  e.g. 'en-IN'
 */
function setAccent(code) {
  if (!state || !els || !ACCENTS.some((a) => a.code === code)) return;
  if (typeof setSettings === 'function') {
    setSettings({ lang: code, ttsVoiceURI: '' });
  } else {
    setSetting('lang', code);
    setSetting('ttsVoiceURI', '');
  }
  updateAccentChips(code);
  els.voice.value = '';
  populateVoices();
  if (state.started && state.phase === 'listen') els.input.focus();
}

/**
 * Change the difficulty level and reload sentences.
 * @param {string} lvl
 */
function setLevel(lvl) {
  if (!state || !els || lvl === state.level || !LEVELS.includes(lvl)) return;
  state.level = lvl;
  setSetting('level', lvl);
  for (const key of Object.keys(els.levelChips)) {
    els.levelChips[key].classList.toggle('active', key === lvl);
    els.levelChips[key].setAttribute('aria-pressed', key === lvl ? 'true' : 'false');
  }
  loadSentences(state.started);
}

/**
 * Change chunking mode, rebuild chunks and restart the session.
 * @param {'word'|'sentence'|'paragraph'} mode
 * @param {boolean} persist  Write to settings.
 */
function setChunkMode(mode, persist) {
  if (!state || !els || !CHUNK_MODES.includes(mode)) return;
  if (persist) setSetting('dictationChunk', mode);
  if (mode === state.chunkMode) return;
  state.chunkMode = mode;
  for (const key of Object.keys(els.segButtons)) {
    els.segButtons[key].classList.toggle('active', key === mode);
    els.segButtons[key].setAttribute('aria-pressed', key === mode ? 'true' : 'false');
  }
  if (state.loading) return;
  state.chunks = buildChunks(state.sentences, mode);
  resetSession(state.started);
}

/**
 * React to settings changed elsewhere (settings drawer).
 * @param {Object} settings
 * @param {string[]} changedKeys
 */
function handleSettingsChange(settings, changedKeys) {
  if (!mounted || !state || !els || state.phase === 'done') return;
  const keys = Array.isArray(changedKeys) ? changedKeys : [];
  if (keys.includes('ttsRate')) {
    els.rate.value = String(settings.ttsRate);
    els.rateLabel.textContent = formatRate(settings.ttsRate);
  }
  if (keys.includes('ttsVolume')) {
    els.volume.value = String(settings.ttsVolume);
    els.volumeLabel.textContent = formatPercent(settings.ttsVolume);
  }
  if (keys.includes('ttsVoiceURI')) {
    els.voice.value = settings.ttsVoiceURI || '';
    if (els.voice.value !== (settings.ttsVoiceURI || '')) els.voice.value = '';
  }
  if (keys.includes('lang')) {
    updateAccentChips(settings.lang);
    populateVoices();
  }
  if (keys.includes('dictationChunk') && CHUNK_MODES.includes(settings.dictationChunk)) {
    setChunkMode(settings.dictationChunk, false);
  }
}

/**
 * Global keyboard shortcuts.
 * @param {KeyboardEvent} e
 */
function onKeydown(e) {
  if (!mounted || !state || !els || state.phase === 'done') return;
  const key = e.key || '';
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && (e.code === 'Space' || key === ' ' || key.toLowerCase() === 'r')) {
    e.preventDefault();
    if (state.started && state.phase === 'listen' && !state.loading) {
      playCurrent(true);
      els.input.focus();
    }
    return;
  }
  if (ctrl || e.altKey) return;

  if (key === 'Escape') {
    if (state.started && !state.loading) {
      e.preventDefault();
      resetSession(true);
    }
    return;
  }

  if (key === 'Enter') {
    const tag = e.target && e.target.tagName;
    if (tag === 'BUTTON' || tag === 'A' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (state.loading) return;
    e.preventDefault();
    if (!state.started) {
      startSession();
    } else if (state.phase === 'listen') {
      submitChunk();
    } else if (state.phase === 'feedback') {
      advance();
    }
  }
}

/** Attach the document keydown listener (idempotent). */
function bindKeydown() {
  if (keydownBound) return;
  document.addEventListener('keydown', onKeydown);
  keydownBound = true;
}

/** Detach the document keydown listener (idempotent). */
function unbindKeydown() {
  if (!keydownBound) return;
  document.removeEventListener('keydown', onKeydown);
  keydownBound = false;
}

/** Cancel the pending auto-advance timer. */
function clearFeedbackTimer() {
  if (feedbackTimer) {
    clearTimeout(feedbackTimer);
    feedbackTimer = 0;
  }
}

/* ------------------------------------------------------------------------ */
/* Small helpers                                                             */
/* ------------------------------------------------------------------------ */

/**
 * @param {number} v
 * @returns {string} e.g. "1.0x"
 */
function formatRate(v) {
  const n = Number.isFinite(Number(v)) ? Number(v) : 1;
  return `${n.toFixed(1)}x`;
}

/**
 * @param {number} v 0..1
 * @returns {string} e.g. "80%"
 */
function formatPercent(v) {
  const n = Number.isFinite(Number(v)) ? Number(v) : 1;
  return `${Math.round(n * 100)}%`;
}

/**
 * @param {number} n
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/**
 * Short chip label for an accent: 'Indian English' -> 'Indian', 'US English' -> 'US'.
 * @param {string} label
 * @returns {string}
 */
function shortAccentLabel(label) {
  return String(label || '').replace(/\s*English\s*$/i, '').trim() || String(label || '');
}

/**
 * @param {string} s
 * @returns {string}
 */
function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}
