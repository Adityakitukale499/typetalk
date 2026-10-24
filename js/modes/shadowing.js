/**
 * TypeTalk — "Listen & Repeat" (shadowing) mode.
 *
 * Flow per sentence: the sentence is spoken via TTS while its text stays hidden,
 * the user repeats it into the microphone, the recognizer stops automatically after
 * 1.5s with no new result (hard cap 15s), and the sentence is revealed with a word
 * diff plus a per-sentence accuracy badge. Scores are aggregated into a Result object
 * and handed to showResults().
 *
 * State machine: 'idle' -> 'playing' -> 'ready' -> 'listening' -> 'review' -> (Next) 'playing' ...
 */

import { h, toast, icon } from '../ui.js';
import { getSettings, setSetting, setSettings, onSettingsChange } from '../settings.js';
import { getSentences } from '../textProvider.js';
import {
  isRecognitionSupported,
  speak,
  stopSpeaking,
  createRecognizer,
  compareWords,
  ACCENTS,
  getVoiceGroups,
  voiceDisplayName
} from '../speech.js';
import { initAudio } from '../audio.js';
import { showResults } from '../results.js';

const SENTENCE_COUNT = 6;
const SILENCE_MS = 1500;
const INITIAL_GRACE_MS = 5000;
const MAX_LISTEN_MS = 15000;
const MIN_RATE = 0.5;
const MAX_RATE = 1.5;

const FALLBACK_ACCENTS = [
  { code: 'en-US', label: 'US', flag: '\u{1F1FA}\u{1F1F8}' },
  { code: 'en-GB', label: 'UK', flag: '\u{1F1EC}\u{1F1E7}' },
  { code: 'en-IN', label: 'India', flag: '\u{1F1EE}\u{1F1F3}' },
  { code: 'en-AU', label: 'Australia', flag: '\u{1F1E6}\u{1F1FA}' }
];

/** @type {HTMLElement|null} */
let rootEl = null;
/** @type {object} */
let params = {};
/** @type {string[]} */
let sentences = [];
/** @type {Array<null|{accuracy:number, matched:number, total:number, extra:number, tokens:Array, seconds:number, transcript:string}>} */
let scores = [];
let index = 0;
/** @type {'idle'|'playing'|'ready'|'listening'|'review'} */
let state = 'idle';
let level = 'intermediate';
let isCustom = false;
let mounted = false;
let mountToken = 0;

/** @type {{start:Function, stop:Function, abort:Function, onResult:Function, onEnd:Function, onError:Function, isListening:Function}|null} */
let recognizer = null;
let silenceTimer = 0;
let capTimer = 0;
let listenStart = 0;
let lastTranscript = '';
let stopRequested = false;

/** @type {Function|null} */
let unsubSettings = null;
/** @type {((e: KeyboardEvent) => void)|null} */
let keyHandler = null;

/** DOM refs for the active session. */
const dom = {
  card: null,
  progressText: null,
  progressBar: null,
  status: null,
  sentenceBox: null,
  wave: null,
  micBtn: null,
  micLabel: null,
  replayBtn: null,
  controls: null,
  rate: null,
  rateValue: null,
  accentGroup: null,
  voiceSelect: null
};

/* ------------------------------------------------------------------ */
/* Mount / unmount                                                     */
/* ------------------------------------------------------------------ */

/**
 * Mount the shadowing mode.
 * @param {HTMLElement} root empty <main id="app">
 * @param {object} p query params (strings): level, custom
 * @returns {Promise<void>}
 */
export async function mount(root, p) {
  unmount();
  mounted = true;
  const token = ++mountToken;
  rootEl = root;
  params = p || {};
  const settings = getSettings();
  level = params.level || settings.level || 'intermediate';
  isCustom = params.custom === '1' || params.custom === 'true';

  root.innerHTML = '';

  if (!isRecognitionSupported()) {
    renderUnsupported(root);
    return;
  }

  renderLoading(root);
  let list = [];
  try {
    list = await getSentences({ level, count: SENTENCE_COUNT, custom: isCustom });
  } catch (err) {
    console.warn('shadowing: getSentences failed', err);
    list = [];
  }
  if (!mounted || token !== mountToken) return;
  list = (list || []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, SENTENCE_COUNT);
  if (!list.length) {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'container shadowing-page' },
      h('div', { class: 'notice notice-warning' },
        h('p', {}, 'Could not load any sentences to practise. Please try again.'),
        h('div', { class: 'flex gap mt' },
          h('button', { class: 'btn btn-primary', onClick: () => mount(root, params) }, 'Retry'),
          h('button', { class: 'btn btn-ghost', onClick: goHome }, 'Home')
        )
      )
    ));
    return;
  }
  startSession(list);
}

