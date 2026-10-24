# TypeTalk — Typing, Listening & Speaking Practice (frontend-only)

## Goals
- 100% static frontend (HTML + CSS + vanilla JS ES modules). No backend, no build step, no framework.
- Deployable by drag-and-drop to GitHub Pages / Netlify / Vercel / Cloudflare Pages (all free, all HTTPS).
- Lightweight: target < 150 KB total excluding fonts; zero npm dependencies at runtime.
- Works offline after first load (PWA manifest + service worker caching, built-in text bank fallback).
- All progress / milestones stored in localStorage with export/import JSON.

## Practice modes
1. See & Type (classic typing test, like typing.com/student/tests)
   - Durations: 30s, 1 min, 3 min, 5 min, or "finish the passage".
   - Content types: words, sentences, paragraphs, quotes, numbers & symbols.
   - Live WPM, accuracy, timer, per-character green/red colouring, caret.
   - On-screen keyboard that highlights the next key and flashes errors.
2. Listen & Type (dictation)
   - Text-to-speech reads a sentence; user types what they heard.
   - Controls: play/replay, speed (0.5x–1.5x), volume, voice picker, "reveal text" after attempt.
   - Chunk modes: word-by-word, sentence-by-sentence, full paragraph.
3. Read Aloud (speaking)
   - Passage is shown; user reads it into the mic; SpeechRecognition transcript is compared word-by-word.
   - Score: pronunciation-accuracy %, words per minute spoken, missed/mis-heard words highlighted.
4. Listen & Repeat (shadowing)
   - Hear a sentence (text hidden), repeat it aloud, see transcript vs original, then reveal.
5. Custom Text
   - Paste any text and run it in any of the modes above.

## Difficulty levels (apply to every mode)
- Beginner: common short words, lowercase, no punctuation.
- Intermediate: full sentences with capitals and punctuation.
- Advanced: paragraphs, numbers, quotes, symbols.
- Expert: long passages, technical/wiki text, strict accuracy (errors must be fixed).

## Free text sources (no API key, CORS-enabled) + local fallback
| Source | Used for | URL |
|---|---|---|
| Wikipedia REST random summary | paragraphs (advanced/expert) | https://en.wikipedia.org/api/rest_v1/page/random/summary |
| DummyJSON quotes | sentences / quotes | https://dummyjson.com/quotes/random |
| Useless Facts | short sentences | https://uselessfacts.jsph.pl/api/v2/facts/random |
| Advice Slip | very short sentences (beginner dictation) | https://api.adviceslip.com/advice |
| Random Word API | word drills | https://random-word-api.vercel.app/api?words=50 |
| PoetryDB | poetry lines (optional) | https://poetrydb.org/random |
| Local bank (data/texts.json) | offline fallback, ~300 curated items by level | bundled |
Strategy: each source wrapped in a provider with a 3-second timeout; on failure fall through to next provider, then to local bank. Texts are normalised (strip odd unicode, cap length, fix quotes). "Never repeat the last 20 texts" rule.

## Milestones, levels & stats
- XP per test = words typed/spoken × accuracy multiplier; levels 1–50 with titles (Novice → Typist → Keyboard Ninja …).
- Badges: First Test, 10/50/100 Tests, WPM 20/40/60/80/100, Accuracy 95%/100%, 1k/10k/100k words, Dictation Ear (90% dictation accuracy), Clear Speaker (95% read-aloud), 3/7/30-day streak, Night Owl, Early Bird, All-Modes-in-a-Day.
- Daily goal (e.g. 5 tests/day) with streak counter and calendar heatmap.
- Dashboard: WPM & accuracy trend (hand-rolled SVG charts, no chart lib), per-key error heatmap on the keyboard, personal bests per mode, recent history table.
- Toast + confetti + sound when a badge unlocks.
- Export / import progress as JSON; reset option.

## UI / UX
- Single-page app, mobile responsive, dark/light/auto theme.
- Home: mode cards, level picker, daily streak ring, quick-start button.
- Test screen: distraction-free, big text, settings drawer (duration, level, sounds, TTS voice/speed/volume, keyboard on/off).
- Audio: synthesized key-click / error / success sounds via Web Audio API (no audio files), master volume + mute. Separate TTS volume slider.
- Keyboard shortcuts: Esc restart, Tab+Enter new text, Space/Enter play audio in listening modes.
- Accessibility: focus states, aria-live for stats, reduced-motion respect.

## Tech structure
```
index.html
manifest.webmanifest, sw.js            (PWA offline)
css/styles.css                         (CSS variables for themes)
js/app.js                              (router/state, screens)
js/modes/typing.js  dictation.js  speaking.js  shadowing.js
js/textProvider.js                     (API providers + fallback chain)
js/speech.js                           (TTS + SpeechRecognition wrappers)
js/audio.js                            (Web Audio sound effects)
js/stats.js  milestones.js  storage.js (scoring, badges, localStorage)
js/keyboard.js  charts.js  ui.js       (visual keyboard, SVG charts, toasts/confetti)
data/texts.json                        (local text bank)
```

## Browser notes
- TTS (SpeechSynthesis): all modern browsers; voices depend on OS.
- SpeechRecognition: Chrome, Edge, Safari. Not in Firefox → speaking modes show a friendly "use Chrome/Edge" notice and are hidden.
- Mic requires HTTPS → all listed free hosts provide it.

## Build phases
1. Skeleton, theme, home screen, See & Type with live stats and results screen.
2. Text provider chain + local bank + difficulty levels + custom text.
3. Listen & Type with TTS controls.
4. Read Aloud + Listen & Repeat with SpeechRecognition and word diff.
5. Stats engine, XP/levels, badges, dashboard with charts and heatmap.
6. Polish: sounds, on-screen keyboard, confetti, PWA offline, export/import, deploy guide (GitHub Pages).
