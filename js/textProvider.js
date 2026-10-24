/**
 * TypeTalk text provider.
 *
 * Supplies practice texts for every mode. Tries free, CORS-enabled online
 * sources (each with a 3 second AbortController timeout), mixes in the local
 * bank (data/texts.json) for variety and always falls back to it on failure.
 * A tiny built-in emergency bank guarantees the app keeps working even when
 * the JSON file cannot be fetched (e.g. file:// protocol).
 *
 * @module textProvider
 */

import { getSettings } from './settings.js';
import { storageGet, storageSet } from './storage.js';

/** Supported text kinds. */
export const KINDS = ['words', 'sentences', 'paragraph', 'quotes', 'numbers'];

/** Supported difficulty levels (easiest first). */
export const LEVELS = ['beginner', 'intermediate', 'advanced', 'expert'];

const TIMEOUT_MS = 3000;
const RECENT_KEY = 'recentTexts';
const RECENT_LIMIT = 20;
const LOCAL_MIX_RATE = 0.3;
const MAX_ATTEMPTS = 3;
const DEFAULT_MAX_CHARS = 600;
const CUSTOM_HARD_CAP = 5000;
const CUSTOM_SENTENCE_CAP = 200;
const MIN_WIKI_CHARS = 200;
const MIN_ONLINE_WORDS = 12;

/** Maximum words per sentence for getSentences, per level. */
const SENTENCE_MAX_WORDS = { beginner: 8, intermediate: 14, advanced: 20, expert: 28 };

/**
 * Shaping rules used by getText per level.
 * wordRe: accepted (lowercased) word shape for 'words' kind coming from online sources.
 * capitalize: share of words to capitalise (expert gets Shift practice).
 * sentenceWords: max words of a single online sentence unit for 'sentences' kind.
 * targetChars: composition stops once this many chars are reached (after the minimum unit count).
 */
const LEVEL_RULES = {
  beginner: {
    wordRe: /^[a-z]{1,6}$/, wordCount: 30, capitalize: 0,
    sentenceMin: 3, sentenceMax: 4, sentenceWords: 12, targetChars: 150, quoteCount: 2, numberCount: 3
  },
  intermediate: {
    wordRe: /^[a-z]{2,9}$/, wordCount: 40, capitalize: 0,
    sentenceMin: 4, sentenceMax: 5, sentenceWords: 22, targetChars: 260, quoteCount: 2, numberCount: 4
  },
  advanced: {
    wordRe: /^[a-z]{3,}$/, wordCount: 50, capitalize: 0,
    sentenceMin: 4, sentenceMax: 6, sentenceWords: 32, targetChars: 380, quoteCount: 3, numberCount: 4
  },
  expert: {
    wordRe: /^[a-z]{3,}$/, wordCount: 60, capitalize: 0.25,
    sentenceMin: 5, sentenceMax: 6, sentenceWords: 45, targetChars: 480, quoteCount: 3, numberCount: 5
  }
};

/** When a kind is missing from the bank at every level, try these kinds instead. */
const KIND_FALLBACK = {
  words: ['sentences'],
  sentences: ['paragraph', 'quotes'],
  paragraph: ['sentences'],
  quotes: ['sentences'],
  numbers: ['sentences']
};

const SOURCE_LABELS = {
  wikipedia: 'Wikipedia',
  dummyjson: 'DummyJSON Quotes',
  uselessfacts: 'Useless Facts',
  adviceslip: 'Advice Slip',
  randomword: 'Random Word API',
  local: 'Built-in library',
  custom: 'Your text'
};

/* ------------------------------------------------------------------------ */
/* Emergency bank (used only when data/texts.json cannot be loaded)          */
/* ------------------------------------------------------------------------ */

