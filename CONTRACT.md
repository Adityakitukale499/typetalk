# TypeTalk — Build Contract (READ FULLY BEFORE WRITING CODE)

Static, frontend-only typing / listening / speaking practice app. Plain HTML + CSS + vanilla JS
(ES modules, `<script type="module">`). NO framework, NO bundler, NO npm, NO backend. Must run from
any static host (GitHub Pages, Netlify). Lightweight: no external JS libraries at all.
Only external resource allowed: Google Fonts "Inter" (optional, with system-ui fallback).
Visual reference: https://www.typing.com/student/tests — clean, friendly, card based, big readable
test text, on-screen keyboard, blue primary, soft shadows, rounded corners, light & dark theme.

Every agent owns ONLY the files assigned to it. Never edit another agent's files. Code against the
APIs below exactly (names, signatures, shapes). All imports use relative paths like `./storage.js`
or `../ui.js`. Use `export function name()` named exports (no default exports). Mode modules export
`mount` and `unmount` as named exports. 2-space indent, semicolons, JSDoc on exported functions.
No TypeScript. Must work in Chrome, Edge, Safari, Firefox (speech-recognition modes degrade
gracefully in Firefox).

## 1. File layout

```
index.html                     core-shell agent
manifest.webmanifest, sw.js    pwa agent
icons/icon.svg                 pwa agent
css/styles.css                 core-shell agent (design system + layout + shared components + home + settings drawer + custom page)
css/typing.css                 typing-mode agent
css/dictation.css              dictation-mode agent
css/speaking.css               speaking-mode agent
css/shadowing.css              shadowing-mode agent
css/results.css                results agent
css/dashboard.css              dashboard agent
css/keyboard.css               keyboard agent
js/app.js                      core-shell agent (router, topbar, home screen, settings drawer, custom-text page, theme)
js/ui.js                       core-shell agent (toast, modal, confetti, DOM helpers, formatters, icons)
js/storage.js                  data agent
js/settings.js                 data agent
js/stats.js                    data agent
js/milestones.js               milestones agent
js/textProvider.js             text-provider agent
data/texts.json                text-bank agent
js/speech.js                   speech agent (TTS + recognition + word diff)
js/audio.js                    audio agent
js/keyboard.js                 keyboard agent
js/charts.js                   dashboard agent
js/results.js                  results agent
js/modes/typing.js             typing-mode agent
js/modes/dictation.js          dictation-mode agent
js/modes/speaking.js           speaking-mode agent
js/modes/shadowing.js          shadowing-mode agent
js/modes/dashboard.js          dashboard agent
README.md                      pwa agent (features + deploy guide)
```

## 2. Routing & mode module interface (app.js owns the router)

Hash routes: `#/` home, `#/typing`, `#/dictation`, `#/speaking`, `#/shadowing`, `#/dashboard`,
`#/custom`. Query params after `?` e.g. `#/typing?kind=sentences&level=intermediate&duration=60`.
app.js lazy-loads `./modes/<name>.js` via dynamic `import()` and calls:

```js
export async function mount(root, params) {}  // root: HTMLElement (empty <main id="app">), params: plain object of query params (strings)
export function unmount() {}                   // stop timers, speech, recognizers, listeners
```

Params every mode must accept (all optional, fall back to settings): `level`, `kind`, `duration`
(seconds as string; `0` = until passage finished), `custom=1` (use settings.customText as the
text). Each mode's CSS file is linked in index.html (all CSS loaded up front; it is small).
Modes navigate with `location.hash = '#/...'`.

## 3. Design tokens (css/styles.css defines on `:root`; dark via `html[data-theme="dark"]`)