/**
 * Unmount: abort recognizer, stop speech, clear timers and listeners.
 */
export function unmount() {
  mounted = false;
  mountToken++;
  clearTimers();
  if (recognizer) {
    try { recognizer.abort(); } catch (_) { /* ignore */ }
    recognizer = null;
  }
  try { stopSpeaking(); } catch (_) { /* ignore */ }
  if (unsubSettings) {
    try { unsubSettings(); } catch (_) { /* ignore */ }
    unsubSettings = null;
  }
  if (keyHandler) {
    document.removeEventListener('keydown', keyHandler);
    keyHandler = null;
  }
  state = 'idle';
  Object.keys(dom).forEach((k) => { dom[k] = null; });
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

/** Navigate home. */
function goHome() {
  location.hash = '#/';
}

/**
 * Human-friendly hint about speech-recognition support.
 * @returns {string}
 */
function getRecognitionHint() {
  return 'Your browser does not support speech recognition. Please use Chrome, Edge or Safari ' +
    'on a device with a microphone to practise Listen & Repeat.';
}

/**
 * Render the "recognition not supported" notice.
 * @param {HTMLElement} root
 */
function renderUnsupported(root) {
  root.appendChild(h('div', { class: 'container shadowing-page' },
    h('div', { class: 'notice notice-warning shadowing-unsupported' },
      h('h2', { class: 'page-title' }, 'Speech recognition unavailable'),
      h('p', {}, getRecognitionHint()),
      h('button', { class: 'btn btn-primary mt', onClick: goHome, html: icon('home') + ' Home' })
    )
  ));
}

/**
 * Render a loading spinner.
 * @param {HTMLElement} root
 */
function renderLoading(root) {
  root.innerHTML = '';
  root.appendChild(h('div', { class: 'container shadowing-page' },
    h('div', { class: 'card shadowing-card shadowing-loading' },
      h('div', { class: 'shadowing-spinner', 'aria-hidden': 'true' }),
      h('p', { class: 'text-muted' }, 'Loading sentences...')
    )
  ));
}

/**
 * Start a session with the given sentences.
 * @param {string[]} list
 */
function startSession(list) {
  sentences = list;
  scores = list.map(() => null);
  index = 0;
  state = 'idle';
  renderSession();
}

/** Build the main session UI. */
function renderSession() {
  if (!rootEl) return;
  rootEl.innerHTML = '';
  const settings = getSettings();

  dom.progressText = h('span', { class: 'shadowing-progress-text' }, `1 / ${sentences.length}`);
  dom.progressBar = h('div', { class: 'bar', style: { width: '0%' } });
  const progress = h('div', {
    class: 'progress', role: 'progressbar', 'aria-valuemin': '0',
    'aria-valuemax': String(sentences.length), 'aria-valuenow': '0'
  }, dom.progressBar);

  // Speed slider bound to settings.ttsRate
  dom.rateValue = h('span', { class: 'shadowing-rate-value text-muted' }, formatRate(settings.ttsRate));
  dom.rate = h('input', {
    type: 'range', class: 'range', id: 'shadowing-rate',
    min: String(MIN_RATE), max: String(MAX_RATE), step: '0.1',
    value: String(clampRate(settings.ttsRate)), 'aria-label': 'Speech speed',
    onInput: (e) => {
      const v = clampRate(parseFloat(e.target.value));
      dom.rateValue.textContent = formatRate(v);
      setSetting('ttsRate', v);
    }
  });

  // Accent chips + voice select (collapsible "Voice settings")
  dom.accentGroup = h('div', { class: 'chip-group shadowing-accents', role: 'group', 'aria-label': 'Accent' });
  renderAccentChips(settings.lang);
  dom.voiceSelect = h('select', {
    class: 'select shadowing-voice', 'aria-label': 'Voice',
    onChange: (e) => setSetting('ttsVoiceURI', e.target.value || '')
  });
  dom.voiceSelect.appendChild(h('option', { value: '' }, 'Auto (best for accent)'));
  rebuildVoiceSelect();

  const voiceDetails = h('details', { class: 'shadowing-voice-settings' },
    h('summary', { class: 'btn btn-ghost btn-sm', html: icon('settings') + ' Voice settings' }),
    h('div', { class: 'shadowing-voice-panel' },
      h('div', { class: 'shadowing-voice-row' },
        h('span', { class: 'text-muted shadowing-field-label' }, 'Accent'),
        dom.accentGroup
      ),
      h('div', { class: 'shadowing-voice-row' },
        h('label', { class: 'text-muted shadowing-field-label', for: 'shadowing-voice' }, 'Voice'),
        dom.voiceSelect
      )
    )
  );
  dom.voiceSelect.id = 'shadowing-voice';

  const header = h('div', { class: 'mode-header shadowing-header' },
    h('div', {},
      h('h1', { class: 'page-title' }, 'Listen & Repeat'),
      h('p', { class: 'page-subtitle' }, `Level: ${capitalize(level)}${isCustom ? ' · Custom text' : ''}`)
    ),
    h('div', { class: 'shadowing-toolbar flex gap' },
      h('div', { class: 'shadowing-speed flex gap-sm' },
        h('label', { class: 'text-muted shadowing-field-label', for: 'shadowing-rate' }, 'Speed'),
        dom.rate,
        dom.rateValue
      ),
      voiceDetails
    )
  );

  dom.status = h('p', { class: 'shadowing-status', 'aria-live': 'polite' }, 'Press Start to hear the first sentence.');
  dom.sentenceBox = h('div', { class: 'shadowing-sentence is-hidden', 'aria-live': 'polite' });
  dom.wave = h('div', { class: 'wave', 'aria-hidden': 'true' },
    h('span'), h('span'), h('span'), h('span'), h('span'));

  dom.micLabel = h('span', { class: 'shadowing-mic-label text-muted' }, 'Repeat');
  dom.micBtn = h('button', {
    class: 'shadowing-mic', type: 'button', 'aria-label': 'Start recording', disabled: 'true',
    onClick: onMicClick, html: icon('mic')
  });
  dom.replayBtn = h('button', {
    class: 'btn btn-ghost btn-sm shadowing-replay', type: 'button', 'aria-label': 'Replay sentence',
    title: 'Replay (Ctrl+Space)', disabled: 'true', onClick: () => replay(), html: icon('repeat') + ' Replay'
  });

  dom.controls = h('div', { class: 'shadowing-controls flex-center gap' });

  dom.card = h('div', { class: 'card shadowing-card', 'data-state': 'idle' },
    h('div', { class: 'flex-between shadowing-progress-row' },
      dom.progressText,
      h('span', { class: 'text-muted shadowing-hint' },
        h('span', { class: 'kbd' }, 'Enter'), ' next · ', h('span', { class: 'kbd' }, 'Ctrl+Space'), ' replay')
    ),
    progress,
    dom.status,
    dom.sentenceBox,
    dom.wave,
    h('div', { class: 'shadowing-mic-wrap flex-center' },
      dom.micBtn,
      dom.micLabel
    ),
    dom.controls
  );

  rootEl.appendChild(h('div', { class: 'container shadowing-page' }, header, dom.card));

  setControls([
    h('button', { class: 'btn btn-primary btn-lg', type: 'button', onClick: onStart, html: icon('play') + ' Start' })
  ]);

  if (unsubSettings) unsubSettings();
  unsubSettings = onSettingsChange((s, changed) => {
    if (!dom.card || !changed) return;
    if (changed.includes('ttsRate') && dom.rate) {
      dom.rate.value = String(clampRate(s.ttsRate));
      dom.rateValue.textContent = formatRate(s.ttsRate);
    }
    if (changed.includes('lang') && dom.accentGroup) {
      renderAccentChips(s.lang);
    }
    if (changed.includes('ttsVoiceURI') && dom.voiceSelect) {
      dom.voiceSelect.value = s.ttsVoiceURI || '';
    }
  });

  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = onKeyDown;
  document.addEventListener('keydown', keyHandler);

  setState('idle');
}

/**
 * Render the accent chip group for the given active language code.
 * @param {string} activeLang
 */
function renderAccentChips(activeLang) {
  if (!dom.accentGroup) return;
  const accents = Array.isArray(ACCENTS) && ACCENTS.length ? ACCENTS : FALLBACK_ACCENTS;
  dom.accentGroup.innerHTML = '';
  accents.forEach((a) => {
    const code = a.code || a.lang || '';
    const active = code === activeLang;
    dom.accentGroup.appendChild(h('button', {
      class: `chip${active ? ' active' : ''}`, type: 'button',
      'aria-pressed': active ? 'true' : 'false', title: a.label || code,
      onClick: () => onAccentPick(code)
    }, `${a.flag ? a.flag + ' ' : ''}${a.label || code}`));
  });
}

/**
 * Accent chip click: set settings.lang, reset voice to auto and rebuild the voice select.
 * The recognizer reads settings.lang on its next start, so it follows the new accent too.
 * @param {string} code e.g. 'en-IN'
 */
function onAccentPick(code) {
  if (!code) return;
  setSettings({ lang: code, ttsVoiceURI: '' });
  renderAccentChips(code);
  if (dom.voiceSelect) dom.voiceSelect.value = '';
  rebuildVoiceSelect();
}

/**
 * Populate the voice select with an <optgroup> per voice group.
 * @returns {Promise<void>}
 */
async function rebuildVoiceSelect() {
  const sel = dom.voiceSelect;
  if (!sel) return;
  const token = mountToken;
  let groups = [];
  try {
    groups = await getVoiceGroups();
  } catch (err) {
    console.warn('shadowing: getVoiceGroups failed', err);
  }
  if (token !== mountToken || dom.voiceSelect !== sel) return;
  const current = getSettings().ttsVoiceURI || '';
  sel.innerHTML = '';
  sel.appendChild(h('option', { value: '' }, 'Auto (best for accent)'));
  (groups || []).forEach((g) => {
    const voices = Array.isArray(g.voices) ? g.voices : [];
    if (!voices.length) return;
    const og = h('optgroup', { label: `${g.flag ? g.flag + ' ' : ''}${g.label || g.code || ''}`.trim() });
    voices.forEach((v) => {
      let name;
      try { name = voiceDisplayName(v); } catch (_) { name = v.name || v.voiceURI; }
      og.appendChild(h('option', { value: v.voiceURI }, name));
    });
    sel.appendChild(og);
  });
  sel.value = current;
  if (sel.value !== current) sel.value = '';
}

/**
 * Replace the control buttons row.
 * @param {HTMLElement[]} buttons
 */
function setControls(buttons) {
  if (!dom.controls) return;
  dom.controls.innerHTML = '';
  buttons.forEach((b) => dom.controls.appendChild(b));
}

/**
 * Set the state and update data-state + mic/replay button states.
 * @param {'idle'|'playing'|'ready'|'listening'|'review'} next
 */
function setState(next) {
  state = next;
  if (!dom.card) return;
  dom.card.dataset.state = next;
  const micEnabled = next === 'ready' || next === 'listening';
  dom.micBtn.disabled = !micEnabled;
  dom.micBtn.classList.toggle('is-listening', next === 'listening');
  dom.micBtn.setAttribute('aria-label', next === 'listening' ? 'Stop recording' : 'Start recording');
  dom.micBtn.innerHTML = icon(next === 'listening' ? 'mic-off' : 'mic');
  dom.micLabel.textContent = next === 'listening'
    ? 'Listening... click to stop'
    : (next === 'ready' ? 'Click to repeat' : 'Repeat');
  dom.wave.classList.toggle('is-active', next === 'playing');
  dom.replayBtn.disabled = next === 'idle';
}

/** Update the progress text and bar. */
function updateProgress() {
  if (!dom.progressText) return;
  const current = Math.min(index + 1, sentences.length);
  dom.progressText.textContent = `${current} / ${sentences.length}`;
  const done = scores.filter(Boolean).length;
  const pct = sentences.length ? Math.round((done / sentences.length) * 100) : 0;
  dom.progressBar.style.width = `${pct}%`;
  const pb = dom.progressBar.parentElement;
  if (pb) pb.setAttribute('aria-valuenow', String(done));
}

/**
 * Show the hidden-sentence placeholder (skeleton) or the revealed content.
 * @param {HTMLElement|null} content null = hidden placeholder
 */
function setSentenceContent(content) {
  if (!dom.sentenceBox) return;
  dom.sentenceBox.innerHTML = '';
  if (!content) {
    dom.sentenceBox.classList.add('is-hidden');
    const words = sentences[index] ? sentences[index].split(/\s+/).length : 6;
    const skeleton = h('div', { class: 'shadowing-skeleton', 'aria-label': 'Sentence hidden' });
    for (let i = 0; i < Math.min(words, 12); i++) {
      skeleton.appendChild(h('span', {
        class: 'shadowing-skeleton-word',
        style: { width: `${40 + ((i * 37) % 60)}px` }
      }));
    }
    dom.sentenceBox.appendChild(skeleton);
  } else {
    dom.sentenceBox.classList.remove('is-hidden');
    dom.sentenceBox.appendChild(content);
  }
}

/* ------------------------------------------------------------------ */
/* Flow                                                                */
/* ------------------------------------------------------------------ */

/** Start button handler. */
function onStart() {
  try { initAudio(); } catch (_) { /* ignore */ }
  index = 0;
  scores = sentences.map(() => null);
  updateProgress();
  playCurrent();
}

/**
 * Play the current sentence via TTS with the text hidden.
 * @returns {Promise<void>}
 */
async function playCurrent() {
  if (!mounted || !dom.card) return;
  const token = mountToken;
  const myIndex = index;
  setSentenceContent(null);
  setControls([dom.replayBtn]);
  setState('playing');
  dom.status.textContent = 'Listen carefully...';
  try {
    await speak(sentences[index], ttsOptions());
  } catch (err) {
    console.warn('shadowing: speak failed', err);
  }
  if (!mounted || token !== mountToken || myIndex !== index) return;
  if (state !== 'playing') return;
  setState('ready');
  dom.status.textContent = 'Now repeat it';
  dom.micBtn.focus();
}

/**
 * Replay the current sentence via TTS (allowed any time after Start, except while recording).
 * @returns {Promise<void>}
 */
async function replay() {
  if (!mounted || state === 'idle' || state === 'listening' || !sentences[index]) return;
  const token = mountToken;
  const myIndex = index;
  dom.wave.classList.add('is-active');
  try {
    await speak(sentences[index], ttsOptions());
  } catch (_) { /* ignore */ }
  if (!mounted || token !== mountToken || myIndex !== index || !dom.wave) return;
  if (state !== 'playing') dom.wave.classList.remove('is-active');
}

/**
 * TTS options from current settings.
 * @returns {{rate:number, lang:string, voiceURI?:string}}
 */
function ttsOptions() {
  const s = getSettings();
  const opts = { rate: clampRate(s.ttsRate), lang: s.lang };
  if (s.ttsVoiceURI) opts.voiceURI = s.ttsVoiceURI;
  return opts;
}

/** Mic button click: start or stop listening. */
function onMicClick() {
  if (state === 'ready') {
    startListening();
  } else if (state === 'listening') {
    stopListening();
  }
}

/** Start the recognizer for the current sentence. */
function startListening() {
  if (!mounted) return;
  try { initAudio(); } catch (_) { /* ignore */ }
  try { stopSpeaking(); } catch (_) { /* ignore */ }
  if (dom.wave) dom.wave.classList.remove('is-active');
  if (recognizer) {
    try { recognizer.abort(); } catch (_) { /* ignore */ }
    recognizer = null;
  }
  clearTimers();
  lastTranscript = '';
  stopRequested = false;
  const myIndex = index;
  const token = mountToken;
  let finished = false;

  let rec;
  try {
    rec = createRecognizer({ lang: getSettings().lang, interim: true, continuous: false });
  } catch (err) {
    console.warn('shadowing: createRecognizer failed', err);
    toast('Could not start the microphone.', { type: 'error' });
    return;
  }
  recognizer = rec;

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimers();
    if (recognizer === rec) recognizer = null;
    try { rec.abort(); } catch (_) { /* ignore */ }
    if (!mounted || token !== mountToken || myIndex !== index) return;
    const seconds = Math.max(1, (Date.now() - listenStart) / 1000);
    review(lastTranscript, seconds);
  };

  rec.onResult(({ finalTranscript, interimTranscript }) => {
    if (finished) return;
    const combined = `${finalTranscript || ''} ${interimTranscript || ''}`.replace(/\s+/g, ' ').trim();
    if (combined) lastTranscript = combined;
    if (dom.status) dom.status.textContent = combined ? `Heard: "${combined}"` : 'Listening...';
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(finish, SILENCE_MS);
  });

  rec.onEnd(() => {
    if (finished) return;
    if (stopRequested || lastTranscript) {
      finish();
    } else if (state === 'listening' && !silenceTimer) {
      silenceTimer = setTimeout(finish, SILENCE_MS);
    }
  });

  rec.onError((code) => {
    if (finished) return;
    if (code === 'no-speech' || code === 'aborted') return; // timers decide
    finished = true;
    clearTimers();
    if (recognizer === rec) recognizer = null;
    try { rec.abort(); } catch (_) { /* ignore */ }
    if (!mounted || token !== mountToken) return;
    handleMicError(code);
    setState('ready');
    dom.status.textContent = 'Now repeat it';
  });

  listenStart = Date.now();
  setState('listening');
  dom.status.textContent = 'Listening...';
  try {
    rec.start();
  } catch (err) {
    console.warn('shadowing: recognizer.start failed', err);
    finished = true;
    recognizer = null;
    toast('Could not start the microphone.', { type: 'error' });
    setState('ready');
    return;
  }
  // Initial grace before any speech, then 1.5s silence after each result; hard cap 15s.
  silenceTimer = setTimeout(finish, INITIAL_GRACE_MS);
  capTimer = setTimeout(finish, MAX_LISTEN_MS);
}

