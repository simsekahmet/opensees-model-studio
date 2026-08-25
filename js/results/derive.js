/**
 * results/derive.js — the quantities an engineer actually reads.
 *
 * Recorders give displacements, reactions and member forces. Story drift, story
 * shear and base shear are all combinations of those, and each one is derived
 * here rather than in a panel, so the chart, the table and the export can never
 * disagree about what a number means.
 *
 * Global axes: X and Y horizontal, Z vertical. DOF 1, 2, 3 follow them.
 */

const DISP = 'node_disp.out';
const REACTION = 'reactions.out';
const GLOBAL_ENVELOPE = 'element_envelope.out';
const LOCAL_ENVELOPE = 'element_local_envelope.out';

/**
 * `EnvelopeElement` writes three rows and no time column: the minimum, the
 * maximum, and the largest magnitude with its sign dropped. The signed extreme
 * is therefore taken from the first two rows.
 */
const MIN_ROW = 0;
const MAX_ROW = 1;

function signedExtreme(rows, column) {
  if (!rows || rows.length < 2 || column < 0) return 0;
  const low = rows[MIN_ROW][column];
  const high = rows[MAX_ROW][column];
  return Math.abs(low) > Math.abs(high) ? low : high;
}

export const DIRECTIONS = [
  { key: 'x', dof: 1, label: 'X' },
  { key: 'y', dof: 2, label: 'Y' },
];

/* ─────────────────────────── story quantities ───────────────────────── */

/**
 * Average horizontal displacement of each story, per step.
 * The mean over a floor's nodes is the floor's rigid-body translation when the
 * diaphragm is rigid, and the closest honest summary when it is not.
 */
export function storyDisplacements(results, dof) {
  if (!results.has(DISP)) return null;

  const steps = results.steps(DISP);
  const rows = results.series[DISP].rows;

  return results.stories.map((story) => {
    const columns = story.nodes
      .map((tag) => results.nodeColumn(DISP, tag, dof))
      .filter((i) => i >= 0);

    const values = new Float64Array(steps);
    if (columns.length) {
      for (let s = 0; s < steps; s++) {
        let total = 0;
        for (const c of columns) total += rows[s][c];
        values[s] = total / columns.length;
      }
    }
    return { level: story.level, z: story.z, height: story.height, values };
  });
}

/**
 * Drift ratio of each story, per step: the relative displacement across the
 * story divided by its height. The base level has no story below it and is
 * left out rather than reported as zero.
 */
export function storyDrifts(results, dof) {
  const disp = storyDisplacements(results, dof);
  if (!disp) return null;

  const out = [];
  for (let k = 1; k < disp.length; k++) {
    const upper = disp[k];
    const lower = disp[k - 1];
    const height = upper.height || (upper.z - lower.z);
    if (!(height > 0)) continue;

    const values = new Float64Array(upper.values.length);
    for (let s = 0; s < values.length; s++) {
      values[s] = (upper.values[s] - lower.values[s]) / height;
    }
    out.push({ level: upper.level, z: upper.z, height, values });
  }
  return out;
}

/**
 * Shear carried by each story, per step: the sum of the horizontal force at the
 * lower end of every column in that story.
 *
 * Global force is used rather than the local one on purpose — the local axes of
 * a column depend on its transformation, and a story shear is a global quantity.
 */
export function storyShears(results, dof) {
  if (!results.has(GLOBAL_ENVELOPE)) return null;

  const rows = results.series[GLOBAL_ENVELOPE].rows;
  const component = `F${dof}`;             // force at node i, global direction

  const out = [];
  for (const story of results.stories) {
    if (!story.level) continue;            // the base carries no story above it
    const columns = (story.columns || [])
      .map((tag) => results.elementColumn(GLOBAL_ENVELOPE, tag, component))
      .filter((i) => i >= 0);
    if (!columns.length) continue;

    // Each column contributes its own worst case. They do not all peak at the
    // same instant, so this is an upper bound on the story shear rather than a
    // simultaneous total — which is what a member-by-member check wants.
    let total = 0;
    for (const c of columns) total += Math.abs(signedExtreme(rows, c));
    out.push({ level: story.level, z: story.z, peak: total, count: columns.length });
  }
  return out.length ? out : null;
}

