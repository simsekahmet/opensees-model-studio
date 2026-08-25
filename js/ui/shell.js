/**
 * ui/shell.js — chrome that is not tied to the model: colour theme, the
 * viewport tab strip, and toast notifications.
 */

const THEME_KEY = 'osms.theme';

/* ─────────────────────────────── theme ──────────────────────────────── */

export function initTheme(button, onChange) {
  const saved = localStorage.getItem(THEME_KEY);
  const preferred = saved
    || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  apply(preferred);

  button.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(next);
    localStorage.setItem(THEME_KEY, next);
    onChange?.(next);
  });

  function apply(theme) {
    document.documentElement.dataset.theme = theme;
  }
}

/** Reads a CSS custom property from the active theme. */
export function themeColor(name, fallback = '#888888') {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/* ──────────────────────────────── tabs ──────────────────────────────── */

/**
 * The 3D / Plan / Elevation tabs all share one WebGL panel — only the camera
 * mode changes — so the tab strip maps tab ids onto panel ids.
 */
const PANEL_OF = {
  view3d: 'panel-scene',
  plan: 'panel-scene',
  elevation: 'panel-scene',
  sections: 'panel-sections',
  data: 'panel-data',
  code: 'panel-code',
  results: 'panel-results',
};

export function initTabs(onChange) {
  const tabs = [...document.querySelectorAll('.tab')];

  const select = (id) => {
    for (const t of tabs) t.classList.toggle('is-active', t.dataset.tab === id);
    const target = PANEL_OF[id];
    for (const p of document.querySelectorAll('.panel')) {
      p.classList.toggle('is-active', p.id === target);
    }
    onChange?.(id);
  };

  for (const t of tabs) t.addEventListener('click', () => select(t.dataset.tab));
  return { select };
}

/* ─────────────────────────────── toasts ─────────────────────────────── */

export function toast(title, message = '', tone = 'info', ms = 4200) {
  const host = document.getElementById('toaster');
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.tone = tone;

  const body = document.createElement('div');
  body.className = 'msg';
  const strong = document.createElement('b');
  strong.textContent = title;
  body.append(strong);
  if (message) body.append(document.createTextNode(message));
  el.append(body);

  host.append(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .2s';
    setTimeout(() => el.remove(), 220);
  }, ms);
}

/* ────────────────────────────── confirm ─────────────────────────────── */

/**
 * A modal yes/no question. Used for the few actions that throw work away, so
 * one stray click cannot clear a model that took an afternoon to set up.
 *
 * @returns {Promise<boolean>} true when the user confirms
 */
export function confirmDialog({ title, message, confirmLabel = 'Continue', tone = 'danger' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const h = document.createElement('h3');
    h.textContent = title;

    const p = document.createElement('p');
    p.textContent = message;

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const cancel = document.createElement('button');
    cancel.className = 'btn btn-ghost';
    cancel.textContent = 'Cancel';

    const ok = document.createElement('button');
    ok.className = tone === 'danger' ? 'btn btn-danger' : 'btn btn-primary';
    ok.textContent = confirmLabel;

    actions.append(cancel, ok);
    box.append(h, p, actions);
    overlay.append(box);
    document.body.append(overlay);
    ok.focus();

    const close = (answer) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(answer);
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); close(false); }
      if (ev.key === 'Enter') { ev.preventDefault(); close(true); }
    };

    cancel.addEventListener('click', () => close(false));
    ok.addEventListener('click', () => close(true));
    overlay.addEventListener('mousedown', (ev) => { if (ev.target === overlay) close(false); });
    document.addEventListener('keydown', onKey);
  });
}

/* ─────────────────────────── status indicator ───────────────────────── */

/**
 * Sets the build status. Passing `onClick` turns the pill into a button — used
 * when the status stands for something the user should be able to open, such as
 * the list of warnings behind a "built with 2 warnings".
 */
export function setStatus(text, tone = 'idle', onClick = null) {
  const host = document.getElementById('build-status');
  host.dataset.tone = tone;
  document.getElementById('build-status-text').textContent = text;

  host.onclick = onClick;
  host.classList.toggle('is-clickable', !!onClick);
  if (onClick) {
    host.setAttribute('role', 'button');
    host.setAttribute('tabindex', '0');
    host.onkeydown = (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onClick(); }
    };
  } else {
    host.removeAttribute('role');
    host.removeAttribute('tabindex');
    host.onkeydown = null;
  }
}

/* ──────────────────────────── file download ─────────────────────────── */

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Turns a model name into a safe file stem. */
export function slug(text, fallback = 'model') {
  const s = String(text || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s || fallback;
}