const EMERGENCY_BANK = {
  version: 1,
  beginner: {
    words: [
      'the and for you are with this that have from they will one all can her was our out day get has him his how man new now old see two way who',
      'cat dog sun run big red hat map pen cup box bed car bus key leg arm eye ear toe lip jam egg tea pie ice fun hop sit nap top lid bag net web',
      'home time work play read book word line page open close start stop walk talk look find keep make take give help come back door road tree leaf rain snow wind'
    ],
    sentences: [
      'the sun is warm today.',
      'my dog likes to run in the park.',
      'we eat lunch at noon and then we rest.'
    ],
    paragraph: [
      'the park near my home is small but nice. there is a pond with ducks and a path for bikes. on sunny days we sit on the grass and read. my dog likes to chase the ball and then nap in the shade.',
      'i get up early and make tea. the house is quiet and the light is soft. i read a page or two and then start my day. a slow start helps me think and feel calm.',
      'my friend has a red bike. we ride to the shop and buy bread and milk. on the way back we stop by the lake. the water is still and the air is cool.'
    ],
    quotes: [
      'Small steps still move you forward. - Anonymous',
      'Be kind and keep going. - Anonymous',
      'Every day is a new page. - Anonymous'
    ],
    numbers: [
      'I have 3 cats and 2 dogs.',
      'The bus comes at 8:15 each day.',
      'My room is number 12 on floor 4.'
    ]
  },
  intermediate: {
    words: [
      'morning window garden simple travel letter bright music little family friend answer market coffee pencil bridge silver summer winter station camera planet',
      'kitchen yellow number orange basket forest river mountain village picture journey comfort wonder balance honest gentle quiet rapid reason future history',
      'library teacher student lesson notebook careful curious capture explain develop improve measure gather collect compare decide manage prepare repeat'
    ],
    sentences: [
      'The library opens at nine, so we arrived a few minutes early.',
      'She packed a small bag with fruit, water, and a good book.',
      'After the storm passed, the streets were quiet and clean.'
    ],
    paragraph: [
      'The market opens before sunrise, and the first visitors are usually bakers looking for fresh fruit. By eight the aisles are crowded, with vendors calling out prices and children tasting samples. Most people leave with more than they planned to buy, which is exactly what the vendors hope for.',
      'Learning to type well is less about speed and more about rhythm. When your fingers settle into a steady pattern, mistakes become rare and speed follows naturally. Short, daily practice sessions are far more effective than one long session each week.',
      'Our neighborhood garden started with three raised beds and a borrowed hose. Within a year, twelve families were sharing tools, seeds, and advice. The tomatoes are still the most popular crop, but the real harvest is the friendships that grew alongside them.'
    ],
    quotes: [
      'Progress hides inside the days that feel ordinary. - Anonymous',
      'You do not need to be fast to be consistent. - Anonymous',
      'Curiosity is the quiet engine of every skill. - Anonymous'
    ],
    numbers: [
      'The train leaves at 7:45 and arrives at 10:20.',
      'Please order 24 chairs and 6 tables for room 302.',
      'The recipe needs 2 cups of flour and 1.5 cups of milk.'
    ]
  },
  advanced: {
    words: [
      'architecture consequence deliberate environment fundamental hypothesis illustrate magnificent negotiation observation perspective qualitative resilience significant',
      'accomplish bureaucracy circumstance demonstrate efficiency flexibility generation hesitation imagination jurisdiction knowledgeable legislation maintenance',
      'nevertheless opportunity participate questionnaire recommendation sophisticated transformation unanimous vulnerability widespread acknowledgement collaboration'
    ],
    sentences: [
      'Although the forecast promised rain, the afternoon stayed bright enough for the outdoor concert.',
      'The committee postponed its decision until every department had submitted a detailed report.',
      'Learning a new language rewires how you listen, not just how you speak.'
    ],
    paragraph: [
      'Cartographers in the eighteenth century worked with instruments that would seem crude today, yet their maps guided ships across oceans with surprising reliability. Accuracy depended on patient observation, careful arithmetic, and a willingness to revise earlier assumptions whenever new measurements contradicted them.',
      'A well designed city street balances many competing needs: pedestrians want shade and safety, cyclists need predictable lanes, and shop owners hope for steady foot traffic. The best solutions rarely come from a single planner; they emerge from years of small adjustments and honest feedback from the people who use the street daily.',
      'Coral reefs occupy less than one percent of the ocean floor, yet they shelter roughly a quarter of all marine species. Their vibrant colors come from microscopic algae living inside the coral tissue, an arrangement so finely balanced that a temperature rise of two degrees can unravel it within weeks.'
    ],
    quotes: [
      'Discipline is choosing what you want most over what you want now. - Anonymous',
      'The clearest explanation is usually the one that took the longest to write. - Anonymous',
      'Expertise is patience wearing a uniform. - Anonymous'
    ],
    numbers: [
      'Order #4821 ships on 12/03 for $19.99 (incl. 8% tax).',
      'The meeting moved from 2:30 PM to 4:15 PM in Room 7B.',
      'Revenue grew 12.5% to $3.4 million in Q3 2025.'
    ]
  },
  expert: {
    words: [
      'Asynchronous Idempotent Heuristic Deterministic Orthogonal Serialization Throughput Latency Concurrency Encapsulation Polymorphism Abstraction Refactoring Immutable',
      'Thermodynamics Photosynthesis Mitochondria Electromagnetic Stoichiometry Crystallography Spectroscopy Biodiversity Paleontology Hydrodynamics Quasar Nebula',
      'Jurisprudence Epistemology Phenomenology Utilitarianism Hermeneutics Dialectic Ontology Pragmatism Rhetoric Semiotics Teleology Aesthetics Metaphysics'
    ],
    sentences: [
      'The compiler\'s type checker rejected the call because the generic parameter, inferred as "never", could not satisfy the constraint.',
      'Quantum error correction encodes one logical qubit across many physical qubits; redundancy, not isolation, protects the information.',
      'If the cache invalidation strategy fails (and it eventually will), stale reads propagate downstream within milliseconds.'
    ],
    paragraph: [
      'Distributed consensus algorithms such as Raft and Paxos tolerate node failures by replicating a log across a quorum of servers; a write is committed only after a majority acknowledges it. The trade-off is latency: every round trip to the quorum adds tens of milliseconds, which is why systems often batch requests, pipeline acknowledgements, and tune heartbeat intervals (typically 50-150 ms) to balance availability against throughput.',
      'In pharmacokinetics, the half-life of a compound (t1/2) describes how long plasma concentration takes to fall by 50%; however, "steady state" is reached only after roughly five half-lives of repeated dosing. Clinicians therefore adjust intervals, not just doses, when renal clearance declines, since accumulation, rather than peak concentration, drives most toxicity.',
      'The 1755 Lisbon earthquake, estimated at magnitude 8.5-9.0, reshaped European philosophy as much as it reshaped the city: Voltaire\'s "Candide" (1759) mocked the optimism of Leibniz, while Kant published three essays proposing natural, rather than divine, causes. Seismology as a discipline arguably begins with the questionnaires that the Marquis of Pombal dispatched to every parish.'
    ],
    quotes: [
      'Complexity is not a badge of honor; it is a debt that compounds. - Anonymous',
      'Precision in language is the first draft of precision in thought. - Anonymous',
      'Measure twice, refactor once, and document the "why", not the "what". - Anonymous'
    ],
    numbers: [
      'Invoice #A-20931: 14 units @ $1,249.50 = $17,493.00 (net 30; 2% discount if paid by 11/15).',
      'Benchmark: p50 = 3.2 ms, p95 = 11.8 ms, p99 = 47.6 ms across 1,000,000 requests (v2.4.1, 8 vCPU).',
      'Flight LX318 departs 06:55 (GMT+1), arrives 09:40 (GMT+2); gate B22, seat 14F, baggage 23 kg max.'
    ]
  }
};