```
--bg            page background       light #f3f6fb   dark #0f1420
--surface       cards/topbar          light #ffffff   dark #171d2b
--surface-2     inset areas, keys     light #eef2f8   dark #1f2736
--text          primary text          light #1b2430   dark #e6ebf3
--text-muted    secondary text        light #6b7a90   dark #94a3b8
--border        hairlines             light #dfe6f0   dark #2a3446
--primary       #3b6cf6   --primary-hover #2f5be0   --primary-contrast #ffffff   --primary-soft (12% tint of primary)
--accent        #14b8a6 (teal)   --accent-soft
--success       #22c55e   --success-soft
--error         #ef4444   --error-soft
--warning       #f59e0b   --warning-soft
--radius-sm 8px  --radius 14px  --radius-lg 20px
--shadow-sm, --shadow, --shadow-lg  (soft, low-opacity)
--font: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif
--mono: ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace
--container: 1100px  (max content width)
--topbar-h: 64px
```
Theme is applied by app.js as `document.documentElement.dataset.theme = 'light' | 'dark'`
(settings.theme 'auto' resolves via prefers-color-scheme). Respect `prefers-reduced-motion` and
`html[data-reduce-motion="true"]` (app.js sets it from settings.reduceMotion).

## 4. Shared CSS component classes (styles.css MUST implement; all agents MAY use)

```
.container                      centered max-width wrapper with 16px side padding
.card                           surface, radius, shadow, padding 20px
.card.card-hover                lift on hover
.btn  .btn-primary  .btn-ghost  .btn-outline  .btn-danger  .btn-sm  .btn-lg  .btn-icon (square, icon only)
.chip  .chip.active             pill selector (used for level / kind / duration pickers)
.chip-group                     flex wrap of chips
.segmented  .segmented > button  .segmented > button.active    segmented control
.select  .input  .textarea      form controls
.range                          <input type="range" class="range"> styled (used for volume / speed)
.toggle                         <label class="toggle"><input type="checkbox"><span class="toggle-track"></span></label> switch
.stat-tile  .stat-tile .value  .stat-tile .label       big number tile
.stat-pill  .stat-pill .value  .stat-pill .label       small inline live stat
.badge                          small rounded label; variants .badge-success .badge-error .badge-warning .badge-primary
.progress  .progress > .bar     progress bar (width set inline)
.grid  .grid-2  .grid-3  .grid-4   responsive grids (collapse to 1 col under 640px)
.flex  .flex-center  .flex-between  .gap-sm  .gap  .gap-lg   utilities (flex = display:flex; align-items:center)
.text-muted  .text-center  .mt  .mb  .mt-lg  .mb-lg    utilities
.page-title  .page-subtitle
.sr-only
.notice  .notice-warning  .notice-info    callout boxes (e.g. "Speech recognition needs Chrome/Edge")
.kbd                            keyboard key hint inline (e.g. <span class="kbd">Esc</span>)
.mode-header                    flex-between row at top of a mode screen (title left, controls right)
```
Icons: inline SVG via `icon(name)` from ui.js (24px, stroke 2, currentColor, Lucide style). No icon fonts.

## 5. Module APIs

### js/storage.js (prefix every key with `typetalk:`)
```js
export function storageGet(key, fallback)      // JSON parse, returns fallback on missing/parse error
export function storageSet(key, value)         // JSON stringify; swallow quota errors (console.warn)
export function storageRemove(key)
export function exportData()                   // -> JSON string {version:1, exportedAt, data:{key:value}} of all typetalk:* entries (key without prefix)
export function importData(jsonString)         // -> boolean success; merges/overwrites keys
export function resetData()                    // removes all typetalk:* keys
```

### js/settings.js
```js
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
export function getSettings()                  // -> full object (DEFAULTS merged with stored)
export function getSetting(key)
export function setSetting(key, value)         // persists via storage, notifies listeners
export function setSettings(partialObject)
export function resetSettings()
export function onSettingsChange(cb)           // cb(settings, changedKeys[]) ; returns unsubscribe fn
```

