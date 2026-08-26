/**
 * state.js — the single source of truth for every parameter.
 *
 * The store is a flat `{ fieldId: value }` object so it serialises directly to
 * localStorage.  Consumers subscribe to changes; the sidebar re-evaluates
 * conditional visibility on every write.
 *
 * Three services sit on top of the store:
 *   validation  every input is checked before a model is built, and nothing is
 *               ever silently substituted (see `parseList`)
 *   history     every mutation is snapshotted, so undo and redo cover form
 *               edits, joint moves, member edits and Reset alike
 *   projects    the whole store round-trips through a JSON file
 */

import { allFields } from './schema.js';
import { DEFAULT_SYSTEM } from './units.js';
import { APP_VERSION, PROJECT_FORMAT } from './version.js';
import { structuralIssues } from './model/checks.js';

const STORAGE_KEY = 'osms.state.v1';

/** Fields whose default depends on the unit system (their `d` is an object). */
const unitDependent = new Set(
  allFields().filter((f) => f.d && typeof f.d === 'object').map((f) => f.id)
);

/** Builds the default state for a given unit system. */
export function defaultsFor(unitSystem = DEFAULT_SYSTEM) {
  const out = {};
  for (const f of allFields()) {
    out[f.id] = (f.d && typeof f.d === 'object') ? f.d[unitSystem] : f.d;
  }
  out.unitSystem = unitSystem;
  // Everything below lives outside the schema: it is keyed by tag, or is a
  // list, rather than being one named parameter.
  out.nodeOffsets = {};        // tag → [dx, dy, dz]
  out.elementOverrides = {};   // tag → { b, h, …, w }
  out.deletedElements = {};    // tag → true
  out.addedElements = [];      // members copied off the grid — see replicate()
  return out;
}

export const state = load();

const subscribers = new Set();

/** Subscribe to state changes. Returns an unsubscribe function. */
export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function emit(detail) {
  for (const fn of subscribers) fn(state, detail);
}

/**
 * Writes one value. Changing `unitSystem` also rebases every unit-dependent
 * field onto that system's defaults — silently converting them would be worse,
 * because the user's own numbers would stop matching what they typed.
 */
export function setValue(id, value) {
  if (state[id] === value) return;
  mark(id);

  if (id === 'unitSystem') {
    const fresh = defaultsFor(value);
    for (const key of unitDependent) state[key] = fresh[key];
    state.unitSystem = value;
    persist();
    emit({ id, value, rebased: true });
    return;
  }

  state[id] = value;
  persist();
  emit({ id, value });
}

/**
 * Moves joints by a displacement in global coordinates. The offsets sit on top
 * of the parametric grid rather than replacing it, so changing bay widths or
 * story heights later keeps the moves; every element touching a moved joint
 * follows it, because element ends are read from the node coordinates.
 */
export function moveNodes(tags, [dx, dy, dz]) {
  mark();
  const next = { ...state.nodeOffsets };
  for (const tag of tags) {
    const [x, y, z] = next[tag] || [0, 0, 0];
    const moved = [x + dx, y + dy, z + dz];
    // Drop the entry once a joint is back on the grid, so the model stays clean.
    if (moved.every((v) => Math.abs(v) < 1e-12)) delete next[tag];
    else next[tag] = moved;
  }
  state.nodeOffsets = next;
  persist();
  emit({ id: 'nodeOffsets', tags });
}

/** Puts the given joints back onto the parametric grid. */
export function clearNodeOffsets(tags = null) {
  mark();
  if (!tags) state.nodeOffsets = {};
  else {
    const next = { ...state.nodeOffsets };
    for (const tag of tags) delete next[tag];
    state.nodeOffsets = next;
  }
  persist();
  emit({ id: 'nodeOffsets', tags });
}

/**
 * Edits individual members: section dimensions and the uniform slab load.
 * Keys carrying `undefined` are ignored, so a patch can set only what the user
 * actually filled in. An empty edit removes the member from the override table
 * and it goes back to whatever the Sections and Loads groups say.
 */
