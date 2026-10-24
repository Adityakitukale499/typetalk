/**
 * TypeTalk — application shell: hash router, topbar, theme, settings drawer,
 * home screen and custom-text page.
 */
import { h, toast, openModal, icon } from './ui.js';
import { getSettings, setSetting, setSettings, resetSettings, onSettingsChange, DEFAULTS } from './settings.js';
import { getPersonalBests, getStreak } from './stats.js';
import { getLevel } from './milestones.js';
import * as speech from './speech.js';
import * as audio from './audio.js';
import { renderRing } from './charts.js';

/* --------------------------------------------------------------------------
   Constants
   -------------------------------------------------------------------------- */

const MODE_ROUTES = ['typing', 'dictation', 'speaking', 'shadowing', 'dashboard'];

const LEVELS = [
  { id: 'beginner', label: 'Beginner', hint: 'Short lowercase words' },
  { id: 'intermediate', label: 'Intermediate', hint: 'Full sentences' },
  { id: 'advanced', label: 'Advanced', hint: 'Paragraphs, numbers & quotes' },
  { id: 'expert', label: 'Expert', hint: 'Long technical text, strict accuracy' }
];

const FALLBACK_ACCENTS = [
  { code: 'en-US', label: 'US English', flag: '🇺🇸' },
  { code: 'en-GB', label: 'British English', flag: '🇬🇧' },
  { code: 'en-IN', label: 'Indian English', flag: '🇮🇳' },
  { code: 'en-AU', label: 'Australian English', flag: '🇦🇺' }
];

const TEST_VOICE_SENTENCE = "Hello! Let's practise typing, listening and speaking together.";

/* --------------------------------------------------------------------------
   Small utilities
   -------------------------------------------------------------------------- */

/**
 * Run fn and return its value, or the fallback if it throws.
 * @template T
 * @param {() => T} fn
 * @param {T} fallback
 * @returns {T}
 */
function safe(fn, fallback) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    console.warn('[TypeTalk]', err);
    return fallback;
  }
}

/** @returns {Array<{code: string, label: string, flag: string}>} */
function getAccents() {
  const list = speech.ACCENTS;
  return Array.isArray(list) && list.length ? list : FALLBACK_ACCENTS;
}

/**
 * @param {string} code
 * @returns {{code: string, label: string, flag: string}}
 */
function accentFor(code) {
  const accents = getAccents();
  return accents.find((a) => a.code === code)
    || accents.find((a) => a.code.split('-')[0] === String(code || '').split('-')[0])
    || accents[0];
}

/**
 * @param {SpeechSynthesisVoice} voice
 * @returns {string}
 */
function voiceLabel(voice) {
  if (typeof speech.voiceDisplayName === 'function') {
    return safe(() => speech.voiceDisplayName(voice), voice.name);
  }
  return `${voice.name} (${voice.lang})`;
}

/**
 * Set --range-pct on a range input so the track fill matches the value.
 * @param {HTMLInputElement} input
 */
function paintRange(input) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const val = Number(input.value) || 0;
  const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
  input.style.setProperty('--range-pct', `${Math.max(0, Math.min(100, pct))}%`);
}

/**
 * Parse location.hash into { route, params }.
 * '#/typing?kind=words&level=beginner' -> { route: 'typing', params: { kind: 'words', level: 'beginner' } }
 * @param {string} [hash]
 * @returns {{route: string, params: Object<string, string>}}
 */
export function parseHash(hash = location.hash) {
  let raw = String(hash || '');
  if (raw.startsWith('#')) raw = raw.slice(1);
  const qIndex = raw.indexOf('?');
  const pathPart = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const queryPart = qIndex >= 0 ? raw.slice(qIndex + 1) : '';
  const route = pathPart.replace(/^\/+|\/+$/g, '').toLowerCase();
  const params = {};
  if (queryPart) {
    const sp = new URLSearchParams(queryPart);
    sp.forEach((value, key) => { params[key] = value; });
  }
  return { route, params };
}

/**
 * Navigate to a hash route.
 * @param {string} hash e.g. '#/typing?duration=60'
 */
export function navigate(hash) {
  if (location.hash === hash) {
    // same hash: force re-route
    handleRoute();
  } else {
    location.hash = hash;
  }
}

/* --------------------------------------------------------------------------
   Theme & motion
   -------------------------------------------------------------------------- */

const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

/**
 * Resolve the effective theme ('light' | 'dark') for the given setting.
 * @param {string} themeSetting
 * @returns {'light'|'dark'}
 */
function resolveTheme(themeSetting) {
  if (themeSetting === 'light' || themeSetting === 'dark') return themeSetting;
  return darkQuery && darkQuery.matches ? 'dark' : 'light';
}

/**
 * Apply theme + reduce-motion attributes from settings.
 * @param {Object} [settings]
 */
function applyTheme(settings = getSettings()) {
  const theme = resolveTheme(settings.theme);
  document.documentElement.dataset.theme = theme;
  if (settings.reduceMotion) document.documentElement.dataset.reduceMotion = 'true';
  else delete document.documentElement.dataset.reduceMotion;
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f1420' : '#3b6cf6');
  updateTopbarState();
}

if (darkQuery) {
  const onScheme = () => { if (getSettings().theme === 'auto') applyTheme(); };
  if (typeof darkQuery.addEventListener === 'function') darkQuery.addEventListener('change', onScheme);
  else if (typeof darkQuery.addListener === 'function') darkQuery.addListener(onScheme);
}

/* --------------------------------------------------------------------------
   Topbar
   -------------------------------------------------------------------------- */

const topbarRefs = {
  navLinks: /** @type {HTMLAnchorElement[]} */ ([]),
  muteBtn: /** @type {HTMLButtonElement|null} */ (null),
  themeBtn: /** @type {HTMLButtonElement|null} */ (null),
  settingsBtn: /** @type {HTMLButtonElement|null} */ (null)
};

