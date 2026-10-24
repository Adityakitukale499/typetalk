/**
 * TypeTalk — milestones.js
 * XP, levels and badges. Persists via storage.js keys `xp` (number) and
 * `badges` (object: badgeId -> unlockedAt timestamp).
 *
 * Call `processResult(stored)` AFTER `stats.recordResult(result)`.
 */

import { storageGet, storageSet } from './storage.js';
import {
  getTotals,
  getStreak,
  getModesToday,
  getHistory,
  getPersonalBests
} from './stats.js';

const XP_KEY = 'xp';
const BADGES_KEY = 'badges';
const MAX_LEVEL = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

const MODE_MULTIPLIER = {
  typing: 1,
  dictation: 1.5,
  speaking: 1.5,
  shadowing: 2
};

/* ------------------------------------------------------------------------ */
/* Level titles                                                             */
/* ------------------------------------------------------------------------ */

/** 50 progressive level titles (index 0 = level 1). */
export const LEVEL_TITLES = [
  'Novice',
  'Beginner',
  'Key Finder',
  'Hunt-and-Pecker',
  'Typist',
  'Apprentice',
  'Steady Hands',
  'Word Wrangler',
  'Home-Row Hero',
  'Rhythm Keeper',
  'Quick Fingers',
  'Sentence Slinger',
  'Keyboard Cadet',
  'Dictation Dabbler',
  'Clear Speaker',
  'Paragraph Pilot',
  'Accuracy Ace',
  'Shift Master',
  'Tempo Tamer',
  'Wordsmith',
  'Swift Scribe',
  'Echo Artist',
  'Punctuation Pro',
  'Caret Commander',
  'Velocity Virtuoso',
  'Golden Ear',
  'Silver Tongue',
  'Backspace Banisher',
  'Flow State',
  'Keystroke Knight',
  'Lightning Linguist',
  'Syntax Sorcerer',
  'Dictation Dynamo',
  'Tongue-Twister Titan',
  'Hundred-Word Hurricane',
  'Error Eraser',
  'Grandmaster Typist',
  'Sonic Scribe',
  'Precision Prodigy',
  'Keyboard Sage',
  'Word Warlock',
  'Phrase Phenom',
  'Typing Titan',
  'Oracle of QWERTY',
  'Mythic Fingers',
  'Supersonic Scribe',
  'Immortal Typist',
  'Keyboard Deity',
  'The Final Boss',
  'Keyboard Legend'
];

/* ------------------------------------------------------------------------ */
/* Badge definitions                                                        */
/* ------------------------------------------------------------------------ */

/**
 * Public badge list: { id, name, description, icon, category }.
 * Unlock logic lives in RULES (keyed by id) so the exported objects stay plain.
 * @type {Array<{id:string,name:string,description:string,icon:string,category:string}>}
 */
export const BADGES = [];

/**
 * @typedef {Object} BadgeContext
 * @property {Object|null} result        the just-recorded result (null when only checking status)
 * @property {Object} totals             stats.getTotals()
 * @property {Object} streak             stats.getStreak()
 * @property {string[]} modesToday       stats.getModesToday()
 * @property {Object} bests              stats.getPersonalBests()
 * @property {Object[]} history          stats.getHistory() newest first
 */

/** @type {Object<string, {check:(ctx:BadgeContext)=>boolean, progress?:(ctx:BadgeContext)=>{current:number,target:number}}>} */
const RULES = {};

/**
 * Registers a badge.
 * @param {{id:string,name:string,description:string,icon:string,category:string}} badge
 * @param {(ctx: BadgeContext) => boolean} check
 * @param {(ctx: BadgeContext) => {current:number,target:number}} [progress]
 */
function def(badge, check, progress) {
  BADGES.push(badge);
  RULES[badge.id] = { check, progress };
}

/* Helpers used by rules ------------------------------------------------- */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function hourOf(ts) {
  const d = new Date(num(ts) || Date.now());
  return d.getHours();
}

function isMode(result, mode) {
  return Boolean(result) && result.mode === mode;
}

function resultWpm(result, mode) {
  return isMode(result, mode) ? num(result.wpm) : 0;
}

