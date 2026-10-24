/**
 * TypeTalk — UI helpers: DOM builder, toasts, modal, confetti, formatters, icons.
 * Vanilla ES module, no dependencies.
 */

/* --------------------------------------------------------------------------
   DOM helper
   -------------------------------------------------------------------------- */

/**
 * Append children (strings, nodes, arrays, null/false ignored) to a parent.
 * @param {HTMLElement|DocumentFragment} parent
 * @param {*} child
 */
function appendChild(parent, child) {
  if (child === null || child === undefined || child === false || child === true) return;
  if (Array.isArray(child)) {
    child.forEach((c) => appendChild(parent, c));
    return;
  }
  if (child instanceof Node) {
    parent.appendChild(child);
    return;
  }
  parent.appendChild(document.createTextNode(String(child)));
}

/**
 * Create a DOM element.
 * attrs supports: class/className, dataset (object), style (object or string),
 * on<Event> handlers (onClick, onInput...), html (innerHTML), boolean attributes,
 * and any other attribute via setAttribute. Children may be strings, nodes,
 * arrays, null or false.
 * @param {string} tag
 * @param {Object} [attrs]
 * @param {...*} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
    for (const key of Object.keys(attrs)) {
      const value = attrs[key];
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class' || key === 'className') {
        el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
      } else if (key === 'dataset' && typeof value === 'object') {
        for (const dk of Object.keys(value)) {
          if (value[dk] !== undefined && value[dk] !== null) el.dataset[dk] = String(value[dk]);
        }
      } else if (key === 'style') {
        if (typeof value === 'string') {
          el.style.cssText = value;
        } else if (typeof value === 'object') {
          for (const sk of Object.keys(value)) {
            if (sk.startsWith('--')) el.style.setProperty(sk, value[sk]);
            else el.style[sk] = value[sk];
          }
        }
      } else if (key === 'html') {
        el.innerHTML = String(value);
      } else if (key.length > 2 && key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'value' && ('value' in el)) {
        el.value = value;
      } else if (key === 'checked' || key === 'disabled' || key === 'selected' || key === 'readonly' || key === 'multiple' || key === 'autofocus' || key === 'hidden') {
        if (value === true) {
          el.setAttribute(key, '');
          if (key in el) el[key] = true;
        }
      } else if (key === 'ref' && typeof value === 'function') {
        value(el);
      } else {
        el.setAttribute(key, value === true ? '' : String(value));
      }
    }
  } else if (attrs) {
    // attrs omitted and a child was passed in its place
    appendChild(el, attrs);
  }
  children.forEach((c) => appendChild(el, c));
  return el;
}

/* --------------------------------------------------------------------------
   Motion
   -------------------------------------------------------------------------- */

/**
 * True when motion should be reduced (OS setting or app setting).
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

/* --------------------------------------------------------------------------
   Toast
   -------------------------------------------------------------------------- */

const TOAST_ICONS = {
  info: 'info',
  success: 'check',
  error: 'x',
  warning: 'alert-triangle'
};

/**
 * Show a transient toast notification in #toast-root.
 * @param {string} message
 * @param {{type?: 'info'|'success'|'error'|'warning', icon?: string, duration?: number}} [opts]
 * @returns {() => void} dismiss function
 */
export function toast(message, { type = 'info', icon: iconName = '', duration = 3000 } = {}) {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = h('div', { id: 'toast-root', class: 'toast-root' });
    document.body.appendChild(root);
  }
  const safeType = ['info', 'success', 'error', 'warning'].includes(type) ? type : 'info';
  let iconEl;
  if (iconName && ICONS[iconName]) {
    iconEl = h('span', { class: 'toast-icon', html: icon(iconName) });
  } else if (iconName) {
    iconEl = h('span', { class: 'toast-icon' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, iconName));
  } else {
    iconEl = h('span', { class: 'toast-icon', html: icon(TOAST_ICONS[safeType]) });
  }
  const el = h('div', { class: `toast toast-${safeType}`, role: safeType === 'error' ? 'alert' : 'status' },
    iconEl,
    h('div', { class: 'toast-message' }, message)
  );
  root.appendChild(el);

  // Limit stacked toasts
  while (root.children.length > 4) root.removeChild(root.firstChild);

  let done = false;
  const remove = () => {
    if (done) return;
    done = true;
    if (reducedMotion()) {
      el.remove();
      return;
    }
    el.classList.add('toast-out');
    const t = setTimeout(() => el.remove(), 220);
    el.addEventListener('animationend', () => { clearTimeout(t); el.remove(); }, { once: true });
  };
  const timer = setTimeout(remove, Math.max(800, duration));
  el.addEventListener('click', () => { clearTimeout(timer); remove(); });
  return () => { clearTimeout(timer); remove(); };
}

