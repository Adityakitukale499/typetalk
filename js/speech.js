/**
 * TypeTalk — speech.js
 * Text-to-speech (SpeechSynthesis), speech recognition (SpeechRecognition) and
 * word-level comparison helpers. Vanilla ES module, no dependencies besides settings.js.
 *
 * Everything degrades gracefully: when an API is missing, speak() resolves
 * immediately, getVoices() resolves to [], and createRecognizer() returns a
 * stub that reports 'not-supported' via onError.
 */

import { getSettings } from './settings.js';

/* ------------------------------------------------------------------ */
/* Environment helpers                                                 */
/* ------------------------------------------------------------------ */

const hasWindow = typeof window !== 'undefined';

/**
 * Read settings defensively (settings.js may throw if storage is unavailable).
 * @returns {object}
 */
function safeSettings() {
  try {
    return getSettings() || {};
  } catch (err) {
    return {};
  }
}

/**
 * Pick the first finite number from the candidates.
 * @param {...*} values
 * @returns {number}
 */
function firstNumber(...values) {
  for (const v of values) {
    const n = Number(v);
    if (v !== '' && v !== null && v !== undefined && Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * @param {number} n
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/**
 * @returns {boolean} true on desktop Chrome / Chromium-based browsers (needs the TTS keep-alive hack)
 */
function isDesktopChrome() {
  if (!hasWindow || !window.navigator) return false;
  const ua = window.navigator.userAgent || '';
  return /Chrome\//.test(ua) && !/Android|Mobile|iPhone|iPad/.test(ua);
}

/**
 * @returns {boolean}
 */
function isFirefox() {
  if (!hasWindow || !window.navigator) return false;
  return /Firefox\//.test(window.navigator.userAgent || '');
}

/**
 * @returns {Function|null} the SpeechRecognition constructor if available
 */
function getRecognitionCtor() {
  if (!hasWindow) return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/**
 * Whether speech synthesis (text-to-speech) is available.
 * @returns {boolean}
 */
export function isTtsSupported() {
  return hasWindow &&
    'speechSynthesis' in window &&
    !!window.speechSynthesis &&
    typeof window.SpeechSynthesisUtterance === 'function';
}

/**
 * Whether speech recognition is available (Chrome, Edge, Safari).
 * @returns {boolean}
 */
export function isRecognitionSupported() {
  return typeof getRecognitionCtor() === 'function';
}

/**
 * Short, user-facing explanation of recognition support for the current browser.
 * @returns {string}
 */
export function getRecognitionHint() {
  if (!isRecognitionSupported()) {
    if (isFirefox()) {
      return 'Speech recognition is not available in Firefox. Please use Chrome, Edge or Safari for the speaking modes.';
    }
    return 'Speech recognition requires Chrome, Edge or Safari.';
  }
  if (hasWindow && window.isSecureContext === false) {
    return 'Speech recognition needs a secure connection (https or localhost).';
  }
  return 'Allow microphone access when prompted, then speak clearly at a natural pace.';
}

/* ------------------------------------------------------------------ */
/* Voices & accents                                                    */
/* ------------------------------------------------------------------ */

/** English accents the app offers, in display order. */
export const ACCENTS = [
  { code: 'en-IN', label: 'Indian English', flag: '🇮🇳' },
  { code: 'en-US', label: 'US English', flag: '🇺🇸' },
  { code: 'en-GB', label: 'British English', flag: '🇬🇧' },
  { code: 'en-AU', label: 'Australian English', flag: '🇦🇺' },
  { code: 'en-CA', label: 'Canadian English', flag: '🇨🇦' },
  { code: 'en-ZA', label: 'South African English', flag: '🇿🇦' },
  { code: 'en-IE', label: 'Irish English', flag: '🇮🇪' }
];

/** @type {SpeechSynthesisVoice[]|null} */
let voicesCache = null;

/**
 * Normalise a BCP-47 tag for comparison ('en_US' -> 'en-us').
 * @param {string} lang
 * @returns {string}
 */
function normLang(lang) {
  return String(lang || '').replace(/_/g, '-').toLowerCase();
}

/**
 * Whether a voice belongs to the given accent code. Hindi (hi-IN) voices are
 * treated as Indian English because they read English with an Indian accent.
 * @param {SpeechSynthesisVoice} voice
 * @param {string} langCode
 * @returns {boolean}
 */
function voiceMatchesLang(voice, langCode) {
  const v = normLang(voice && voice.lang);
  const want = normLang(langCode);
  if (!v || !want) return false;
  if (v === want) return true;
  if (want === 'en-in' && v === 'hi-in') return true;
  return false;
}

/**
 * @param {SpeechSynthesisVoice} voice
 * @returns {boolean}
 */
function isEnglishVoice(voice) {
  const v = normLang(voice && voice.lang);
  return v.startsWith('en') || v === 'hi-in';
}

/**
 * Sort voices: preferred language first, then other English voices, then the rest.
 * @param {SpeechSynthesisVoice[]} list
 * @returns {SpeechSynthesisVoice[]}
 */
function sortVoices(list) {
  const preferred = safeSettings().lang || 'en-US';
  const rank = (v) => {
    if (voiceMatchesLang(v, preferred)) return 0;
    if (isEnglishVoice(v)) return 1;
    return 2;
  };
  return Array.from(list || []).sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (!!a.default !== !!b.default) return a.default ? -1 : 1;
    if (!!a.localService !== !!b.localService) return a.localService ? -1 : 1;
    return String(a.name).localeCompare(String(b.name));
  });
}

/**
 * Synchronously read the browser's voice list (may be empty before 'voiceschanged').
 * @returns {SpeechSynthesisVoice[]}
 */
function readVoicesSync() {
  if (!isTtsSupported()) return [];
  let list = [];
  try {
    list = window.speechSynthesis.getVoices() || [];
  } catch (err) {
    list = [];
  }
  if (list.length) voicesCache = sortVoices(list);
  return voicesCache || [];
}

/**
 * Resolve the list of available voices. Resolves immediately when the browser
 * already exposes voices; otherwise waits for 'voiceschanged' for up to 1.5s.
 * English voices come first (settings.lang match, then other English).
 * @returns {Promise<SpeechSynthesisVoice[]>}
 */
export function getVoices() {
  if (!isTtsSupported()) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const list = readVoicesSync();
  if (list.length) return Promise.resolve(list);

  return new Promise((resolve) => {
    let done = false;
    let timer = 0;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (typeof synth.removeEventListener === 'function') {
        synth.removeEventListener('voiceschanged', finish);
      } else if (synth.onvoiceschanged === finish) {
        synth.onvoiceschanged = null;
      }
      resolve(readVoicesSync());
    };
    if (typeof synth.addEventListener === 'function') {
      synth.addEventListener('voiceschanged', finish);
    } else {
      synth.onvoiceschanged = finish;
    }
    timer = setTimeout(finish, 1500);
  });
}

/**
 * Group English voices by accent. Order: settings.lang first, then the rest of
 * ACCENTS, then 'Other English' (English voices with an accent not listed),
 * then 'Other languages'. Groups with no voices are omitted.
 * @returns {Promise<Array<{ code: string, label: string, flag: string, voices: SpeechSynthesisVoice[] }>>}
 */
export async function getVoiceGroups() {
  const voices = await getVoices();
  const preferred = normLang(safeSettings().lang || 'en-US');
  const ordered = [
    ...ACCENTS.filter((a) => normLang(a.code) === preferred),
    ...ACCENTS.filter((a) => normLang(a.code) !== preferred)
  ];
  const used = new Set();
  const groups = [];
  for (const accent of ordered) {
    const members = voices.filter((v) => !used.has(v) && voiceMatchesLang(v, accent.code));
    members.forEach((v) => used.add(v));
    if (members.length) groups.push({ ...accent, voices: members });
  }
  const otherEnglish = voices.filter((v) => !used.has(v) && isEnglishVoice(v));
  otherEnglish.forEach((v) => used.add(v));
  if (otherEnglish.length) {
    groups.push({ code: 'en', label: 'Other English', flag: '🌐', voices: otherEnglish });
  }
  const others = voices.filter((v) => !used.has(v));
  if (others.length) {
    groups.push({ code: 'other', label: 'Other languages', flag: '🌍', voices: others });
  }
  return groups;
}

/**
 * Voices for one accent code (e.g. 'en-IN'; includes hi-IN voices).
 * @param {string} langCode
 * @returns {Promise<SpeechSynthesisVoice[]>}
 */
export async function getVoicesForLang(langCode) {
  const voices = await getVoices();
  return voices.filter((v) => voiceMatchesLang(v, langCode));
}

/**
 * Score a voice for "best default" selection: natural/online voices first,
 * then Google, then the browser default, then anything else.
 * @param {SpeechSynthesisVoice} voice
 * @returns {number} lower is better
 */
function voiceQualityRank(voice) {
  const name = String((voice && voice.name) || '');
  if (/neural|online|natural/i.test(name)) return 0;
  if (/google/i.test(name)) return 1;
  if (voice && voice.default) return 2;
  return 3;
}

/**
 * Pick the best voice for an accent from a list (sync).
 * @param {SpeechSynthesisVoice[]} list
 * @param {string} langCode
 * @returns {SpeechSynthesisVoice|null}
 */
function bestVoiceSync(list, langCode) {
  let candidates = (list || []).filter((v) => voiceMatchesLang(v, langCode));
  if (!candidates.length) {
    // Same base language (e.g. any 'en-*') as a fallback.
    const base = normLang(langCode).split('-')[0];
    candidates = (list || []).filter((v) => normLang(v.lang).split('-')[0] === base);
  }
  if (!candidates.length) return null;
  // Prefer exact accent matches over hi-IN stand-ins at equal quality.
  const exact = (v) => (normLang(v.lang) === normLang(langCode) ? 0 : 1);
  return candidates.slice().sort((a, b) => {
    const qa = voiceQualityRank(a);
    const qb = voiceQualityRank(b);
    if (qa !== qb) return qa - qb;
    return exact(a) - exact(b);
  })[0];
}

/**
 * Best voice for an accent: prefers 'Neural' / 'Online' (Edge natural voices),
 * then 'Google', then the browser default, then the first match.
 * @param {string} langCode
 * @returns {Promise<SpeechSynthesisVoice|null>}
 */
export async function pickDefaultVoice(langCode) {
  const voices = await getVoices();
  return bestVoiceSync(voices, langCode);
}

/**
 * Human-friendly voice label, e.g.
 * 'Microsoft Neerja Online (Natural) - English (India)' -> 'Neerja (Natural)'.
 * @param {SpeechSynthesisVoice} voice
 * @returns {string}
 */
export function voiceDisplayName(voice) {
  if (!voice) return '';
  let name = String(voice.name || '').trim();
  if (!name) return String(voice.lang || '');
  const natural = /\(natural\)/i.test(name) || /\bnatural\b/i.test(name);
  name = name
    .replace(/\s*-\s*[^-()]*\([^)]*\)\s*$/g, '')      // trailing ' - English (India)'
    .replace(/\s*-\s*(english|[a-z]+ \([^)]*\))\s*$/i, '')
    .replace(/\(natural\)/gi, '')
    .replace(/\((english|[a-z]+)\s*\([^)]*\)\)/gi, '')
    .replace(/\(\s*[a-z]{2,3}[-_][a-z]{2,4}\s*\)/gi, '') // '(en-IN)'
    .replace(/\b(microsoft|google|apple|amazon)\b\s*/gi, '')
    .replace(/\bonline\b/gi, '')
    .replace(/\bdesktop\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—]+|[\s\-–—]+$/g, '')
    .trim();
  if (!name) name = String(voice.lang || 'Voice');
  if (natural) name += ' (Natural)';
  return name;
}

