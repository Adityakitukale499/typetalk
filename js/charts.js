/**
 * TypeTalk - charts.js
 * Pure SVG charts (no libraries). Every chart is responsive through a viewBox with
 * width:100% and preserveAspectRatio, and all colours reference CSS custom properties so
 * light / dark themes work automatically.
 *
 * Exports: renderLineChart, renderBarChart, renderCalendarHeatmap, renderRing, renderSparkline
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const EMPTY_MESSAGE = 'Not enough data yet';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
let uid = 0;

/* ------------------------------------------------------------------ helpers */

/**
 * Create an SVG element with attributes. Keys `style` (object) and `title` (string, becomes a
 * <title> child used as a tooltip) are handled specially.
 * @param {string} tag
 * @param {Object} [attrs]
 * @param {...(Node|string)} children
 * @returns {SVGElement}
 */
function svgEl(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key === 'title') {
      const t = document.createElementNS(SVG_NS, 'title');
      t.textContent = String(value);
      el.appendChild(t);
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

/**
 * Create a responsive root <svg>.
 * @param {number} width viewBox width
 * @param {number} height viewBox height
 * @param {string} [label] accessible label
 * @returns {SVGSVGElement}
 */
function svgRoot(width, height, label = '') {
  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': label || null,
    class: 'chart-svg',
    style: { display: 'block', width: '100%', height: 'auto', overflow: 'visible' }
  });
  return svg;
}

/**
 * Clear a container and append the empty-state message.
 * @param {HTMLElement} container
 * @param {string} [message]
 */
function showEmpty(container, message = EMPTY_MESSAGE) {
  const div = document.createElement('div');
  div.className = 'chart-empty';
  div.textContent = message;
  Object.assign(div.style, {
    color: 'var(--text-muted)',
    textAlign: 'center',
    padding: '28px 12px',
    fontSize: '14px'
  });
  container.appendChild(div);
}

/**
 * Whether animations should be skipped.
 * @returns {boolean}
 */
