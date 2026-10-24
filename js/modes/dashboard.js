/**
 * TypeTalk - modes/dashboard.js
 * "Your Progress" dashboard: level, streak, totals, trends, activity calendar, personal bests,
 * weak keys (keyboard heatmap), badges, recent history and data management (export / import / reset).
 */

import { h, toast, openModal, closeModal, formatDuration, formatDate, icon } from '../ui.js';
import {
  getHistory, getPersonalBests, getTotals, getDailyCounts, getStreak, getKeyErrorTotals, getTodayKey
} from '../stats.js';
import { getLevel, getXp, getAllBadgesWithStatus } from '../milestones.js';
import { createKeyboard } from '../keyboard.js';
import { exportData, importData, resetData } from '../storage.js';
import { renderLineChart, renderCalendarHeatmap, renderRing } from '../charts.js';

const MODES = ['typing', 'dictation', 'speaking', 'shadowing'];
const MODE_LABELS = {
  typing: 'See & Type',
  dictation: 'Listen & Type',
  speaking: 'Read Aloud',
  shadowing: 'Listen & Repeat'
};
const MODE_ICONS = {
  typing: 'keyboard',
  dictation: 'headphones',
  speaking: 'mic',
  shadowing: 'repeat'
};
const TREND_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'typing', label: 'Typing' },
  { key: 'dictation', label: 'Dictation' },
  { key: 'speaking', label: 'Speaking' },
  { key: 'shadowing', label: 'Shadowing' }
];

/** @type {HTMLElement|null} */
let rootEl = null;
/** @type {{ destroy: Function, setHeatmap: Function }|null} */
let keyboard = null;
let trendFilter = 'all';

/* ------------------------------------------------------------------ helpers */

/**
 * Format an integer with thousands separators.
 * @param {number} n
 * @returns {string}
 */
function num(n) {
  return (Number(n) || 0).toLocaleString();
}

/**
 * Human-readable mode label.
 * @param {string} mode
 * @returns {string}
 */
function modeLabel(mode) {
  return MODE_LABELS[mode] || mode || '-';
}

/**
 * Capitalise the first letter.
 * @param {string} s
 * @returns {string}
 */
function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/**
 * Card heading row with an icon.
 * @param {string} iconName
 * @param {string} title
 * @param {Node|string|null} [right]
 * @returns {HTMLElement}
 */
function cardHead(iconName, title, right = null) {
  return h('div', { class: 'dash-card-head' },
    h('div', { class: 'dash-card-title' },
      h('span', { class: 'dash-card-icon', html: icon(iconName) }),
      h('h2', {}, title)
    ),
    right
  );
}

/**
 * Display name for a key character in the weak keys list.
 * @param {string} ch
 * @returns {string}
 */
function keyName(ch) {
  if (ch === ' ') return 'space';
  if (ch === '\n') return 'enter';
  if (ch === '\t') return 'tab';
  return ch;
}

/**
 * Trigger a browser download of a text blob.
 * @param {string} filename
 * @param {string} text
 * @param {string} [type]
 */