/** Stop listening (user clicked the mic again). */
function stopListening() {
  if (state !== 'listening' || !recognizer) return;
  stopRequested = true;
  clearTimers();
  const rec = recognizer;
  // Give the recognizer a brief moment to flush a final result; onEnd will finish, else we do.
  silenceTimer = setTimeout(() => {
    if (recognizer === rec && state === 'listening') {
      try { rec.abort(); } catch (_) { /* ignore */ }
      recognizer = null;
      const seconds = Math.max(1, (Date.now() - listenStart) / 1000);
      review(lastTranscript, seconds);
    }
  }, 500);
  try { rec.stop(); } catch (_) { /* ignore */ }
}

/**
 * Map recognizer error codes to toasts.
 * @param {string} code
 */
function handleMicError(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      toast('Microphone access is blocked. Allow the microphone in your browser settings and try again.',
        { type: 'error', duration: 5000 });
      break;
    case 'audio-capture':
      toast('No microphone was found. Please connect one and try again.', { type: 'error', duration: 5000 });
      break;
    case 'network':
      toast('Speech recognition needs a network connection.', { type: 'warning' });
      break;
    case 'language-not-supported':
      toast('This accent is not supported for speech recognition. Try another one.', { type: 'warning' });
      break;
    default:
      toast(`Speech recognition error: ${code || 'unknown'}`, { type: 'error' });
  }
}