function reduceMotion() {
  try {
    if (document.documentElement.dataset.reduceMotion === 'true') return true;
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
}

/**
 * Compute a "nice" y-axis scale starting at 0.
 * @param {number} maxVal
 * @param {number} [tickCount]
 * @returns {{ max: number, step: number, ticks: number[] }}
 */
function niceScale(maxVal, tickCount = 4) {
  let target = Number.isFinite(maxVal) && maxVal > 0 ? maxVal : 1;
  const rough = target / tickCount;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  let step;
  if (norm <= 1) step = 1;
  else if (norm <= 2) step = 2;
  else if (norm <= 2.5) step = 2.5;
  else if (norm <= 5) step = 5;
  else step = 10;
  step *= mag;
  const max = Math.max(step, Math.ceil(target / step) * step);
  const ticks = [];
  for (let v = 0; v <= max + step / 1000; v += step) ticks.push(+v.toFixed(6));
  return { max, step, ticks };
}

/**
 * Format a tick value for display.
 * @param {number} v
 * @param {number} step
 * @returns {string}
 */
function fmtTick(v, step) {
  if (step >= 1) return String(Math.round(v));
  return v.toFixed(1);
}

/**
 * Format a number for a value label / tooltip.
 * @param {number} v
 * @returns {string}
 */
function fmtValue(v) {
  if (!Number.isFinite(v)) return '-';
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}

/**
 * Build a smooth monotone-cubic SVG path through the points (no overshoot).
 * @param {{x:number,y:number}[]} pts screen-space points
 * @returns {string}
 */
function monotonePath(pts) {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0].x} ${pts[0].y}`;
  if (n === 2) return `M${pts[0].x} ${pts[0].y} L${pts[1].x} ${pts[1].y}`;

  const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);
  const slope3 = (p0, p1, p2) => {
    const h0 = p1.x - p0.x;
    const h1 = p2.x - p1.x;
    const s0 = h0 ? (p1.y - p0.y) / h0 : 0;
    const s1 = h1 ? (p2.y - p1.y) / h1 : 0;
    const p = (s0 * h1 + s1 * h0) / (h0 + h1 || 1);
    return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  };
  const slope2 = (p0, p1, t) => {
    const hh = p1.x - p0.x;
    return hh ? (3 * (p1.y - p0.y) / hh - t) / 2 : t;
  };

  const t = new Array(n);
  for (let i = 1; i < n - 1; i++) t[i] = slope3(pts[i - 1], pts[i], pts[i + 1]);
  t[0] = slope2(pts[0], pts[1], t[1]);
  t[n - 1] = slope2(pts[n - 2], pts[n - 1], t[n - 2]);

  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const dx = (p1.x - p0.x) / 3;
    const c1x = p0.x + dx;
    const c1y = p0.y + t[i] * dx;
    const c2x = p1.x - dx;
    const c2y = p1.y - t[i + 1] * dx;
    d += ` C${r(c1x)} ${r(c1y)} ${r(c2x)} ${r(c2y)} ${r(p1.x)} ${r(p1.y)}`;
  }
  return d;
}

/**
 * Round to 2 decimals for compact path strings.
 * @param {number} v
 * @returns {number}
 */
function r(v) {
  return Math.round(v * 100) / 100;
}

/**
 * Pick at most `max` evenly spaced indices from 0..count-1 (always includes first & last).
 * @param {number} count
 * @param {number} max
 * @returns {Set<number>}
 */
function sparseIndices(count, max = 6) {
  const set = new Set();
  if (count <= 0) return set;
  if (count <= max) {
    for (let i = 0; i < count; i++) set.add(i);
    return set;
  }
  const stepN = (count - 1) / (max - 1);
  for (let i = 0; i < max; i++) set.add(Math.round(i * stepN));
  return set;
}

/**
 * Local date key YYYY-MM-DD.
 * @param {Date} d
 * @returns {string}
 */
function dateKey(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/* --------------------------------------------------------------- line chart */

/**
 * Render a responsive line chart with smooth lines, gradient area fills, grid and dots.
 * @param {HTMLElement} container
 * @param {{ series: {name:string, color?:string, points:{x:number,y:number}[]}[], yLabel?: string, height?: number, showDots?: boolean, xLabels?: string[] }} opts
 */
export function renderLineChart(container, { series = [], yLabel = '', height = 220, showDots = true, xLabels = [] } = {}) {
  container.innerHTML = '';
  const valid = (series || []).filter((s) => s && Array.isArray(s.points) && s.points.length > 0);
  if (valid.length === 0) {
    showEmpty(container);
    return;
  }

  const W = 600;
  const H = Math.max(120, height);
  const hasLegend = valid.length > 1;
  const pad = { top: hasLegend ? 30 : 14, right: 16, bottom: 30, left: 44 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  // x domain across all series
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMaxData = 0;
  for (const s of valid) {
    for (const p of s.points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      xMin = Math.min(xMin, p.x);
      xMax = Math.max(xMax, p.x);
      yMaxData = Math.max(yMaxData, p.y);
    }
  }
  if (!Number.isFinite(xMin)) {
    showEmpty(container);
    return;
  }
  const xSpan = xMax - xMin;
  const scale = niceScale(yMaxData, 4);
  const sx = (x) => (xSpan === 0 ? pad.left + plotW / 2 : pad.left + ((x - xMin) / xSpan) * plotW);
  const sy = (y) => pad.top + plotH - (y / scale.max) * plotH;

  const svg = svgRoot(W, H, yLabel ? `${yLabel} chart` : 'Line chart');
  const defs = svgEl('defs');
  svg.appendChild(defs);

  // grid + y labels
  const grid = svgEl('g', { class: 'chart-grid' });
  for (const tick of scale.ticks) {
    const y = r(sy(tick));
    grid.appendChild(svgEl('line', {
      x1: pad.left, x2: W - pad.right, y1: y, y2: y,
      style: { stroke: 'var(--border)', strokeWidth: 1 },
      'stroke-dasharray': tick === 0 ? null : '3 4'
    }));
    grid.appendChild(svgEl('text', {
      x: pad.left - 8, y: y + 4, 'text-anchor': 'end',
      style: { fill: 'var(--text-muted)', fontSize: '11px', fontFamily: 'var(--font)' }
    }, fmtTick(tick, scale.step)));
  }
  svg.appendChild(grid);

  // y axis label (rotated)
  if (yLabel) {
    svg.appendChild(svgEl('text', {
      x: 12, y: pad.top + plotH / 2,
      transform: `rotate(-90 12 ${pad.top + plotH / 2})`,
      'text-anchor': 'middle',
      style: { fill: 'var(--text-muted)', fontSize: '11px', fontFamily: 'var(--font)' }
    }, yLabel));
  }

  // x labels (sparse), taken from the longest series
  const longest = valid.reduce((a, b) => (a.points.length >= b.points.length ? a : b));
  if (Array.isArray(xLabels) && xLabels.length > 0) {
    const n = Math.min(xLabels.length, longest.points.length);
    const idxs = sparseIndices(n, 6);
    const xg = svgEl('g', { class: 'chart-xlabels' });
    for (const i of idxs) {
      const p = longest.points[i];
      if (!p || !xLabels[i]) continue;
      let anchor = 'middle';
      if (n > 1 && i === 0) anchor = 'start';
      if (n > 1 && i === n - 1) anchor = 'end';
      xg.appendChild(svgEl('text', {
        x: r(sx(p.x)), y: H - 8, 'text-anchor': anchor,
        style: { fill: 'var(--text-muted)', fontSize: '11px', fontFamily: 'var(--font)' }
      }, String(xLabels[i])));
    }
    svg.appendChild(xg);
  }

  // series
  const animate = !reduceMotion();
  valid.forEach((s, si) => {
    const color = s.color || 'var(--primary)';
    const pts = s.points
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p) => ({ x: r(sx(p.x)), y: r(sy(Math.max(0, p.y))), raw: p }));
    if (pts.length === 0) return;

    const gradId = `tt-grad-${++uid}`;
    const grad = svgEl('linearGradient', { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 },
      svgEl('stop', { offset: '0%', style: { stopColor: color, stopOpacity: 0.12 } }),
      svgEl('stop', { offset: '100%', style: { stopColor: color, stopOpacity: 0 } })
    );
    defs.appendChild(grad);

    const lineD = monotonePath(pts);
    const g = svgEl('g', { class: 'chart-series', 'data-series': s.name || `s${si}` });

    if (pts.length > 1) {
      const baseY = r(sy(0));
      const areaD = `${lineD} L${pts[pts.length - 1].x} ${baseY} L${pts[0].x} ${baseY} Z`;
      g.appendChild(svgEl('path', { d: areaD, fill: `url(#${gradId})`, stroke: 'none' }));
      const line = svgEl('path', {
        d: lineD, fill: 'none',
        style: { stroke: color, strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' }
      });
      if (animate) {
        line.style.transition = 'opacity 400ms ease';
        line.style.opacity = '0';
        requestAnimationFrame(() => { line.style.opacity = '1'; });
      }
      g.appendChild(line);
    }

    if (showDots || pts.length === 1) {
      const dense = pts.length > 40;
      pts.forEach((p, i) => {
        const label = xLabels && xLabels[i] ? ` (${xLabels[i]})` : '';
        g.appendChild(svgEl('circle', {
          cx: p.x, cy: p.y, r: dense ? 2 : 3.5,
          style: { fill: 'var(--surface)', stroke: color, strokeWidth: 2 },
          title: `${s.name || 'Value'}: ${fmtValue(p.raw.y)}${label}`
        }));
      });
    }
    svg.appendChild(g);
  });

  // legend
  if (hasLegend) {
    const lg = svgEl('g', { class: 'chart-legend' });
    let x = pad.left;
    valid.forEach((s) => {
      const color = s.color || 'var(--primary)';
      lg.appendChild(svgEl('rect', { x, y: 6, width: 12, height: 4, rx: 2, style: { fill: color } }));
      const txt = svgEl('text', {
        x: x + 18, y: 11,
        style: { fill: 'var(--text-muted)', fontSize: '11px', fontFamily: 'var(--font)' }
      }, s.name || '');
      lg.appendChild(txt);
      x += 18 + (s.name || '').length * 6.5 + 16;
    });
    svg.appendChild(lg);
  }

  container.appendChild(svg);
}