### Result object (produced by modes, consumed by stats/milestones/results)
```js
{
  id: string,                 // assigned by stats.recordResult
  mode: 'typing' | 'dictation' | 'speaking' | 'shadowing',
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert',
  kind: string,               // 'words' | 'sentences' | 'paragraph' | 'quotes' | 'numbers' | 'custom'
  wpm: number,                // net WPM (typing) or spoken WPM (speaking); rounded int
  rawWpm: number,             // gross WPM, rounded int (speaking: same as wpm)
  accuracy: number,           // 0..100, one decimal
  durationSec: number,
  chars: number,              // total chars attempted (typing) / total words*5 (speaking)
  correctChars: number,
  errors: number,             // total mistakes made (including corrected ones)
  words: number,              // words completed correctly
  keyErrors: { [char]: count }, // per-key mistakes (typing & dictation); {} for speech modes
  timestamp: number,          // Date.now()
  source: string,             // text source name e.g. 'wikipedia' | 'local'
  text: string                // the target text (truncated to 500 chars)
}
```

### js/stats.js
```js
export function computeWpm(correctChars, seconds)             // -> Math.round((correctChars/5)/(seconds/60)); 0 if seconds<=0
export function computeAccuracy(correctChars, totalChars)      // -> number 0..100, 1 decimal; 0 if totalChars<=0
export function recordResult(result)                          // assigns id + timestamp if missing, stores in history (cap 500 newest), updates totals/daily/bests; returns stored result with isNewPb: boolean
export function getHistory({ mode, limit } = {})              // newest first
export function getPersonalBests()                            // -> { typing:{wpm, accuracy}, dictation:{...}, speaking:{...}, shadowing:{...} } (0s when none)
export function getTotals()                                   // -> { tests, words, chars, seconds, errors, byMode:{typing:count, dictation, speaking, shadowing} }
export function getDailyCounts()                              // -> { 'YYYY-MM-DD': testsCount }
export function getStreak()                                   // -> { current, longest, todayCount, goal, goalMet }  (a day counts toward streak if >=1 test)
export function getKeyErrorTotals()                           // -> { [char]: count } aggregated over history
export function getTodayKey()                                 // 'YYYY-MM-DD' local date
export function getModesToday()                               // -> string[] distinct modes practised today
```

### js/milestones.js
```js
export const LEVEL_TITLES = [...]                             // 50 titles; e.g. 'Novice','Beginner','Typist',... 'Keyboard Legend'
export const BADGES = [ { id, name, description, icon (emoji string), category: 'tests'|'speed'|'accuracy'|'volume'|'listening'|'speaking'|'streak'|'special' } ]
export function processResult(storedResult)                   // -> { xpGained, levelBefore, levelAfter, leveledUp: boolean, newBadges: Badge[] } ; persists xp + unlocked. Call AFTER stats.recordResult.
export function getXp()                                       // total xp
export function getLevel()                                    // -> { level, title, xp, xpIntoLevel, xpForNext, progress (0..1) }
export function getUnlockedBadges()                           // -> [{ ...badge, unlockedAt }]
export function getAllBadgesWithStatus()                      // -> [{ ...badge, unlocked: boolean, unlockedAt?, progress?: {current, target} }]
```
XP formula: `round(words * (accuracy/100)^2 * modeMultiplier)` (typing 1, dictation 1.5, speaking 1.5, shadowing 2) + bonuses (new PB +25, accuracy 100 +20), minimum 1. Level curve: cumulative xp needed to reach level n (1-based, level 1 at 0 xp) = sum of 100 * k^1.5 for k=1..n-1, capped at level 50.
Badges (minimum): first test; 10/50/100/500 tests; WPM 20/40/60/80/100 (typing mode); accuracy >=95% (>=50 chars) / 100% (>=50 chars);
total words 1k/10k/100k; dictation accuracy >=90%; speaking accuracy >=95%; all 4 modes in one day (stats.getModesToday);
streak 3/7/30 days; night owl (test between 00:00-04:00); early bird (05:00-07:00); marathon (durationSec >= 300).