/** Build the topbar once into #topbar. */
function renderTopbar() {
  const header = document.getElementById('topbar');
  if (!header) return;
  header.innerHTML = '';

  const navItems = [
    { href: '#/', label: 'Home', icon: 'home', match: ['', 'custom'] },
    { href: '#/dashboard', label: 'Dashboard', icon: 'chart', match: ['dashboard'] }
  ];
  topbarRefs.navLinks = navItems.map((item) => {
    const a = h('a', { class: 'nav-link', href: item.href, dataset: { match: item.match.join(',') } },
      h('span', { html: icon(item.icon), class: 'flex' }),
      h('span', {}, item.label)
    );
    return a;
  });

  topbarRefs.muteBtn = h('button', {
    type: 'button', class: 'btn btn-icon', 'aria-label': 'Toggle sound', title: 'Toggle sound',
    onClick: () => {
      const muted = !safe(() => audio.isMuted(), false);
      safe(() => audio.setMuted(muted));
      updateTopbarState();
      syncDrawer();
      toast(muted ? 'Sounds muted' : 'Sounds on', { type: 'info', icon: muted ? 'volume-off' : 'volume', duration: 1400 });
    }
  });

  topbarRefs.themeBtn = h('button', {
    type: 'button', class: 'btn btn-icon', 'aria-label': 'Toggle theme', title: 'Toggle light / dark theme',
    onClick: () => {
      const current = resolveTheme(getSettings().theme);
      setSetting('theme', current === 'dark' ? 'light' : 'dark');
    }
  });

  const settingsBtn = h('button', {
    type: 'button', class: 'btn btn-icon', 'aria-label': 'Open settings', title: 'Settings',
    'aria-controls': 'settings-drawer', 'aria-expanded': 'false', html: icon('settings'),
    onClick: () => openDrawer()
  });
  topbarRefs.settingsBtn = settingsBtn;

  header.appendChild(
    h('div', { class: 'container topbar-inner' },
      h('div', { class: 'flex gap-sm' },
        h('a', { class: 'logo', href: '#/', 'aria-label': 'TypeTalk home' },
          h('span', { class: 'logo-mark', html: icon('keyboard') }),
          h('span', { class: 'logo-text' }, 'Type', h('span', {}, 'Talk'))
        ),
        h('nav', { class: 'nav', 'aria-label': 'Main' }, topbarRefs.navLinks)
      ),
      h('div', { class: 'topbar-actions' }, topbarRefs.muteBtn, topbarRefs.themeBtn, settingsBtn)
    )
  );
  updateTopbarState();
}

