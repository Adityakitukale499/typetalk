/**
 * TypeTalk — shared results screen (contract section 5, js/results.js).
 * Renders a celebratory typing.com-style summary after any mode finishes:
 * stars, big stat tiles, personal best badge, XP + level bar, unlocked badges,
 * recent trend chart, optional extra content, weak keys and action buttons.
 *
 * @module results
 */

import { recordResult, getHistory } from './stats.js';
import { processResult, getLevel, getXp } from './milestones.js';
import { h, icon, starsFor, formatDuration, formatDate, confetti } from './ui.js';
import { renderLineChart } from './charts.js';
import { playSuccess, playUnlock } from './audio.js';

/** Human readable mode names. */
const MODE_LABELS = {
  typing: 'See & Type',
  dictation: 'Listen & Type',
  speaking: 'Read Aloud',
  shadowing: 'Listen & Repeat'
};

/** Modes whose WPM is a spoken-words-per-minute figure. */
const SPEECH_MODES = ['speaking', 'shadowing'];

/** Active document keydown handler (one results screen at a time). */
let activeKeyHandler = null;
/** MutationObserver watching the root for the screen being replaced. */
let activeObserver = null;

/**
 * Remove the Enter / Esc keyboard listener and the root observer installed by
 * the last showResults() call. Safe to call repeatedly; modes may call it in unmount().
 */
export function cleanupResults() {
  if (activeKeyHandler) {
    document.removeEventListener('keydown', activeKeyHandler);
    activeKeyHandler = null;
  }
  if (activeObserver) {
    activeObserver.disconnect();
    activeObserver = null;
  }
}

/**
 * Capitalise the first letter of a string.
 * @param {string} s
 * @returns {string}
 */