export function setElementOverrides(tags, patch) {
  mark();
  const next = { ...state.elementOverrides };
  for (const tag of tags) {
    const merged = { ...next[tag] };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === null || value === '') delete merged[key];
      else merged[key] = value;
    }
    if (Object.keys(merged).length) next[tag] = merged;
    else delete next[tag];
  }
  state.elementOverrides = next;
  persist();
  emit({ id: 'elementOverrides', tags });
}

/** Returns the listed members to the model-wide sections and loads. */
export function clearElementOverrides(tags = null) {
  mark();
  if (!tags) state.elementOverrides = {};
  else {
    const next = { ...state.elementOverrides };
    for (const tag of tags) delete next[tag];
    state.elementOverrides = next;
  }
  persist();
  emit({ id: 'elementOverrides', tags });
}

/**
 * Removes members from the model. The grid still generates them, so the tags
 * are remembered and skipped — both here and in the generated script — which
 * keeps every other tag exactly where it was.
 */
export function deleteElements(tags) {
  if (!tags.length) return;
  mark();
  const next = { ...state.deletedElements };
  for (const tag of tags) next[tag] = true;
  state.deletedElements = next;
  persist();
  emit({ id: 'deletedElements', tags });
}

/** Brings deleted members back; with no argument, all of them. */
export function restoreElements(tags = null) {
  mark();
  if (!tags) state.deletedElements = {};
  else {
    const next = { ...state.deletedElements };
    for (const tag of tags) delete next[tag];
    state.deletedElements = next;
  }
  persist();
  emit({ id: 'deletedElements', tags });
}

/**
 * Copies members to a new position. The copies are free-standing: they carry
 * their own end coordinates rather than a grid index, so they can land anywhere
 * — another story, another bay, or half a bay across.
 *
 * @param {object[]} elements  members to copy, from the built model
 * @param {number[]} delta     [dx, dy, dz] in model units
 * @param {number} count       how many copies, each one delta further along
 */
export function replicate(elements, delta, count = 1) {
  if (!elements.length || count < 1) return 0;
  mark();

  const added = [...state.addedElements];
  let nextId = added.reduce((a, e) => Math.max(a, e.id || 0), 0) + 1;

  for (let n = 1; n <= count; n++) {
    const [dx, dy, dz] = delta.map((v) => v * n);
    for (const e of elements) {
      added.push({
        id: nextId++,
        kind: e.kind,
        from: [e.p1[0] + dx, e.p1[1] + dy, e.p1[2] + dz],
        to: [e.p2[0] + dx, e.p2[1] + dy, e.p2[2] + dz],
        source: e.tag,
      });
    }
  }

  state.addedElements = added;
  persist();
  emit({ id: 'addedElements' });
  return count * elements.length;
}

/** Removes copied members; with no argument, all of them. */
export function clearAdded(ids = null) {
  mark();
  state.addedElements = ids
    ? state.addedElements.filter((e) => !ids.includes(e.id))
    : [];
  persist();
  emit({ id: 'addedElements' });
}

/** Everything the user placed by hand, rather than through the grid. */
export function manualEdits(s = state) {
  return {
    moves: Object.keys(s.nodeOffsets || {}).length,
    edits: Object.keys(s.elementOverrides || {}).length,
    deleted: Object.keys(s.deletedElements || {}).length,
    added: (s.addedElements || []).length,
  };
}

/** Drops every by-hand change, leaving the parametric grid on its own. */
export function clearManualEdits() {
  mark();
  state.nodeOffsets = {};
  state.elementOverrides = {};
  state.deletedElements = {};
  state.addedElements = [];
  persist();
  emit({ id: '*', cleared: true });
}

/** Restores every field to its default in the current unit system. */
export function resetAll() {
  mark();
  const fresh = defaultsFor(state.unitSystem);
  for (const key of Object.keys(fresh)) state[key] = fresh[key];
  persist();
  emit({ id: '*', reset: true });
}

/* ────────────────────────────── persistence ─────────────────────────── */

/**
 * Whether the last write to localStorage succeeded. Private browsing and a
 * full quota both fail silently at the API level, so the app has to watch for
 * it: work that is not being saved must be visible as such, not discovered
 * when the tab is closed.
 */