/**
 * Compare transcript to the expected sentence and show the review state.
 * @param {string} transcript
 * @param {number} seconds listening duration (>= 1)
 */
function review(transcript, seconds) {
  if (!mounted || !dom.card) return;
  const expected = sentences[index];
  let cmp;
  try {
    cmp = compareWords(expected, transcript || '');
  } catch (err) {
    console.warn('shadowing: compareWords failed', err);
    cmp = { accuracy: 0, matched: 0, total: expected.split(/\s+/).filter(Boolean).length, extra: 0, tokens: [] };
  }
  scores[index] = {
    accuracy: Number(cmp.accuracy) || 0,
    matched: cmp.matched || 0,
    total: cmp.total || 0,
    extra: cmp.extra || 0,
    tokens: cmp.tokens || [],
    seconds,
    transcript: transcript || ''
  };
  updateProgress();
  setState('review');

  const isLast = index >= sentences.length - 1;
  dom.status.textContent = cmp.total > 0 && cmp.matched === cmp.total
    ? 'Perfect!'
    : (transcript ? 'Here is how you did' : 'We did not hear anything. Try again or move on.');

  setSentenceContent(h('div', { class: 'shadowing-review' },
    renderDiff(cmp.tokens, expected),
    h('div', { class: 'flex gap-sm shadowing-review-meta' },
      accuracyBadge(cmp.accuracy),
      h('span', { class: 'text-muted' }, `${cmp.matched} / ${cmp.total} words`),
      transcript ? h('span', { class: 'text-muted shadowing-heard' }, `You said: "${transcript}"`) : null
    )
  ));

  setControls([
    dom.replayBtn,
    h('button', { class: 'btn btn-outline', type: 'button', onClick: tryAgain, html: icon('refresh') + ' Try again' }),
    h('button', {
      class: 'btn btn-primary', type: 'button', onClick: next,
      html: isLast ? icon('check') + ' Finish' : 'Next ' + icon('arrow-right')
    })
  ]);
  const nextBtn = dom.controls.lastElementChild;
  if (nextBtn) nextBtn.focus();
}