/**
 * Find a voice by URI, falling back to the best voice for a language.
 * @param {string} voiceURI
 * @param {string} lang
 * @returns {SpeechSynthesisVoice|null}
 */
function pickVoice(voiceURI, lang) {
  const list = readVoicesSync();
  if (!list.length) return null;
  if (voiceURI) {
    const exact = list.find((v) => v.voiceURI === voiceURI || v.name === voiceURI);
    if (exact) return exact;
  }
  return bestVoiceSync(list, lang); // null lets the browser choose its default
}

/* ------------------------------------------------------------------ */
/* Speaking                                                            */
/* ------------------------------------------------------------------ */

const MAX_CHUNK = 200;

/**
 * Split long text into chunks (<= MAX_CHUNK chars) at sentence, then clause,
 * then word boundaries. Chrome silently stops long utterances, so we speak
 * chunks one after another.
 * @param {string} text
 * @param {number} [max]
 * @returns {string[]}
 */
function chunkText(text, max = MAX_CHUNK) {
  const str = String(text || '').replace(/\s+/g, ' ').trim();
  if (!str) return [];
  if (str.length <= max) return [str];

  const sentences = str.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [str];
  const pieces = [];
  for (const s of sentences) {
    const t = s.trim();
    if (!t) continue;
    if (t.length <= max) {
      pieces.push(t);
      continue;
    }
    // Too long for one sentence: split on clause separators, then on words.
    const clauses = t.split(/(?<=[,;:])\s+/);
    let buf = '';
    for (const c of clauses) {
      if (c.length > max) {
        if (buf) { pieces.push(buf); buf = ''; }
        let wordBuf = '';
        for (const w of c.split(' ')) {
          if ((wordBuf + ' ' + w).trim().length > max && wordBuf) {
            pieces.push(wordBuf);
            wordBuf = w;
          } else {
            wordBuf = (wordBuf + ' ' + w).trim();
          }
        }
        if (wordBuf) pieces.push(wordBuf);
      } else if ((buf + ' ' + c).trim().length > max && buf) {
        pieces.push(buf);
        buf = c;
      } else {
        buf = (buf + ' ' + c).trim();
      }
    }
    if (buf) pieces.push(buf);
  }

  // Merge small sentences together while staying under the limit.
  const chunks = [];
  let cur = '';
  for (const p of pieces) {
    if (!cur) {
      cur = p;
    } else if ((cur + ' ' + p).length <= max) {
      cur = cur + ' ' + p;
    } else {
      chunks.push(cur);
      cur = p;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** @type {object|null} the active speak() job */
let currentJob = null;
let jobSeq = 0;

/**
 * Speak text aloud. Cancels any current speech first. Defaults come from
 * settings (ttsRate, ttsPitch, ttsVolume, ttsVoiceURI, lang). When no voice
 * URI is set, the best voice for the chosen accent (settings.lang) is used.
 * @param {string} text
 * @param {{ rate?: number, pitch?: number, volume?: number, voiceURI?: string, lang?: string }} [opts]
 * @returns {Promise<void>} resolves when speech ends, errors or is cancelled
 */
export function speak(text, { rate, pitch, volume, voiceURI, lang } = {}) {
  const str = String(text == null ? '' : text).trim();
  stopSpeaking();
  if (!isTtsSupported() || !str) return Promise.resolve();

  const synth = window.speechSynthesis;
  const settings = safeSettings();
  const uRate = clamp(firstNumber(rate, settings.ttsRate, 1), 0.1, 10);
  const uPitch = clamp(firstNumber(pitch, settings.ttsPitch, 1), 0, 2);
  const uVolume = clamp(firstNumber(volume, settings.ttsVolume, 1), 0, 1);
  const uVoiceURI = voiceURI !== undefined && voiceURI !== null ? voiceURI : (settings.ttsVoiceURI || '');
  const uLang = lang || settings.lang || 'en-US';
  const chunks = chunkText(str);

  const job = {
    id: ++jobSeq,
    cancelled: false,
    done: false,
    resolve: null,
    utterances: [], // keep references so Chrome does not GC them mid-speech
    keepAlive: 0,
    watchdog: 0,
    watchdogExtensions: 0,
    startTimer: 0
  };
  currentJob = job;

  const promise = new Promise((resolve) => {
    job.resolve = resolve;
  });

  const clearWatchdog = () => {
    if (job.watchdog) {
      clearTimeout(job.watchdog);
      job.watchdog = 0;
    }
  };

  job.finish = () => {
    if (job.done) return;
    job.done = true;
    clearWatchdog();
    if (job.keepAlive) {
      clearInterval(job.keepAlive);
      job.keepAlive = 0;
    }
    if (job.startTimer) {
      clearTimeout(job.startTimer);
      job.startTimer = 0;
    }
    if (currentJob === job) currentJob = null;
    job.resolve();
  };

  const voice = pickVoice(uVoiceURI, uLang);

  const speakChunk = (index) => {
    if (job.cancelled || index >= chunks.length) {
      job.finish();
      return;
    }
    const chunk = chunks[index];
    let utter;
    try {
      utter = new window.SpeechSynthesisUtterance(chunk);
    } catch (err) {
      job.finish();
      return;
    }
    utter.rate = uRate;
    utter.pitch = uPitch;
    utter.volume = uVolume;
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang || uLang;
    } else {
      utter.lang = uLang;
    }

    const next = () => {
      clearWatchdog();
      if (job.done) return;
      if (job.cancelled) {
        job.finish();
      } else {
        speakChunk(index + 1);
      }
    };

    // Chrome occasionally never fires onend; estimate the duration and recover.
    const armWatchdog = () => {
      clearWatchdog();
      const estimate = (chunk.length * 120) / uRate + 3000;
      job.watchdog = setTimeout(() => {
        job.watchdog = 0;
        if (job.done) return;
        let busy = false;
        try {
          busy = synth.speaking || synth.pending;
        } catch (err) {
          busy = false;
        }
        if (busy && job.watchdogExtensions < 2) {
          job.watchdogExtensions += 1;
          armWatchdog();
          return;
        }
        if (busy) {
          try { synth.cancel(); } catch (err) { /* ignore */ }
          job.cancelled = true;
        }
        next();
      }, estimate);
    };

    utter.onstart = () => {
      job.watchdogExtensions = 0;
      armWatchdog();
    };
    utter.onend = next;
    utter.onerror = (event) => {
      clearWatchdog();
      if (job.done) return;
      const code = event && event.error;
      if (job.cancelled || code === 'interrupted' || code === 'canceled') {
        job.finish();
        return;
      }
      // Any other synthesis failure: give up on this text (resolve, never reject).
      job.finish();
    };

    job.utterances.push(utter);
    armWatchdog();
    try {
      synth.speak(utter);
    } catch (err) {
      job.finish();
    }
  };

  const begin = () => {
    job.startTimer = 0;
    if (job.cancelled) {
      job.finish();
      return;
    }
    // Chrome desktop pauses long speech after ~15s; a pause/resume tick keeps it alive.
    if (isDesktopChrome()) {
      job.keepAlive = setInterval(() => {
        if (job.done) return;
        try {
          if (synth.speaking && !synth.paused) {
            synth.pause();
            synth.resume();
          }
        } catch (err) {
          /* ignore */
        }
      }, 10000);
    }
    speakChunk(0);
  };

  // After cancel(), some engines swallow an immediate speak(); give them a tick.
  let wasBusy = false;
  try {
    wasBusy = synth.speaking || synth.pending;
  } catch (err) {
    wasBusy = false;
  }
  if (wasBusy) {
    job.startTimer = setTimeout(begin, 60);
  } else {
    begin();
  }
  return promise;
}

/**
 * Stop any current speech and resolve its pending promise.
 */
export function stopSpeaking() {
  const job = currentJob;
  if (job) {
    job.cancelled = true;
    job.finish();
  }
  if (isTtsSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch (err) {
      /* ignore */
    }
  }
}

/**
 * @returns {boolean} whether speech is in progress (or queued)
 */
export function isSpeaking() {
  if (currentJob && !currentJob.done) return true;
  if (!isTtsSupported()) return false;
  try {
    return !!(window.speechSynthesis.speaking || window.speechSynthesis.pending);
  } catch (err) {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Recognition                                                         */
/* ------------------------------------------------------------------ */

const RESTART_DELAY = 250;
const RESTART_WINDOW = 10000; // ms
const RESTART_MAX = 8;        // restarts allowed inside the window before giving up

/**
 * Create a speech recognizer wrapper around SpeechRecognition.
 * finalTranscript accumulates across result events; interimTranscript is the
 * current unconfirmed text. The recognizer restarts itself after 'no-speech',
 * silent aborts and unexpected ends while the caller still wants to listen.
 * @param {{ lang?: string, interim?: boolean, continuous?: boolean }} [options]
 * @returns {{ start(): void, stop(): void, abort(): void, onResult(cb: Function): Function, onEnd(cb: Function): Function, onError(cb: Function): Function, isListening(): boolean }}
 */
export function createRecognizer({ lang, interim = true, continuous = true } = {}) {
  const Ctor = getRecognitionCtor();
  const handlers = { result: [], end: [], error: [] };

  const subscribe = (type) => (cb) => {
    if (typeof cb !== 'function') return () => {};
    handlers[type].push(cb);
    return () => {
      const i = handlers[type].indexOf(cb);
      if (i >= 0) handlers[type].splice(i, 1);
    };
  };
  const emit = (type, payload) => {
    for (const cb of handlers[type].slice()) {
      try {
        cb(payload);
      } catch (err) {
        /* never let a listener break the recognizer */
      }
    }
  };

  if (!Ctor) {
    // Graceful stub for browsers without SpeechRecognition (e.g. Firefox).
    return {
      start() {
        setTimeout(() => {
          emit('error', 'not-supported');
          emit('end');
        }, 0);
      },
      stop() {},
      abort() {},
      onResult: subscribe('result'),
      onEnd: subscribe('end'),
      onError: subscribe('error'),
      isListening() {
        return false;
      }
    };
  }

  let recognition = null;
  let wanted = false;      // user wants to be listening
  let active = false;      // we consider ourselves listening (incl. restart gaps)
  let userAborted = false;
  let finalTranscript = '';
  let lastFinalIndex = -1; // per-session guard against repeated final results (Android)
  let restartTimer = 0;
  let restartTimes = [];

  const resolveLang = () => lang || safeSettings().lang || 'en-US';

  const finishForGood = () => {
    wanted = false;
    active = false;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = 0;
    }
    emit('end');
  };

  const scheduleRestart = () => {
    if (restartTimer) return;
    const now = Date.now();
    restartTimes = restartTimes.filter((t) => now - t < RESTART_WINDOW);
    if (restartTimes.length >= RESTART_MAX) {
      emit('error', 'restart-limit');
      finishForGood();
      return;
    }
    restartTimes.push(now);
    restartTimer = setTimeout(() => {
      restartTimer = 0;
      if (!wanted) {
        finishForGood();
        return;
      }
      startSession();
    }, RESTART_DELAY);
  };

  const buildRecognition = () => {
    const rec = new Ctor();
    rec.lang = resolveLang();
    rec.interimResults = !!interim;
    rec.continuous = !!continuous;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      active = true;
    };

    rec.onresult = (event) => {
      if (rec !== recognition) return;
      let interimText = '';
      const results = event.results || [];
      const from = typeof event.resultIndex === 'number' ? event.resultIndex : 0;
      for (let i = from; i < results.length; i++) {
        const res = results[i];
        if (!res || !res[0]) continue;
        const transcript = String(res[0].transcript || '');
        if (res.isFinal) {
          if (i <= lastFinalIndex) continue; // Android repeats earlier finals
          lastFinalIndex = i;
          const piece = transcript.trim();
          if (piece) finalTranscript = finalTranscript ? finalTranscript + ' ' + piece : piece;
        } else {
          interimText += transcript;
        }
      }
      emit('result', { finalTranscript, interimTranscript: interimText.trim() });
    };

    rec.onerror = (event) => {
      if (rec !== recognition) return;
      const code = (event && event.error) || 'unknown';
      if (code === 'no-speech') return;   // onend follows; we restart silently
      if (code === 'aborted') return;     // engine hiccup (restart follows) or our own abort()
      // Fatal errors: stop wanting to listen so onend does not restart.
      wanted = false;
      emit('error', code);
    };

    rec.onend = () => {
      if (rec !== recognition) return;
      if (wanted && !userAborted) {
        scheduleRestart();
        return;
      }
      finishForGood();
    };
    return rec;
  };

  const startSession = () => {
    lastFinalIndex = -1;
    recognition = buildRecognition();
    try {
      recognition.start();
      active = true;
    } catch (err) {
      // 'already started' or a transient failure: retry shortly if still wanted.
      if (wanted) {
        scheduleRestart();
      } else {
        finishForGood();
      }
    }
  };

  return {
    /** Begin listening; resets the accumulated transcript. */
    start() {
      if (wanted && active) return;
      wanted = true;
      userAborted = false;
      finalTranscript = '';
      restartTimes = [];
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = 0;
      }
      if (recognition) {
        try { recognition.abort(); } catch (err) { /* ignore */ }
        recognition = null;
      }
      startSession();
    },
    /** Stop listening gracefully; pending audio is still finalised and onEnd fires. */
    stop() {
      wanted = false;
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = 0;
      }
      if (recognition) {
        try {
          recognition.stop();
        } catch (err) {
          finishForGood();
        }
      } else if (active) {
        finishForGood();
      }
    },
    /** Abort immediately, discarding pending audio. */
    abort() {
      wanted = false;
      userAborted = true;
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = 0;
      }
      if (recognition) {
        try {
          recognition.abort();
        } catch (err) {
          finishForGood();
        }
      } else if (active) {
        finishForGood();
      }
    },
    onResult: subscribe('result'),
    onEnd: subscribe('end'),
    onError: subscribe('error'),
    /** @returns {boolean} */
    isListening() {
      return wanted && active;
    }
  };
}