/* ------------------------------------------------------------------------ */
/* Small helpers                                                             */
/* ------------------------------------------------------------------------ */

/**
 * @param {string} text
 * @returns {string} text with common typographic characters mapped to ASCII (nothing stripped)
 */
function mapToAscii(text) {
  let s = String(text == null ? '' : text)
    .replace(/[‘’‚‛′´ʼ]/g, '\'')
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[  -​  　]/g, ' ');
  // Transliterate Latin accented letters: decompose and drop combining marks
  // ("Cafe", "Sao Paulo"), then map letters NFD does not split.
  if (typeof s.normalize === 'function') {
    s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  return s.replace(/[ßæÆœŒøØðÐþÞłŁđĐ]/g, (ch) => SPECIAL_LETTERS[ch] || ch);
}

/** Latin letters that NFD normalisation leaves intact. */
const SPECIAL_LETTERS = {
  'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE',
  'ø': 'o', 'Ø': 'O', 'ð': 'd', 'Ð': 'D', 'þ': 'th', 'Þ': 'Th',
  'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D'
};

/** Max share of characters that may be stripped (non-Latin script) before a text is rejected. */
const MAX_STRIPPED_RATIO = 0.02;

/**
 * True when the text is typeable on a standard keyboard: after mapping
 * typographic punctuation and transliterating accented Latin letters, any
 * remaining non-ASCII characters (e.g. CJK, Cyrillic, Arabic) must make up
 * less than 2% of the text; those few are silently stripped by normalizeText.
 * @param {string} text
 * @returns {boolean}
 */
function isAsciiCompatible(text) {
  const mapped = mapToAscii(text);
  if (!mapped.length) return false;
  const stray = mapped.match(/[^\x20-\x7E\s]/g);
  if (!stray) return true;
  return stray.length / mapped.length < MAX_STRIPPED_RATIO;
}

/**
 * Fisher-Yates shuffle (returns a copy).
 * @template T
 * @param {T[]} list
 * @returns {T[]}
 */
function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * @template T
 * @param {T[]} list
 * @returns {T|undefined}
 */
function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * @param {string[]} list
 * @returns {string[]} de-duplicated (case-insensitive) copy preserving order
 */