### js/textProvider.js
```js
export const KINDS  = ['words','sentences','paragraph','quotes','numbers'];
export const LEVELS = ['beginner','intermediate','advanced','expert'];
export async function getText({ level, kind, maxChars = 600, custom = false })
   // -> { text, source, title? }   source e.g. 'wikipedia' | 'dummyjson' | 'uselessfacts' | 'adviceslip' | 'randomword' | 'local' | 'custom'
   // Tries online providers appropriate for level/kind with 3s timeout each (AbortController), then local data/texts.json (fetched once & cached, path resolved relative to the module: new URL('../data/texts.json', import.meta.url)), never repeats last 20 texts (storage key 'recentTexts'). Normalises: collapse whitespace, replace curly quotes/dashes with ASCII, strip non-printable, trim to maxChars at a sentence/word boundary. custom=true returns settings.customText (normalised) with source 'custom'; if customText is empty, fall back to local.
export async function getSentences({ level, count = 5, maxWords = 14, custom = false })
   // -> string[] short sentences for dictation/shadowing (beginner <= 8 words, intermediate <= 14, advanced <= 20, expert <= 28); custom=true splits settings.customText
export function splitSentences(text)         // -> string[]
export function normalizeText(text)          // -> string
```
Online sources (CORS-enabled, no key): Wikipedia `https://en.wikipedia.org/api/rest_v1/page/random/summary` (field `extract`) for paragraph on advanced/expert; DummyJSON `https://dummyjson.com/quotes/random` (`quote`, `author`) for quotes/sentences; Useless Facts `https://uselessfacts.jsph.pl/api/v2/facts/random?language=en` (`text`) sentences; Advice Slip `https://api.adviceslip.com/advice` (`slip.advice`) beginner sentences; Random Word `https://random-word-api.vercel.app/api?words=60` (array) words (beginner words should be filtered to <= 6 letters). If `navigator.onLine === false` skip straight to local. Local bank is always the fallback and is also mixed in randomly (~30%) so content varies.

### data/texts.json (local bank)
```json
{
  "version": 1,
  "beginner":     { "words": ["the and for ..."], "sentences": ["..."], "paragraph": ["..."] },
  "intermediate": { "words": [...], "sentences": [...], "paragraph": [...], "quotes": [...] },
  "advanced":     { "words": [...], "sentences": [...], "paragraph": [...], "quotes": [...], "numbers": [...] },
  "expert":       { "words": [...], "sentences": [...], "paragraph": [...], "quotes": [...], "numbers": [...] }
}
```
Each `words` entry is one string of ~40 space-separated words. Minimum counts: `words` 12 entries; `sentences` 40; `paragraph` 15 (300-600 chars); `quotes` 25 (format `Quote text. - Author`); `numbers` 15 (digits, dates, prices, symbols, e.g. `Order #4821 ships on 12/03 for $19.99 (incl. 8% tax).`). ASCII only. Original, family-friendly, varied topics. Beginner = lowercase common words, short simple sentences, no punctuation except period. Expert paragraphs include technical vocabulary and rich punctuation.

### js/speech.js
```js
export function isTtsSupported()
export function isRecognitionSupported()
export async function getVoices()                     // -> SpeechSynthesisVoice[] (waits for voiceschanged up to 1.5s), English voices first
export function speak(text, { rate, pitch, volume, voiceURI, lang } = {})   // -> Promise<void> resolves on end/cancel; cancels any current speech first; defaults from settings
export function stopSpeaking()
export function isSpeaking()
export function createRecognizer({ lang, interim = true, continuous = true } = {})
   // -> { start(), stop(), abort(), onResult(cb), onEnd(cb), onError(cb), isListening() }
   // onResult cb receives ({ finalTranscript, interimTranscript }) where finalTranscript accumulates across results; auto-restarts on 'no-speech' / unexpected end while continuous & started; onError cb receives (errorCode: string)
export function normalizeWords(text)                  // -> string[] lowercase, strip punctuation, numbers kept
export function compareWords(expectedText, spokenText)
   // -> { accuracy (0..100, 1 decimal), matched, total, extra, tokens: [{ word, status: 'ok'|'missed'|'wrong', heard?: string }] }
   // LCS alignment; 'wrong' when a different word fills the slot (heard = what was said); tokens preserve original expected words (with punctuation) in order
```