/* ------------------------------------------------------------------ */
/* Word normalisation & comparison                                     */
/* ------------------------------------------------------------------ */

/**
 * Normalise text into comparable word tokens: lowercase, hyphens/slashes become
 * spaces, punctuation stripped (inner apostrophes and decimal points kept),
 * digits kept as-is.
 * @param {string} text
 * @returns {string[]}
 */
export function normalizeWords(text) {
  const str = String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/(\d),(\d)/g, '$1$2')                 // 1,000 -> 1000
    .replace(/(\d)\.(\d)/g, '$1\u0001$2')          // protect decimal points
    .replace(/[-‐-―−/]+/g, ' ')     // hyphens, dashes, slashes -> space
    .replace(/[^\p{L}\p{N}'\u0001\s]+/gu, ' ')     // drop other punctuation
    .replace(/\u0001/g, '.');
  return str
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length > 0);
}

/**
 * Levenshtein edit distance.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return prev[b.length];
}

const SOUNDEX_CODES = {
  b: '1', f: '1', p: '1', v: '1',
  c: '2', g: '2', j: '2', k: '2', q: '2', s: '2', x: '2', z: '2',
  d: '3', t: '3',
  l: '4',
  m: '5', n: '5',
  r: '6'
};

/**
 * American Soundex code ('' for words without letters).
 * @param {string} word
 * @returns {string}
 */