function bestWpm(bests, mode) {
  return bests && bests[mode] ? num(bests[mode].wpm) : 0;
}

function perfectCount(history) {
  return history.filter((r) => num(r.accuracy) >= 100 && num(r.chars) >= 50).length;
}

function modeCount(totals, mode) {
  return totals && totals.byMode ? num(totals.byMode[mode]) : 0;
}

function bestStreak(streak) {
  return Math.max(num(streak.current), num(streak.longest));
}

function countProgress(getter, target) {
  return (ctx) => ({ current: Math.min(getter(ctx), target), target });
}

/* Tests ---------------------------------------------------------------- */

const TEST_MILESTONES = [
  { n: 1, id: 'first-test', name: 'First Steps', icon: '🎯', desc: 'Complete your very first test.' },
  { n: 10, id: 'tests-10', name: 'Warming Up', icon: '🔥', desc: 'Complete 10 tests.' },
  { n: 50, id: 'tests-50', name: 'Regular', icon: '📘', desc: 'Complete 50 tests.' },
  { n: 100, id: 'tests-100', name: 'Centurion', icon: '💯', desc: 'Complete 100 tests.' },
  { n: 500, id: 'tests-500', name: 'Dedicated', icon: '🏛️', desc: 'Complete 500 tests.' }
];
TEST_MILESTONES.forEach(({ n, id, name, icon, desc }) => {
  def(
    { id, name, description: desc, icon, category: 'tests' },
    (ctx) => num(ctx.totals.tests) >= n,
    countProgress((ctx) => num(ctx.totals.tests), n)
  );
});

/* Speed (typing mode) --------------------------------------------------- */

const SPEED_MILESTONES = [
  { n: 20, id: 'wpm-20', name: 'Getting Rolling', icon: '🚲' },
  { n: 40, id: 'wpm-40', name: 'Cruising', icon: '🚗' },
  { n: 60, id: 'wpm-60', name: 'Fast Fingers', icon: '🏍️' },
  { n: 80, id: 'wpm-80', name: 'Blazing', icon: '🏎️' },
  { n: 100, id: 'wpm-100', name: 'Century Club', icon: '🚀' },
  { n: 120, id: 'wpm-120', name: 'Speed Demon 120', icon: '😈' }
];
SPEED_MILESTONES.forEach(({ n, id, name, icon }) => {
  def(
    { id, name, description: `Reach ${n} WPM in a typing test.`, icon, category: 'speed' },
    (ctx) => Math.max(resultWpm(ctx.result, 'typing'), bestWpm(ctx.bests, 'typing')) >= n,
    countProgress(
      (ctx) => Math.max(resultWpm(ctx.result, 'typing'), bestWpm(ctx.bests, 'typing')),
      n
    )
  );
});

/* Accuracy --------------------------------------------------------------- */

def(
  {
    id: 'acc-95',
    name: 'Sharpshooter',
    description: 'Finish a test with 95% accuracy or better (50+ characters).',
    icon: '🎯',
    category: 'accuracy'
  },
  (ctx) => Boolean(ctx.result) && num(ctx.result.accuracy) >= 95 && num(ctx.result.chars) >= 50
);

def(
  {
    id: 'acc-100',
    name: 'Flawless',
    description: 'Finish a test with 100% accuracy (50+ characters).',
    icon: '💎',
    category: 'accuracy'
  },
  (ctx) => Boolean(ctx.result) && num(ctx.result.accuracy) >= 100 && num(ctx.result.chars) >= 50
);

def(
  {
    id: 'perfect-5',
    name: 'Perfectionist x5',
    description: 'Finish 5 tests with 100% accuracy (50+ characters each).',
    icon: '✨',
    category: 'accuracy'
  },
  (ctx) => perfectCount(ctx.history) >= 5,
  countProgress((ctx) => perfectCount(ctx.history), 5)
);

def(
  {
    id: 'error-free-marathon',
    name: 'Clean Sheet',
    description: 'Type 200+ characters in one test without a single mistake.',
    icon: '🧼',
    category: 'accuracy'
  },
  (ctx) =>
    Boolean(ctx.result) &&
    (ctx.result.mode === 'typing' || ctx.result.mode === 'dictation') &&
    num(ctx.result.errors) === 0 &&
    num(ctx.result.chars) >= 200
);