export const storage = { ok: true, reason: '' };

const storageSubs = new Set();

export function subscribeStorage(fn) {
  storageSubs.add(fn);
  return () => storageSubs.delete(fn);
}

function persist() {
  let ok = true;
  let reason = '';
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    ok = false;
    reason = err && err.name === 'QuotaExceededError'
      ? 'Browser storage is full, so this model is only held in memory.'
      : 'This browser is blocking local storage, so this model is only held in memory.';
  }
  if (ok === storage.ok) return;
  storage.ok = ok;
  storage.reason = reason;
  for (const fn of storageSubs) fn(storage);
}

/**
 * Every select field's allowed values, so stale saved choices can be caught.
 * Built on first use because `load()` needs it while this module is still
 * being evaluated.
 */
function selectOptionsFor(id) {
  // The cache hangs off the function itself: a module-level `let` would still
  // be in its temporal dead zone when `load()` calls this during evaluation.
  if (!selectOptionsFor.cache) {
    selectOptionsFor.cache = new Map(
      allFields()
        .filter((f) => f.type === 'select' && Array.isArray(f.options))
        .map((f) => [f.id, new Set(f.options.map((o) => o.value))])
    );
  }
  return selectOptionsFor.cache.get(id);
}

/** Overlays a saved object onto a fresh default set for its unit system. */
function merge(saved) {
  const merged = defaultsFor(saved.unitSystem || DEFAULT_SYSTEM);
  for (const key of Object.keys(merged)) {
    if (saved[key] === undefined) continue;
    // A choice that no longer exists — an element withdrawn because OpenSees
    // cannot run it, say — falls back to the default rather than being carried
    // forward into a model that would fail to build.
    const allowed = selectOptionsFor(key);
    if (allowed && !allowed.has(saved[key])) continue;
    merged[key] = saved[key];
  }
  // Fields added in a later version keep the default they were just given.
  merged.nodeOffsets = isPlainObject(saved.nodeOffsets) ? saved.nodeOffsets : {};
  merged.elementOverrides = isPlainObject(saved.elementOverrides) ? saved.elementOverrides : {};
  merged.deletedElements = isPlainObject(saved.deletedElements) ? saved.deletedElements : {};
  merged.addedElements = Array.isArray(saved.addedElements) ? saved.addedElements : [];
  return merged;
}

// A function declaration, not a const: `load()` runs while this module is still
// being evaluated, so anything it calls has to be hoisted.
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function load() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
  catch { saved = null; }
  if (!isPlainObject(saved)) return defaultsFor(DEFAULT_SYSTEM);
  return merge(saved);
}

/* ─────────────────────────── project files ──────────────────────────── */

/** The whole store as a portable, human-readable project file. */
export function exportProject() {
  return `${JSON.stringify({
    app: 'OpenSees Model Studio',
    version: APP_VERSION,
    format: PROJECT_FORMAT,
    savedAt: new Date().toISOString(),
    state: clone(state),
  }, null, 2)}\n`;
}

/**
 * Reads a project file back into the store. Unknown fields are dropped and
 * missing ones fall back to the current defaults, so a file written by an
 * older release still opens. Throws `InputError` on anything unreadable.
 */
export function importProject(text) {
  const doc = readProjectFile(text);

  const saved = isPlainObject(doc) && isPlainObject(doc.state) ? doc.state : doc;
  if (!isPlainObject(saved) || saved.unitSystem === undefined) {
    throw new InputError('That file is not an OpenSees Model Studio project.');
  }

  mark();
  replace(merge(saved));
  emit({ id: '*', imported: true });
  return { version: doc && doc.version ? String(doc.version) : 'unknown' };
}

/** The comment lines a generated script carries its model definition in. */
const PROJECT_MARKER = '# osms:';

/**
 * Reads a project out of whatever the user handed over: a `.json` project, a
 * generated `.py` script, or a generated `.ipynb` notebook. The last two carry
 * the definition in comments, so the file someone keeps to run is the same file
 * they can reopen.
 */