/* ---------------------------------------------------------------- bar chart */

/**
 * Render a bar chart with rounded bars and value labels.
 * @param {HTMLElement} container
 * @param {{ labels: string[], values: number[], color?: string, height?: number }} opts
 */
export function renderBarChart(container, { labels = [], values = [], color = 'var(--primary)', height = 200 } = {}) {
  container.innerHTML = '';
  const vals = (values || []).map((v) => (Number.isFinite(v) ? v : 0));
  if (vals.length === 0) {
    showEmpty(container);
    return;
  }

  const W = 600;
  const H = Math.max(120, height);
  const pad = { top: 22, right: 12, bottom: 30, left: 40 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const scale = niceScale(Math.max(...vals), 4);
  const sy = (y) => pad.top + plotH - (y / scale.max) * plotH;

  const svg = svgRoot(W, H, 'Bar chart');

  for (const tick of scale.ticks) {
    const y = r(sy(tick));
    svg.appendChild(svgEl('line', {
      x1: pad.left, x2: W - pad.right, y1: y, y2: y,
      style: { stroke: 'var(--border)', strokeWidth: 1 },
      'stroke-dasharray': tick === 0 ? null : '3 4'
    }));
    svg.appendChild(svgEl('text', {
      x: pad.left - 8, y: y + 4, 'text-anchor': 'end',
      style: { fill: 'var(--text-muted)', fontSize: '11px', fontFamily: 'var(--font)' }
    }, fmtTick(tick, scale.step)));
  }

  const n = vals.length;
  const slot = plotW / n;
  const barW = Math.max(6, Math.min(44, slot * 0.6));
  const animate = !reduceMotion();
  const labelIdx = sparseIndices(n, n <= 12 ? n : 8);

  vals.forEach((v, i) => {
    const x = r(pad.left + slot * i + (slot - barW) / 2);
    const yTop = r(sy(v));
    const base = r(sy(0));
    const h = Math.max(0, base - yTop);
    const rect = svgEl('rect', {
      x, y: animate ? base : yTop, width: r(barW), height: animate ? 0 : r(h),
      rx: Math.min(6, barW / 2),
      style: { fill: color, opacity: 0.9 },
      title: `${labels[i] !== undefined ? labels[i] + ': ' : ''}${fmtValue(v)}`
    });
    if (animate) {
      rect.style.transition = 'y 450ms ease, height 450ms ease';
      requestAnimationFrame(() => {
        rect.setAttribute('y', String(yTop));
        rect.setAttribute('height', String(r(h)));
      });
    }
    svg.appendChild(rect);
    svg.appendChild(svgEl('text', {
      x: r(x + barW / 2), y: yTop - 6, 'text-anchor': 'middle',
      style: { fill: 'var(--text)', fontSize: '11px', fontWeight: 600, fontFamily: 'var(--font)' }
    }, fmtValue(v)));
    if (labelIdx.has(i) && labels[i] !== undefined) {
      svg.appendChild(svgEl('text', {
        x: r(x + barW / 2), y: H - 8, 'text-anchor': 'middle',
        style: { fill: 'var(--text-muted)', fontSize: '11px', fontFamily: 'var(--font)' }
      }, String(labels[i])));
    }
  });

  container.appendChild(svg);
}

/* --------------------------------------------------------- calendar heatmap */

/**
 * Render a GitHub-style calendar heatmap (weeks x 7). Intensity is relative to the daily goal.
 * @param {HTMLElement} container
 * @param {{ counts: Object<string, number>, weeks?: number, goal?: number }} opts
 */
export function renderCalendarHeatmap(container, { counts = {}, weeks = 20, goal = 5 } = {}) {
  container.innerHTML = '';
  const data = counts || {};
  const total = Object.values(data).reduce((a, b) => a + (Number(b) || 0), 0);
  const cols = Math.max(4, Math.min(53, Math.round(weeks) || 20));
  const safeGoal = Math.max(1, Number(goal) || 5);

  const CELL = 12;
  const GAP = 3;
  const LEFT = 22;
  const TOP = 18;
  const W = LEFT + cols * (CELL + GAP);
  const H = TOP + 7 * (CELL + GAP);

  // start on the Sunday of the week (cols - 1) weeks before this week
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay() - (cols - 1) * 7);

  const svg = svgRoot(W, H, 'Activity calendar');
  svg.style.maxWidth = `${W * 1.4}px`;

  // weekday letters
  WEEKDAY_LETTERS.forEach((letter, d) => {
    svg.appendChild(svgEl('text', {
      x: 0, y: TOP + d * (CELL + GAP) + CELL - 2,
      style: { fill: 'var(--text-muted)', fontSize: '9px', fontFamily: 'var(--font)' }
    }, letter));
  });

  const opacities = [1, 0.3, 0.55, 0.78, 1];
  let lastMonth = -1;
  let lastLabelCol = -10;
  const cursor = new Date(start);
  for (let w = 0; w < cols; w++) {
    for (let d = 0; d < 7; d++) {
      const x = LEFT + w * (CELL + GAP);
      const y = TOP + d * (CELL + GAP);
      const inFuture = cursor > today;
      const key = dateKey(cursor);
      const n = Number(data[key]) || 0;

      // month label on the first row when a new month begins within this column
      if (d === 0 || cursor.getDate() === 1) {
        const m = cursor.getMonth();
        if (m !== lastMonth && !inFuture) {
          // only label when there is room (at least 3 columns since the previous label)
          if (w - lastLabelCol >= 3) {
            svg.appendChild(svgEl('text', {
              x, y: 11,
              style: { fill: 'var(--text-muted)', fontSize: '10px', fontFamily: 'var(--font)' }
            }, MONTHS[m]));
            lastLabelCol = w;
          }
          lastMonth = m;
        }
      }

      let level = 0;
      if (n > 0) level = Math.min(4, Math.max(1, Math.ceil((n / safeGoal) * 4)));
      const dateLabel = `${MONTHS[cursor.getMonth()]} ${cursor.getDate()}`;
      const rect = svgEl('rect', {
        x, y, width: CELL, height: CELL, rx: 3,
        'data-date': key,
        'data-level': level,
        style: {
          fill: level === 0 ? 'var(--surface-2)' : 'var(--primary)',
          opacity: inFuture ? 0.35 : opacities[level],
          stroke: key === dateKey(today) ? 'var(--primary)' : 'none',
          strokeWidth: 1
        },
        title: inFuture ? dateLabel : `${dateLabel}: ${n} ${n === 1 ? 'test' : 'tests'}`
      });
      svg.appendChild(rect);
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  const wrap = document.createElement('div');
  wrap.className = 'heatmap-wrap';
  wrap.style.overflowX = 'auto';
  wrap.appendChild(svg);
  container.appendChild(wrap);

  // legend
  const legend = document.createElement('div');
  legend.className = 'heatmap-legend';
  Object.assign(legend.style, {
    display: 'flex', alignItems: 'center', gap: '4px', marginTop: '8px',
    fontSize: '11px', color: 'var(--text-muted)', justifyContent: 'flex-end'
  });
  const less = document.createElement('span');
  less.textContent = 'Less';
  less.style.marginRight = '4px';
  legend.appendChild(less);
  for (let i = 0; i <= 4; i++) {
    const sw = document.createElement('span');
    sw.className = 'heatmap-swatch';
    Object.assign(sw.style, {
      display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px',
      background: i === 0 ? 'var(--surface-2)' : 'var(--primary)',
      opacity: String(opacities[i])
    });
    legend.appendChild(sw);
  }
  const more = document.createElement('span');
  more.textContent = 'More';
  more.style.marginLeft = '4px';
  legend.appendChild(more);
  container.appendChild(legend);

  if (total === 0) {
    showEmpty(container, 'No activity yet - complete a test to light up the calendar');
  }
}

/* --------------------------------------------------------------------- ring */

/**
 * Render a circular progress ring with centred text.
 * @param {HTMLElement} container
 * @param {{ value: number, max: number, label?: string, sublabel?: string, color?: string, size?: number, valueText?: string }} opts
 *   `valueText` optionally overrides the big centred text (defaults to `value`).
 */
export function renderRing(container, { value = 0, max = 1, label = '', sublabel = '', color = 'var(--primary)', size = 120, valueText } = {}) {
  container.innerHTML = '';
  if (!Number.isFinite(value) || !Number.isFinite(max)) {
    showEmpty(container);
    return;
  }
  const S = Math.max(48, size);
  const strokeW = Math.max(6, Math.round(S * 0.085));
  const radius = (S - strokeW) / 2 - 1;
  const c = S / 2;
  const circ = 2 * Math.PI * radius;
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const target = circ * (1 - ratio);

  const svg = svgRoot(S, S, label ? `${label}: ${fmtValue(value)} of ${fmtValue(max)}` : 'Progress ring');
  svg.classList.add('ring-svg');
  svg.style.maxWidth = `${S}px`;
  svg.style.margin = '0 auto';

  svg.appendChild(svgEl('circle', {
    cx: c, cy: c, r: radius, fill: 'none',
    style: { stroke: 'var(--surface-2)', strokeWidth: strokeW }
  }));
  const prog = svgEl('circle', {
    cx: c, cy: c, r: radius, fill: 'none',
    transform: `rotate(-90 ${c} ${c})`,
    'stroke-dasharray': r(circ),
    'stroke-dashoffset': r(reduceMotion() ? target : circ),
    style: { stroke: color, strokeWidth: strokeW, strokeLinecap: 'round' },
    title: `${fmtValue(value)} / ${fmtValue(max)}`
  });
  if (!reduceMotion()) {
    prog.style.transition = 'stroke-dashoffset 700ms cubic-bezier(.4,0,.2,1)';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => prog.setAttribute('stroke-dashoffset', String(r(target))));
    });
  }
  svg.appendChild(prog);

  const hasLabel = Boolean(label);
  const hasSub = Boolean(sublabel);
  const bigSize = Math.round(S * (hasLabel ? 0.24 : 0.28));
  const bigY = c + (hasLabel ? -S * 0.02 : bigSize * 0.35);
  svg.appendChild(svgEl('text', {
    x: c, y: r(bigY), 'text-anchor': 'middle', class: 'ring-value',
    style: { fill: 'var(--text)', fontSize: `${bigSize}px`, fontWeight: 700, fontFamily: 'var(--font)' }
  }, valueText !== undefined ? String(valueText) : fmtValue(value)));
  if (hasLabel) {
    svg.appendChild(svgEl('text', {
      x: c, y: r(c + S * 0.13), 'text-anchor': 'middle', class: 'ring-label',
      style: { fill: 'var(--text-muted)', fontSize: `${Math.round(S * 0.1)}px`, fontFamily: 'var(--font)' }
    }, label));
  }
  if (hasSub) {
    svg.appendChild(svgEl('text', {
      x: c, y: r(c + S * (hasLabel ? 0.24 : 0.18)), 'text-anchor': 'middle', class: 'ring-sublabel',
      style: { fill: 'var(--text-muted)', fontSize: `${Math.round(S * 0.085)}px`, fontFamily: 'var(--font)' }
    }, sublabel));
  }
  container.appendChild(svg);
}