### js/audio.js (Web Audio API, synthesized, no files)
```js
export function initAudio()        // create/resume AudioContext (call on first user gesture); safe to call repeatedly
export function playKey()          // soft short click
export function playError()        // low thud
export function playSuccess()      // short rising chime (test complete)
export function playUnlock()       // sparkle arpeggio (badge / level up)
export function playTick()         // countdown tick
export function setVolume(v)       // 0..1 ; persists via settings.soundVolume
export function getVolume()
export function setMuted(bool)     // persists settings.soundMuted
export function isMuted()
```
audio.js subscribes to onSettingsChange so changes from the settings drawer apply live. All play* are no-ops when muted or when context unavailable.

### js/keyboard.js (+ css/keyboard.css)
```js
export function createKeyboard(container, { compact = false } = {})
   // renders QWERTY (number row with symbols, 3 letter rows with punctuation, bottom row: Shift, Space, Shift; plus Backspace & Enter)
   // -> { highlightNext(char), pressKey(char, correct), clearHighlight(), setHeatmap({ [char]: count }), destroy() }
   // highlightNext: marks key (and Shift when uppercase/shifted symbol) with .key-next; char ' ' = space
   // pressKey: brief .key-correct / .key-wrong animation (~150ms)
   // setHeatmap: colors keys by error intensity (data-heat="0".."4"), used by dashboard
```
Keyboard container class `.vkeyboard`; hidden by CSS under 700px width.

### js/ui.js
```js
export function h(tag, attrs = {}, ...children)      // DOM helper: attrs supports class/className, dataset (object), style (object or string), on<Event> handlers (e.g. onClick), html (innerHTML), any other attribute via setAttribute; children: strings/nodes/arrays/null/false
export function toast(message, { type = 'info', icon = '', duration = 3000 } = {})   // type 'info'|'success'|'error'|'warning'; renders into #toast-root
export function openModal({ title, content, actions = [], onClose })    // content: HTMLElement | html string; actions: [{ label, onClick, variant: 'primary'|'ghost'|'danger' }]; renders into #modal-root; returns close fn; Esc closes
export function closeModal()
export function confetti({ duration = 1800, count = 120 } = {})           // canvas overlay, respects reduced motion
export function formatDuration(seconds)             // 65 -> '1:05'
export function formatDate(ts)                      // 'Oct 24'
export function icon(name)                          // -> inline svg string for: 'keyboard','headphones','mic','mic-off','repeat','chart','home','settings','sun','moon','volume','volume-off','play','pause','stop','refresh','arrow-right','arrow-left','check','x','flame','trophy','star','clock','zap','target','award','upload','download','trash','info','file-text','eye','eye-off','skip-forward','menu'
export function starsFor(result)                    // -> 0..3 : 3 if accuracy>=97 && (wpm>=40 || mode is speech); 2 if accuracy>=90; 1 if accuracy>=70; else 0
```

### js/charts.js (pure SVG, responsive via viewBox + width:100%, uses CSS vars for colors)
```js
export function renderLineChart(container, { series: [{ name, color, points: [{ x: number, y: number }] }], yLabel = '', height = 220, showDots = true, xLabels = [] })
   // x is an index or timestamp; xLabels optional strings per point for axis
export function renderBarChart(container, { labels: string[], values: number[], color = 'var(--primary)', height = 200 })
export function renderCalendarHeatmap(container, { counts: { 'YYYY-MM-DD': n }, weeks = 20, goal = 5 })   // GitHub-style, tooltip via title
export function renderRing(container, { value, max, label = '', sublabel = '', color = 'var(--primary)', size = 120 })   // circular progress with centered text
```
All render* clear the container first and show a friendly "Not enough data yet" message when empty.

