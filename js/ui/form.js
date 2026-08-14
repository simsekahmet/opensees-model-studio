/**
 * ui/form.js — renders the parameter sidebar from SCHEMA.
 *
 * Controls are created once; a change to the state only re-evaluates
 * visibility and unit labels, so focus and caret position survive typing.
 */

import { SCHEMA } from '../schema.js';
import { state, setValue, subscribe } from '../state.js';
import { unitLabel } from '../units.js';

const COLLAPSE_KEY = 'osms.collapsed';

export function renderForm(root, onDirty) {
  const collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]'));
  const registry = [];   // { field, wrapper, input, unitEl }

  root.textContent = '';

  for (const group of SCHEMA) {
    const section = document.createElement('section');
    section.className = 'group';
    section.dataset.group = group.id;
    if (collapsed.has(group.id)) section.classList.add('is-collapsed');

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'group-head';
    head.innerHTML = `<span class="caret"></span><span class="g-title"></span><span class="g-note"></span>`;
    head.querySelector('.g-title').textContent = group.title;
    head.querySelector('.g-note').textContent = group.note || '';
    head.addEventListener('click', () => {
      section.classList.toggle('is-collapsed');
      const now = [...root.querySelectorAll('.group.is-collapsed')].map((g) => g.dataset.group);
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(now));
    });

    const body = document.createElement('div');
    body.className = 'group-body';

    // Pairs of consecutive `half` fields share a row.
    let row = null;
    for (const field of group.fields) {
      const el = field.kind === 'sub' ? subhead(field) : control(field, registry, onDirty);
      if (!el) continue;

      if (field.half) {
        if (!row) { row = document.createElement('div'); row.className = 'field-row'; body.append(row); }
        row.append(el);
        if (row.children.length === 2) row = null;
      } else {
        row = null;
        body.append(el);
      }
    }

    section.append(head, body);
    root.append(section);
  }

  refresh();
  subscribe(refresh);

  /** Re-applies conditional visibility, unit labels and values. */
  function refresh() {
    for (const r of registry) {
      const visible = !r.field.showIf || r.field.showIf(state);
      r.wrapper.hidden = !visible;

      if (r.unitEl) r.unitEl.textContent = unitLabel(state.unitSystem, r.field.unit);

      const value = state[r.field.id];
      if (r.input.type === 'checkbox') {
        if (r.input.checked !== !!value) r.input.checked = !!value;
      } else if (document.activeElement !== r.input) {
        const next = value === undefined || value === null ? '' : String(value);
        if (r.input.value !== next) r.input.value = next;
      }
    }
    // Empty groups (all fields hidden) collapse out of the way.
    for (const g of root.querySelectorAll('.group')) {
      const body = g.querySelector('.group-body');
      const any = [...body.children].some((c) => !c.hidden);
      g.hidden = !any;
    }
  }

  return { refresh };
}

/* ──────────────────────────── control builders ──────────────────────── */

function subhead(field) {
  const el = document.createElement('div');
  el.className = 'subhead';
  el.textContent = field.label;
  if (field.showIf) {
    const update = () => { el.hidden = !field.showIf(state); };
    subscribe(update);
    update();
  }
  return el;
}

function control(field, registry, onDirty) {
  if (field.type === 'check') return checkbox(field, registry, onDirty);

  const wrapper = document.createElement('div');
  wrapper.className = 'field';

  const label = document.createElement('label');
  label.className = 'field-label';
  label.htmlFor = `f-${field.id}`;
  label.append(document.createTextNode(field.label));

  let unitEl = null;
  if (field.unit) {
    unitEl = document.createElement('span');
    unitEl.className = 'unit';
    label.append(unitEl);
  }

  const input = field.type === 'select'
    ? buildSelect(field)
    : buildInput(field);
  input.id = `f-${field.id}`;

  input.addEventListener(field.type === 'select' ? 'change' : 'input', () => {
    setValue(field.id, readValue(field, input));
    onDirty?.();
  });
  // Numbers are only clamped once the user leaves the field, so intermediate
  // states such as "0." or "-" remain typeable.
  if (field.type === 'number') {
    input.addEventListener('blur', () => {
      const clamped = clamp(field, Number(input.value));
      if (Number.isFinite(clamped)) {
        setValue(field.id, clamped);
        input.value = String(clamped);
      }
    });
  }

  wrapper.append(label, input);
  if (field.hint) {
    const hint = document.createElement('div');
    hint.className = 'field-hint';
    hint.textContent = field.hint;
    wrapper.append(hint);
  }

  registry.push({ field, wrapper, input, unitEl });
  return wrapper;
}

function buildInput(field) {
  const input = document.createElement('input');
  input.className = 'input';
  input.type = field.type === 'number' ? 'number' : 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  if (field.type === 'number') {
    if (field.min !== undefined) input.min = field.min;
    if (field.max !== undefined) input.max = field.max;
    input.step = field.step ?? 'any';
  }
  return input;
}

function buildSelect(field) {
  const select = document.createElement('select');
  select.className = 'select';
  for (const opt of field.options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    select.append(o);
  }
  return select;
}

function checkbox(field, registry, onDirty) {
  const wrapper = document.createElement('label');
  wrapper.className = 'field-check';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = `f-${field.id}`;

  const text = document.createElement('span');
  text.className = 't';
  text.textContent = field.label;
  if (field.hint) {
    const hint = document.createElement('span');
    hint.className = 'h';
    hint.textContent = field.hint;
    text.append(hint);
  }

  input.addEventListener('change', () => {
    setValue(field.id, input.checked);
    onDirty?.();
  });

  wrapper.append(input, text);
  registry.push({ field, wrapper, input, unitEl: null });
  return wrapper;
}

/* ─────────────────────────────── helpers ────────────────────────────── */

function readValue(field, input) {
  if (field.type === 'number') {
    const n = Number(input.value);
    return input.value === '' || !Number.isFinite(n) ? input.value : n;
  }
  return input.value;
}

function clamp(field, n) {
  if (!Number.isFinite(n)) return NaN;
  let v = n;
  if (field.min !== undefined) v = Math.max(field.min, v);
  if (field.max !== undefined) v = Math.min(field.max, v);
  if (field.step === 1) v = Math.round(v);
  return v;
}