/** Total horizontal reaction at the supports, per step, as a positive force. */
export function baseShear(results, dof) {
  if (!results.has(REACTION)) return null;

  const rows = results.series[REACTION].rows;
  const columns = results.supports
    .map((tag) => results.nodeColumn(REACTION, tag, dof))
    .filter((i) => i >= 0);
  if (!columns.length) return null;

  const values = new Float64Array(rows.length);
  for (let s = 0; s < rows.length; s++) {
    let total = 0;
    for (const c of columns) total += rows[s][c];
    values[s] = -total;
  }
  return values;
}

/* ────────────────────────────── envelopes ───────────────────────────── */

/** The largest magnitude each story reaches over the whole analysis. */
export function envelope(series) {
  if (!series) return null;
  return series.map((story) => {
    let peak = 0;
    let at = 0;
    for (let s = 0; s < story.values.length; s++) {
      const v = Math.abs(story.values[s]);
      if (v > peak) { peak = v; at = s; }
    }
    return { ...story, peak, at, signed: story.values[at] || 0 };
  });
}

/* ───────────────────────────── member forces ────────────────────────── */

/** The six local components at both ends of one member, over the analysis. */
const LOCAL_COMPONENTS = ['N', 'Vy', 'Vz', 'T', 'My', 'Mz'];

/**
 * The envelope of the local end forces of one member: `{ i: {...}, j: {...} }`
 * carrying the six components at each end, each one at its signed extreme over
 * the whole analysis. Null when the member was not recorded.
 */
export function memberForces(results, tag) {
  if (!results.has(LOCAL_ENVELOPE)) return null;

  const rows = results.series[LOCAL_ENVELOPE].rows;
  if (rows.length < 2) return null;

  const read = (suffix) => {
    const end = {};
    for (const component of LOCAL_COMPONENTS) {
      const c = results.elementColumn(LOCAL_ENVELOPE, tag, `${component}_${suffix}`);
      if (c < 0) return null;
      end[component] = signedExtreme(rows, c);
    }
    return end;
  };

  const i = read('i');
  const j = read('j');
  return i && j ? { i, j } : null;
}

/**
 * Peak magnitude of one local component over every recorded member, used to
 * scale diagrams so that members can be compared against each other.
 */
export function memberPeak(results, component) {
  if (!results.has(LOCAL_ENVELOPE)) return 0;

  const spec = results.series[LOCAL_ENVELOPE];
  let peak = 0;
  spec.columns.forEach((col, c) => {
    if (!col.component || !col.component.startsWith(`${component}_`)) return;
    for (const row of spec.rows) {
      const v = Math.abs(row[c]);
      if (v > peak) peak = v;
    }
  });
  return peak;
}

/* ──────────────────────────── analysis cases ────────────────────────── */

/** Roof displacement / base shear pairs from a pushover or cyclic run. */
export function capacityCurve(results, file) {
  if (!results.has(file)) return null;
  const spec = results.series[file];
  return spec.rows.map((r) => [r[0], r[1]]);
}

/** Iterations taken at each step, from whichever case recorded them. */
export function convergence(results) {
  if (results.has('convergence.out')) {
    const rows = results.series['convergence.out'].rows;
    return {
      label: 'Time history',
      xLabel: 'Time',
      points: rows.map((r) => [r[0], r[1]]),
      norms: rows.map((r) => [r[0], r[2]]),
    };
  }
  for (const file of ['pushover.out', 'cyclic.out']) {
    if (!results.has(file)) continue;
    const rows = results.series[file].rows;
    return {
      label: file === 'pushover.out' ? 'Pushover' : 'Cyclic',
      xLabel: 'Step',
      points: rows.map((r, i) => [i + 1, r[2]]),
      norms: null,
    };
  }
  return null;
}

/** Displacement of one node over the analysis, for a trace. */
export function nodeTrace(results, tag, dof) {
  const c = results.nodeColumn(DISP, tag, dof);
  if (c < 0) return null;
  return { time: results.time(DISP), values: results.column(DISP, c) };
}

/** The topmost node of the model, used as the default trace and control point. */
export function roofNode(results) {
  const top = results.stories[results.stories.length - 1];
  if (!top || !top.nodes || !top.nodes.length) return null;
  return top.nodes[0];
}