function soundex(word) {
  const w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return '';
  let out = w[0].toUpperCase();
  let last = SOUNDEX_CODES[w[0]] || '';
  for (let i = 1; i < w.length && out.length < 4; i++) {
    const ch = w[i];
    const code = SOUNDEX_CODES[ch] || '';
    if (code && code !== last) out += code;
    if (ch !== 'h' && ch !== 'w') last = code;
  }
  return (out + '000').slice(0, 4);
}

/** Common English homophone / spelling-variant groups recognition engines mix up. */
const HOMOPHONE_GROUPS = [
  ['to', 'too', 'two'], ['for', 'four', 'fore'], ['there', 'their', "they're"],
  ['your', "you're"], ['its', "it's"], ['hear', 'here'], ['where', 'wear', 'ware'],
  ['know', 'no'], ['knows', 'nose'], ['right', 'write', 'rite'], ['one', 'won'],
  ['see', 'sea'], ['be', 'bee'], ['by', 'buy', 'bye'], ['which', 'witch'],
  ['whether', 'weather'], ['piece', 'peace'], ['hole', 'whole'], ['our', 'hour'],
  ['i', 'eye'], ['ate', 'eight'], ['new', 'knew'], ['son', 'sun'], ['so', 'sew'],
  ['some', 'sum'], ['week', 'weak'], ['would', 'wood'], ['red', 'read'],
  ['blue', 'blew'], ['through', 'threw'], ['night', 'knight'], ['meet', 'meat'],
  ['wait', 'weight'], ['hi', 'high'], ['in', 'inn'], ['flour', 'flower'],
  ['plain', 'plane'], ['brake', 'break'], ['great', 'grate'], ['pair', 'pear', 'pare'],
  ['tail', 'tale'], ['mail', 'male'], ['sail', 'sale'], ['steal', 'steel'],
  ['allowed', 'aloud'], ['die', 'dye'], ['fair', 'fare'], ['heal', 'heel'],
  ['made', 'maid'], ['pain', 'pane'], ['rain', 'reign', 'rein'], ['role', 'roll'],
  ['sent', 'cent', 'scent'], ['sight', 'site', 'cite'], ['stair', 'stare'],
  ['waste', 'waist'], ['way', 'weigh'], ['than', 'then'], ['a', 'uh'],
  ['and', 'an', 'n'], ['are', 'our', 'r'], ['you', 'u'], ['okay', 'ok'],
  ['hello', 'hallo'], ['grey', 'gray'], ['colour', 'color'], ['favourite', 'favorite'],
  ['centre', 'center'], ['theatre', 'theater'], ['metre', 'meter'], ['litre', 'liter'],
  ['practise', 'practice'], ['travelling', 'traveling'], ['realise', 'realize'],
  ['organise', 'organize'], ['neighbour', 'neighbor'], ['honour', 'honor'],
  ['1', 'one'], ['2', 'two', 'to', 'too'], ['3', 'three'], ['4', 'four', 'for'],
  ['5', 'five'], ['6', 'six'], ['7', 'seven'], ['8', 'eight', 'ate'], ['9', 'nine'],
  ['10', 'ten'], ['0', 'zero', 'oh']
];

