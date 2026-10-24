/**
 * TypeTalk - "Read Aloud" speaking mode.
 *
 * The user reads a passage out loud; the Web Speech API transcribes it and the
 * result is scored with an LCS word diff (speech.compareWords). Words are
 * highlighted live while speaking, and a word-by-word diff is attached to the
 * shared results screen.
 *
 * @module modes/speaking
 */

import { h, toast, icon, formatDuration } from '../ui.js';
import { getSettings, setSetting } from '../settings.js';
import { getText, LEVELS } from '../textProvider.js';
import {
  ACCENTS,
  isRecognitionSupported,
  isTtsSupported,
  speak,
  stopSpeaking,
  createRecognizer,
  compareWords
} from '../speech.js';
import { showResults } from '../results.js';

const MAX_CHARS = 350;
const HIGHLIGHT_DEBOUNCE_MS = 150;
const FALLBACK_HINT =
  'Speech recognition is not available in this browser. Please use Chrome, Edge or Safari to practise reading aloud.';

const STATUS = {
  idle: 'Click the mic and start reading',
  listening: 'Listening...',
  processing: 'Processing...',
  paused: 'Paused. Click the mic to continue or press Finish'
};

const MIC_BLOCKED = "Microphone access was blocked. Allow the mic in your browser's site settings.";
const ERROR_MESSAGES = {
  'not-allowed': MIC_BLOCKED,
  'service-not-allowed': MIC_BLOCKED,
  network: 'Speech service unavailable, check your connection',
  'audio-capture': 'No microphone found'
};

/** @type {object|null} Mutable per-mount state. */
let state = null;

/**
 * Create a fresh state object for a mount.
 * @param {HTMLElement} root
 * @param {object} params
 * @returns {object}
 */
function createState(root, params) {
  const settings = getSettings();
  const custom = params.custom === '1' || params.custom === 'true';
  return {
    root,
    params,
    custom,
    level: LEVELS.includes(params.level) ? params.level : settings.level,
    kind: custom ? 'custom' : (params.kind || settings.kind),
    passage: null,            // { text, source }
    recognizer: null,
    listening: false,
    stopping: false,
    spoke: false,             // true once any transcript has been received
    finalTranscript: '',
    interimTranscript: '',
    listenStart: 0,           // timestamp of the current listening interval
    accumulatedMs: 0,         // listening time from completed intervals
    timerId: 0,
    highlightId: 0,
    speaking: false,          // TTS playing
    els: {}
  };
}

/* ------------------------------------------------------------------------ */
/* Lifecycle                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Mount the Read Aloud mode.
 * @param {HTMLElement} root empty <main id="app">
 * @param {object} params query params: level, kind, custom
 * @returns {Promise<void>}
 */
export async function mount(root, params = {}) {
  unmount();
  state = createState(root, params);
  await loadPassage();
}

/**
 * Unmount: abort recognition, stop TTS, clear timers.
 */
export function unmount() {
  if (!state) return;
  const s = state;
  state = null;
  if (s.recognizer) {
    try { s.recognizer.abort(); } catch (e) { /* ignore */ }
  }
  try { stopSpeaking(); } catch (e) { /* ignore */ }
  clearInterval(s.timerId);
  clearTimeout(s.highlightId);
}

/**
 * True when the given state is still the active mount (guards async work).
 * @param {object} s
 * @returns {boolean}
 */
function isActive(s) {
  return state === s;
}

/* ------------------------------------------------------------------------ */
/* Passage loading                                                          */
/* ------------------------------------------------------------------------ */

/**
 * Fetch a passage with a spinner, then render the screen.
 * @returns {Promise<void>}
 */
async function loadPassage() {
  const s = state;
  if (!s) return;
  resetSession(s);
  s.root.innerHTML = '';
  s.root.appendChild(
    h('div', { class: 'container speak-page' },
      renderHeader(s),
      h('div', { class: 'card speak-card speak-loading' },
        h('div', { class: 'speak-spinner', 'aria-hidden': 'true' }),
        h('p', { class: 'text-muted' }, 'Loading passage...'))));

  let passage;
  try {
    passage = await getText({
      level: s.level,
      kind: s.custom ? getSettings().kind : s.kind,
      maxChars: MAX_CHARS,
      custom: s.custom
    });
  } catch (e) {
    passage = { text: 'The quick brown fox jumps over the lazy dog.', source: 'local' };
  }
  if (!isActive(s)) return;
  s.passage = { text: String(passage.text || '').trim(), source: passage.source || 'local' };
  renderScreen(s);
}