function cap(s) {
  const str = String(s || '');
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

/**
 * Clamp a number into [0, 1]; NaN becomes 0.
 * @param {number} n
 * @returns {number}
 */
function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * Cumulative XP required to reach a level (contract level curve):
 * sum of 100 * k^1.5 for k = 1..n-1 (level 1 at 0 xp).
 * @param {number} level
 * @returns {number}
 */
function xpForLevel(level) {
  let total = 0;
  for (let k = 1; k < level; k++) total += 100 * Math.pow(k, 1.5);
  return Math.round(total);
}

/**
 * Estimate the level-bar fill (0..1) the user had BEFORE this result.
 * @param {{ xpGained: number, levelBefore: number, leveledUp: boolean }} progress
 * @param {{ level: number, xpIntoLevel: number, xpForNext: number }} levelNow
 * @returns {number}
 */
function progressBefore(progress, levelNow) {
  const gained = Number(progress.xpGained) || 0;
  if (!progress.leveledUp) {
    const into = (Number(levelNow.xpIntoLevel) || 0) - gained;
    const need = Number(levelNow.xpForNext) || 1;
    return clamp01(into / need);
  }
  let xpNow = 0;
  try { xpNow = Number(getXp()) || 0; } catch (e) { xpNow = 0; }
  const lvlBefore = Math.max(1, Number(progress.levelBefore) || 1);
  const xpBefore = xpNow - gained;
  const into = xpBefore - xpForLevel(lvlBefore);
  const need = Math.max(1, xpForLevel(lvlBefore + 1) - xpForLevel(lvlBefore));
  return clamp01(into / need);
}

/**
 * Whether animations should be skipped (OS preference or app setting).
 * @returns {boolean}
 */
function reducedMotion() {
  try {
    if (document.documentElement.dataset.reduceMotion === 'true') return true;
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) {
    return false;
  }
}

/**
 * Display label for a key character in the "Keys to practice" list.
 * @param {string} ch
 * @returns {string}
 */
function keyLabel(ch) {
  if (ch === ' ') return 'Space';
  if (ch === '\n') return 'Enter';
  if (ch === '\t') return 'Tab';
  return ch;
}

/**
 * Pick the headline for the given mode.
 * @param {string} mode
 * @returns {string}
 */
function titleFor(mode) {
  if (SPEECH_MODES.includes(mode)) return 'Great Reading!';
  if (mode === 'dictation') return 'Nice Listening!';
  return 'Test Complete!';
}

/**
 * Build a big stat tile.
 * @param {string} value
 * @param {string} label
 * @param {string} [extraClass]
 * @returns {HTMLElement}
 */
function tile(value, label, extraClass = '') {
  return h('div', { class: `stat-tile results-tile ${extraClass}`.trim() },
    h('div', { class: 'value' }, value),
    h('div', { class: 'label' }, label)
  );
}

/**
 * Build a `.card` with a small heading.
 * @param {string} title
 * @param {string} extraClass
 * @param {...any} children
 * @returns {HTMLElement}
 */
function sectionCard(title, extraClass, ...children) {
  return h('div', { class: `card results-section ${extraClass}`.trim() },
    title ? h('h3', { class: 'results-section-title' }, title) : null,
    ...children
  );
}

/**
 * Render the shared results screen.
 *
 * 1) `const stored = recordResult(result)`  2) `const progress = processResult(stored)`
 * 3) clears `root` and renders the celebratory summary.
 *
 * Keyboard: Enter -> onNext, Esc -> onRetry. The listener removes itself when fired or
 * when the rendered screen is removed from `root`; `cleanupResults()` removes it too.
 *
 * @param {HTMLElement} root  container (usually <main id="app">)
 * @param {object} result  Result object produced by a mode (see contract)
 * @param {{ onRetry?: Function, onNext?: Function, onHome?: Function, extraContent?: HTMLElement }} [options]
 * @returns {Promise<{ stored: object, progress: object }>}
 */
export async function showResults(root, result, { onRetry, onNext, onHome, extraContent } = {}) {
  cleanupResults();

  // 1) persist + 2) milestones
  const stored = recordResult(result) || result;
  let progress;
  try {
    progress = processResult(stored);
  } catch (err) {
    console.warn('[results] processResult failed', err);
    progress = null;
  }
  if (!progress || typeof progress !== 'object') {
    progress = { xpGained: 0, levelBefore: 1, levelAfter: 1, leveledUp: false, newBadges: [] };
  }
  const newBadges = Array.isArray(progress.newBadges) ? progress.newBadges : [];

  let levelNow;
  try {
    levelNow = getLevel();
  } catch (e) {
    levelNow = null;
  }
  if (!levelNow) {
    levelNow = { level: progress.levelAfter || 1, title: '', xp: 0, xpIntoLevel: 0, xpForNext: 1, progress: 0 };
  }

  const mode = stored.mode || 'typing';
  const isSpeech = SPEECH_MODES.includes(mode);
  const stars = Math.max(0, Math.min(3, Number(starsFor(stored)) || 0));
  const motionOff = reducedMotion();

  // 3) render
  root.innerHTML = '';
  const wrap = h('section', { class: 'results-wrap', 'aria-live': 'polite' });

  // Header
  const subtitleParts = [MODE_LABELS[mode] || cap(mode), cap(stored.level), cap(stored.kind)].filter(Boolean);
  wrap.appendChild(h('header', { class: 'results-header' },
    h('h1', { class: 'results-title' }, titleFor(mode)),
    h('p', { class: 'results-subtitle text-muted' }, subtitleParts.join(' · '))
  ));

  // Stars
  const starsRow = h('div', { class: 'results-stars', role: 'img', 'aria-label': `${stars} of 3 stars` });
  for (let i = 0; i < 3; i++) {
    starsRow.appendChild(h('span', {
      class: `star${i < stars ? ' filled' : ''}`,
      style: { animationDelay: `${0.15 + i * 0.12}s` },
      html: icon('star')
    }));
  }
  wrap.appendChild(starsRow);

  // Stat tiles
  const accuracy = Number(stored.accuracy);
  wrap.appendChild(h('div', { class: 'results-tiles' },
    tile(String(stored.wpm ?? 0), isSpeech ? 'Spoken WPM' : 'WPM', 'tile-wpm'),
    tile(`${Number.isFinite(accuracy) ? accuracy : 0}%`, 'Accuracy', 'tile-accuracy'),
    tile(formatDuration(Math.round(Number(stored.durationSec) || 0)), 'Time', 'tile-time'),
    tile(String(stored.errors ?? 0), 'Errors', 'tile-errors')
  ));

  // Badges row: PB / revealed
  const flags = [];
  if (stored.isNewPb) {
    flags.push(h('span', { class: 'badge badge-success results-pb' },
      h('span', { class: 'results-pb-icon', html: icon('trophy') }),
      'New personal best!'
    ));
  }
  if (stored.revealed) {
    flags.push(h('span', { class: 'badge badge-warning' }, 'Text was revealed'));
  }
  if (flags.length) wrap.appendChild(h('div', { class: 'results-flags' }, ...flags));

  // XP card
  const bar = h('div', { class: 'bar', style: { width: `${Math.round(progressBefore(progress, levelNow) * 100)}%` } });
  const xpGained = Math.max(0, Math.round(Number(progress.xpGained) || 0));
  const xpCard = h('div', { class: 'card results-xp' },
    h('div', { class: 'flex-between results-xp-head' },
      h('div', { class: 'results-xp-gain' },
        h('span', { class: 'results-xp-icon', html: icon('zap') }),
        h('span', { class: 'results-xp-value' }, `+${xpGained} XP`)
      ),
      h('div', { class: 'results-level-label text-muted' },
        `Level ${levelNow.level}${levelNow.title ? ` · ${levelNow.title}` : ''}`
      )
    ),
    h('div', {
      class: 'progress results-level-bar',
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': String(Math.round(clamp01(levelNow.progress) * 100))
    }, bar),
    h('div', { class: 'results-xp-foot text-muted' },
      `${Math.round(Number(levelNow.xpIntoLevel) || 0)} / ${Math.round(Number(levelNow.xpForNext) || 0)} XP to next level`
    )
  );
  if (progress.leveledUp) {
    xpCard.appendChild(h('div', { class: 'results-levelup' },
      h('span', { class: 'results-levelup-icon', html: icon('award') }),
      h('span', null,
        h('strong', null, 'Level up! '),
        `You are now Level ${progress.levelAfter || levelNow.level}${levelNow.title ? ` - ${levelNow.title}` : ''}`
      )
    ));
  }
  wrap.appendChild(xpCard);

  // Newly unlocked badges
  if (newBadges.length) {
    const grid = h('div', { class: 'results-badges-grid' });
    newBadges.forEach((b, i) => {
      grid.appendChild(h('div', {
        class: 'results-badge-card',
        style: { animationDelay: `${0.3 + i * 0.12}s` }
      },
        h('div', { class: 'results-badge-emoji', 'aria-hidden': 'true' }, b.icon || '🏆'),
        h('div', { class: 'results-badge-text' },
          h('div', { class: 'results-badge-name' }, b.name || 'Badge'),
          h('div', { class: 'results-badge-desc text-muted' }, b.description || '')
        )
      ));
    });
    wrap.appendChild(sectionCard(
      newBadges.length === 1 ? 'Badge unlocked' : 'Badges unlocked',
      'results-badges',
      grid
    ));
  }

  // Recent trend (last 10 results for this mode, chronological)
  let history = [];
  try {
    history = getHistory({ mode, limit: 10 }) || [];
  } catch (e) {
    history = [];
  }
  const chrono = history.slice().reverse();
  let chartHost = null;
  if (chrono.length >= 2) {
    chartHost = h('div', { class: 'results-chart' });
    wrap.appendChild(sectionCard('Recent trend', 'results-trend',
      h('div', { class: 'results-legend text-muted' },
        h('span', { class: 'results-legend-item' },
          h('i', { class: 'results-legend-dot', style: { background: 'var(--primary)' } }),
          isSpeech ? 'Spoken WPM' : 'WPM'),
        h('span', { class: 'results-legend-item' },
          h('i', { class: 'results-legend-dot', style: { background: 'var(--accent)' } }),
          'Accuracy %')
      ),
      chartHost
    ));
  }

  // Extra content from the mode (e.g. spoken-word diff)
  if (extraContent instanceof Node) {
    wrap.appendChild(sectionCard('', 'results-extra', extraContent));
  }

  // Keys to practice
  const keyErrors = stored.keyErrors && typeof stored.keyErrors === 'object' ? stored.keyErrors : {};
  const topKeys = Object.entries(keyErrors)
    .filter(([, n]) => Number(n) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 5);
  if (topKeys.length) {
    wrap.appendChild(sectionCard('Keys to practice', 'results-keys',
      h('div', { class: 'results-keys-list' },
        ...topKeys.map(([ch, n]) => h('span', {
          class: 'results-key',
          title: `${n} mistake${Number(n) === 1 ? '' : 's'}`
        },
          h('span', { class: 'kbd' }, keyLabel(ch)),
          h('span', { class: 'results-key-count text-muted' }, `×${n}`)
        ))
      )
    ));
  }

  // Actions
  const hasRetry = typeof onRetry === 'function';
  const hasNext = typeof onNext === 'function';
  const goHome = () => {
    cleanupResults();
    if (typeof onHome === 'function') onHome();
    else location.hash = '#/';
  };
  const doRetry = () => {
    cleanupResults();
    if (hasRetry) onRetry();
  };
  const doNext = () => {
    cleanupResults();
    if (hasNext) onNext();
  };
  const actions = h('div', { class: 'results-actions' });
  if (hasRetry) {
    actions.appendChild(h('button', { class: 'btn btn-outline', type: 'button', onClick: doRetry },
      h('span', { class: 'results-btn-icon', html: icon('refresh') }), 'Try Again'));
  }
  if (hasNext) {
    actions.appendChild(h('button', { class: 'btn btn-primary btn-lg', type: 'button', onClick: doNext },
      'Next Text', h('span', { class: 'results-btn-icon', html: icon('arrow-right') })));
  }
  actions.appendChild(h('button', { class: 'btn btn-ghost', type: 'button', onClick: goHome },
    h('span', { class: 'results-btn-icon', html: icon('home') }), 'Home'));
  wrap.appendChild(actions);

  if (hasRetry || hasNext) {
    wrap.appendChild(h('div', { class: 'results-hints text-muted' },
      hasNext ? h('span', null, h('span', { class: 'kbd' }, 'Enter'), ' - Next') : null,
      hasRetry ? h('span', null, h('span', { class: 'kbd' }, 'Esc'), ' - Retry') : null
    ));
  }

  root.appendChild(wrap);

  // Chart after insertion so width-based layouts measure correctly.
  if (chartHost) {
    try {
      renderLineChart(chartHost, {
        series: [
          {
            name: isSpeech ? 'Spoken WPM' : 'WPM',
            color: 'var(--primary)',
            points: chrono.map((r, i) => ({ x: i, y: Number(r.wpm) || 0 }))
          },
          {
            name: 'Accuracy',
            color: 'var(--accent)',
            points: chrono.map((r, i) => ({ x: i, y: Number(r.accuracy) || 0 }))
          }
        ],
        height: 160,
        showDots: true,
        xLabels: chrono.map((r) => formatDate(r.timestamp))
      });
    } catch (err) {
      console.warn('[results] chart failed', err);
    }
  }

  // Animate the level bar to its new fill.
  const target = `${Math.round(clamp01(levelNow.progress) * 100)}%`;
  if (motionOff) {
    bar.style.width = target;
  } else if (progress.leveledUp) {
    // Fill to 100%, snap to 0, then grow to the new level's progress.
    requestAnimationFrame(() => {
      bar.style.width = '100%';
      setTimeout(() => {
        bar.style.transition = 'none';
        bar.style.width = '0%';
        void bar.offsetWidth;
        bar.style.transition = '';
        requestAnimationFrame(() => { bar.style.width = target; });
      }, 950);
    });
  } else {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { bar.style.width = target; });
    });
  }

  // Celebration audio / confetti
  try {
    if (newBadges.length || progress.leveledUp) {
      confetti();
      playUnlock();
    } else {
      playSuccess();
    }
  } catch (err) {
    console.warn('[results] celebration failed', err);
  }

  // Keyboard: Enter -> next, Esc -> retry
  if (hasRetry || hasNext) {
    activeKeyHandler = (ev) => {
      if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const t = ev.target;
      const tag = t && t.tagName ? t.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) return;
      if (ev.key === 'Enter' && hasNext) {
        ev.preventDefault();
        doNext();
      } else if ((ev.key === 'Escape' || ev.key === 'Esc') && hasRetry) {
        ev.preventDefault();
        doRetry();
      }
    };
    document.addEventListener('keydown', activeKeyHandler);

    if (typeof MutationObserver === 'function') {
      activeObserver = new MutationObserver(() => {
        if (!root.contains(wrap)) cleanupResults();
      });
      activeObserver.observe(root, { childList: true });
    }
  }

  return { stored, progress };
}