/* Volume ----------------------------------------------------------------- */

const WORD_MILESTONES = [
  { n: 1000, id: 'words-1k', name: 'Thousand Words', icon: '📝', label: '1,000' },
  { n: 10000, id: 'words-10k', name: 'Novelist', icon: '📚', label: '10,000' },
  { n: 100000, id: 'words-100k', name: 'Library Builder', icon: '🏰', label: '100,000' }
];
WORD_MILESTONES.forEach(({ n, id, name, icon, label }) => {
  def(
    { id, name, description: `Type or speak ${label} words in total.`, icon, category: 'volume' },
    (ctx) => num(ctx.totals.words) >= n,
    countProgress((ctx) => num(ctx.totals.words), n)
  );
});

def(
  {
    id: 'hours-1',
    name: 'Hour of Power',
    description: 'Practise for 1 hour in total.',
    icon: '⏳',
    category: 'volume'
  },
  (ctx) => num(ctx.totals.seconds) >= 3600,
  countProgress((ctx) => Math.floor(num(ctx.totals.seconds) / 60), 60)
);

/* Listening (dictation) ---------------------------------------------------- */

def(
  {
    id: 'dictation-first',
    name: 'All Ears',
    description: 'Complete your first Listen & Type test.',
    icon: '👂',
    category: 'listening'
  },
  (ctx) => isMode(ctx.result, 'dictation') || modeCount(ctx.totals, 'dictation') >= 1,
  countProgress((ctx) => modeCount(ctx.totals, 'dictation'), 1)
);

def(
  {
    id: 'dictation-90',
    name: 'Good Ear',
    description: 'Score 90% accuracy or better in a Listen & Type test.',
    icon: '🎧',
    category: 'listening'
  },
  (ctx) => isMode(ctx.result, 'dictation') && num(ctx.result.accuracy) >= 90
);

def(
  {
    id: 'dictation-expert',
    name: 'Polyglot Ear',
    description: 'Complete a Listen & Type test at expert level.',
    icon: '🦻',
    category: 'listening'
  },
  (ctx) => isMode(ctx.result, 'dictation') && ctx.result.level === 'expert'
);

def(
  {
    id: 'dictation-25',
    name: 'Transcriber',
    description: 'Complete 25 Listen & Type tests.',
    icon: '📻',
    category: 'listening'
  },
  (ctx) => modeCount(ctx.totals, 'dictation') >= 25,
  countProgress((ctx) => modeCount(ctx.totals, 'dictation'), 25)
);

/* Speaking (speaking + shadowing) ------------------------------------------ */

def(
  {
    id: 'speaking-first',
    name: 'Found My Voice',
    description: 'Complete your first Read Aloud test.',
    icon: '🎤',
    category: 'speaking'
  },
  (ctx) => isMode(ctx.result, 'speaking') || modeCount(ctx.totals, 'speaking') >= 1,
  countProgress((ctx) => modeCount(ctx.totals, 'speaking'), 1)
);

def(
  {
    id: 'speaking-95',
    name: 'Clear Speaker',
    description: 'Score 95% accuracy or better in a Read Aloud test.',
    icon: '🗣️',
    category: 'speaking'
  },
  (ctx) => isMode(ctx.result, 'speaking') && num(ctx.result.accuracy) >= 95
);

def(
  {
    id: 'shadowing-first',
    name: 'Echo',
    description: 'Complete your first Listen & Repeat session.',
    icon: '🔁',
    category: 'speaking'
  },
  (ctx) => isMode(ctx.result, 'shadowing') || modeCount(ctx.totals, 'shadowing') >= 1,
  countProgress((ctx) => modeCount(ctx.totals, 'shadowing'), 1)
);

def(
  {
    id: 'shadowing-90',
    name: 'Parrot',
    description: 'Score 90% accuracy or better in a Listen & Repeat session.',
    icon: '🦜',
    category: 'speaking'
  },
  (ctx) => isMode(ctx.result, 'shadowing') && num(ctx.result.accuracy) >= 90
);

