# TypeTalk

**Typing, Listening & Speaking practice - free, offline-friendly, no account needed.**

TypeTalk is a lightweight, static web app (plain HTML, CSS and vanilla JavaScript - no framework, no build step, no backend) that helps you practise four skills in one place:

| Mode | What you do |
| --- | --- |
| **See & Type** | Classic typing test with a live on-screen keyboard, WPM, accuracy and error tracking. |
| **Listen & Type** (Dictation) | Hear a word, sentence or paragraph read aloud and type what you heard. |
| **Read Aloud** (Speaking) | Read a passage into your microphone; speech recognition scores every word. |
| **Listen & Repeat** (Shadowing) | Hear a sentence, repeat it, and see exactly which words you got right. |

## Features

- **Four difficulty levels**: Beginner, Intermediate, Advanced, Expert (expert forces strict mode).
- **Five text kinds**: words, sentences, paragraphs, quotes and numbers/symbols, plus your own **custom text**.
- **Quick tests**: 30 s, 1 / 3 / 5 minute timed tests or a whole passage.
- **Milestones**: XP, 50 level titles (from *Novice* to *Keyboard Legend*) and badges for speed, accuracy, volume, streaks and more.
- **Detailed stats**: WPM and accuracy trends, calendar heatmap, streaks, daily goal, personal bests per mode, weak-key keyboard heatmap, recent history.
- **On-screen keyboard** that highlights the next key and flashes correct / wrong presses.
- **Synthesised sounds** (Web Audio, no audio files) with volume control and mute.
- **Text-to-speech** with voice, speed, pitch and volume controls.
- **Light and dark theme**, reduced-motion support, responsive down to 360 px.
- **Installable PWA** that works offline (the app shell and the local text bank are cached).
- **Fresh content** from free, keyless public APIs, with a built-in local text bank as fallback:
  - Wikipedia random summaries - https://en.wikipedia.org/api/rest_v1/page/random/summary
  - DummyJSON quotes - https://dummyjson.com/quotes/random
  - Useless Facts - https://uselessfacts.jsph.pl/api/v2/facts/random?language=en
  - Advice Slip - https://api.adviceslip.com/advice
  - Random Word API - https://random-word-api.vercel.app/api?words=60

## Browser support

- Typing, dictation, stats and the dashboard work in **Chrome, Edge, Safari and Firefox**.
- **Speech recognition** (Read Aloud and Listen & Repeat) uses the Web Speech API, which is available in **Chrome, Edge and Safari**. Firefox does not support it yet; those modes show a friendly notice instead.
- The **microphone only works on HTTPS** (or `http://localhost`). All the hosting options below serve HTTPS automatically.
- Text-to-speech voices depend on your operating system; pick one in Settings.

## Privacy

Everything - settings, results, XP, badges - lives in your browser's `localStorage` under `typetalk:*` keys. Nothing is uploaded anywhere. The only network requests the app makes are to the public text APIs listed above (to fetch practice text) and, optionally, Google Fonts for the Inter typeface. Speech recognition is handled by your browser; see your browser's own privacy policy for how it processes audio.

## Run locally

The app uses ES modules and `fetch()`, which browsers block on `file://` URLs, so serve the folder with any static server:

```bash
# Node
npx serve .

# Python 3
python -m http.server 8080

# PHP
php -S localhost:8080
```

Then open `http://localhost:3000` (serve) or `http://localhost:8080`. No install or build step is needed.

## Deploy

TypeTalk is a plain folder of static files and uses only relative URLs, so it works from a domain root or from a subpath.

### GitHub Pages

1. Create a repository and push this folder to the `main` branch.
2. On GitHub open **Settings -> Pages**.
3. Under **Build and deployment** choose **Deploy from a branch**, then select **main** and the **/ (root)** folder. Save.
4. Wait a minute and open `https://<your-user>.github.io/<repo>/`.

The repository includes an empty `.nojekyll` file so GitHub serves every file as-is (Jekyll would otherwise ignore some paths). The service worker and manifest use relative paths, so the `/<repo>/` subpath works without configuration.

### Netlify Drop

1. Go to https://app.netlify.com/drop.
2. Drag the whole project folder onto the page.
3. Netlify gives you an HTTPS URL immediately. Rename the site under **Site settings** if you like.

### Vercel

1. Push the folder to GitHub (or use the Vercel CLI: `npx vercel`).
2. At https://vercel.com/new import the repository.
3. Framework preset: **Other**. Leave build command and output directory empty. Deploy.

### Cloudflare Pages

1. In the Cloudflare dashboard open **Workers & Pages -> Create -> Pages**.
2. Either **Upload assets** (drag the folder) or **Connect to Git** and pick the repository.
3. Build command: none. Build output directory: `/`. Deploy.

## Reset / export data

Open **Dashboard** and use:

- **Export** - downloads a JSON file with all your settings and history. Keep it as a backup or move it to another browser.
- **Import** - loads a previously exported JSON file (merges into existing data).
- **Reset data** - wipes every `typetalk:*` key from `localStorage` after a confirmation.

Settings alone can be reset from the Settings drawer (**Reset settings**). Clearing your browser's site data also removes everything.

## Project structure

```
index.html                 app shell
manifest.webmanifest       PWA manifest
sw.js                      service worker (offline cache)
.nojekyll                  tells GitHub Pages not to run Jekyll
icons/                     icon.svg, icon-maskable.svg
css/                       styles.css (design system) + one file per mode, keyboard, results, dashboard
js/app.js                  router, topbar, home, settings drawer, custom-text page
js/ui.js                   DOM helpers, toast, modal, confetti, icons
js/storage.js              localStorage wrapper, export / import / reset
js/settings.js             user settings with change listeners
js/stats.js                results history, totals, streaks, personal bests
js/milestones.js           XP, levels and badges
js/textProvider.js         online text sources + local fallback
js/speech.js               text-to-speech, speech recognition, word diff
js/audio.js                synthesised sound effects
js/keyboard.js             on-screen keyboard + heatmap
js/charts.js               SVG line / bar charts, heatmap, progress ring
js/results.js              shared results screen
js/modes/                  typing.js, dictation.js, speaking.js, shadowing.js, dashboard.js
data/texts.json            local text bank (all levels and kinds)
```

## Credits

Practice text comes from these generous free services:

- [Wikipedia REST API](https://en.wikipedia.org/api/rest_v1/) - text under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- [DummyJSON](https://dummyjson.com/) - quotes
- [Useless Facts](https://uselessfacts.jsph.pl/) - random facts
- [Advice Slip](https://api.adviceslip.com/) - short advice sentences
- [Random Word API](https://random-word-api.vercel.app/) - word lists

Typeface: [Inter](https://rsms.me/inter/) via Google Fonts (optional, falls back to system fonts). Icon style inspired by [Lucide](https://lucide.dev/).

Visual direction inspired by typing.com. TypeTalk is an independent project and is not affiliated with any of the services above.
# typetalk
