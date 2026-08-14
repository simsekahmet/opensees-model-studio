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

/* ─────────────────────────── status indicator ───────────────────────── */

export function setStatus(text, tone = 'idle') {
  const host = document.getElementById('build-status');
  host.dataset.tone = tone;
  document.getElementById('build-status-text').textContent = text;
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