def(
  {
    id: 'speech-25',
    name: 'Orator',
    description: 'Complete 25 speech tests (Read Aloud or Listen & Repeat).',
    icon: '🎙️',
    category: 'speaking'
  },
  (ctx) => modeCount(ctx.totals, 'speaking') + modeCount(ctx.totals, 'shadowing') >= 25,
  countProgress(
    (ctx) => modeCount(ctx.totals, 'speaking') + modeCount(ctx.totals, 'shadowing'),
    25
  )
);

/* Streaks -------------------------------------------------------------------- */

const STREAK_MILESTONES = [
  { n: 3, id: 'streak-3', name: 'Hat Trick', icon: '🔥' },
  { n: 7, id: 'streak-7', name: 'Week Warrior', icon: '📅' },
  { n: 30, id: 'streak-30', name: 'Monthly Machine', icon: '🗓️' },
  { n: 100, id: 'streak-100', name: 'Unstoppable', icon: '🌋' }
];
STREAK_MILESTONES.forEach(({ n, id, name, icon }) => {
  def(
    { id, name, description: `Practise ${n} days in a row.`, icon, category: 'streak' },
    (ctx) => bestStreak(ctx.streak) >= n,
    countProgress((ctx) => bestStreak(ctx.streak), n)
  );
});

def(
  {
    id: 'goal-met',
    name: 'Goal Getter',
    description: 'Hit your daily test goal.',
    icon: '✅',
    category: 'streak'
  },
  (ctx) => Boolean(ctx.streak.goalMet),
  (ctx) => {
    const target = Math.max(1, num(ctx.streak.goal) || 1);
    return { current: Math.min(num(ctx.streak.todayCount), target), target };
  }
);

/* Special ---------------------------------------------------------------------- */

const ALL_MODES = ['typing', 'dictation', 'speaking', 'shadowing'];

def(
  {
    id: 'all-modes-day',
    name: 'Quadfecta',
    description: 'Practise all four modes in a single day.',
    icon: '🍀',
    category: 'special'
  },
  (ctx) => ALL_MODES.every((m) => ctx.modesToday.includes(m)),
  countProgress((ctx) => ALL_MODES.filter((m) => ctx.modesToday.includes(m)).length, 4)
);

def(
  {
    id: 'night-owl',
    name: 'Night Owl',
    description: 'Complete a test between midnight and 4 AM.',
    icon: '🦉',
    category: 'special'
  },
  (ctx) => {
    if (!ctx.result) return false;
    const h = hourOf(ctx.result.timestamp);
    return h >= 0 && h < 4;
  }
);

def(
  {
    id: 'early-bird',
    name: 'Early Bird',
    description: 'Complete a test between 5 AM and 7 AM.',
    icon: '🐦',
    category: 'special'
  },
  (ctx) => {
    if (!ctx.result) return false;
    const h = hourOf(ctx.result.timestamp);
    return h >= 5 && h < 7;
  }
);

def(
  {
    id: 'marathon',
    name: 'Marathon',
    description: 'Complete a single test lasting 5 minutes or more.',
    icon: '🏃',
    category: 'special'
  },
  (ctx) => Boolean(ctx.result) && num(ctx.result.durationSec) >= 300
);

def(
  {
    id: 'comeback',
    name: 'Comeback',
    description: 'Return for a test after a break of 7 or more days.',
    icon: '🔙',
    category: 'special'
  },
  (ctx) => {
    if (!ctx.result) return false;
    const now = num(ctx.result.timestamp);
    const previous = ctx.history.find(
      (r) => r && r.id !== ctx.result.id && num(r.timestamp) < now
    );
    return Boolean(previous) && now - num(previous.timestamp) >= 7 * DAY_MS;
  }
);

def(
  {
    id: 'weekend-warrior',
    name: 'Weekend Warrior',
    description: 'Complete a test on a Saturday or Sunday.',
    icon: '🛋️',
    category: 'special'
  },
  (ctx) => {
    if (!ctx.result) return false;
    const day = new Date(num(ctx.result.timestamp) || Date.now()).getDay();
    return day === 0 || day === 6;
  }
);