/** @type {Map<string, number[]>} word -> group ids */
const HOMOPHONE_INDEX = new Map();
HOMOPHONE_GROUPS.forEach((group, gi) => {
  for (const w of group) {
    if (!HOMOPHONE_INDEX.has(w)) HOMOPHONE_INDEX.set(w, []);
    HOMOPHONE_INDEX.get(w).push(gi);
  }
});

/**
 * Whether two normalised words should count as the same for scoring.
 * Forgives recognition noise: homophones, one-letter typos in words of 5+
 * letters, and same-Soundex near spellings for words of 4+ letters.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function wordsSimilar(a, b) {
  const x = String(a || '').toLowerCase();
  const y = String(b || '').toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  const gx = HOMOPHONE_INDEX.get(x);
  const gy = HOMOPHONE_INDEX.get(y);
  if (gx && gy && gx.some((g) => gy.includes(g))) return true;
  // Apostrophe noise: "cats" vs "cat's".
  const strip = (s) => s.replace(/'/g, '');
  if (strip(x) === strip(y)) return true;
  if (x.length >= 5 && y.length >= 5) {
    const d = levenshtein(x, y);
    if (d <= 1) return true;
    if (d <= 2 && soundex(x) === soundex(y)) return true;
  } else if (x.length >= 4 && y.length >= 4) {
    if (levenshtein(x, y) <= 1 && soundex(x) === soundex(y)) return true;
  }
  return false;
}

/**
 * Longest-common-subsequence alignment of two token arrays using wordsSimilar.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {Array<[number, number]>} matched index pairs (ascending)
 */