function readProjectFile(text) {
  const trimmed = String(text ?? '').trimStart();

  if (trimmed.startsWith('{')) {
    let doc;
    try { doc = JSON.parse(text); }
    catch { throw new InputError('That file is not valid JSON.'); }

    // A notebook is JSON too — its cells hold the script, comments and all.
    if (isPlainObject(doc) && Array.isArray(doc.cells)) {
      const source = doc.cells
        .flatMap((cell) => (Array.isArray(cell.source) ? cell.source : [cell.source || '']))
        .join('');
      return fromScript(source, 'notebook');
    }
    return doc;
  }

  return fromScript(text, 'script');
}

function fromScript(source, what) {
  const payload = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(PROJECT_MARKER))
    .map((line) => line.slice(PROJECT_MARKER.length).trim())
    .join('');

  if (!payload) {
    throw new InputError(
      `That ${what} carries no model definition. Only scripts generated by OpenSees Model `
      + 'Studio 1.2 or later can be loaded back — they keep the definition in a comment '
      + 'block at the end of the file.'
    );
  }
  try { return JSON.parse(payload); }
  catch { throw new InputError(`The model definition in that ${what} is damaged and cannot be read.`); }
}

/* ──────────────────────────── undo / redo ───────────────────────────── */

const HISTORY_LIMIT = 60;
const COALESCE_MS = 700;

const past = [];
const future = [];
const historySubs = new Set();
let lastMark = { key: null, at: 0 };

const clone = (o) => JSON.parse(JSON.stringify(o));

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;

export function subscribeHistory(fn) {
  historySubs.add(fn);
  fn({ undo: canUndo(), redo: canRedo() });
  return () => historySubs.delete(fn);
}

function emitHistory() {
  for (const fn of historySubs) fn({ undo: canUndo(), redo: canRedo() });
}

/**
 * Records the state as it is *before* a mutation. Consecutive writes to the
 * same field within a moment fold into one step, so typing "6000" leaves one
 * undo entry rather than four.
 */
function mark(key = null) {
  const now = Date.now();
  if (key !== null && key === lastMark.key && now - lastMark.at < COALESCE_MS && past.length) {
    lastMark.at = now;
    if (future.length) { future.length = 0; emitHistory(); }
    return;
  }
  past.push(clone(state));
  if (past.length > HISTORY_LIMIT) past.shift();
  future.length = 0;
  lastMark = { key, at: now };
  emitHistory();
}

/** Swaps the whole store for another snapshot, in place. */
function replace(next) {
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, next);
  persist();
  lastMark = { key: null, at: 0 };
  emitHistory();
}

export function undo() {
  if (!past.length) return false;
  future.push(clone(state));
  replace(past.pop());
  emit({ id: '*', history: 'undo' });
  return true;
}

export function redo() {
  if (!future.length) return false;
  past.push(clone(state));
  replace(future.pop());
  emit({ id: '*', history: 'redo' });
  return true;
}

/* ─────────────────────────── input parsing ──────────────────────────── */

/** Raised when an input cannot be read as the number the model needs. */
export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
  }
}

const trim = (n) => (Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(6))));

/**
 * Reads a "6" or "6, 7.5, 6" list field into exactly `count` positive numbers.
 *
 * Nothing is ever substituted: a zero, a negative number or a typo comes back
 * as an error rather than quietly becoming a default, because a frame built
 * with a 1 m bay the user never asked for is worse than no frame at all.
 * Padding a short list and truncating a long one are both legitimate, but each
 * one is reported in `notice` so it is never a surprise. A single value
 * repeating for every bay or story is the documented idiom the field's own hint
 * describes, so it passes without a note.
 *
 * @returns {{ values: number[]|null, errors: string[], notice: string|null }}
 */