/**
 * Clear per-attempt state (keeps passage, level, kind).
 * @param {object} s
 */
function resetSession(s) {
  if (s.recognizer) {
    try { s.recognizer.abort(); } catch (e) { /* ignore */ }
    s.recognizer = null;
  }
  try { stopSpeaking(); } catch (e) { /* ignore */ }
  clearInterval(s.timerId);
  clearTimeout(s.highlightId);
  s.timerId = 0;
  s.highlightId = 0;
  s.listening = false;
  s.stopping = false;
  s.spoke = false;
  s.speaking = false;
  s.finalTranscript = '';
  s.interimTranscript = '';
  s.listenStart = 0;
  s.accumulatedMs = 0;
  s.els = {};
}

/* ------------------------------------------------------------------------ */
/* Rendering                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Build the mode header (title, level chips, New text).
 * @param {object} s
 * @returns {HTMLElement}
 */
function renderHeader(s) {
  const chips = h('div', { class: 'chip-group', role: 'group', 'aria-label': 'Level' },
    LEVELS.map((lvl) => h('button', {
      class: 'chip' + (lvl === s.level ? ' active' : ''),
      type: 'button',
      'aria-pressed': lvl === s.level ? 'true' : 'false',
      onClick: () => {
        if (!isActive(s) || s.level === lvl) return;
        s.level = lvl;
        setSetting('level', lvl);
        loadPassage();
      }
    }, capitalize(lvl))));

  return h('div', { class: 'mode-header speak-header' },
    h('div', { class: 'speak-title-wrap' },
      h('h1', { class: 'page-title speak-title' },
        h('span', { class: 'speak-title-icon', html: icon('mic'), 'aria-hidden': 'true' }),
        'Read Aloud'),
      h('p', { class: 'page-subtitle' }, 'Read the passage out loud and let your browser check your words.')),
    h('div', { class: 'flex gap speak-controls' },
      chips,
      h('button', {
        class: 'btn btn-outline',
        type: 'button',
        onClick: () => { if (isActive(s)) loadPassage(); }
      }, h('span', { html: icon('refresh'), 'aria-hidden': 'true' }), 'New text')));
}

/**
 * Compact accent picker bound to settings.lang.
 * @param {object} s
 * @returns {HTMLElement}
 */
function renderAccentChips(s) {
  const accents = Array.isArray(ACCENTS) ? ACCENTS : [];
  const current = getSettings().lang;
  const group = h('div', { class: 'chip-group speak-accents', role: 'group', 'aria-label': 'Accent' },
    accents.map((a) => h('button', {
      class: 'chip chip-sm speak-accent' + (a.code === current ? ' active' : ''),
      type: 'button',
      dataset: { code: a.code },
      'aria-pressed': a.code === current ? 'true' : 'false',
      'aria-label': 'Accent: ' + a.label,
      onClick: () => changeAccent(s, a.code)
    }, h('span', { class: 'speak-accent-flag', 'aria-hidden': 'true' }, a.flag || ''), ' ', a.label)));
  s.els.accents = group;
  return group;
}

/**
 * Switch recognition / TTS language; recreate recognizer on next start.
 * @param {object} s
 * @param {string} code BCP-47 lang code e.g. 'en-IN'
 */