### js/results.js (+ css/results.css) — shared results screen for all modes
```js
export async function showResults(root, result, { onRetry, onNext, onHome, extraContent } = {})
   // 1) const stored = recordResult(result)  2) const progress = processResult(stored)
   // 3) root.innerHTML = '' then renders: title ("Test Complete!"), 1-3 stars (ui.starsFor) animated, big tiles WPM / Accuracy / Time / Errors,
   //    "New personal best!" badge if stored.isNewPb, XP gained + level bar (animated) + "Level up!" if leveledUp,
   //    newly unlocked badges cards with confetti + audio.playUnlock (else audio.playSuccess),
   //    sparkline of last 10 results for this mode (charts.renderLineChart), optional extraContent (HTMLElement) section,
   //    mistyped keys list (top 5 from result.keyErrors) when non-empty,
   //    buttons: Try Again (onRetry), Next Text (onNext, primary), Home (onHome -> default location.hash='#/').
   //    Keyboard: Enter -> onNext, Esc -> onRetry (listeners removed when root content is replaced; use a one-time keydown listener that self-removes when it fires or when root is emptied)
   // returns { stored, progress }
```

## 6. Mode behaviours

### typing (See & Type) — like typing.com
- Load text via getText({level, kind}) (or custom). Show large wrapped text; each char a <span class="ch">, states `.pending` / `.current` (blinking caret) / `.correct` / `.wrong`. Space errors visible (underline).
- Capture keystrokes with a document keydown listener (ignore when modifier keys or when focus is in an input/select/textarea). Start timer on first keystroke; countdown when duration>0 else count up; finish when time ends or text completed. Strict mode blocks advancing on a wrong char (expert level forces strict). Backspace allowed.
- Live stat pills: Time, WPM, Accuracy, Errors. Thin progress bar across the text. On-screen keyboard (createKeyboard, toggle via settings.showKeyboard) with highlightNext/pressKey. audio.playKey/playError on keystrokes; audio.playTick for last 5 seconds of countdown.
- Top controls: chips for duration (30s / 1 min / 3 min / 5 min / Passage=0), level, kind; "New text" button; Esc restarts same text; Tab+Enter new text (show hint row with .kbd). Changing a chip updates settings and reloads text. Show text source caption ("Source: Wikipedia").
- "Click here or start typing" focus overlay when the test area loses focus (like typing.com) — optional but nice.
- keyErrors collected per expected char. Result built per contract, then showResults(root, result, {onRetry, onNext}).

### dictation (Listen & Type)
- getSentences({level, count: 8}) (or custom text split). Chunk by settings.dictationChunk ('word' splits sentences into words, 'paragraph' joins all). Text HIDDEN; big round Play/Replay button (auto-plays first chunk after user clicks Start), speed slider (ttsRate), TTS volume slider, voice select, replay count shown, "Show text" eye button reveals (flagged `revealed`, no score penalty but shown in results). User types in an <input class="input"> (autofocus), Enter submits chunk; per-word diff via compareWords shown correct/wrong; auto-plays next chunk after 1.2s. Progress "3 / 8" with progress bar. Timing from first keystroke of each chunk until submit (sum). keyErrors from char-level comparison of typed vs expected (simple positional compare per word). Result mode 'dictation'. Keyboard shortcuts: Ctrl+Space or Ctrl+R replay (preventDefault).

### speaking (Read Aloud)
- If !isRecognitionSupported(): render .notice-warning explaining to use Chrome/Edge/Safari and a Home button. Else: show passage (getText or custom; maxChars 350), big round mic button (toggle start/stop), live interim transcript box, pulsing ring animation while listening, timer, "Finish" button. On finish: compareWords(expected, final) -> accuracy, spoken wpm = matched words / (seconds/60). Render diff (ok green, missed red strikethrough, wrong red with small "heard: x" below) as extraContent to showResults. Mic permission errors -> toast + guidance. Also allow "Listen" button to hear the passage via TTS first.