/* --------------------------------------------------------------------------
   Modal
   -------------------------------------------------------------------------- */

let activeModal = null;

/**
 * Open a modal dialog in #modal-root. Only one modal at a time (replaces current).
 * @param {{title?: string, content?: HTMLElement|string, actions?: Array<{label: string, onClick?: Function, variant?: 'primary'|'ghost'|'danger'|'outline'}>, onClose?: Function}} opts
 * @returns {() => void} close function
 */
export function openModal({ title = '', content = '', actions = [], onClose } = {}) {
  closeModal();
  let root = document.getElementById('modal-root');
  if (!root) {
    root = h('div', { id: 'modal-root', class: 'modal-root' });
    document.body.appendChild(root);
  }
  const titleId = `modal-title-${Date.now().toString(36)}`;
  const previouslyFocused = document.activeElement;

  const body = h('div', { class: 'modal-body' });
  if (content instanceof Node) body.appendChild(content);
  else if (typeof content === 'string') body.innerHTML = content;

  const state = { closed: false };
  const close = () => {
    if (state.closed) return;
    state.closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    if (activeModal === state) activeModal = null;
    document.body.style.overflow = '';
    if (typeof onClose === 'function') {
      try { onClose(); } catch (e) { console.warn(e); }
    }
    if (previouslyFocused && typeof previouslyFocused.focus === 'function' && document.contains(previouslyFocused)) {
      previouslyFocused.focus();
    }
  };
  state.close = close;

  const actionBtns = actions.map((a) => {
    const variant = a.variant === 'primary' ? 'btn-primary'
      : a.variant === 'danger' ? 'btn-danger'
      : a.variant === 'outline' ? 'btn-outline'
      : 'btn-ghost';
    return h('button', {
      type: 'button',
      class: `btn ${variant}`,
      onClick: () => {
        let result;
        if (typeof a.onClick === 'function') {
          try { result = a.onClick(close); } catch (e) { console.warn(e); }
        }
        if (result !== false && a.keepOpen !== true) close();
      }
    }, a.label);
  });

  const closeBtn = h('button', {
    type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Close dialog', onClick: close, html: icon('x')
  });

  const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': title ? titleId : null },
    h('div', { class: 'modal-header' },
      title ? h('h2', { id: titleId }, title) : h('span'),
      closeBtn
    ),
    body,
    actionBtns.length ? h('div', { class: 'modal-actions' }, actionBtns) : null
  );
  const backdrop = h('div', { class: 'modal-backdrop', onClick: (e) => { if (e.target === backdrop) close(); } }, modal);

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      // basic focus trap
      const focusables = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  document.addEventListener('keydown', onKey);
  root.appendChild(backdrop);
  document.body.style.overflow = 'hidden';
  activeModal = state;

  // Focus the primary action, else the first focusable
  const primary = modal.querySelector('.btn-primary, .btn-danger') || actionBtns[0] || closeBtn;
  requestAnimationFrame(() => { try { primary.focus(); } catch (e) { /* ignore */ } });

  return close;
}

/**
 * Close the currently open modal, if any.
 */
export function closeModal() {
  if (activeModal && typeof activeModal.close === 'function') activeModal.close();
  activeModal = null;
}

/* --------------------------------------------------------------------------
   Confetti
   -------------------------------------------------------------------------- */