/** Refresh the mute / theme icons and active nav link. */
function updateTopbarState() {
  const { route } = parseHash();
  topbarRefs.navLinks.forEach((a) => {
    const matches = (a.dataset.match || '').split(',');
    const active = matches.includes(route);
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (topbarRefs.muteBtn) {
    const muted = safe(() => audio.isMuted(), false);
    topbarRefs.muteBtn.innerHTML = icon(muted ? 'volume-off' : 'volume');
    topbarRefs.muteBtn.setAttribute('aria-label', muted ? 'Unmute sounds' : 'Mute sounds');
    topbarRefs.muteBtn.setAttribute('aria-pressed', String(muted));
  }
  if (topbarRefs.themeBtn) {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    topbarRefs.themeBtn.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
    topbarRefs.themeBtn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }
}

/* --------------------------------------------------------------------------
   Settings drawer
   -------------------------------------------------------------------------- */

const drawer = {
  el: /** @type {HTMLElement|null} */ (null),
  overlay: /** @type {HTMLElement|null} */ (null),
  built: false,
  open: false,
  lastFocus: /** @type {Element|null} */ (null),
  controls: /** @type {Object<string, any>} */ ({}),
  voicesLoaded: false,
  voiceGroupByURI: /** @type {Map<string, string>} */ (new Map())
};

/**
 * Build a labelled range row with live value label.
 * @param {{key: string, label: string, min: number, max: number, step: number, format: (v: number) => string, onInput?: (v: number) => void}} opts
 * @returns {HTMLElement}
 */
function rangeField({ key, label, min, max, step, format, onInput }) {
  const valueEl = h('span', { class: 'range-value', 'aria-live': 'off' });
  const input = h('input', {
    type: 'range', class: 'range', min, max, step, 'aria-label': label, id: `set-${key}`,
    onInput: () => {
      const v = Number(input.value);
      valueEl.textContent = format(v);
      paintRange(input);
      if (onInput) onInput(v);
      else setSetting(key, v);
    }
  });
  drawer.controls[key] = { input, valueEl, format };
  return h('div', { class: 'field' },
    h('div', { class: 'flex-between' }, h('label', { for: `set-${key}` }, label), valueEl),
    input
  );
}

/**
 * Build a toggle row bound to a boolean setting.
 * @param {{key: string, label: string, hint?: string}} opts
 * @returns {HTMLElement}
 */
function toggleField({ key, label, hint }) {
  const input = h('input', { type: 'checkbox', id: `set-${key}`, onChange: () => setSetting(key, input.checked) });
  drawer.controls[key] = { input, type: 'checkbox' };
  return h('div', { class: 'field-row' },
    h('div', {},
      h('label', { for: `set-${key}` }, label),
      hint ? h('div', { class: 'field-hint' }, hint) : null
    ),
    h('label', { class: 'toggle', 'aria-label': label }, input, h('span', { class: 'toggle-track' }))
  );
}

/** Build the drawer DOM once. */
function buildDrawer() {
  if (drawer.built) return;
  drawer.el = document.getElementById('settings-drawer');
  drawer.overlay = document.getElementById('drawer-overlay');
  if (!drawer.el) return;
  if (!drawer.overlay) {
    drawer.overlay = h('div', { id: 'drawer-overlay', class: 'drawer-overlay', hidden: true });
    drawer.el.parentNode.insertBefore(drawer.overlay, drawer.el);
  }
  drawer.overlay.addEventListener('click', closeDrawer);
  drawer.el.innerHTML = '';

  /* ---- Appearance ---- */
  const themeSeg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Theme' },
    ['auto', 'light', 'dark'].map((t) => h('button', {
      type: 'button', dataset: { value: t }, onClick: () => setSetting('theme', t)
    }, t === 'auto' ? h('span', { html: icon('monitor') }) : h('span', { html: icon(t === 'light' ? 'sun' : 'moon') }), t[0].toUpperCase() + t.slice(1)))
  );
  drawer.controls.theme = { seg: themeSeg };

  /* ---- Sound ---- */
  const muteBtn = h('button', {
    type: 'button', class: 'btn btn-outline btn-icon', 'aria-label': 'Mute sounds',
    onClick: () => {
      const muted = !safe(() => audio.isMuted(), false);
      safe(() => audio.setMuted(muted));
      updateTopbarState();
      syncDrawer();
    }
  });
  drawer.controls.soundMuted = { btn: muteBtn };
  const soundRange = rangeField({
    key: 'soundVolume', label: 'Sound volume', min: 0, max: 1, step: 0.05,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => { safe(() => audio.setVolume(v)); }
  });
  // place mute button inline with the range
  const soundRangeInput = drawer.controls.soundVolume.input;
  const rangeRow = h('div', { class: 'range-row' });
  soundRangeInput.replaceWith(rangeRow);
  rangeRow.append(soundRangeInput, muteBtn);

  /* ---- Voice & Speech ---- */
  const accentGroup = h('div', { class: 'chip-group', role: 'group', 'aria-label': 'Accent' });
  const accentNotice = h('div', { class: 'notice notice-info mt-sm', hidden: true, html: icon('info') });
  const accentNoticeText = h('span');
  accentNotice.appendChild(accentNoticeText);
  drawer.controls.lang = { group: accentGroup, notice: accentNotice, noticeText: accentNoticeText };
  getAccents().forEach((a) => {
    accentGroup.appendChild(h('button', {
      type: 'button', class: 'chip', dataset: { value: a.code }, 'aria-pressed': 'false',
      onClick: () => {
        setSettings({ lang: a.code, ttsVoiceURI: '' });
        refreshVoices();
      }
    }, h('span', { 'aria-hidden': 'true' }, a.flag), ` ${a.label}`));
  });

  const voiceSelect = h('select', {
    class: 'select', id: 'set-ttsVoiceURI', 'aria-label': 'Voice',
    onChange: () => {
      const uri = voiceSelect.value;
      const patch = { ttsVoiceURI: uri };
      const groupCode = drawer.voiceGroupByURI.get(uri);
      if (uri && groupCode && /^en(-|$)/i.test(groupCode)) patch.lang = groupCode;
      setSettings(patch);
    }
  }, h('option', { value: '' }, 'Auto (best for accent)'));
  drawer.controls.ttsVoiceURI = { select: voiceSelect };

  const testVoiceBtn = h('button', {
    type: 'button', class: 'btn btn-outline btn-sm', html: `${icon('play')}<span>Test voice</span>`,
    onClick: async () => {
      if (!safe(() => speech.isTtsSupported(), true)) {
        toast('Text-to-speech is not supported in this browser.', { type: 'warning' });
        return;
      }
      testVoiceBtn.disabled = true;
      try {
        await speech.speak(TEST_VOICE_SENTENCE);
      } catch (err) {
        console.warn(err);
        toast('Could not play the voice.', { type: 'error' });
      } finally {
        testVoiceBtn.disabled = false;
      }
    }
  });

  const voiceSection = h('div', { class: 'drawer-section' },
    h('h3', {}, h('span', { html: icon('globe') }), 'Voice & speech'),
    h('div', { class: 'field' },
      h('label', {}, 'Accent'),
      accentGroup,
      h('div', { class: 'field-hint' }, 'Voices depend on your device and browser. Microsoft Edge has the most natural voices.'),
      accentNotice
    ),
    h('div', { class: 'field' },
      h('div', { class: 'flex-between' }, h('label', { for: 'set-ttsVoiceURI' }, 'Voice'), testVoiceBtn),
      voiceSelect
    ),
    rangeField({ key: 'ttsRate', label: 'Speech speed', min: 0.5, max: 1.5, step: 0.05, format: (v) => `${v.toFixed(2)}x` }),
    rangeField({ key: 'ttsPitch', label: 'Pitch', min: 0.5, max: 2, step: 0.1, format: (v) => v.toFixed(1) }),
    rangeField({ key: 'ttsVolume', label: 'Speech volume', min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` })
  );

  /* ---- Practice ---- */
  const goalInput = h('input', {
    type: 'number', class: 'input', id: 'set-dailyGoal', min: 1, max: 100, step: 1, inputmode: 'numeric',
    onChange: () => {
      let v = Math.round(Number(goalInput.value));
      if (!Number.isFinite(v) || v < 1) v = 1;
      if (v > 100) v = 100;
      goalInput.value = String(v);
      setSetting('dailyGoal', v);
    }
  });
  drawer.controls.dailyGoal = { input: goalInput, type: 'number' };

  const chunkSelect = h('select', {
    class: 'select', id: 'set-dictationChunk', onChange: () => setSetting('dictationChunk', chunkSelect.value)
  },
    h('option', { value: 'word' }, 'Word by word'),
    h('option', { value: 'sentence' }, 'Sentence by sentence'),
    h('option', { value: 'paragraph' }, 'Whole paragraph')
  );
  drawer.controls.dictationChunk = { select: chunkSelect };

  const practiceSection = h('div', { class: 'drawer-section' },
    h('h3', {}, h('span', { html: icon('target') }), 'Practice'),
    toggleField({ key: 'showKeyboard', label: 'On-screen keyboard', hint: 'Highlights the next key while typing' }),
    toggleField({ key: 'strictMode', label: 'Strict mode', hint: 'Fix every mistake before continuing (Expert always strict)' }),
    h('div', { class: 'field-row' },
      h('div', {}, h('label', { for: 'set-dailyGoal' }, 'Daily goal'), h('div', { class: 'field-hint' }, 'Tests per day')),
      goalInput
    ),
    h('div', { class: 'field' },
      h('label', { for: 'set-dictationChunk' }, 'Dictation chunk'),
      chunkSelect
    )
  );

  /* ---- Accessibility ---- */
  const a11ySection = h('div', { class: 'drawer-section' },
    h('h3', {}, h('span', { html: icon('eye') }), 'Accessibility'),
    toggleField({ key: 'reduceMotion', label: 'Reduce motion', hint: 'Disables animations and confetti' })
  );

  const resetBtn = h('button', {
    type: 'button', class: 'btn btn-outline btn-block', html: `${icon('rotate-ccw')}<span>Reset settings</span>`,
    onClick: () => {
      openModal({
        title: 'Reset settings?',
        content: '<p>All settings return to their defaults. Your progress, stats and badges are kept.</p>',
        actions: [
          { label: 'Cancel', variant: 'ghost' },
          {
            label: 'Reset',
            variant: 'danger',
            onClick: () => {
              safe(() => resetSettings());
              applyTheme();
              syncDrawer();
              refreshVoices();
              toast('Settings reset to defaults', { type: 'success' });
            }
          }
        ]
      });
    }
  });

  const closeBtn = h('button', {
    type: 'button', class: 'btn btn-ghost btn-icon', 'aria-label': 'Close settings', html: icon('x'), onClick: closeDrawer
  });

  drawer.el.append(
    h('div', { class: 'drawer-header' },
      h('h2', { id: 'settings-title' }, h('span', { html: icon('settings') }), 'Settings'),
      closeBtn
    ),
    h('div', { class: 'drawer-body' },
      h('div', { class: 'drawer-section' },
        h('h3', {}, h('span', { html: icon('sun') }), 'Appearance'),
        h('div', { class: 'field' }, h('label', {}, 'Theme'), themeSeg)
      ),
      h('div', { class: 'drawer-section' },
        h('h3', {}, h('span', { html: icon('volume') }), 'Sound'),
        soundRange
      ),
      voiceSection,
      practiceSection,
      a11ySection
    ),
    h('div', { class: 'drawer-footer' }, resetBtn)
  );

  drawer.built = true;
  syncDrawer();
}

/**
 * Reflect current settings into every drawer control.
 * @param {Object} [settings]
 */
function syncDrawer(settings = getSettings()) {
  if (!drawer.built) return;
  const c = drawer.controls;

  if (c.theme) {
    c.theme.seg.querySelectorAll('button').forEach((b) => {
      const active = b.dataset.value === settings.theme;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
  }
  for (const key of ['soundVolume', 'ttsRate', 'ttsPitch', 'ttsVolume']) {
    const ctl = c[key];
    if (!ctl) continue;
    const v = Number(settings[key]);
    if (document.activeElement !== ctl.input) ctl.input.value = String(v);
    ctl.valueEl.textContent = ctl.format(v);
    paintRange(ctl.input);
  }
  if (c.soundMuted) {
    const muted = !!settings.soundMuted;
    c.soundMuted.btn.innerHTML = icon(muted ? 'volume-off' : 'volume');
    c.soundMuted.btn.setAttribute('aria-label', muted ? 'Unmute sounds' : 'Mute sounds');
    c.soundMuted.btn.setAttribute('aria-pressed', String(muted));
    c.soundMuted.btn.classList.toggle('is-on', muted);
    if (c.soundVolume) c.soundVolume.input.disabled = muted;
  }
  for (const key of ['showKeyboard', 'strictMode', 'reduceMotion']) {
    if (c[key]) c[key].input.checked = !!settings[key];
  }
  if (c.dailyGoal && document.activeElement !== c.dailyGoal.input) {
    c.dailyGoal.input.value = String(settings.dailyGoal);
  }
  if (c.dictationChunk) c.dictationChunk.select.value = settings.dictationChunk;
  if (c.lang) {
    c.lang.group.querySelectorAll('.chip').forEach((chip) => {
      const active = chip.dataset.value === settings.lang;
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-pressed', String(active));
    });
  }
  if (c.ttsVoiceURI) {
    const sel = c.ttsVoiceURI.select;
    const uri = settings.ttsVoiceURI || '';
    const has = Array.from(sel.options).some((o) => o.value === uri);
    sel.value = has ? uri : '';
  }
}

/** Populate the voice select (grouped by accent) and the "no voice" notice. */
async function refreshVoices() {
  if (!drawer.built) return;
  const sel = drawer.controls.ttsVoiceURI.select;
  const settings = getSettings();
  const ttsOk = safe(() => speech.isTtsSupported(), true);

  if (!ttsOk) {
    sel.innerHTML = '';
    sel.appendChild(h('option', { value: '' }, 'Text-to-speech unavailable'));
    sel.disabled = true;
    return;
  }

  let groups = [];
  try {
    if (typeof speech.getVoiceGroups === 'function') {
      groups = (await speech.getVoiceGroups()) || [];
    } else {
      const voices = (await speech.getVoices()) || [];
      groups = [{ code: '', label: 'Voices', flag: '', voices }];
    }
  } catch (err) {
    console.warn('[TypeTalk] voices', err);
  }

  drawer.voiceGroupByURI = new Map();
  sel.innerHTML = '';
  sel.appendChild(h('option', { value: '' }, 'Auto (best for accent)'));
  let total = 0;
  groups.forEach((g) => {
    const voices = Array.isArray(g.voices) ? g.voices : [];
    if (!voices.length) return;
    const og = h('optgroup', { label: `${g.flag ? g.flag + ' ' : ''}${g.label || g.code || 'Voices'}` });
    voices.forEach((v) => {
      drawer.voiceGroupByURI.set(v.voiceURI, g.code || v.lang || '');
      og.appendChild(h('option', { value: v.voiceURI }, voiceLabel(v)));
      total++;
    });
    sel.appendChild(og);
  });
  sel.disabled = total === 0;
  drawer.voicesLoaded = true;

  // Accent availability notice
  const accent = accentFor(settings.lang);
  const langLower = String(settings.lang || '').toLowerCase();
  const hasAccentVoice = groups.some((g) => {
    const code = String(g.code || '').toLowerCase();
    const voices = Array.isArray(g.voices) ? g.voices : [];
    if (!voices.length) return false;
    if (code === langLower) return true;
    return voices.some((v) => String(v.lang || '').toLowerCase().replace('_', '-') === langLower);
  });
  const notice = drawer.controls.lang.notice;
  if (total > 0 && !hasAccentVoice) {
    drawer.controls.lang.noticeText.textContent = ` No ${accent.label} voice installed on this device. The browser default will be used.`;
    notice.hidden = false;
  } else {
    notice.hidden = true;
  }
  syncDrawer(settings);
}

/** Open the settings drawer. */
function openDrawer() {
  buildDrawer();
  if (!drawer.el || drawer.open) return;
  drawer.open = true;
  drawer.lastFocus = document.activeElement;
  drawer.el.hidden = false;
  drawer.overlay.hidden = false;
  drawer.el.setAttribute('aria-hidden', 'false');
  if (topbarRefs.settingsBtn) topbarRefs.settingsBtn.setAttribute('aria-expanded', 'true');
  // next frame so the transition runs
  requestAnimationFrame(() => {
    drawer.el.classList.add('is-open');
    drawer.overlay.classList.add('is-open');
  });
  document.addEventListener('keydown', onDrawerKey);
  syncDrawer();
  if (!drawer.voicesLoaded) refreshVoices();
  const first = drawer.el.querySelector('.drawer-body button, .drawer-body input, .drawer-body select');
  setTimeout(() => { try { (first || drawer.el).focus(); } catch (e) { /* ignore */ } }, 60);
}

/** Close the settings drawer. */
function closeDrawer() {
  if (!drawer.el || !drawer.open) return;
  drawer.open = false;
  drawer.el.classList.remove('is-open');
  drawer.overlay.classList.remove('is-open');
  drawer.el.setAttribute('aria-hidden', 'true');
  if (topbarRefs.settingsBtn) topbarRefs.settingsBtn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('keydown', onDrawerKey);
  const finish = () => {
    if (drawer.open) return;
    drawer.el.hidden = true;
    drawer.overlay.hidden = true;
  };
  const reduce = document.documentElement.dataset.reduceMotion === 'true'
    || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (reduce) finish();
  else setTimeout(finish, 280);
  const target = drawer.lastFocus;
  if (target && typeof target.focus === 'function' && document.contains(target)) target.focus();
}

/** @param {KeyboardEvent} e */
function onDrawerKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeDrawer();
  }
}

/* --------------------------------------------------------------------------
   Built-in pages: home, custom, not-found
   -------------------------------------------------------------------------- */

const MODE_CARDS = [
  { route: 'typing', title: 'See & Type', desc: 'Classic typing test with live WPM, accuracy and an on-screen keyboard.', icon: 'keyboard', tone: '', pbKey: 'typing' },
  { route: 'dictation', title: 'Listen & Type', desc: 'Hear a sentence read aloud and type exactly what you heard.', icon: 'headphones', tone: 'icon-accent', pbKey: 'dictation' },
  { route: 'speaking', title: 'Read Aloud', desc: 'Read a passage into your mic and get word-by-word pronunciation feedback.', icon: 'mic', tone: 'icon-success', pbKey: 'speaking' },
  { route: 'shadowing', title: 'Listen & Repeat', desc: 'Shadow a native voice: listen, repeat, then compare your words.', icon: 'repeat', tone: 'icon-purple', pbKey: 'shadowing' },
  { route: 'custom', title: 'Custom Text', desc: 'Paste your own text and practise it in any mode.', icon: 'file-text', tone: 'icon-warning' },
  { route: 'dashboard', title: 'Dashboard', desc: 'Trends, streaks, badges, weak keys and your full history.', icon: 'chart', tone: 'icon-error' }
];

const QUICK_TESTS = [
  { num: '1', unit: 'minute', label: '1 Minute Test', sub: 'Quick warm-up', hash: '#/typing?duration=60' },
  { num: '3', unit: 'minute', label: '3 Minute Test', sub: 'Build stamina', hash: '#/typing?duration=180' },
  { num: '5', unit: 'minute', label: '5 Minute Test', sub: 'Marathon badge', hash: '#/typing?duration=300' },
  { num: null, unit: 'passage', label: 'Passage', sub: 'Finish the whole text', hash: '#/typing?duration=0' }
];

const homePage = {
  /**
   * @param {HTMLElement} root
   */
  async mount(root) {
    const settings = getSettings();
    const streak = safe(() => getStreak(), { current: 0, longest: 0, todayCount: 0, goal: settings.dailyGoal, goalMet: false });
    const level = safe(() => getLevel(), { level: 1, title: 'Novice', xp: 0, xpIntoLevel: 0, xpForNext: 100, progress: 0 });
    const bests = safe(() => getPersonalBests(), {});
    const accent = accentFor(settings.lang);

    /* Hero + summary */
    const ringEl = h('div', { class: 'summary-ring', 'aria-label': `Today: ${streak.todayCount} of ${streak.goal} tests` });
    const summary = h('div', { class: 'card summary-card' },
      ringEl,
      h('div', { class: 'summary-info' },
        h('div', { class: 'summary-level' },
          h('span', { class: 'badge badge-primary' }, `Level ${level.level}`),
          h('span', { class: 'summary-title' }, level.title)
        ),
        h('div', { class: 'summary-xp' }, `${level.xpIntoLevel} / ${level.xpForNext} XP to next level`),
        h('div', { class: 'progress progress-thin' }, h('div', { class: 'bar', style: { width: `${Math.round((level.progress || 0) * 100)}%` } })),
        h('div', { class: 'summary-stats' },
          h('span', { class: 'summary-stat is-streak' }, h('span', { html: icon('flame') }), h('strong', {}, String(streak.current)), ' day streak'),
          h('span', { class: 'summary-stat' }, h('span', { html: icon('trophy') }), h('strong', {}, String(streak.longest)), ' best'),
          h('span', { class: 'summary-stat' }, h('span', { html: icon('zap') }), h('strong', {}, String(level.xp)), ' XP')
        )
      )
    );

    const hero = h('section', { class: 'hero' },
      h('div', { class: 'hero-text' },
        h('h1', {}, 'Practise typing, ', h('span', {}, 'listening & speaking')),
        h('p', {}, 'Fast, friendly drills with live stats, levels and badges. Everything runs in your browser and your progress stays on your device.'),
        h('div', { class: 'hero-actions' },
          h('a', { class: 'btn btn-primary btn-lg', href: '#/typing' }, h('span', { html: icon('keyboard') }), 'Start typing'),
          h('button', {
            type: 'button', class: 'chip', title: 'Change accent and voice', 'aria-label': `Accent: ${accent.label}. Open settings`,
            onClick: () => openDrawer()
          }, h('span', { 'aria-hidden': 'true' }, accent.flag), ` ${accent.label}`, h('span', { html: icon('settings') }))
        )
      ),
      summary
    );

    /* Quick tests */
    const quick = h('section', { 'aria-labelledby': 'quick-title' },
      h('h2', { id: 'quick-title', class: 'section-title' }, h('span', { html: icon('clock') }), 'Quick typing tests'),
      h('div', { class: 'quick-tests' },
        QUICK_TESTS.map((q) => h('a', { class: 'card card-hover quick-test', href: q.hash },
          q.num
            ? h('span', { class: 'qt-num' }, q.num)
            : h('span', { class: 'qt-num', html: icon('book-open') }),
          h('span', { class: 'qt-unit' }, q.unit),
          h('span', { class: 'qt-label' }, q.label),
          h('span', { class: 'qt-sub' }, q.sub)
        ))
      )
    );

    /* Level picker */
    const current = LEVELS.find((l) => l.id === settings.level) || LEVELS[1];
    const levelPicker = h('section', { class: 'card level-picker', 'aria-label': 'Difficulty level' },
      h('div', { class: 'level-picker-label' },
        h('span', { html: icon('layers') }),
        h('div', {}, 'Difficulty', h('span', { class: 'level-picker-hint' }, current.hint))
      ),
      h('div', { class: 'chip-group', role: 'group', 'aria-label': 'Level' },
        LEVELS.map((l) => h('button', {
          type: 'button', class: ['chip', l.id === settings.level ? 'active' : ''], 'aria-pressed': String(l.id === settings.level),
          onClick: () => setSetting('level', l.id)
        }, l.label))
      )
    );

    /* Mode cards */
    const modes = h('section', { 'aria-labelledby': 'modes-title' },
      h('h2', { id: 'modes-title', class: 'section-title' }, h('span', { html: icon('zap') }), 'Practice modes'),
      h('div', { class: 'mode-cards' },
        MODE_CARDS.map((m) => {
          const pb = m.pbKey && bests[m.pbKey];
          return h('a', { class: 'card card-hover mode-card', href: `#/${m.route}` },
            h('span', { class: ['mode-icon', m.tone], html: icon(m.icon) }),
            h('h3', {}, m.title),
            h('p', {}, m.desc),
            h('div', { class: 'mode-footer' },
              h('span', { class: 'mode-go' }, 'Start', h('span', { html: icon('arrow-right') })),
              pb && (pb.wpm > 0 || pb.accuracy > 0)
                ? h('span', { class: 'mode-pb' }, 'Best ', h('strong', {}, `${pb.wpm} WPM`), ` · ${Number(pb.accuracy).toFixed(0)}%`)
                : null
            )
          );
        })
      )
    );

    /* Personal bests */
    const pbSection = h('section', { 'aria-labelledby': 'pb-title' },
      h('h2', { id: 'pb-title', class: 'section-title' }, h('span', { html: icon('trophy') }), 'Personal bests'),
      h('div', { class: 'pb-row' },
        MODE_CARDS.filter((m) => m.pbKey).map((m) => {
          const pb = bests[m.pbKey] || { wpm: 0, accuracy: 0 };
          const has = pb.wpm > 0 || pb.accuracy > 0;
          return h('div', { class: 'card pb-tile' },
            h('span', { class: 'pb-icon', html: icon(m.icon) }),
            h('div', { class: 'pb-info' },
              h('div', { class: 'pb-mode' }, m.title),
              has
                ? h('div', { class: 'pb-value' }, String(pb.wpm), h('small', {}, 'WPM'))
                : h('div', { class: 'pb-value text-muted' }, '—'),
              h('div', { class: 'pb-acc' }, has ? `${Number(pb.accuracy).toFixed(1)}% accuracy` : 'No tests yet')
            )
          );
        })
      )
    );

    const footer = h('p', { class: 'home-footer' },
      'Tip: press ', h('span', { class: 'kbd' }, 'Esc'), ' during a test to restart, ',
      h('span', { class: 'kbd' }, 'Tab'), ' + ', h('span', { class: 'kbd' }, 'Enter'), ' for a new text.'
    );

    root.appendChild(h('div', { class: 'container page home-page' }, hero, quick, levelPicker, modes, pbSection, footer));

    // Progress ring (after insertion so the chart can measure)
    try {
      renderRing(ringEl, {
        value: streak.todayCount,
        max: Math.max(1, streak.goal || settings.dailyGoal || 1),
        label: `${streak.todayCount}/${streak.goal || settings.dailyGoal}`,
        sublabel: 'today',
        color: streak.goalMet ? 'var(--success)' : 'var(--primary)',
        size: 110
      });
    } catch (err) {
      console.warn('[TypeTalk] ring', err);
      ringEl.textContent = `${streak.todayCount}/${streak.goal}`;
    }
  },
  unmount() {}
};

