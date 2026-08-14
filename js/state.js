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