function lcsPairs(a, b) {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return [];
  // dp[i][j] = LCS length of a[i..], b[j..]
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (wordsSimilar(a[i], b[j])) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (wordsSimilar(a[i], b[j])) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/**
 * Compare what was expected with what was spoken/typed.
 * Tokens preserve the original expected words (with punctuation) in order.
 * A word is 'ok' when matched (or near-matched), 'wrong' when a different word
 * was said in its place (heard = that word), 'missed' when nothing was said.
 * @param {string} expectedText
 * @param {string} spokenText
 * @returns {{ accuracy: number, matched: number, total: number, extra: number, tokens: Array<{ word: string, status: 'ok'|'missed'|'wrong', heard?: string }> }}
 */
export function compareWords(expectedText, spokenText) {
  const displayWords = String(expectedText == null ? '' : expectedText)
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);

  // Flatten expected normalised words, remembering which display token each belongs to.
  const expected = [];
  const owner = [];
  displayWords.forEach((w, ti) => {
    for (const nw of normalizeWords(w)) {
      expected.push(nw);
      owner.push(ti);
    }
  });
  const spoken = normalizeWords(spokenText);

  const pairs = lcsPairs(expected, spoken);
  const expStatus = new Array(expected.length).fill('missed');
  const expHeard = new Array(expected.length).fill('');
  const spokenUsed = new Array(spoken.length).fill(false);
  for (const [ei, si] of pairs) {
    expStatus[ei] = 'ok';
    spokenUsed[si] = true;
  }

  // Between consecutive anchors, pair unmatched expected words with unmatched
  // spoken words in order: those become 'wrong' (heard = spoken word).
  let extra = 0;
  const anchors = [[-1, -1], ...pairs, [expected.length, spoken.length]];
  for (let k = 0; k < anchors.length - 1; k++) {
    const [e0, s0] = anchors[k];
    const [e1, s1] = anchors[k + 1];
    const gapE = [];
    for (let e = e0 + 1; e < e1; e++) gapE.push(e);
    const gapS = [];
    for (let s = s0 + 1; s < s1; s++) if (!spokenUsed[s]) gapS.push(s);
    const pairCount = Math.min(gapE.length, gapS.length);
    for (let p = 0; p < pairCount; p++) {
      expStatus[gapE[p]] = 'wrong';
      expHeard[gapE[p]] = spoken[gapS[p]];
      spokenUsed[gapS[p]] = true;
    }
    extra += gapS.length - pairCount;
  }

  // Collapse back onto display tokens.
  const tokens = displayWords.map((word) => ({ word, status: 'ok' }));
  const perToken = displayWords.map(() => []);
  expected.forEach((_, ei) => perToken[owner[ei]].push(ei));

  let matched = 0;
  let total = 0;
  perToken.forEach((indices, ti) => {
    if (!indices.length) return; // punctuation-only token: neutral, not scored
    total += 1;
    const statuses = indices.map((ei) => expStatus[ei]);
    if (statuses.every((s) => s === 'ok')) {
      matched += 1;
      return;
    }
    const heard = indices
      .filter((ei) => expStatus[ei] === 'wrong')
      .map((ei) => expHeard[ei])
      .join(' ');
    if (heard) {
      tokens[ti].status = 'wrong';
      tokens[ti].heard = heard;
    } else {
      tokens[ti].status = 'missed';
    }
  });

  const accuracy = total > 0 ? Math.round((matched / total) * 1000) / 10 : 0;
  return { accuracy, matched, total, extra, tokens };
}