export function parseList(text, count) {
  const raw = String(text ?? '').trim();
  if (!raw) return { values: null, errors: ['Enter a value.'], notice: null };

  const tokens = raw.split(/[,;\s]+/).filter(Boolean);
  const errors = [];
  const nums = [];

  for (const token of tokens) {
    const n = Number(token);
    if (!Number.isFinite(n)) errors.push(`“${token}” is not a number.`);
    else if (n === 0) errors.push('A value of 0 is not a usable dimension.');
    else if (n < 0) errors.push(`${token} is negative — every value must be greater than zero.`);
    else nums.push(n);
  }
  if (errors.length) return { values: null, errors, notice: null };

  let notice = null;
  if (nums.length > 1 && nums.length < count) {
    const short = count - nums.length;
    notice = `${nums.length} values given for ${count} — the last one (${trim(nums[nums.length - 1])}) `
      + `is repeated for the remaining ${short}.`;
  } else if (nums.length > count) {
    notice = `${nums.length} values given for ${count} — the last ${nums.length - count} are ignored.`;
  }

  const values = [];
  for (let i = 0; i < count; i++) values.push(nums[Math.min(i, nums.length - 1)]);
  return { values, errors: [], notice };
}

/**
 * `parseList` for callers that have already validated their input.
 * Throws rather than guessing, so a code path that skips validation fails
 * loudly instead of building a model nobody asked for.
 */
export function expandList(text, count) {
  const { values, errors } = parseList(text, count);
  if (!values) throw new InputError(errors[0]);
  return values;
}

/* ───────────────────────────── validation ───────────────────────────── */

/** List fields, and the field that decides how many entries each one needs. */
const LIST_FIELDS = [
  { id: 'spanX', from: 'baysX' },
  { id: 'spanY', from: 'baysY' },
  { id: 'storyHeight', from: 'numStories' },
];

/**
 * Checks every visible input. Hidden fields are skipped: an option that is not
 * part of the current model must not block it.
 *
 * @returns {{ ok: boolean, errors: Object, notices: Object }} keyed by field id
 */
export function validateState(s = state) {
  const errors = {};
  const notices = {};

  for (const f of allFields()) {
    if (f.type !== 'number') continue;
    if (f.showIf && !f.showIf(s)) continue;

    const raw = s[f.id];
    if (raw === '' || raw === null || raw === undefined || !Number.isFinite(Number(raw))) {
      errors[f.id] = 'Enter a number.';
      continue;
    }
    const n = Number(raw);
    // `gt` and `lt` are the open bounds — a bay of exactly 0 or a damping ratio
    // of exactly 1 is as unusable as one outside the range.
    if (f.gt !== undefined && !(n > f.gt)) {
      errors[f.id] = f.gt === 0
        ? 'Must be greater than zero.'
        : `Must be greater than ${trim(f.gt)}.`;
    } else if (f.lt !== undefined && !(n < f.lt)) errors[f.id] = `Must be less than ${trim(f.lt)}.`;
    else if (f.min !== undefined && n < f.min) errors[f.id] = `Must be ${trim(f.min)} or more.`;
    else if (f.max !== undefined && n > f.max) errors[f.id] = `Must be ${trim(f.max)} or less.`;
    else if (f.step === 1 && !Number.isInteger(n)) errors[f.id] = 'Must be a whole number.';
  }

  for (const { id, from } of LIST_FIELDS) {
    if (errors[from]) continue;                 // the count itself is wrong; say that first
    const count = Number(s[from]);
    if (!Number.isFinite(count) || count < 1) continue;

    const result = parseList(s[id], Math.round(count));
    if (result.errors.length) errors[id] = result.errors[0];
    else if (result.notice) notices[id] = result.notice;
  }

  // Checks that need more than one field: section proportions, cover and
  // reinforcement against the section they produce, and record timing.
  // A field that is already wrong on its own keeps its simpler message.
  const cross = structuralIssues(s);
  for (const [id, message] of Object.entries(cross.errors)) {
    if (!errors[id]) errors[id] = message;
  }
  for (const [id, message] of Object.entries(cross.notices)) {
    if (!errors[id] && !notices[id]) notices[id] = message;
  }

  return { ok: Object.keys(errors).length === 0, errors, notices };
}

/** A one-line summary of what is wrong, for the status bar and toasts. */
export function firstIssue(errors) {
  const [id] = Object.keys(errors);
  if (!id) return null;
  const field = allFields().find((f) => f.id === id);
  return `${field ? field.label : id}: ${errors[id]}`;
}