const customPage = {
  timer: 0,
  flush: null,
  /**
   * @param {HTMLElement} root
   */
  async mount(root) {
    const settings = getSettings();
    const wordsEl = h('strong', {}, '0');
    const charsEl = h('strong', {}, '0');
    const saveState = h('span', { class: 'save-state text-muted' });

    const textarea = h('textarea', {
      class: 'textarea', id: 'custom-text', placeholder: 'Paste or type any text here — a paragraph from a book, your vocabulary list, a speech you are rehearsing…',
      spellcheck: 'false', 'aria-describedby': 'custom-counts'
    });
    textarea.value = settings.customText || '';

    const actions = [
      { label: 'Type it', sub: 'See & Type', icon: 'keyboard', route: 'typing', primary: true },
      { label: 'Dictate it', sub: 'Listen & Type', icon: 'headphones', route: 'dictation' },
      { label: 'Read it aloud', sub: 'Read Aloud', icon: 'mic', route: 'speaking' },
      { label: 'Shadow it', sub: 'Listen & Repeat', icon: 'repeat', route: 'shadowing' }
    ].map((a) => h('button', {
      type: 'button', class: ['btn', a.primary ? 'btn-primary' : 'btn-outline'],
      onClick: () => {
        save(true);
        navigate(`#/${a.route}?custom=1`);
      }
    }, h('span', { html: icon(a.icon) }), a.label, h('small', {}, a.sub)));

    const clearBtn = h('button', {
      type: 'button', class: 'btn btn-ghost btn-sm', html: `${icon('trash')}<span>Clear</span>`,
      onClick: () => {
        textarea.value = '';
        update();
        save(true);
        textarea.focus();
      }
    });

    const update = () => {
      const text = textarea.value;
      const trimmed = text.trim();
      const words = trimmed ? trimmed.split(/\s+/).length : 0;
      wordsEl.textContent = String(words);
      charsEl.textContent = String(text.length);
      const empty = trimmed.length === 0;
      actions.forEach((b) => { b.disabled = empty; });
      clearBtn.disabled = empty;
    };

    const save = (immediate = false) => {
      clearTimeout(customPage.timer);
      const doSave = () => {
        const value = textarea.value;
        if (getSettings().customText !== value) setSetting('customText', value);
        saveState.innerHTML = value.trim() ? `${icon('check')}<span>Saved</span>` : '';
      };
      if (immediate) doSave();
      else {
        saveState.textContent = 'Saving…';
        customPage.timer = setTimeout(doSave, 400);
      }
      customPage.flush = doSave;
    };

    textarea.addEventListener('input', () => { update(); save(); });
    update();
    if (textarea.value.trim()) saveState.innerHTML = `${icon('check')}<span>Saved</span>`;

    root.appendChild(h('div', { class: 'container page custom-page' },
      h('div', { class: 'mode-header' },
        h('h1', { class: 'page-title' }, h('span', { html: icon('file-text') }), 'Custom text'),
        h('div', { class: 'controls' }, h('a', { class: 'btn btn-ghost btn-sm', href: '#/' }, h('span', { html: icon('arrow-left') }), 'Home'))
      ),
      h('p', { class: 'page-subtitle' }, 'Practise with your own material. Your text is saved on this device and used by every mode when you choose it below.'),
      h('div', { class: 'card' },
        h('label', { class: 'field-label', for: 'custom-text' }, 'Your text'),
        h('div', { class: 'mt-sm' }, textarea),
        h('div', { class: 'custom-meta', id: 'custom-counts' },
          h('div', { class: 'counts' },
            h('span', {}, wordsEl, ' words'),
            h('span', {}, charsEl, ' characters')
          ),
          h('div', { class: 'flex gap-sm' }, saveState, clearBtn)
        ),
        h('div', { class: 'custom-actions' }, actions)
      ),
      h('div', { class: 'notice notice-info mt', html: icon('info') }, h('span', {}, 'Tip: for dictation and shadowing the text is split into sentences, so end each sentence with a period.'))
    ));
    setTimeout(() => { try { textarea.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 50);
  },
  unmount() {
    clearTimeout(customPage.timer);
    if (customPage.flush) {
      try { customPage.flush(); } catch (e) { /* ignore */ }
      customPage.flush = null;
    }
  }
};

const notFoundPage = {
  /** @param {HTMLElement} root */
  async mount(root) {
    root.appendChild(h('div', { class: 'container page' },
      h('div', { class: 'card error-card' },
        h('div', { class: 'error-icon', html: icon('info') }),
        h('h2', {}, 'Page not found'),
        h('p', { class: 'text-muted' }, 'That link does not match any practice mode.'),
        h('a', { class: 'btn btn-primary', href: '#/' }, h('span', { html: icon('home') }), 'Go home')
      )
    ));
  },
  unmount() {}
};

/* --------------------------------------------------------------------------
   Router
   -------------------------------------------------------------------------- */

const modeCache = /** @type {Map<string, Promise<any>>} */ (new Map());
let currentModule = /** @type {{unmount?: Function}|null} */ (null);
let currentRoute = '';
let routeToken = 0;

/**
 * Lazy-load a mode module (cached).
 * @param {string} name
 * @returns {Promise<{mount: Function, unmount: Function}>}
 */
function loadMode(name) {
  if (!modeCache.has(name)) {
    const p = import(`./modes/${name}.js`).catch((err) => {
      modeCache.delete(name);
      throw err;
    });
    modeCache.set(name, p);
  }
  return modeCache.get(name);
}

/**
 * Render a friendly error card when a route fails to load/mount.
 * @param {HTMLElement} root
 * @param {string} route
 * @param {Error} err
 */
function renderError(root, route, err) {
  root.innerHTML = '';
  const retryHash = location.hash || '#/';
  root.appendChild(h('div', { class: 'container page' },
    h('div', { class: 'card error-card' },
      h('div', { class: 'error-icon', html: icon('alert-triangle') }),
      h('h2', {}, 'Something went wrong'),
      h('p', { class: 'text-muted' }, `We couldn't open ${route ? `the “${route}” screen` : 'this screen'}. You can try again or head back home.`),
      h('pre', {}, String((err && (err.stack || err.message)) || err)),
      h('div', { class: 'flex-center gap-sm flex-wrap' },
        h('button', { type: 'button', class: 'btn btn-outline', onClick: () => navigate(retryHash) }, h('span', { html: icon('refresh') }), 'Try again'),
        h('a', { class: 'btn btn-primary', href: '#/' }, h('span', { html: icon('home') }), 'Home')
      )
    )
  ));
}

/**
 * Resolve the current hash and mount the matching screen.
 * @param {{soft?: boolean}} [opts] soft = in-place refresh (keeps drawer open and scroll position)
 */
async function handleRoute(opts = {}) {
  const soft = !!(opts && opts.soft === true);
  const root = document.getElementById('app');
  if (!root) return;
  const { route, params } = parseHash();
  const token = ++routeToken;
  currentRoute = route;

  // Tear down the previous screen
  if (currentModule && typeof currentModule.unmount === 'function') {
    try { currentModule.unmount(); } catch (err) { console.warn('[TypeTalk] unmount', err); }
  }
  currentModule = null;
  if (!soft) {
    safe(() => { if (typeof speech.stopSpeaking === 'function') speech.stopSpeaking(); });
    closeDrawer();
  }

  root.innerHTML = '';
  root.appendChild(h('div', { class: 'page-loading' }, h('div', { class: 'spinner', role: 'status', 'aria-label': 'Loading' })));
  updateTopbarState();
  if (!soft) window.scrollTo({ top: 0, behavior: 'auto' });

  let mod;
  try {
    if (route === '' || route === 'home') mod = homePage;
    else if (route === 'custom') mod = customPage;
    else if (MODE_ROUTES.includes(route)) mod = await loadMode(route);
    else mod = notFoundPage;

    if (token !== routeToken) return; // superseded by a newer navigation
    if (!mod || typeof mod.mount !== 'function') throw new Error(`Module "${route}" has no mount() export`);

    root.innerHTML = '';
    currentModule = mod;
    await mod.mount(root, params);
    if (token !== routeToken) return;
    document.title = routeTitle(route);
  } catch (err) {
    console.error('[TypeTalk] route error', err);
    if (token !== routeToken) return;
    currentModule = null;
    renderError(root, route, err);
  }
}

/**
 * @param {string} route
 * @returns {string}
 */
function routeTitle(route) {
  const names = {
    '': 'TypeTalk — Typing, Listening & Speaking Practice',
    typing: 'See & Type — TypeTalk',
    dictation: 'Listen & Type — TypeTalk',
    speaking: 'Read Aloud — TypeTalk',
    shadowing: 'Listen & Repeat — TypeTalk',
    dashboard: 'Dashboard — TypeTalk',
    custom: 'Custom Text — TypeTalk'
  };
  return names[route] || 'TypeTalk';
}

/* --------------------------------------------------------------------------
   Settings reactions
   -------------------------------------------------------------------------- */

const HOME_REFRESH_KEYS = ['level', 'lang', 'dailyGoal', 'customText'];
let homeRefreshRaf = 0;

onSettingsChange((settings, changedKeys = []) => {
  const keys = Array.isArray(changedKeys) ? changedKeys : Object.keys(DEFAULTS);
  if (keys.includes('theme') || keys.includes('reduceMotion')) applyTheme(settings);
  if (keys.includes('soundMuted')) updateTopbarState();
  syncDrawer(settings);
  if (keys.includes('lang') || keys.includes('ttsVoiceURI')) {
    // refresh the "no voice installed" notice when the accent changes
    if (drawer.built && drawer.voicesLoaded && keys.includes('lang')) refreshVoices();
  }
  if ((currentRoute === '' || currentRoute === 'home') && keys.some((k) => HOME_REFRESH_KEYS.includes(k))) {
    cancelAnimationFrame(homeRefreshRaf);
    homeRefreshRaf = requestAnimationFrame(() => handleRoute({ soft: true }));
  }
});

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

/** Register the service worker when served over http(s). */
function registerServiceWorker() {
  try {
    if (!('serviceWorker' in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('[TypeTalk] service worker not registered', err);
      });
    });
  } catch (err) {
    console.warn('[TypeTalk] service worker', err);
  }
}

/** Unlock the Web Audio context on the first user gesture. */
function armAudioUnlock() {
  const unlock = () => {
    safe(() => audio.initAudio());
    document.removeEventListener('pointerdown', unlock, true);
    document.removeEventListener('keydown', unlock, true);
  };
  document.addEventListener('pointerdown', unlock, { capture: true, once: true });
  document.addEventListener('keydown', unlock, { capture: true, once: true });
}

/** Initialise the shell. */
function init() {
  applyTheme();
  renderTopbar();
  buildDrawer();
  armAudioUnlock();
  registerServiceWorker();

  window.addEventListener('hashchange', () => handleRoute());
  window.addEventListener('online', () => toast('Back online', { type: 'success', duration: 1500 }));
  window.addEventListener('offline', () => toast('You are offline — using the built-in text bank', { type: 'warning', duration: 2500 }));

  handleRoute();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