/* ---------------------------------------------------------------- sparkline */

/**
 * Render a minimal sparkline (smooth line + soft area, no axes).
 * @param {HTMLElement} container
 * @param {{ values: number[], color?: string, height?: number }} opts
 */
export function renderSparkline(container, { values = [], color = 'var(--primary)', height = 48 } = {}) {
  container.innerHTML = '';
  const vals = (values || []).filter((v) => Number.isFinite(v));
  if (vals.length === 0) {
    showEmpty(container);
    return;
  }
  // viewBox width follows the container so strokes/dots keep their shape
  const W = Math.max(100, Math.round(container.clientWidth) || 200);
  const H = Math.max(24, height);
  const padY = 4;
  const padX = 3;
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const span = max - min || 1;
  const pts = vals.map((v, i) => ({
    x: r(vals.length === 1 ? W / 2 : padX + (i / (vals.length - 1)) * (W - padX * 2)),
    y: r(padY + (1 - (v - min) / span) * (H - padY * 2))
  }));
  const svg = svgRoot(W, H, 'Sparkline');
  svg.style.height = `${H}px`;
  const gradId = `tt-spark-${++uid}`;
  svg.appendChild(svgEl('defs', {},
    svgEl('linearGradient', { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 },
      svgEl('stop', { offset: '0%', style: { stopColor: color, stopOpacity: 0.18 } }),
      svgEl('stop', { offset: '100%', style: { stopColor: color, stopOpacity: 0 } })
    )
  ));
  const d = monotonePath(pts);
  if (pts.length > 1) {
    svg.appendChild(svgEl('path', {
      d: `${d} L${pts[pts.length - 1].x} ${H} L${pts[0].x} ${H} Z`,
      fill: `url(#${gradId})`, stroke: 'none'
    }));
  }
  svg.appendChild(svgEl('path', {
    d, fill: 'none', 'vector-effect': 'non-scaling-stroke',
    style: { stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
  }));
  const last = pts[pts.length - 1];
  svg.appendChild(svgEl('circle', {
    cx: last.x, cy: last.y, r: 3,
    style: { fill: color },
    title: fmtValue(vals[vals.length - 1])
  }));
  container.appendChild(svg);
}