/** Re-record the current sentence (replaces its score). */
function tryAgain() {
  if (state !== 'review') return;
  scores[index] = null;
  updateProgress();
  setSentenceContent(null);
  setControls([dom.replayBtn]);
  setState('ready');
  dom.status.textContent = 'Now repeat it';
  dom.micBtn.focus();
}

/** Advance to the next sentence or finish. */
function next() {
  if (state !== 'review') return;
  if (index >= sentences.length - 1) {
    finishSession();
    return;
  }
  index++;
  updateProgress();
  playCurrent();
}

/**
 * Keyboard shortcuts: Enter -> Next (review) / Start (idle), Ctrl+Space -> Replay.
 * @param {KeyboardEvent} e
 */
function onKeyDown(e) {
  if (!mounted || !dom.card) return;
  if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
    e.preventDefault();
    replay();
    return;
  }
  const target = e.target;
  const tag = target && target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable)) return;
  if (tag === 'INPUT' && target.type !== 'range') return;
  if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
    if (state === 'review') {
      e.preventDefault();
      next();
    } else if (state === 'idle') {
      e.preventDefault();
      onStart();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Finish / results                                                    */
/* ------------------------------------------------------------------ */

/** Aggregate scores and show the results screen. */
async function finishSession() {
  if (!mounted || !rootEl) return;
  clearTimers();
  if (recognizer) {
    try { recognizer.abort(); } catch (_) { /* ignore */ }
    recognizer = null;
  }
  try { stopSpeaking(); } catch (_) { /* ignore */ }
  if (keyHandler) {
    document.removeEventListener('keydown', keyHandler);
    keyHandler = null;
  }
  if (unsubSettings) {
    unsubSettings();
    unsubSettings = null;
  }
  state = 'idle';

  let total = 0;
  let matched = 0;
  let extras = 0;
  let speakingSeconds = 0;
  sentences.forEach((s, i) => {
    const sc = scores[i];
    if (sc) {
      total += sc.total;
      matched += sc.matched;
      extras += sc.extra || 0;
      speakingSeconds += sc.seconds;
    } else {
      total += s.split(/\s+/).filter(Boolean).length;
    }
  });
  speakingSeconds = Math.max(1, Math.round(speakingSeconds));
  const wpm = Math.round(matched / (speakingSeconds / 60));
  const accuracy = total > 0 ? Math.round((matched / total) * 1000) / 10 : 0;
  const joined = sentences.join(' ');

  const result = {
    mode: 'shadowing',
    level,
    kind: isCustom ? 'custom' : 'sentences',
    wpm,
    rawWpm: wpm,
    accuracy,
    durationSec: speakingSeconds,
    chars: total * 5,
    correctChars: matched * 5,
    errors: Math.max(0, total - matched) + extras,
    words: matched,
    keyErrors: {},
    timestamp: Date.now(),
    source: 'mixed',
    text: joined.length > 500 ? joined.slice(0, 500) : joined
  };

  const extraContent = h('div', { class: 'shadowing-results' },
    h('h3', { class: 'shadowing-results-title' }, 'Sentence by sentence'),
    h('ol', { class: 'shadowing-sentence-list' },
      ...sentences.map((s, i) => {
        const sc = scores[i];
        return h('li', { class: 'shadowing-sentence-item' },
          h('div', { class: 'shadowing-sentence-diff' },
            sc ? renderDiff(sc.tokens, s) : h('span', { class: 'text-muted' }, s)
          ),
          h('div', { class: 'shadowing-sentence-meta flex gap-sm' },
            sc ? accuracyBadge(sc.accuracy) : h('span', { class: 'badge' }, 'Skipped'),
            sc ? h('span', { class: 'text-muted' }, `${sc.matched} / ${sc.total} words`) : null
          )
        );
      })
    )
  );

  const sameSentences = sentences.slice();
  const root = rootEl;
  const retryParams = params;
  try {
    await showResults(root, result, {
      onRetry: () => {
        unmount();
        mounted = true;
        mountToken++;
        rootEl = root;
        params = retryParams;
        startSession(sameSentences);
      },
      onNext: () => {
        mount(root, retryParams);
      },
      extraContent
    });
  } catch (err) {
    console.error('shadowing: showResults failed', err);
    toast('Could not show results.', { type: 'error' });
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Render a word diff from compareWords tokens.
 * @param {Array<{word:string,status:string,heard?:string}>} tokens
 * @param {string} fallbackText used when tokens are empty
 * @returns {HTMLElement}
 */
function renderDiff(tokens, fallbackText) {
  const wrap = h('p', { class: 'shadowing-diff' });
  if (!tokens || !tokens.length) {
    wrap.textContent = fallbackText;
    return wrap;
  }
  tokens.forEach((t, i) => {
    const cls = t.status === 'ok' ? 'w-ok' : (t.status === 'missed' ? 'w-missed' : 'w-wrong');
    const span = h('span', { class: `w ${cls}` }, t.word);
    if (t.status === 'wrong' && t.heard) {
      span.appendChild(h('small', { class: 'w-heard' }, `heard: ${t.heard}`));
      span.title = `heard: ${t.heard}`;
    } else if (t.status === 'missed') {
      span.title = 'missed';
    }
    wrap.appendChild(span);
    if (i < tokens.length - 1) wrap.appendChild(document.createTextNode(' '));
  });
  return wrap;
}

/**
 * Badge element for an accuracy value.
 * @param {number} acc 0..100
 * @returns {HTMLElement}
 */
function accuracyBadge(acc) {
  const v = Number.isFinite(Number(acc)) ? Number(acc) : 0;
  const variant = v >= 90 ? 'badge-success' : (v >= 70 ? 'badge-warning' : 'badge-error');
  return h('span', { class: `badge ${variant}` }, `${v.toFixed(1)}%`);
}

/** Clear silence and cap timers. */
function clearTimers() {
  clearTimeout(silenceTimer);
  clearTimeout(capTimer);
  silenceTimer = 0;
  capTimer = 0;
}

/**
 * Clamp a TTS rate into range.
 * @param {number} r
 * @returns {number}
 */
function clampRate(r) {
  const n = Number(r);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(n * 10) / 10));
}

/**
 * Format a rate for display.
 * @param {number} r
 * @returns {string}
 */
function formatRate(r) {
  return `${clampRate(r).toFixed(1)}x`;
}

/**
 * Capitalise the first letter.
 * @param {string} s
 * @returns {string}
 */
function capitalize(s) {
  s = String(s || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