def(
  {
    id: 'custom-creator',
    name: 'Author',
    description: 'Complete a test using your own custom text.',
    icon: '✍️',
    category: 'special'
  },
  (ctx) => Boolean(ctx.result) && ctx.result.kind === 'custom'
);

def(
  {
    id: 'number-cruncher',
    name: 'Number Cruncher',
    description: 'Score 95% accuracy or better on a numbers & symbols test.',
    icon: '🔢',
    category: 'special'
  },
  (ctx) =>
    Boolean(ctx.result) && ctx.result.kind === 'numbers' && num(ctx.result.accuracy) >= 95
);

def(
  {
    id: 'expert-typist',
    name: 'Expert Mode',
    description: 'Complete an expert-level typing test with 90% accuracy or better.',
    icon: '🧠',
    category: 'special'
  },
  (ctx) =>
    isMode(ctx.result, 'typing') &&
    ctx.result.level === 'expert' &&
    num(ctx.result.accuracy) >= 90
);

/* ------------------------------------------------------------------------ */
/* Persistence helpers                                                       */
/* ------------------------------------------------------------------------ */

/** @returns {number} */
function readXp() {
  const xp = Number(storageGet(XP_KEY, 0));
  return Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
}

/** @returns {Object<string, number>} */
function readUnlocked() {
  const raw = storageGet(BADGES_KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
}

function safe(fn, fallback) {
  try {
    const v = fn();
    return v === undefined || v === null ? fallback : v;
  } catch (err) {
    return fallback;
  }
}

/**
 * Gathers everything badge rules need, with safe defaults on a fresh install.
 * @param {Object|null} result
 * @returns {BadgeContext}
 */
function buildContext(result) {
  const totals = safe(getTotals, {});
  const streak = safe(getStreak, {});
  const modesToday = safe(getModesToday, []);
  const bests = safe(getPersonalBests, {});
  const history = safe(() => getHistory(), []);
  return {
    result: result || null,
    totals: totals && typeof totals === 'object' ? totals : {},
    streak: streak && typeof streak === 'object' ? streak : {},
    modesToday: Array.isArray(modesToday) ? modesToday : [],
    bests: bests && typeof bests === 'object' ? bests : {},
    history: Array.isArray(history) ? history : []
  };
}

/* ------------------------------------------------------------------------ */
/* Levels                                                                    */
/* ------------------------------------------------------------------------ */

const LEVEL_THRESHOLDS = (() => {
  const t = [0];
  let sum = 0;
  for (let k = 1; k < MAX_LEVEL; k++) {
    sum += Math.round(100 * Math.pow(k, 1.5));
    t.push(sum);
  }
  return t; // t[n-1] = cumulative xp to reach level n
})();

/**
 * Cumulative XP required to reach level n (1-based; level 1 = 0 xp).
 * Levels above 50 return the level-50 threshold.
 * @param {number} n
 * @returns {number}
 */
export function xpForLevel(n) {
  const lvl = Math.min(MAX_LEVEL, Math.max(1, Math.floor(num(n)) || 1));
  return LEVEL_THRESHOLDS[lvl - 1];
}

/**
 * Level number for a given XP amount.
 * @param {number} xp
 * @returns {number}
 */
function levelForXp(xp) {
  let level = 1;
  for (let n = 2; n <= MAX_LEVEL; n++) {
    if (xp >= LEVEL_THRESHOLDS[n - 1]) level = n;
    else break;
  }
  return level;
}

/**
 * Total XP earned.
 * @returns {number}
 */
export function getXp() {
  return readXp();
}

/**
 * Current level info.
 * @returns {{ level:number, title:string, xp:number, xpIntoLevel:number, xpForNext:number, progress:number }}
 */
export function getLevel() {
  const xp = readXp();
  const level = levelForXp(xp);
  const base = xpForLevel(level);
  const atMax = level >= MAX_LEVEL;
  const next = atMax ? base : xpForLevel(level + 1);
  const xpForNext = atMax ? 0 : next - base;
  const xpIntoLevel = atMax ? 0 : xp - base;
  const progress = atMax ? 1 : Math.min(1, Math.max(0, xpForNext ? xpIntoLevel / xpForNext : 0));
  return {
    level,
    title: LEVEL_TITLES[level - 1] || LEVEL_TITLES[LEVEL_TITLES.length - 1],
    xp,
    xpIntoLevel,
    xpForNext,
    progress
  };
}

/* ------------------------------------------------------------------------ */
/* XP calculation                                                            */
/* ------------------------------------------------------------------------ */

/**
 * XP for a single result: round(words * (accuracy/100)^2 * modeMultiplier)
 * + 25 for a new personal best + 20 for 100% accuracy, minimum 1.
 * @param {Object} result
 * @returns {number}
 */
function computeXp(result) {
  const words = Math.max(0, num(result.words));
  const accuracy = Math.min(100, Math.max(0, num(result.accuracy)));
  const mult = MODE_MULTIPLIER[result.mode] || 1;
  let xp = Math.round(words * Math.pow(accuracy / 100, 2) * mult);
  if (result.isNewPb) xp += 25;
  if (accuracy >= 100) xp += 20;
  return Math.max(1, xp);
}

/* ------------------------------------------------------------------------ */
/* Public API                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Awards XP and checks badges for a freshly recorded result.
 * Call AFTER stats.recordResult(result).
 * @param {Object} storedResult result returned by stats.recordResult (has isNewPb)
 * @returns {{ xpGained:number, levelBefore:number, levelAfter:number, leveledUp:boolean, newBadges:Object[] }}
 */
export function processResult(storedResult) {
  const before = getLevel();
  if (!storedResult || typeof storedResult !== 'object') {
    return {
      xpGained: 0,
      levelBefore: before.level,
      levelAfter: before.level,
      leveledUp: false,
      newBadges: []
    };
  }

  const xpGained = computeXp(storedResult);
  storageSet(XP_KEY, readXp() + xpGained);
  const after = getLevel();

  const unlocked = readUnlocked();
  const ctx = buildContext(storedResult);
  const now = Date.now();
  const newBadges = [];

  for (const badge of BADGES) {
    if (unlocked[badge.id]) continue;
    const rule = RULES[badge.id];
    let hit = false;
    try {
      hit = Boolean(rule && rule.check(ctx));
    } catch (err) {
      hit = false;
    }
    if (hit) {
      unlocked[badge.id] = now;
      newBadges.push({ ...badge, unlockedAt: now });
    }
  }
  if (newBadges.length) storageSet(BADGES_KEY, unlocked);

  return {
    xpGained,
    levelBefore: before.level,
    levelAfter: after.level,
    leveledUp: after.level > before.level,
    newBadges
  };
}

/**
 * Badges the user has unlocked, oldest first.
 * @returns {Array<Object>} [{ ...badge, unlockedAt }]
 */
export function getUnlockedBadges() {
  const unlocked = readUnlocked();
  return BADGES.filter((b) => unlocked[b.id])
    .map((b) => ({ ...b, unlockedAt: num(unlocked[b.id]) }))
    .sort((a, b) => a.unlockedAt - b.unlockedAt);
}

/**
 * Every badge with unlock status and, where countable, progress.
 * @returns {Array<Object>} [{ ...badge, unlocked, unlockedAt?, progress?: {current, target} }]
 */
export function getAllBadgesWithStatus() {
  const unlocked = readUnlocked();
  const ctx = buildContext(null);
  return BADGES.map((badge) => {
    const out = { ...badge, unlocked: Boolean(unlocked[badge.id]) };
    if (out.unlocked) out.unlockedAt = num(unlocked[badge.id]);
    const rule = RULES[badge.id];
    if (rule && typeof rule.progress === 'function') {
      try {
        const p = rule.progress(ctx);
        if (p && Number.isFinite(p.target) && p.target > 0) {
          const current = out.unlocked ? p.target : Math.min(p.target, Math.max(0, num(p.current)));
          out.progress = { current, target: p.target };
        }
      } catch (err) {
        /* progress is optional; ignore */
      }
    }
    return out;
  });
}
