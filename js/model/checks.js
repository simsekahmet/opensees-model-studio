/**
 * model/checks.js — the checks that need more than one field to answer.
 *
 * `state.js` handles per-field bounds from the schema; everything here compares
 * fields against each other or against the section geometry they produce: a
 * flange that does not fit inside its own depth, a cover that leaves no core,
 * more reinforcement than section, an analysis step coarser than the record it
 * is integrating.
 *
 * Two severities come back, keyed by the field the message belongs under:
 *   errors    the model cannot be built — the number is not usable
 *   notices   the model is buildable but the input means something the user
 *             may not have intended
 *
 * Nothing here throws. It runs on every keystroke, over half-typed input.
 */

import { allSections, usesFibers } from './sections.js';
import { getRecord } from './groundmotion.js';

/** Section families and the field ids their dimensions came from. */
const I_FIELDS = {
  column: { shape: 'colShape', h: 'colIh', bf: 'colIbf', tf: 'colItf', tw: 'colItw', name: 'Column' },
  beamX: { shape: 'beamShape', h: 'beamIh', bf: 'beamIbf', tf: 'beamItf', tw: 'beamItw', name: 'Beam' },
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function structuralIssues(s) {
  const errors = {};
  const notices = {};
  const fail = (id, message) => { if (!errors[id]) errors[id] = message; };
  const note = (id, message) => { if (!notices[id]) notices[id] = message; };

  iSectionProportions(s, fail);
  reinforcement(s, fail);
  groundMotion(s, fail, note);
  damping(s, fail, note);

  return { errors, notices };
}

/* ─────────────────────────── I-section geometry ─────────────────────── */

/**
 * An I-section is drawn as two flanges and a web. Flanges thicker than half the
 * depth leave no web, and a web wider than the flange is not an I at all —
 * either way the fiber mesh and the reported inertia stop meaning anything.
 */
function iSectionProportions(s, fail) {
  for (const f of Object.values(I_FIELDS)) {
    if (s[f.shape] !== 'ISection') continue;

    const h = num(s[f.h]);
    const bf = num(s[f.bf]);
    const tf = num(s[f.tf]);
    const tw = num(s[f.tw]);
    if (h === null || bf === null || tf === null || tw === null) continue;
    if (h <= 0 || bf <= 0 || tf <= 0 || tw <= 0) continue;   // the field bounds say this

    if (2 * tf >= h) {
      fail(f.tf, `Two flanges of ${trim(tf)} leave no web inside a depth of ${trim(h)} — `
        + `2 × tf must be less than d.`);
    }
    if (tw > bf) {
      fail(f.tw, `A web of ${trim(tw)} is wider than the ${trim(bf)} flange — tw cannot exceed bf.`);
    }
  }
}

/* ──────────────────────── cover and reinforcement ───────────────────── */

/**
 * Cover and bar area are only meaningful once the section carries fibers. Both
 * are checked against the section the studio actually built, so the numbers
 * quoted in the message are the ones the Sections tab shows.
 */
function reinforcement(s, fail) {
  if (!usesFibers(s)) return;

  let sections;
  try {
    sections = allSections(s);
  } catch {
    return;                       // half-typed geometry; the field bounds will speak first
  }

  const cover = num(s.cover);
  const families = [
    { sec: sections.column, barField: 'colBarArea', name: 'column' },
    { sec: sections.beamX, barField: 'beamBarArea', name: 'beam' },
    ...(sections.shared ? [] : [{ sec: sections.beamY, barField: 'beamBarArea', name: 'Y-beam' }]),
  ];

  for (const { sec, barField, name } of families) {
    if (!sec || !Number.isFinite(sec.A) || sec.A <= 0) continue;

    // Cover is measured from every face, so twice it has to fit inside the
    // smaller dimension or there is no confined core left to reinforce.
    if (cover !== null && cover > 0) {
      const across = sec.shape === 'Circular' ? sec.D : Math.min(sec.b, sec.h);
      if (Number.isFinite(across) && 2 * cover >= across) {
        fail('cover', `A cover of ${trim(cover)} on both faces leaves no core in the ${name} `
          + `section, which measures ${trim(across)} across.`);
      }
    }

    const bars = sec.fiber && sec.fiber.totalBarArea;
    if (Number.isFinite(bars) && bars > 0 && bars >= sec.A) {
      fail(barField, `The ${name} reinforcement totals ${trim(bars, 5)}, which is more than the `
        + `${trim(sec.A, 5)} gross area of the section.`);
    }
  }
}

/* ───────────────────────── ground motion timing ─────────────────────── */

/**
 * The record and the integration have to agree. A step coarser than the record
 * steps over input the analysis was supposed to see; a duration longer than the
 * record is legitimate free vibration, but only if it was meant.
 */
function groundMotion(s, fail, note) {
  if (!s.runTimeHistory) return;

  const gmDt = num(s.gmDt);
  const thDt = num(s.thDt);
  if (gmDt !== null && thDt !== null && gmDt > 0 && thDt > 0 && thDt > gmDt) {
    fail('thDt', `An analysis step of ${trim(thDt, 4)} s is coarser than the record's `
      + `${trim(gmDt, 4)} s, so acceleration points would be stepped over.`);
  }

  const record = getRecord();
  if (!record || gmDt === null || gmDt <= 0) return;

  const recordLength = record.npts * gmDt;
  const duration = num(s.thDuration);
  if (duration !== null && duration > 0 && duration > recordLength + 1e-9) {
    note('thDuration', `The record is ${trim(recordLength, 2)} s long; the last `
      + `${trim(duration - recordLength, 2)} s are free vibration.`);
  }
}

/* ────────────────────────────── damping ─────────────────────────────── */

/**
 * Rayleigh damping is anchored on two modes. Asking for a mode beyond the ones
 * being computed leaves the reported modal results unable to explain the
 * damping that was applied.
 */
function damping(s, fail, note) {
  if (!s.runTimeHistory) return;

  const i = num(s.dampModeI);
  const j = num(s.dampModeJ);
  if (i === null || j === null || i < 1 || j < 1) return;

  if (i === j) {
    note('dampModeJ', `Both anchors are mode ${trim(j)}, so the damping is exact at that mode `
      + 'only and is not the usual two-mode Rayleigh fit.');
  }

  if (!s.runModal) return;
  const modes = num(s.numModes);
  if (modes === null || modes < 1) return;

  const highest = Math.max(i, j);
  if (highest > modes) {
    fail(i > j ? 'dampModeI' : 'dampModeJ',
      `Mode ${trim(highest)} is beyond the ${trim(modes)} modes being computed — raise the mode `
      + 'count or anchor the damping lower.');
  }
}

/* ─────────────────────────────── helpers ────────────────────────────── */

function trim(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(digits)));
}