function changeAccent(s, code) {
  if (!isActive(s) || getSettings().lang === code) return;
  setSetting('lang', code);
  setSetting('ttsVoiceURI', '');
  if (s.speaking) stopSpeaking();

  const wasListening = s.listening || s.stopping;
  if (s.recognizer) {
    try { s.recognizer.abort(); } catch (e) { /* ignore */ }
    s.recognizer = null;
  }
  if (wasListening) {
    stopTimer(s);
    s.listening = false;
    s.stopping = false;
    setMicState(s, false);
    setStatus(s, s.spoke ? STATUS.paused : STATUS.idle);
    toast('Accent changed, click the mic to continue', { type: 'info', icon: icon('mic') });
  }
  if (s.els.accents) {
    s.els.accents.querySelectorAll('.speak-accent').forEach((el) => {
      const active = el.dataset.code === code;
      el.classList.toggle('active', active);
      el.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }
}

/**
 * Render the full practice screen (supported or not).
 * @param {object} s
 */
function renderScreen(s) {
  const supported = isRecognitionSupported();
  const page = h('div', { class: 'container speak-page' }, renderHeader(s));

  if (!supported) {
    page.appendChild(renderUnsupportedNotice(s));
  }

  // Passage: one span.sw per word so matched words can be highlighted live.
  const words = s.passage.text.split(/\s+/).filter(Boolean);
  const passageEl = h('p', { class: 'speak-passage', lang: 'en', 'aria-label': 'Passage to read' },
    words.map((w, i) => [i > 0 ? ' ' : null, h('span', { class: 'sw', dataset: { i: String(i) } }, w)]));
  s.els.words = Array.from(passageEl.querySelectorAll('.sw'));

  const listenBtn = h('button', {
    class: 'btn btn-outline speak-listen',
    type: 'button',
    'aria-label': 'Listen to the passage',
    onClick: () => toggleListen(s)
  },
  h('span', { class: 'speak-listen-icon', html: icon('headphones'), 'aria-hidden': 'true' }),
  h('span', { class: 'speak-listen-label' }, 'Listen'));
  if (!isTtsSupported()) listenBtn.disabled = true;
  s.els.listenBtn = listenBtn;

  const card = h('div', { class: 'card speak-card' },
    h('div', { class: 'flex-between speak-card-top' },
      h('span', { class: 'text-muted speak-source' }, 'Source: ' + capitalize(s.passage.source)),
      listenBtn),
    passageEl);

  if (supported) {
    const micBtn = h('button', {
      class: 'mic-btn',
      type: 'button',
      'aria-label': 'Start listening',
      'aria-pressed': 'false',
      onClick: () => toggleMic(s)
    }, h('span', { class: 'mic-btn-icon', html: icon('mic'), 'aria-hidden': 'true' }));
    s.els.micBtn = micBtn;

    const status = h('p', { class: 'speak-status', role: 'status', 'aria-live': 'polite' }, STATUS.idle);
    s.els.status = status;

    const timer = h('span', { class: 'stat-pill speak-timer' },
      h('span', { class: 'speak-timer-icon', html: icon('clock'), 'aria-hidden': 'true' }),
      h('span', { class: 'value' }, '0:00'),
      h('span', { class: 'label' }, 'time'));
    s.els.timerValue = timer.querySelector('.value');

    const finishBtn = h('button', {
      class: 'btn btn-primary btn-lg speak-finish',
      type: 'button',
      onClick: () => finish(s)
    }, h('span', { html: icon('check'), 'aria-hidden': 'true' }), 'Finish');
    finishBtn.disabled = true;
    s.els.finishBtn = finishBtn;

    const transcript = h('div', { class: 'transcript', 'aria-live': 'polite', 'aria-label': 'Live transcript' },
      h('span', { class: 'transcript-placeholder text-muted' }, 'Your words will appear here...'));
    s.els.transcript = transcript;

    card.appendChild(renderAccentChips(s));
    card.appendChild(
      h('div', { class: 'speak-controls-row' },
        h('div', { class: 'speak-mic-wrap' }, micBtn, status),
        h('div', { class: 'flex gap speak-actions' }, timer, finishBtn)));
    card.appendChild(transcript);
  }

  page.appendChild(card);
  s.root.innerHTML = '';
  s.root.appendChild(page);
  if (!supported) {
    fillRecognitionHint(s);
  }
}

/**
 * Notice shown when SpeechRecognition is not available.
 * @param {object} s
 * @returns {HTMLElement}
 */
function renderUnsupportedNotice(s) {
  const text = h('p', { class: 'speak-hint-text' }, FALLBACK_HINT);
  s.els.hintText = text;
  return h('div', { class: 'notice notice-warning speak-notice', role: 'alert' },
    h('div', { class: 'speak-notice-body' },
      h('strong', {}, 'Speech recognition not supported'),
      text,
      h('p', { class: 'text-muted' }, 'You can still press Listen to hear the passage read aloud.')),
    h('button', {
      class: 'btn btn-primary',
      type: 'button',
      onClick: () => { location.hash = '#/'; }
    }, h('span', { html: icon('home'), 'aria-hidden': 'true' }), 'Home'));
}

/**
 * Use speech.getRecognitionHint() for the notice text when that export exists.
 * A guarded dynamic import keeps this module loadable if it does not.
 * @param {object} s
 */
async function fillRecognitionHint(s) {
  try {
    const mod = await import('../speech.js');
    if (isActive(s) && typeof mod.getRecognitionHint === 'function' && s.els.hintText) {
      const hint = mod.getRecognitionHint();
      if (hint) s.els.hintText.textContent = String(hint);
    }
  } catch (e) {
    /* keep fallback text */
  }
}

/* ------------------------------------------------------------------------ */
/* TTS "Listen"                                                             */
/* ------------------------------------------------------------------------ */

/**
 * Toggle reading the passage aloud via TTS (speech.speak defaults).
 * @param {object} s
 */
function toggleListen(s) {
  if (!isActive(s) || !s.passage) return;
  if (s.speaking) {
    stopSpeaking(); // speak() resolves on cancel -> button resets below
    return;
  }
  if (s.listening) {
    pauseListening(s);
  }
  s.speaking = true;
  setListenButton(s, true);
  Promise.resolve()
    .then(() => speak(s.passage.text))
    .catch(() => {})
    .then(() => {
      if (!isActive(s)) return;
      s.speaking = false;
      setListenButton(s, false);
    });
}

/**
 * Update Listen button appearance.
 * @param {object} s
 * @param {boolean} playing
 */
function setListenButton(s, playing) {
  const btn = s.els.listenBtn;
  if (!btn) return;
  btn.classList.toggle('is-playing', playing);
  btn.setAttribute('aria-label', playing ? 'Stop listening to the passage' : 'Listen to the passage');
  const ic = btn.querySelector('.speak-listen-icon');
  const label = btn.querySelector('.speak-listen-label');
  if (ic) ic.innerHTML = icon(playing ? 'stop' : 'headphones');
  if (label) label.textContent = playing ? 'Stop' : 'Listen';
}

/* ------------------------------------------------------------------------ */
/* Recognition                                                              */
/* ------------------------------------------------------------------------ */

/**
 * Lazily create the recognizer for this session using the current accent.
 * @param {object} s
 * @returns {object}
 */
function ensureRecognizer(s) {
  if (s.recognizer) return s.recognizer;
  const rec = createRecognizer({ lang: getSettings().lang, interim: true, continuous: true });

  rec.onResult(({ finalTranscript, interimTranscript }) => {
    if (!isActive(s) || s.recognizer !== rec) return;
    s.finalTranscript = finalTranscript || '';
    s.interimTranscript = interimTranscript || '';
    if (s.finalTranscript.trim() || s.interimTranscript.trim()) {
      s.spoke = true;
      if (s.els.finishBtn) s.els.finishBtn.disabled = false;
    }
    renderTranscript(s);
    scheduleHighlight(s);
  });

  rec.onEnd(() => {
    if (!isActive(s) || s.recognizer !== rec) return;
    // Only react to ends we asked for; the recognizer auto-restarts otherwise.
    if (s.stopping || s.listening) {
      s.stopping = false;
      stopTimer(s);
      s.listening = false;
      setMicState(s, false);
      setStatus(s, s.spoke ? STATUS.paused : STATUS.idle);
    }
  });

  rec.onError((code) => {
    if (!isActive(s) || s.recognizer !== rec) return;
    if (code === 'aborted' || code === 'no-speech') return;
    const msg = ERROR_MESSAGES[code];
    if (msg) {
      toast(msg, { type: 'error', icon: icon('mic-off'), duration: 5000 });
    } else {
      toast('Speech recognition error: ' + code, { type: 'error', duration: 4000 });
    }
    try { rec.abort(); } catch (e) { /* ignore */ }
    stopTimer(s);
    s.listening = false;
    s.stopping = false;
    setMicState(s, false);
    setStatus(s, s.spoke ? STATUS.paused : STATUS.idle);
  });

  s.recognizer = rec;
  return rec;
}

/**
 * Mic button handler: start or pause listening.
 * @param {object} s
 */
function toggleMic(s) {
  if (!isActive(s)) return;
  if (s.listening) {
    pauseListening(s);
    return;
  }
  if (s.speaking) stopSpeaking();
  const rec = ensureRecognizer(s);
  try {
    rec.start();
  } catch (e) {
    toast('Could not start the microphone. Try again.', { type: 'error' });
    return;
  }
  s.listening = true;
  s.stopping = false;
  startTimer(s);
  setMicState(s, true);
  setStatus(s, STATUS.listening);
}

/**
 * Pause recognition without finishing.
 * @param {object} s
 */
function pauseListening(s) {
  if (!s.listening || !s.recognizer) return;
  s.stopping = true;
  setStatus(s, STATUS.processing);
  try { s.recognizer.stop(); } catch (e) { /* ignore */ }
  // Pause the clock immediately; onEnd finalises the status text.
  stopTimer(s);
  s.listening = false;
  setMicState(s, false);
}

/**
 * Toggle visual state of the mic button.
 * @param {object} s
 * @param {boolean} on
 */
function setMicState(s, on) {
  const btn = s.els.micBtn;
  if (!btn) return;
  btn.classList.toggle('is-listening', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.setAttribute('aria-label', on ? 'Pause listening' : (s.spoke ? 'Resume listening' : 'Start listening'));
  const ic = btn.querySelector('.mic-btn-icon');
  if (ic) ic.innerHTML = icon(on ? 'pause' : 'mic');
}

/**
 * Set the status line text.
 * @param {object} s
 * @param {string} text
 */
function setStatus(s, text) {
  if (s.els.status) s.els.status.textContent = text;
}

/**
 * Render final + interim transcript.
 * @param {object} s
 */
function renderTranscript(s) {
  const box = s.els.transcript;
  if (!box) return;
  box.innerHTML = '';
  const fin = s.finalTranscript.trim();
  const inter = s.interimTranscript.trim();
  if (!fin && !inter) {
    box.appendChild(h('span', { class: 'transcript-placeholder text-muted' }, 'Your words will appear here...'));
    return;
  }
  if (fin) box.appendChild(h('span', { class: 'transcript-final' }, fin));
  if (inter) box.appendChild(h('span', { class: 'transcript-interim' }, (fin ? ' ' : '') + inter));
  box.scrollTop = box.scrollHeight;
}

/**
 * Debounced live highlight of recognised words.
 * @param {object} s
 */
function scheduleHighlight(s) {
  clearTimeout(s.highlightId);
  s.highlightId = setTimeout(() => {
    if (!isActive(s)) return;
    highlightWords(s);
  }, HIGHLIGHT_DEBOUNCE_MS);
}

/**
 * Mark matched passage words with .sw-ok via compareWords.
 * @param {object} s
 */
function highlightWords(s) {
  if (!s.passage || !s.els.words) return;
  const spoken = (s.finalTranscript + ' ' + s.interimTranscript).trim();
  if (!spoken) {
    s.els.words.forEach((el) => el.classList.remove('sw-ok'));
    return;
  }
  let cmp;
  try {
    cmp = compareWords(s.passage.text, spoken);
  } catch (e) {
    return;
  }
  const tokens = cmp && Array.isArray(cmp.tokens) ? cmp.tokens : [];
  s.els.words.forEach((el, i) => {
    const t = tokens[i];
    el.classList.toggle('sw-ok', !!t && t.status === 'ok');
  });
}

/* ------------------------------------------------------------------------ */
/* Timer                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Start (or resume) the listening clock.
 * @param {object} s
 */
function startTimer(s) {
  if (s.timerId) return;
  s.listenStart = Date.now();
  updateTimer(s);
  s.timerId = setInterval(() => updateTimer(s), 250);
}

/**
 * Pause the clock, folding the current interval into the total.
 * @param {object} s
 */
function stopTimer(s) {
  if (s.timerId) {
    clearInterval(s.timerId);
    s.timerId = 0;
  }
  if (s.listenStart) {
    s.accumulatedMs += Date.now() - s.listenStart;
    s.listenStart = 0;
  }
  updateTimer(s);
}

/**
 * Total listening time in ms (completed intervals + the running one).
 * @param {object} s
 * @returns {number}
 */
function elapsedMs(s) {
  return s.accumulatedMs + (s.listenStart ? Date.now() - s.listenStart : 0);
}

/**
 * Refresh the timer pill.
 * @param {object} s
 */
function updateTimer(s) {
  if (s.els.timerValue) {
    s.els.timerValue.textContent = formatDuration(Math.floor(elapsedMs(s) / 1000));
  }
}

/* ------------------------------------------------------------------------ */
/* Finish & results                                                         */
/* ------------------------------------------------------------------------ */

/**
 * Score the attempt and show the shared results screen.
 * @param {object} s
 * @returns {Promise<void>}
 */
async function finish(s) {
  if (!isActive(s) || !s.passage) return;
  const spoken = (s.finalTranscript + ' ' + s.interimTranscript).trim();
  if (!s.spoke || !spoken) {
    toast('Read the passage aloud first, then press Finish.', { type: 'warning', icon: icon('mic') });
    return;
  }

  // Stop everything.
  stopTimer(s);
  s.listening = false;
  s.stopping = false;
  if (s.recognizer) {
    try { s.recognizer.abort(); } catch (e) { /* ignore */ }
    s.recognizer = null;
  }
  try { stopSpeaking(); } catch (e) { /* ignore */ }
  s.speaking = false;
  clearTimeout(s.highlightId);

  const cmp = compareWords(s.passage.text, spoken);
  const seconds = Math.max(1, Math.round(elapsedMs(s) / 1000));
  const wpm = Math.round(cmp.matched / (seconds / 60));
  const passageText = s.passage.text;
  const source = s.passage.source;

  const result = {
    mode: 'speaking',
    level: s.level,
    kind: s.kind,
    wpm,
    rawWpm: wpm,
    accuracy: cmp.accuracy,
    durationSec: seconds,
    chars: cmp.total * 5,
    correctChars: cmp.matched * 5,
    errors: Math.max(0, cmp.total - cmp.matched + cmp.extra),
    words: cmp.matched,
    keyErrors: {},
    timestamp: Date.now(),
    source,
    text: passageText.slice(0, 500)
  };

  const extraContent = renderDiff(cmp);

  try {
    await showResults(s.root, result, {
      extraContent,
      onRetry: () => {
        if (!isActive(s)) return;
        resetSession(s);
        s.passage = { text: passageText, source };
        renderScreen(s);
      },
      onNext: () => {
        if (!isActive(s)) return;
        loadPassage();
      }
    });
  } catch (e) {
    console.warn('speaking: showResults failed', e);
  }
}

/**
 * Build the "Word by word" diff section for the results screen.
 * @param {{ tokens: Array<{word: string, status: string, heard?: string}>, extra: number }} cmp
 * @returns {HTMLElement}
 */
function renderDiff(cmp) {
  const tokens = Array.isArray(cmp.tokens) ? cmp.tokens : [];
  const words = tokens.map((t) => {
    if (t.status === 'ok') return h('span', { class: 'w w-ok' }, t.word);
    if (t.status === 'missed') return h('span', { class: 'w w-missed', title: 'Not heard' }, t.word);
    const heard = t.heard || '?';
    return h('span', { class: 'w w-wrong', title: 'Heard: ' + heard },
      h('span', { class: 'w-expected' }, t.word),
      h('small', { class: 'w-heard' }, 'heard: ' + heard));
  });
  const extra = Number(cmp.extra) || 0;
  return h('section', { class: 'speak-diff-section' },
    h('h3', { class: 'speak-diff-title' }, 'Word by word'),
    h('div', { class: 'speak-diff-legend text-muted' },
      h('span', { class: 'w w-ok' }, 'correct'), ' ',
      h('span', { class: 'w w-missed' }, 'missed'), ' ',
      h('span', { class: 'w w-wrong' }, h('span', { class: 'w-expected' }, 'wrong'))),
    h('p', { class: 'speak-diff', lang: 'en' }, words.flatMap((el, i) => (i > 0 ? [' ', el] : [el]))),
    h('p', { class: 'speak-diff-extra text-muted' }, 'Extra words: ' + extra));
}

/* ------------------------------------------------------------------------ */
/* Utils                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Capitalise the first letter.
 * @param {string} str
 * @returns {string}
 */
function capitalize(str) {
  const v = String(str || '');
  return v.charAt(0).toUpperCase() + v.slice(1);
}
