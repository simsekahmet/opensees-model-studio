/**
 * ui/form.js — renders the parameter sidebar from SCHEMA.
 *
 * Controls are created once; a change to the state only re-evaluates
 * visibility and unit labels, so focus and caret position survive typing.
 */

import { SCHEMA } from '../schema.js';
import { state, setValue, subscribe } from '../state.js';
import { unitLabel } from '../units.js';
import { loadRecordFile, subscribeGM, getRecord } from '../model/groundmotion.js';

export function renderForm(root, onDirty) {
  const registry = [];   // { field, wrapper, input, unitEl }

  root.textContent = '';

  for (const group of SCHEMA) {
    // Every group starts closed, so the sidebar always opens as a short index
    // of the model rather than a wall of inputs.
    const section = document.createElement('section');
    section.className = 'group is-collapsed';
    section.dataset.group = group.id;

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'group-head';
    head.innerHTML = '<span class="caret"></span><span class="g-title"></span>';
    head.querySelector('.g-title').textContent = group.title;
    head.addEventListener('click', () => section.classList.toggle('is-collapsed'));

    const body = document.createElement('div');
    body.className = 'group-body';

    // Pairs of consecutive `half` fields share a row.
    let row = null;
    for (const field of group.fields) {
      if (field.kind === 'break') { row = null; continue; }

      const el = field.kind === 'sub' ? subhead(field)
        : field.kind === 'note-line' ? noteLine(field)
        : control(field, registry, onDirty);
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

/** A standalone caveat shown above a material's parameter block. */
function noteLine(field) {
  const el = document.createElement('p');
  el.className = 'field-note';
  el.textContent = field.label;
  if (field.showIf) {
    const update = () => { el.hidden = !field.showIf(state); };
    subscribe(update);
    update();
  }
  return el;
}

/**
 * Ground motion upload. The record itself stays in `model/groundmotion.js`;
 * only its name lands in the persisted state, and a declared DT in the header
 * is pushed into the record-dt field so the two cannot disagree.
 */
function fileField(field, onDirty) {
  const wrapper = document.createElement('div');
  wrapper.className = 'field';

  const label = document.createElement('div');
  label.className = 'field-label';
  label.textContent = field.label;

  const row = document.createElement('div');
  row.className = 'file-row';

  const input = document.createElement('input');
  input.type = 'file';
  input.id = `f-${field.id}`;
  input.accept = '.txt,.at2,.AT2,.dat,.acc,text/plain';
  input.className = 'file-input';

  const button = document.createElement('label');
  button.className = 'btn btn-ghost btn-sm';
  button.htmlFor = input.id;
  button.textContent = 'Choose record…';

  const summary = document.createElement('div');
  summary.className = 'file-summary';

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const rec = await loadRecordFile(file);
      setValue(field.id, rec.name);
      if (rec.dt) setValue('gmDt', rec.dt);
      onDirty?.();
    } catch (err) {
      summary.textContent = err.message;
      summary.dataset.tone = 'error';
    }
  });

  const paint = (rec) => {
    if (!rec) {
      summary.textContent = 'No record loaded.';
      delete summary.dataset.tone;
      return;
    }
    delete summary.dataset.tone;
    summary.textContent = `${rec.name} — ${rec.npts} points`
      + (rec.dt ? `, dt ${rec.dt} s, ${(rec.npts * rec.dt).toFixed(1)} s` : '')
      + `, peak ${rec.pga.toPrecision(4)}  [${rec.source}]`;
  };
  subscribeGM(paint);
  paint(getRecord());

  row.append(button, input);
  wrapper.append(label, row, summary);
  if (field.hint) {
    const hint = document.createElement('div');
    hint.className = 'field-hint';
    hint.textContent = field.hint;
    wrapper.append(hint);
  }

  // Visibility is driven by the same showIf machinery as every other field.
  if (field.showIf) {
    const update = () => { wrapper.hidden = !field.showIf(state); };
    subscribe(update);
    update();
  }
  return wrapper;
}

function control(field, registry, onDirty) {
  if (field.type === 'check') return checkbox(field, registry, onDirty);
  if (field.type === 'file') return fileField(field, onDirty);

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