### shadowing (Listen & Repeat)
- Sentences via getSentences({count: 6}). For each: Play (TTS, text hidden) -> user clicks mic to repeat -> auto-stop after 1.5s silence or click again -> transcript compared -> reveal sentence with diff, score per sentence, Next (Enter). Aggregate accuracy; words = total expected words; wpm = matched/(speakingSeconds/60). Recognition fallback same notice as speaking. TTS replay allowed (speed slider).

### dashboard
- Level ring (renderRing) + title + XP bar; streak (current/longest) + today's goal ring; totals tiles; WPM & accuracy trend line charts (last 30, filter by mode via segmented control); calendar heatmap; personal bests per mode; weak keys: keyboard heatmap via createKeyboard(container).setHeatmap(getKeyErrorTotals()) + top 5 list; badges grid (locked greyed with progress bar); recent history table (date, mode, level, wpm, acc); Export (download JSON file) / Import (file input) / Reset data (openModal confirm) buttons.

### home (app.js)
- Hero with app name + tagline; quick tests row like typing.com: "1 Minute Test", "3 Minute Test", "5 Minute Test", "Passage" (-> #/typing?duration=60 etc.); mode cards (See & Type, Listen & Type, Read Aloud, Listen & Repeat, Custom Text, Dashboard) with icons & short descriptions; level chip picker (writes settings.level); streak + today's progress ring + level title (from stats/milestones); personal bests row.
- Topbar: logo (keyboard icon + "TypeTalk"), nav (Home, Dashboard), mute toggle, theme toggle, settings gear -> right side drawer with: theme segmented, sound volume range + mute, TTS voice select / rate / pitch / volume + "Test voice" button, show keyboard toggle, strict mode toggle, daily goal number, language select, dictation chunk select, reduce motion, Reset settings.
- #/custom page: textarea for custom text (saved to settings.customText), char/word count, buttons "Type it", "Dictate it", "Read it aloud", "Shadow it" -> navigate to mode with `custom=1`.
- Register service worker `sw.js` if available (guard errors). Call audio.initAudio() on first pointerdown/keydown.
- index.html contains: `<header id="topbar">`, `<main id="app">`, `<aside id="settings-drawer">`, `<div id="toast-root">`, `<div id="modal-root">`, links to ALL css files listed above, `<script type="module" src="js/app.js">`, manifest link, theme-color meta, favicon `icons/icon.svg`.

## 7. Quality bar
- Zero console errors. Handle fetch failures silently with fallback. Clean up timers/listeners in unmount().
- Mobile responsive down to 360px. Keyboard hidden automatically under 700px width.
- Animations subtle (150-250ms). Respect prefers-reduced-motion & settings.reduceMotion.
- Every interactive element has focus-visible styling and an aria-label where icon-only.
- Each file self-contained and syntactically valid; test your module's logic mentally against the contract before finishing.

## 8. Addendum: voice accents (added mid-build)
speech.js additionally exports: `ACCENTS` ([{code,label,flag}] for en-IN, en-US, en-GB, en-AU, en-CA, en-ZA, en-IE),
`getVoiceGroups()` -> [{code,label,flag,voices}] grouped by accent (hi-IN under Indian English, non-English in 'other'),
`getVoicesForLang(code)`, `pickDefaultVoice(code)` (prefers Neural/Online > Google > default), `voiceDisplayName(voice)`.
`speak()` picks `pickDefaultVoice(settings.lang)` when `settings.ttsVoiceURI` is ''. Settings drawer, dictation and
shadowing show an accent chip picker (sets settings.lang and clears ttsVoiceURI) plus an optgroup-ed voice select.
