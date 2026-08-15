/**
 * state.js — the single source of truth for every parameter.
 *
 * The store is a flat `{ fieldId: value }` object so it serialises directly to
 * localStorage.  Consumers subscribe to changes; the sidebar re-evaluates
 * conditional visibility on every write.
 */

import { allFields } from './schema.js';
import { DEFAULT_SYSTEM } from './units.js';

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
  // Manual joint moves and per-member edits live outside the schema: they are
  // keyed by node or element tag rather than being one named parameter.
  out.nodeOffsets = {};
  out.elementOverrides = {};
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
  if (!tags) state.elementOverrides = {};
  else {
    const next = { ...state.elementOverrides };
    for (const tag of tags) delete next[tag];
    state.elementOverrides = next;
  }
  persist();
  emit({ id: 'elementOverrides', tags });
}

/** Restores every field to its default in the current unit system. */
export function resetAll() {
  const fresh = defaultsFor(state.unitSystem);
  for (const key of Object.keys(fresh)) state[key] = fresh[key];
  persist();
  emit({ id: '*', reset: true });
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { /* private browsing or quota — the app still works in memory */ }
}

function load() {
  const base = defaultsFor(DEFAULT_SYSTEM);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
  catch { saved = null; }
  if (!saved || typeof saved !== 'object') return base;

  // Rebase onto the saved unit system, then overlay the saved values so that
  // fields added in a later version still receive a sensible default.
  const merged = defaultsFor(saved.unitSystem || DEFAULT_SYSTEM);
  for (const key of Object.keys(merged)) {
    if (saved[key] !== undefined) merged[key] = saved[key];
  }
  if (!merged.nodeOffsets || typeof merged.nodeOffsets !== 'object') merged.nodeOffsets = {};
  if (!merged.elementOverrides || typeof merged.elementOverrides !== 'object') merged.elementOverrides = {};
  return merged;
}

/* ─────────────────────────── input parsing ──────────────────────────── */

/**
 * Expands a "6" or "6, 7.5, 6" text field into exactly `count` numbers.
 * A single value repeats; a short list is padded with its last entry; a long
 * list is truncated.
 */
export function expandList(text, count, fallback = 1) {
  const parsed = String(text ?? '')
    .split(/[,;\s]+/)
    .map((t) => Number(t))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (parsed.length === 0) return Array.from({ length: count }, () => fallback);
  const out = [];
  for (let i = 0; i < count; i++) out.push(parsed[Math.min(i, parsed.length - 1)]);
  return out;
}
