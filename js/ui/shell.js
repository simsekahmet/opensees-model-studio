/**
 * ui/shell.js — chrome that is not tied to the model: colour theme, the
 * viewport tab strip, and toast notifications.
 */

const THEME_KEY = 'osms.theme';

/* ─────────────────────────────── theme ──────────────────────────────── */

export function initTheme(button, onChange) {
  // Light is where the page starts. Someone who has chosen dark keeps it; the
  // operating system's preference is not consulted, because a drawing tool that
  // opens dark for half its users is two different products.
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); }
  catch { saved = null; }
  apply(saved === 'dark' || saved === 'light' ? saved : 'light');

  button.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private browsing */ }
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
 * Which panel each tab shows. Plan and elevation are not tabs: they are the
 * same scene seen through a different camera, chosen with the story and
 * elevation pickers in the toolbar.
 */
const PANEL_OF = {
  view3d: 'panel-scene',
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
    modal({ title, message, confirmLabel, tone, onDone: resolve });
  });
}

/** The one modal every dialog above is a shape of. */
function modal({ title, message, body, confirmLabel, tone, onDone, cancel = true, focus }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const box = document.createElement('div');
  box.className = 'modal';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');

  const h = document.createElement('h3');
  h.textContent = title;
  box.append(h);

  if (message) {
    const p = document.createElement('p');
    p.textContent = message;
    box.append(p);
  }
  if (body) box.append(body);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  let cancelButton = null;
  if (cancel) {
    cancelButton = document.createElement('button');
    cancelButton.className = 'btn btn-ghost';
    cancelButton.textContent = 'Cancel';
    actions.append(cancelButton);
  }

  const ok = document.createElement('button');
  ok.className = tone === 'danger' ? 'btn btn-danger' : 'btn btn-primary';
  ok.textContent = confirmLabel;
  actions.append(ok);

  box.append(actions);
  overlay.append(box);
  document.body.append(overlay);

  const first = focus ? focus() : ok;
  (first || ok).focus();
  if (first && first.select) first.select();

  const close = (answer) => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    onDone(answer);
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); close(false); }
    if (ev.key === 'Enter') { ev.preventDefault(); close(true); }
  };

  cancelButton?.addEventListener('click', () => close(false));
  ok.addEventListener('click', () => close(true));
  overlay.addEventListener('mousedown', (ev) => { if (ev.target === overlay) close(false); });
  document.addEventListener('keydown', onKey);
}

/**
 * A modal that asks for a few numbers. Resolves to `{ id: value }`, or null if
 * the user backed out.
 */
export function promptDialog({ title, message, fields, confirmLabel = 'OK' }) {
  return new Promise((resolve) => {
    const inputs = new Map();
    const body = document.createElement('div');
    body.className = 'modal-fields';

    for (const field of fields) {
      const wrap = document.createElement('label');
      wrap.className = 'modal-field';
      const name = document.createElement('span');
      name.textContent = field.label;
      const input = document.createElement('input');
      input.className = 'input';
      input.type = 'text';
      input.value = field.value ?? '';
      input.autocomplete = 'off';
      inputs.set(field.id, input);
      wrap.append(name, input);
      body.append(wrap);
    }

    modal({
      title,
      message,
      body,
      confirmLabel,
      tone: 'primary',
      focus: () => inputs.values().next().value,
      onDone: (confirmed) => {
        if (!confirmed) return resolve(null);
        const out = {};
        for (const [id, input] of inputs) out[id] = input.value.trim();
        resolve(out);
      },
    });
  });
}

/** A modal that only tells the user something. */
export function infoDialog({ title, body, message = '' }) {
  return new Promise((resolve) => {
    modal({
      title, message, body, confirmLabel: 'Close', tone: 'primary',
      cancel: false,
      onDone: () => resolve(true),
    });
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