function uniq(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/**
 * @param {string} text
 * @returns {number}
 */
function wordCount(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * @param {string} text
 * @returns {string} text ending in sentence punctuation
 */
function ensureTerminal(text) {
  const t = text.trim().replace(/[\s,;:\-]+$/, '');
  return /[.!?]["')\]]*$/.test(t) ? t : `${t}.`;
}

/**
 * @param {string} text
 * @returns {string}
 */
function capitalizeFirst(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/**
 * djb2 hash of a string, base-36 encoded (compact storage key).
 * @param {string} text
 * @returns {string}
 */
function hashText(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/**
 * @returns {Record<string, any>} current settings (empty object if unavailable)
 */
function safeSettings() {
  try {
    const s = getSettings();
    return s && typeof s === 'object' ? s : {};
  } catch (err) {
    console.debug('[textProvider] settings unavailable', err);
    return {};
  }
}

/**
 * @param {string|undefined} level
 * @param {Record<string, any>} settings
 * @returns {string} a valid level
 */
function resolveLevel(level, settings) {
  if (LEVELS.includes(level)) return level;
  if (LEVELS.includes(settings.level)) return settings.level;
  return 'intermediate';
}

/**
 * @param {string|undefined} kind
 * @param {Record<string, any>} settings
 * @returns {string} a valid kind
 */
function resolveKind(kind, settings) {
  if (KINDS.includes(kind)) return kind;
  if (KINDS.includes(settings.kind)) return settings.kind;
  return 'sentences';
}

/**
 * @returns {boolean} whether online providers may be attempted
 */
function canGoOnline() {
  if (typeof fetch !== 'function') return false;
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return false;
  return true;
}

/**
 * Levels ordered by closeness to the requested one (easier level wins ties).
 * @param {string} level
 * @returns {string[]}
 */
function orderLevels(level) {
  const idx = Math.max(0, LEVELS.indexOf(level));
  return LEVELS.slice().sort((a, b) => {
    const da = Math.abs(LEVELS.indexOf(a) - idx);
    const db = Math.abs(LEVELS.indexOf(b) - idx);
    return da - db || LEVELS.indexOf(a) - LEVELS.indexOf(b);
  });
}

/* ------------------------------------------------------------------------ */
/* Public pure helpers                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Normalise text for typing: curly quotes, dashes, ellipsis and non-breaking
 * spaces become ASCII; other non-printable / non-ASCII characters are
 * stripped; whitespace is collapsed to single spaces and trimmed.
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  return mapToAscii(text)
    .replace(/[^\x20-\x7E\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const ABBREVIATION_RE = /(?:^|\s)(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|Ft|Lt|Gen|Col|Capt|Sgt|Inc|Ltd|Co|No|vs|etc|approx|e\.g|i\.e|U\.S|U\.K|[A-Z])\.$/;

/**
 * Split text into sentences. Terminators are . ! ? (optionally followed by a
 * closing quote/bracket) followed by whitespace or end of text. Decimal
 * numbers and common abbreviations (Dr., e.g., initials) are kept intact.
 * @param {string} text
 * @returns {string[]}
 */
export function splitSentences(text) {
  const clean = normalizeText(text);
  if (!clean) return [];
  const parts = clean.split(/([.!?]+["')\]]*)(?=\s+|$)/);
  const out = [];
  let buffer = '';
  for (let i = 0; i < parts.length; i += 2) {
    const body = (parts[i] || '').trim();
    const punct = parts[i + 1] || '';
    const piece = `${buffer ? `${buffer} ` : ''}${body}${punct}`.trim();
    if (!piece) {
      buffer = '';
      continue;
    }
    const hasMore = i + 2 < parts.length && parts.slice(i + 2).some((p) => p && p.trim());
    if (hasMore && ABBREVIATION_RE.test(piece)) {
      buffer = piece;
      continue;
    }
    out.push(piece);
    buffer = '';
  }
  if (buffer) out.push(buffer);
  return out;
}

/**
 * Human readable label for a text source id.
 * @param {string} source
 * @returns {string}
 */
export function getSourceLabel(source) {
  if (Object.prototype.hasOwnProperty.call(SOURCE_LABELS, source)) return SOURCE_LABELS[source];
  return source ? String(source) : 'Unknown';
}

/* ------------------------------------------------------------------------ */
/* Trimming & composition                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Trim text to maxChars, preferring a sentence boundary (if it keeps at least
 * half of the budget), else a word boundary.
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
function trimToMax(text, maxChars) {
  if (!text || !Number.isFinite(maxChars) || maxChars <= 0 || text.length <= maxChars) return text;
  const probe = text.slice(0, maxChars + 1);
  const re = /[.!?]+["')\]]*(?=\s|$)/g;
  let cut = -1;
  let m;
  while ((m = re.exec(probe)) !== null) {
    const end = m.index + m[0].length;
    if (end <= maxChars) cut = end;
  }
  if (cut >= maxChars * 0.5) return text.slice(0, cut).trim();
  const slice = text.slice(0, maxChars);
  const space = /\s/.test(text.charAt(maxChars)) ? maxChars : slice.lastIndexOf(' ');
  if (space > 0) return slice.slice(0, space).replace(/[\s,;:\-("']+$/, '').trim();
  return slice.trim();
}

/**
 * Normalise + trim.
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
function finalize(text, maxChars) {
  return trimToMax(normalizeText(text), maxChars);
}

/**
 * Join random units (sentences / quotes / number lines) until the minimum
 * count is reached and either the target length is met or the next unit
 * would exceed maxChars.
 * @param {string[]} pool
 * @param {{ min: number, max: number, targetChars: number }} rule
 * @param {number} maxChars
 * @returns {string}
 */
function composeUnits(pool, rule, maxChars) {
  const items = shuffle(uniq(pool.map((s) => normalizeText(s)).filter(Boolean)));
  const out = [];
  let length = 0;
  for (const unit of items) {
    if (out.length >= rule.max) break;
    if (out.length >= rule.min && (length >= rule.targetChars || length + unit.length + 1 > maxChars)) break;
    out.push(unit);
    length += unit.length + 1;
  }
  return out.join(' ');
}

/**
 * Filter and shape words from an online word list for the given level.
 * @param {string[]} list
 * @param {string} level
 * @returns {string[]}
 */
function shapeWords(list, level) {
  const rules = LEVEL_RULES[level];
  const seen = new Set();
  const out = [];
  for (const raw of shuffle(list)) {
    if (typeof raw !== 'string' || !isAsciiCompatible(raw)) continue;
    const word = normalizeText(raw).toLowerCase();
    if (!rules.wordRe.test(word) || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= rules.wordCount) break;
  }
  if (rules.capitalize > 0) {
    return out.map((w) => (Math.random() < rules.capitalize ? capitalizeFirst(w) : w));
  }
  return out;
}

/** Keeps online content family friendly (local bank is curated already). */
const UNSUITABLE_RE = /\b(?:bastard|damn|hell|crap|shit|fuck|piss|bitch|sex|sexy|porn|drunk|kill|murder|suicide|nude|naked|dead|die|dies|died)\w*/i;

/**
 * Clean-up applied to online items only: backticks used as apostrophes.
 * @param {string} raw
 * @returns {string}
 */
function cleanOnline(raw) {
  return String(raw).replace(/`/g, '\'');
}

/**
 * Whether a sentence unit from an online source is acceptable for getText.
 * @param {string} raw
 * @param {number} maxWords
 * @returns {boolean}
 */
function acceptUnit(raw, maxWords) {
  if (typeof raw !== 'string' || !isAsciiCompatible(raw)) return false;
  const text = normalizeText(raw);
  if (text.length < 8 || /https?:|www\./i.test(text) || UNSUITABLE_RE.test(text)) return false;
  const words = wordCount(text);
  return words >= 2 && words <= maxWords;
}

/**
 * Whether a sentence fits the dictation/shadowing constraints.
 * @param {string} sentence
 * @param {number} maxWords
 * @returns {boolean}
 */
function sentenceFits(sentence, maxWords) {
  if (!sentence || sentence.length < 6 || /https?:|www\./i.test(sentence) || UNSUITABLE_RE.test(sentence)) return false;
  const words = wordCount(sentence);
  return words >= 2 && words <= maxWords;
}

/**
 * Format a quote as "Quote text. - Author".
 * @param {string} quote
 * @param {string} author
 * @returns {string}
 */
function formatQuote(quote, author) {
  const text = ensureTerminal(normalizeText(quote));
  const by = normalizeText(author) || 'Unknown';
  return `${text} - ${by}`;
}

/* ------------------------------------------------------------------------ */
/* Online providers                                                          */
/* ------------------------------------------------------------------------ */

/**
 * @param {string} url
 * @param {AbortSignal} signal
 * @returns {Promise<any>}
 */
async function fetchJson(url, signal) {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/**
 * Run a task with an AbortController timeout.
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} task
 * @param {number} [ms]
 * @returns {Promise<T>}
 */
async function withTimeout(task, ms = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await task(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {any} value
 * @returns {string}
 */
function str(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * Provider registry. fetch(signal, req) resolves to a string, an array of
 * strings, or { text, title } (Wikipedia).
 * @type {Array<{ name: string, supports: (req: { level: string, kind: string }) => boolean, fetch: (signal: AbortSignal, req: { level: string, kind: string }) => Promise<string|string[]|{ text: string, title?: string }> }>}
 */
const PROVIDERS = [
  {
    name: 'wikipedia',
    supports: ({ level, kind }) => kind === 'paragraph' && (level === 'advanced' || level === 'expert'),
    async fetch(signal) {
      const data = await fetchJson('https://en.wikipedia.org/api/rest_v1/page/random/summary', signal);
      const extract = str(data && data.extract);
      if ((data && data.type === 'disambiguation') || extract.length < MIN_WIKI_CHARS || /may refer to/i.test(extract)) {
        throw new Error('unsuitable Wikipedia extract');
      }
      return { text: extract, title: str(data.title) };
    }
  },
  {
    name: 'dummyjson',
    supports: ({ level, kind }) => kind === 'quotes' || (kind === 'sentences' && level !== 'beginner'),
    async fetch(signal, req) {
      const data = await fetchJson('https://dummyjson.com/quotes/random', signal);
      const quote = str(data && data.quote).trim();
      const author = str(data && data.author).trim();
      if (!quote || !isAsciiCompatible(quote + author)) throw new Error('unusable quote');
      // Some entries arrive in Title Case ("Money Demands That You Sell"); skip them.
      const qWords = quote.split(/\s+/).filter((w) => w.length > 3);
      const capitalised = qWords.filter((w) => /^[A-Z]/.test(w)).length;
      if (qWords.length >= 4 && capitalised / qWords.length > 0.6) throw new Error('title-case quote');
      if (UNSUITABLE_RE.test(quote)) throw new Error('unsuitable quote');
      return req.kind === 'quotes' ? formatQuote(quote, author) : quote;
    }
  },
  {
    name: 'uselessfacts',
    supports: ({ level, kind }) => kind === 'sentences' && level !== 'beginner',
    async fetch(signal) {
      const data = await fetchJson('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en', signal);
      const text = str(data && data.text).trim();
      if (!text) throw new Error('empty fact');
      return text;
    }
  },
  {
    name: 'adviceslip',
    supports: ({ level, kind }) => kind === 'sentences' && (level === 'beginner' || level === 'intermediate'),
    async fetch(signal) {
      // Advice Slip caches aggressively; a unique query string yields a fresh slip.
      const bust = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
      const data = await fetchJson(`https://api.adviceslip.com/advice?t=${bust}`, signal);
      const text = str(data && data.slip && data.slip.advice).trim();
      if (!text) throw new Error('empty advice');
      return text;
    }
  },
  {
    name: 'randomword',
    supports: ({ kind }) => kind === 'words',
    async fetch(signal, req) {
      const n = req.level === 'beginner' ? 120 : 60;
      // Primary host first; the original Heroku deployment (also CORS-enabled) is the backup.
      const urls = [
        `https://random-word-api.vercel.app/api?words=${n}`,
        `https://random-word-api.herokuapp.com/word?number=${n}`
      ];
      let lastError = new Error('no word list');
      for (const url of urls) {
        if (signal.aborted) break;
        try {
          const data = await fetchJson(url, signal);
          if (!Array.isArray(data)) throw new Error('unexpected word list');
          return data.filter((w) => typeof w === 'string');
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError;
    }
  }
];

/**
 * Normalise a provider result into a list of strings.
 * @param {any} value
 * @returns {string[]}
 */
function toList(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string').map(cleanOnline);
  if (value && typeof value === 'object' && typeof value.text === 'string') return [cleanOnline(value.text)];
  return typeof value === 'string' ? [cleanOnline(value)] : [];
}

/**
 * Fetch several independent items from a single-item provider in parallel.
 * @param {typeof PROVIDERS[number]} provider
 * @param {{ level: string, kind: string }} req
 * @param {number} n
 * @returns {Promise<string[]>}
 */
async function collectItems(provider, req, n) {
  const results = await Promise.allSettled(
    Array.from({ length: n }, () => withTimeout((signal) => provider.fetch(signal, req)))
  );
  const items = [];
  for (const r of results) {
    if (r.status === 'fulfilled') items.push(...toList(r.value));
  }
  return items;
}

/**
 * Produce a shaped text from one online provider. Throws on any problem.
 * @param {typeof PROVIDERS[number]} provider
 * @param {{ level: string, kind: string, maxChars: number }} req
 * @returns {Promise<{ text: string, title?: string }>}
 */
async function fromProvider(provider, req) {
  const rules = LEVEL_RULES[req.level];
  switch (req.kind) {
    case 'words': {
      const raw = await withTimeout((signal) => provider.fetch(signal, req));
      const list = Array.isArray(raw) ? raw : String(raw).split(/\s+/);
      const words = shapeWords(list, req.level);
      if (words.length < MIN_ONLINE_WORDS) throw new Error('not enough usable words');
      return { text: words.join(' ') };
    }
    case 'paragraph': {
      const raw = await withTimeout((signal) => provider.fetch(signal, req));
      const item = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? { text: cleanOnline(raw.text), title: raw.title }
        : { text: toList(raw).join(' ') };
      if (!isAsciiCompatible(item.text) || UNSUITABLE_RE.test(item.text)) throw new Error('unsuitable paragraph');
      const text = normalizeText(item.text);
      if (text.length < MIN_WIKI_CHARS) throw new Error('paragraph too short');
      return item.title ? { text, title: normalizeText(item.title) } : { text };
    }
    case 'sentences':
    case 'quotes': {
      const isQuotes = req.kind === 'quotes';
      const rule = isQuotes
        ? { min: 2, max: rules.quoteCount, targetChars: rules.targetChars }
        : { min: rules.sentenceMin, max: rules.sentenceMax, targetChars: rules.targetChars };
      const items = await collectItems(provider, req, rule.max + 1);
      const maxWords = isQuotes ? rules.sentenceWords + 6 : rules.sentenceWords;
      const usable = uniq(
        items
          .filter((s) => acceptUnit(s, maxWords))
          .map((s) => (isQuotes ? normalizeText(s) : capitalizeFirst(ensureTerminal(normalizeText(s)))))
      );
      if (usable.length < rule.min) throw new Error('not enough usable sentences');
      return { text: composeUnits(usable, rule, req.maxChars) };
    }
    default:
      throw new Error(`kind ${req.kind} is local only`);
  }
}

/* ------------------------------------------------------------------------ */
/* Local bank                                                                */
/* ------------------------------------------------------------------------ */

/** @type {Promise<Record<string, any>>|null} */
let bankPromise = null;

/**
 * Load data/texts.json once (cached promise). Falls back to the emergency
 * bank when the fetch fails (file:// protocol, offline first load, etc.).
 * @returns {Promise<Record<string, any>>}
 */
function loadBank() {
  if (!bankPromise) {
    bankPromise = (async () => {
      try {
        const url = new URL('../data/texts.json', import.meta.url);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data || typeof data !== 'object') throw new Error('invalid bank');
        return data;
      } catch (err) {
        console.debug('[textProvider] local bank unavailable, using emergency bank', err);
        return EMERGENCY_BANK;
      }
    })();
  }
  return bankPromise;
}

/**
 * Find a non-empty pool for level/kind, falling back to neighbouring levels,
 * the emergency bank and finally other kinds.
 * @param {Record<string, any>} bank
 * @param {string} level
 * @param {string} kind
 * @returns {{ items: string[], level: string, kind: string }}
 */
function getPool(bank, level, kind) {
  const levelOrder = orderLevels(level);
  const kindOrder = [kind, ...(KIND_FALLBACK[kind] || []), ...KINDS].filter((k, i, a) => a.indexOf(k) === i);
  for (const k of kindOrder) {
    for (const source of [bank, EMERGENCY_BANK]) {
      for (const l of levelOrder) {
        const raw = source && source[l] && Array.isArray(source[l][k]) ? source[l][k] : [];
        const items = raw.filter((x) => typeof x === 'string' && x.trim());
        if (items.length) return { items, level: l, kind: k };
      }
    }
  }
  return { items: ['The quick brown fox jumps over the lazy dog.'], level, kind: 'sentences' };
}

/**
 * Compose a text from the local bank.
 * @param {{ level: string, kind: string, maxChars: number }} req
 * @returns {Promise<{ text: string, source: string }>}
 */
async function fromLocal(req) {
  const bank = await loadBank();
  return { ...composeLocal(bank, req), source: 'local' };
}

/**
 * @param {Record<string, any>} bank
 * @param {{ level: string, kind: string, maxChars: number }} req
 * @returns {{ text: string }}
 */
function composeLocal(bank, req) {
  const rules = LEVEL_RULES[req.level];
  const pool = getPool(bank, req.level, req.kind);
  let text = '';
  switch (pool.kind) {
    case 'words': {
      const entries = shuffle(pool.items).slice(0, 2);
      const words = uniq(normalizeText(entries.join(' ')).split(' ').filter(Boolean));
      text = shuffle(words).slice(0, rules.wordCount).join(' ');
      break;
    }
    case 'paragraph':
      text = pick(pool.items) || '';
      break;
    case 'quotes':
      text = composeUnits(pool.items, { min: 2, max: rules.quoteCount, targetChars: rules.targetChars }, req.maxChars);
      break;
    case 'numbers':
      text = composeUnits(pool.items, { min: Math.min(3, rules.numberCount), max: rules.numberCount, targetChars: rules.targetChars }, req.maxChars);
      break;
    default:
      text = composeUnits(pool.items, { min: rules.sentenceMin, max: rules.sentenceMax, targetChars: rules.targetChars }, req.maxChars);
  }
  if (!text) text = pool.items[0] || '';
  return { text: finalize(text, req.maxChars) };
}

/* ------------------------------------------------------------------------ */
/* Recent-text memory                                                        */
/* ------------------------------------------------------------------------ */

/**
 * @returns {string[]}
 */
function readRecent() {
  try {
    const value = storageGet(RECENT_KEY, []);
    return Array.isArray(value) ? value.filter((x) => typeof x === 'string') : [];
  } catch (err) {
    return [];
  }
}

/**
 * @param {string} hash
 * @returns {boolean}
 */
function isRecent(hash) {
  return readRecent().includes(hash);
}

/**
 * @param {string} hash
 */
function remember(hash) {
  const list = readRecent().filter((h) => h !== hash);
  list.push(hash);
  while (list.length > RECENT_LIMIT) list.shift();
  try {
    storageSet(RECENT_KEY, list);
  } catch (err) {
    console.debug('[textProvider] could not persist recent texts', err);
  }
}

/* ------------------------------------------------------------------------ */
/* Public API                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Produce one candidate text: online (random provider order, ~70% of the
 * time when online) with local fallback.
 * @param {{ level: string, kind: string, maxChars: number }} req
 * @returns {Promise<{ text: string, source: string, title?: string }>}
 */
async function produce(req) {
  if (canGoOnline() && Math.random() >= LOCAL_MIX_RATE) {
    const providers = shuffle(PROVIDERS.filter((p) => {
      try {
        return p.supports(req);
      } catch (err) {
        return false;
      }
    }));
    for (const provider of providers) {
      try {
        const result = await fromProvider(provider, req);
        const text = trimToMax(result.text, req.maxChars);
        if (text) {
          const out = { text, source: provider.name };
          if (result.title) out.title = result.title;
          return out;
        }
      } catch (err) {
        console.debug(`[textProvider] provider ${provider.name} failed`, err && err.message ? err.message : err);
      }
    }
  }
  return fromLocal(req);
}

/**
 * Get a practice text.
 *
 * Tries online providers suited to level/kind (3 s timeout each, randomised
 * order, ~30% of requests go straight to the local bank for variety), falls
 * back to data/texts.json, and avoids repeating any of the last 20 texts
 * (storage key 'recentTexts'; up to 3 attempts, then accepts a repeat).
 * The result is normalised and trimmed to maxChars at a sentence or word
 * boundary. With custom=true the user's settings.customText is returned
 * (source 'custom'); when maxChars is passed explicitly the custom text is
 * trimmed to it, otherwise it is kept whole (hard cap 5000 chars). An empty
 * custom text falls back to the local bank.
 *
 * @param {{ level?: string, kind?: string, maxChars?: number, custom?: boolean }} [options]
 * @returns {Promise<{ text: string, source: string, title?: string }>}
 */
export async function getText({ level, kind, maxChars, custom = false } = {}) {
  const settings = safeSettings();
  const lvl = resolveLevel(level, settings);
  const knd = resolveKind(kind, settings);
  const explicitMax = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 0;
  const limit = explicitMax || DEFAULT_MAX_CHARS;
  const req = { level: lvl, kind: knd, maxChars: limit };

  if (custom) {
    const customText = normalizeText(settings.customText);
    if (customText) {
      return { text: trimToMax(customText, explicitMax || CUSTOM_HARD_CAP), source: 'custom' };
    }
    try {
      const local = await fromLocal(req);
      remember(hashText(local.text));
      return local;
    } catch (err) {
      console.debug('[textProvider] local fallback failed', err);
      return { ...composeLocal(EMERGENCY_BANK, req), source: 'local' };
    }
  }

  let result = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let candidate = null;
    try {
      candidate = await produce(req);
    } catch (err) {
      console.debug('[textProvider] produce failed', err);
    }
    if (!candidate || !candidate.text) continue;
    result = candidate;
    if (!isRecent(hashText(candidate.text))) break;
  }
  if (!result || !result.text) {
    result = { ...composeLocal(EMERGENCY_BANK, req), source: 'local' };
  }
  remember(hashText(result.text));
  return result;
}

/**
 * Get short sentences for dictation / shadowing.
 *
 * Pulls from Advice Slip / Useless Facts / DummyJSON (per level) and the
 * local sentence bank, splits into single sentences, filters by maxWords
 * (default per level: beginner 8, intermediate 14, advanced 20, expert 28),
 * de-duplicates and returns `count` items. With custom=true the user's
 * settings.customText is split into sentences and returned in full (no word
 * filter); an empty custom text falls back to the normal flow.
 *
 * @param {{ level?: string, count?: number, maxWords?: number, custom?: boolean }} [options]
 * @returns {Promise<string[]>}
 */
export async function getSentences({ level, count = 5, maxWords, custom = false } = {}) {
  const settings = safeSettings();
  const lvl = resolveLevel(level, settings);
  const limit = Number.isFinite(maxWords) && maxWords > 0 ? Math.floor(maxWords) : SENTENCE_MAX_WORDS[lvl];
  const wanted = Math.max(1, Math.floor(Number(count) || 5));

  if (custom) {
    const parts = splitSentences(settings.customText);
    if (parts.length) return parts.slice(0, CUSTOM_SENTENCE_CAP);
  }

  const accepted = [];
  const seen = new Set();
  const add = (sentence) => {
    const key = sentence.toLowerCase();
    if (seen.has(key) || !sentenceFits(sentence, limit)) return;
    seen.add(key);
    accepted.push(sentence);
  };

  if (canGoOnline() && Math.random() >= LOCAL_MIX_RATE) {
    const req = { level: lvl, kind: 'sentences' };
    const providers = shuffle(PROVIDERS.filter((p) => p.supports(req)));
    for (const provider of providers) {
      if (accepted.length >= wanted) break;
      try {
        const items = await collectItems(provider, req, wanted - accepted.length + 1);
        for (const raw of items) {
          if (!isAsciiCompatible(raw)) continue;
          for (const piece of splitSentences(raw)) add(capitalizeFirst(ensureTerminal(piece)));
        }
      } catch (err) {
        console.debug(`[textProvider] provider ${provider.name} failed`, err && err.message ? err.message : err);
      }
    }
  }

  if (accepted.length < wanted) {
    let pool;
    try {
      pool = getPool(await loadBank(), lvl, 'sentences');
    } catch (err) {
      pool = getPool(EMERGENCY_BANK, lvl, 'sentences');
    }
    const local = shuffle(pool.items);
    for (const entry of local) {
      if (accepted.length >= wanted) break;
      for (const piece of splitSentences(entry)) add(piece);
    }
    if (accepted.length < wanted) {
      // Relax the word limit rather than return too few sentences.
      for (const entry of local) {
        if (accepted.length >= wanted) break;
        const sentence = normalizeText(entry);
        const key = sentence.toLowerCase();
        if (sentence && !seen.has(key)) {
          seen.add(key);
          accepted.push(sentence);
        }
      }
    }
  }

  return accepted.slice(0, wanted);
}