function downloadText(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

/**
 * Format a timestamp as a short time of day, e.g. "14:05".
 * @param {number} ts
 * @returns {string}
 */
function formatTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* -------------------------------------------------------------------- cards */

/**
 * Empty-state banner shown when there is no history yet.
 * @returns {HTMLElement}
 */
function buildEmptyBanner() {
  return h('div', { class: 'notice notice-info dash-empty-banner' },
    h('div', { class: 'dash-empty-text' },
      h('strong', {}, 'No tests yet.'),
      ' Complete your first test and your progress, streaks and badges will show up here.'
    ),
    h('button', {
      class: 'btn btn-primary',
      onClick: () => { location.hash = '#/typing'; }
    }, h('span', { html: icon('keyboard') }), 'Start typing')
  );
}

/**
 * Level card: ring with XP into current level, title and XP text.
 * @returns {HTMLElement}
 */
function buildLevelCard() {
  const lvl = getLevel();
  const xp = getXp();
  const ringEl = h('div', { class: 'ring-wrap' });
  const isMax = !(lvl.xpForNext > 0);
  renderRing(ringEl, {
    value: isMax ? 1 : lvl.xpIntoLevel,
    max: isMax ? 1 : lvl.xpForNext,
    valueText: String(lvl.level),
    label: 'Level',
    size: 132
  });
  const pct = Math.round((isMax ? 1 : (lvl.progress || 0)) * 100);
  return h('section', { class: 'card dash-card level-card' },
    cardHead('star', 'Level'),
    h('div', { class: 'level-body' },
      ringEl,
      h('div', { class: 'level-info' },
        h('div', { class: 'level-title' }, `Level ${lvl.level} - ${lvl.title}`),
        h('div', { class: 'text-muted level-xp' }, `${num(xp)} XP total`),
        h('div', { class: 'progress level-progress', 'aria-label': 'XP progress' },
          h('div', { class: 'bar', style: { width: `${pct}%` } })
        ),
        h('div', { class: 'text-muted level-next' },
          isMax
            ? 'Max level reached!'
            : `${num(lvl.xpIntoLevel)} / ${num(lvl.xpForNext)} XP to level ${lvl.level + 1}`
        )
      )
    )
  );
}

/**
 * Streak card: current / longest streak + today's goal ring.
 * @returns {HTMLElement}
 */
function buildStreakCard() {
  const s = getStreak();
  const ringEl = h('div', { class: 'ring-wrap' });
  renderRing(ringEl, {
    value: s.todayCount,
    max: s.goal,
    valueText: String(s.todayCount),
    label: 'today',
    sublabel: `of ${s.goal}`,
    color: s.goalMet ? 'var(--success)' : 'var(--accent)',
    size: 132
  });
  return h('section', { class: 'card dash-card streak-card' },
    cardHead('flame', 'Streak'),
    h('div', { class: 'streak-body' },
      h('div', { class: 'streak-stats' },
        h('div', { class: 'streak-big' },
          h('span', { class: 'streak-flame', html: icon('flame') }),
          h('span', { class: 'streak-value' }, String(s.current)),
          h('span', { class: 'streak-unit' }, s.current === 1 ? 'day' : 'days')
        ),
        h('div', { class: 'text-muted' }, 'Current streak'),
        h('div', { class: 'streak-longest' },
          h('span', { html: icon('trophy') }),
          h('span', {}, `Longest: ${s.longest} ${s.longest === 1 ? 'day' : 'days'}`)
        ),
        h('div', { class: s.goalMet ? 'badge badge-success' : 'badge badge-primary' },
          s.goalMet ? 'Daily goal met!' : `${Math.max(0, s.goal - s.todayCount)} more to reach today's goal`
        )
      ),
      ringEl
    )
  );
}

/**
 * Totals tiles: tests, words, minutes, average accuracy.
 * @returns {HTMLElement}
 */
function buildTotalsCard() {
  const t = getTotals();
  const history = getHistory();
  const avgAcc = history.length
    ? Math.round((history.reduce((a, r) => a + (Number(r.accuracy) || 0), 0) / history.length) * 10) / 10
    : 0;
  const tile = (value, label) => h('div', { class: 'stat-tile' },
    h('div', { class: 'value' }, value),
    h('div', { class: 'label' }, label)
  );
  return h('section', { class: 'card dash-card totals-card span-2' },
    cardHead('zap', 'Totals'),
    h('div', { class: 'grid grid-4 totals-grid' },
      tile(num(t.tests), 'Tests'),
      tile(num(t.words), 'Words'),
      tile(num(Math.round((t.seconds || 0) / 60)), 'Minutes'),
      tile(`${avgAcc}%`, 'Avg accuracy')
    )
  );
}

/**
 * Trends card: segmented mode filter + WPM and accuracy line charts over the last 30 results.
 * @returns {HTMLElement}
 */
function buildTrendsCard() {
  const wpmEl = h('div', { class: 'chart-box' });
  const accEl = h('div', { class: 'chart-box' });

  const draw = () => {
    const opts = { limit: 30 };
    if (trendFilter !== 'all') opts.mode = trendFilter;
    const rows = getHistory(opts).slice().reverse(); // chronological
    const xLabels = rows.map((r) => formatDate(r.timestamp));
    renderLineChart(wpmEl, {
      series: rows.length ? [{ name: 'WPM', color: 'var(--primary)', points: rows.map((r, i) => ({ x: i, y: Number(r.wpm) || 0 })) }] : [],
      yLabel: 'WPM',
      height: 220,
      xLabels
    });
    renderLineChart(accEl, {
      series: rows.length ? [{ name: 'Accuracy', color: 'var(--accent)', points: rows.map((r, i) => ({ x: i, y: Number(r.accuracy) || 0 })) }] : [],
      yLabel: '%',
      height: 220,
      xLabels
    });
  };

  const seg = h('div', { class: 'segmented trend-filter', role: 'tablist', 'aria-label': 'Filter trends by mode' });
  const buttons = TREND_FILTERS.map((f) => {
    const btn = h('button', {
      type: 'button',
      class: f.key === trendFilter ? 'active' : '',
      role: 'tab',
      'aria-selected': f.key === trendFilter ? 'true' : 'false',
      onClick: () => {
        trendFilter = f.key;
        buttons.forEach((b, i) => {
          const on = TREND_FILTERS[i].key === trendFilter;
          b.classList.toggle('active', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        draw();
      }
    }, f.label);
    seg.appendChild(btn);
    return btn;
  });

  draw();

  return h('section', { class: 'card dash-card trends-card span-2' },
    cardHead('chart', 'Trends', seg),
    h('div', { class: 'trend-charts' },
      h('div', { class: 'trend-chart' },
        h('h3', { class: 'chart-title' }, 'WPM - last 30 results'),
        wpmEl
      ),
      h('div', { class: 'trend-chart' },
        h('h3', { class: 'chart-title' }, 'Accuracy - last 30 results'),
        accEl
      )
    )
  );
}

/**
 * Activity calendar heatmap card.
 * @returns {HTMLElement}
 */
function buildActivityCard() {
  const el = h('div', { class: 'heatmap-box' });
  const goal = getStreak().goal || 5;
  renderCalendarHeatmap(el, { counts: getDailyCounts(), weeks: 20, goal });
  return h('section', { class: 'card dash-card activity-card span-2' },
    cardHead('clock', 'Activity', h('span', { class: 'text-muted dash-card-note' }, `Daily goal: ${goal} tests`)),
    el
  );
}

/**
 * Personal bests per mode.
 * @returns {HTMLElement}
 */
function buildBestsCard() {
  const bests = getPersonalBests() || {};
  return h('section', { class: 'card dash-card bests-card' },
    cardHead('trophy', 'Personal bests'),
    h('ul', { class: 'bests-list' },
      MODES.map((m) => {
        const b = bests[m] || { wpm: 0, accuracy: 0 };
        return h('li', { class: 'bests-row' },
          h('span', { class: `mode-badge mode-${m}` }, h('span', { html: icon(MODE_ICONS[m]) }), modeLabel(m)),
          h('span', { class: 'bests-values' },
            h('span', { class: 'bests-stat' }, h('strong', {}, String(b.wpm || 0)), h('span', { class: 'text-muted' }, ' WPM')),
            h('span', { class: 'bests-stat' }, h('strong', {}, `${b.accuracy || 0}%`), h('span', { class: 'text-muted' }, ' acc'))
          )
        );
      })
    )
  );
}

/**
 * Weak keys: keyboard heatmap + top 5 mistyped keys.
 * @returns {HTMLElement}
 */
function buildWeakKeysCard() {
  const totals = getKeyErrorTotals() || {};
  const entries = Object.entries(totals)
    .filter(([, c]) => Number(c) > 0)
    .sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 5);

  const kbEl = h('div', { class: 'weak-keyboard' });
  if (keyboard) {
    try { keyboard.destroy(); } catch (e) { /* ignore */ }
    keyboard = null;
  }
  try {
    keyboard = createKeyboard(kbEl, { compact: true });
    keyboard.setHeatmap(totals);
  } catch (e) {
    console.warn('Keyboard heatmap unavailable', e);
  }

  const list = top.length
    ? h('ol', { class: 'weak-keys-list' },
      top.map(([ch, count]) => h('li', { class: 'weak-key-row' },
        h('span', { class: 'kbd' }, keyName(ch)),
        h('span', { class: 'weak-key-count' }, `${num(count)} ${count === 1 ? 'mistake' : 'mistakes'}`)
      ))
    )
    : h('p', { class: 'text-muted weak-keys-empty' }, 'No mistakes recorded yet. Nice!');

  return h('section', { class: 'card dash-card weak-keys-card span-2' },
    cardHead('target', 'Weak keys'),
    h('div', { class: 'weak-keys-body' },
      kbEl,
      h('div', { class: 'weak-keys-side' },
        h('h3', { class: 'chart-title' }, 'Most mistyped'),
        list
      )
    )
  );
}

/**
 * Badges grid with locked / unlocked status and progress bars.
 * @returns {HTMLElement}
 */
function buildBadgesCard() {
  const all = getAllBadgesWithStatus() || [];
  const unlockedCount = all.filter((b) => b.unlocked).length;
  return h('section', { class: 'card dash-card badges-card span-2' },
    cardHead('award', 'Badges', h('span', { class: 'badge badge-primary badges-summary' }, `${unlockedCount} / ${all.length} unlocked`)),
    all.length === 0
      ? h('p', { class: 'text-muted' }, 'No badges defined.')
      : h('div', { class: 'badge-grid' },
        all.map((b) => {
          const prog = b.progress && b.progress.target > 0 ? b.progress : null;
          const pct = prog ? Math.min(100, Math.round((prog.current / prog.target) * 100)) : 0;
          return h('div', {
            class: `badge-card${b.unlocked ? ' unlocked' : ' locked'}`,
            title: b.unlocked ? `${b.name} - unlocked` : `${b.name} - locked`
          },
            h('div', { class: 'badge-icon', 'aria-hidden': 'true' }, b.icon || '\u{1F3C5}'),
            h('div', { class: 'badge-name' }, b.name),
            h('div', { class: 'badge-desc text-muted' }, b.description || ''),
            b.unlocked
              ? h('div', { class: 'badge-status badge-unlocked' },
                h('span', { html: icon('check') }),
                `Unlocked ${b.unlockedAt ? formatDate(b.unlockedAt) : ''}`.trim())
              : (prog
                ? h('div', { class: 'badge-progress' },
                  h('div', { class: 'progress' }, h('div', { class: 'bar', style: { width: `${pct}%` } })),
                  h('div', { class: 'badge-progress-text text-muted' }, `${num(prog.current)} / ${num(prog.target)}`)
                )
                : h('div', { class: 'badge-status text-muted' }, 'Locked'))
          );
        })
      )
  );
}

/**
 * Recent history table (last 20 results).
 * @returns {HTMLElement}
 */
function buildHistoryCard() {
  const rows = getHistory({ limit: 20 });
  const table = rows.length === 0
    ? h('p', { class: 'text-muted' }, 'Your recent tests will appear here.')
    : h('div', { class: 'history-wrap' },
      h('table', { class: 'history-table' },
        h('thead', {},
          h('tr', {},
            h('th', {}, 'Date'),
            h('th', {}, 'Mode'),
            h('th', {}, 'Level'),
            h('th', { class: 'num' }, 'WPM'),
            h('th', { class: 'num' }, 'Accuracy'),
            h('th', { class: 'num' }, 'Time')
          )
        ),
        h('tbody', {},
          rows.map((r) => h('tr', {},
            h('td', {},
              h('span', { class: 'history-date' }, formatDate(r.timestamp)),
              h('span', { class: 'history-time text-muted' }, ` ${formatTime(r.timestamp)}`)
            ),
            h('td', {}, h('span', { class: `mode-badge mode-${r.mode}` }, h('span', { html: icon(MODE_ICONS[r.mode] || 'keyboard') }), modeLabel(r.mode))),
            h('td', {}, cap(r.level)),
            h('td', { class: 'num' }, String(r.wpm ?? 0)),
            h('td', { class: 'num' }, `${r.accuracy ?? 0}%`),
            h('td', { class: 'num' }, formatDuration(Math.round(r.durationSec || 0)))
          ))
        )
      )
    );
  return h('section', { class: 'card dash-card history-card span-2' },
    cardHead('file-text', 'Recent history', h('span', { class: 'text-muted dash-card-note' }, rows.length ? `Last ${rows.length}` : '')),
    table
  );
}

/**
 * Data management: export / import / reset.
 * @returns {HTMLElement}
 */
function buildDataCard() {
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'sr-only',
    'aria-label': 'Import progress file',
    tabindex: '-1',
    onChange: (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const ok = importData(String(reader.result || ''));
        if (ok) {
          toast('Progress imported', { type: 'success', icon: icon('check') });
          rerender();
        } else {
          toast('Could not import that file - is it a TypeTalk export?', { type: 'error' });
        }
      };
      reader.onerror = () => toast('Could not read the file', { type: 'error' });
      reader.readAsText(file);
    }
  });

  const onExport = () => {
    try {
      const json = exportData();
      downloadText(`typetalk-progress-${getTodayKey()}.json`, json);
      toast('Progress exported', { type: 'success', icon: icon('download') });
    } catch (e) {
      console.warn(e);
      toast('Export failed', { type: 'error' });
    }
  };

  const onReset = () => {
    openModal({
      title: 'Reset all data?',
      content: h('div', {},
        h('p', {}, 'This permanently deletes your history, XP, badges, streaks and settings on this device.'),
        h('p', { class: 'text-muted' }, 'Tip: export your progress first if you might want it back.')
      ),
      actions: [
        { label: 'Cancel', variant: 'ghost', onClick: () => closeModal() },
        {
          label: 'Reset everything',
          variant: 'danger',
          onClick: () => {
            resetData();
            closeModal();
            trendFilter = 'all';
            toast('All data has been reset', { type: 'warning', icon: icon('trash') });
            rerender();
          }
        }
      ]
    });
  };

  return h('section', { class: 'card dash-card data-card span-2' },
    cardHead('settings', 'Your data'),
    h('p', { class: 'text-muted data-note' },
      'Everything is stored locally in this browser. Export a backup to move your progress to another device.'),
    h('div', { class: 'data-actions' },
      h('button', { class: 'btn btn-outline', type: 'button', onClick: onExport },
        h('span', { html: icon('download') }), 'Export JSON'),
      h('button', { class: 'btn btn-outline', type: 'button', onClick: () => fileInput.click() },
        h('span', { html: icon('upload') }), 'Import JSON'),
      h('button', { class: 'btn btn-danger', type: 'button', onClick: onReset },
        h('span', { html: icon('trash') }), 'Reset all data'),
      fileInput
    )
  );
}