const CONFETTI_COLORS = ['#3b6cf6', '#14b8a6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

/**
 * Burst of confetti over the whole screen. No-op when reduced motion is preferred.
 * @param {{duration?: number, count?: number}} [opts]
 */
export function confetti({ duration = 1800, count = 120 } = {}) {
  if (reducedMotion()) return;
  if (typeof document === 'undefined' || !document.body) return;

  const canvas = h('canvas', { class: 'confetti-canvas', 'aria-hidden': 'true' });
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  document.body.appendChild(canvas);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0;
  let H = 0;
  const resize = () => {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  const pieces = [];
  for (let i = 0; i < count; i++) {
    const fromLeft = i % 2 === 0;
    pieces.push({
      x: fromLeft ? W * 0.2 + Math.random() * W * 0.15 : W * 0.65 + Math.random() * W * 0.15,
      y: H * 0.55 + Math.random() * 40,
      vx: (fromLeft ? 1 : -1) * (2 + Math.random() * 5) + (Math.random() - 0.5) * 3,
      vy: -(9 + Math.random() * 7),
      w: 6 + Math.random() * 6,
      h: 4 + Math.random() * 6,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.3,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      shape: Math.random() < 0.3 ? 'circle' : 'rect',
      wobble: Math.random() * Math.PI * 2
    });
  }

  const start = performance.now();
  const total = Math.max(600, duration);
  let raf = 0;
  const gravity = 0.28;

  const cleanup = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    canvas.remove();
  };

  const frame = (now) => {
    const t = now - start;
    const fade = t > total * 0.7 ? 1 - (t - total * 0.7) / (total * 0.3) : 1;
    ctx.clearRect(0, 0, W, H);
    let alive = 0;
    for (const p of pieces) {
      p.vy += gravity;
      p.vx *= 0.99;
      p.wobble += 0.1;
      p.x += p.vx + Math.sin(p.wobble) * 0.6;
      p.y += p.vy;
      p.rot += p.vr;
      if (p.y < H + 30) alive++;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, fade));
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
    if (t < total && alive > 0) {
      raf = requestAnimationFrame(frame);
    } else {
      cleanup();
    }
  };
  raf = requestAnimationFrame(frame);
}

/* --------------------------------------------------------------------------
   Formatters
   -------------------------------------------------------------------------- */

/**
 * Format seconds as m:ss (65 -> '1:05'). Hours shown when >= 3600.
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (hrs > 0) return `${hrs}:${pad(mins)}:${pad(secs)}`;
  return `${mins}:${pad(secs)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format a timestamp as 'Oct 24' (adds the year when not the current year).
 * @param {number|Date|string} ts
 * @returns {string}
 */
export function formatDate(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

/* --------------------------------------------------------------------------
   Icons (Lucide-style, 24px, stroke 2, currentColor)
   -------------------------------------------------------------------------- */

const ICONS = {
  keyboard: '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
  headphones: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
  'mic-off': '<line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  'volume-off': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  stop: '<rect width="14" height="14" x="5" y="5" rx="2"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>',
  'skip-forward': '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>',
  menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
  // extras used by the shell
  'alert-triangle': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  'message-square': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  sliders: '<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  'book-open': '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>'
};

/**
 * Inline SVG string for a named Lucide-style icon (24px, stroke 2, currentColor).
 * Unknown names return an empty-circle fallback.
 * @param {string} name
 * @returns {string}
 */
export function icon(name) {
  const body = ICONS[name] || '<circle cx="12" cy="12" r="9"/>';
  return `<svg class="icon icon-${String(name).replace(/[^a-z0-9-]/gi, '')}" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/**
 * Names of all available icons.
 * @returns {string[]}
 */
export function iconNames() {
  return Object.keys(ICONS);
}

/* --------------------------------------------------------------------------
   Scoring helper
   -------------------------------------------------------------------------- */

/**
 * Star rating (0..3) for a result.
 * 3 if accuracy >= 97 and (wpm >= 40 or speech mode); 2 if accuracy >= 90; 1 if >= 70; else 0.
 * @param {{accuracy: number, wpm: number, mode: string}} result
 * @returns {number}
 */
export function starsFor(result) {
  if (!result) return 0;
  const acc = Number(result.accuracy) || 0;
  const wpm = Number(result.wpm) || 0;
  const isSpeech = result.mode === 'speaking' || result.mode === 'shadowing';
  if (acc >= 97 && (wpm >= 40 || isSpeech)) return 3;
  if (acc >= 90) return 2;
  if (acc >= 70) return 1;
  return 0;
}