/* ------------------------------------------------------------------- render */

/**
 * Build the whole dashboard into the root element.
 */
function render() {
  if (!rootEl) return;
  if (keyboard) {
    try { keyboard.destroy(); } catch (e) { /* ignore */ }
    keyboard = null;
  }
  rootEl.innerHTML = '';

  const totals = getTotals();
  const hasData = (totals && totals.tests > 0) || getHistory({ limit: 1 }).length > 0;

  const page = h('div', { class: 'container dashboard-page' },
    h('div', { class: 'mode-header dash-header' },
      h('div', {},
        h('h1', { class: 'page-title' }, 'Your Progress'),
        h('p', { class: 'page-subtitle' }, 'Levels, streaks, trends and badges - all stored on this device.')
      ),
      h('button', {
        class: 'btn btn-primary',
        type: 'button',
        onClick: () => { location.hash = '#/typing'; }
      }, h('span', { html: icon('keyboard') }), 'Take a test')
    ),
    hasData ? null : buildEmptyBanner(),
    h('div', { class: 'dashboard' },
      buildLevelCard(),
      buildStreakCard(),
      buildTotalsCard(),
      buildTrendsCard(),
      buildActivityCard(),
      buildBestsCard(),
      buildWeakKeysCard(),
      buildBadgesCard(),
      buildHistoryCard(),
      buildDataCard()
    )
  );
  rootEl.appendChild(page);
}

/**
 * Re-render after data changes (import / reset).
 */
function rerender() {
  if (!rootEl) return;
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

/* --------------------------------------------------------- mode interface */

/**
 * Mount the dashboard.
 * @param {HTMLElement} root
 * @param {Object} [params]
 */
export async function mount(root, params = {}) {
  rootEl = root;
  if (params && params.mode && (params.mode === 'all' || MODES.includes(params.mode))) {
    trendFilter = params.mode;
  }
  render();
}

/**
 * Unmount: destroy the keyboard and release references.
 */
export function unmount() {
  if (keyboard) {
    try { keyboard.destroy(); } catch (e) { /* ignore */ }
    keyboard = null;
  }
  rootEl = null;
}
