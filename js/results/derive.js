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

/** Node tags step by this much per level, which is what pairs a joint with the
 *  one directly beneath it. It matches `nodeTag` in the model builder. */
const LEVEL_STRIDE = 10000;

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
 * Story drift joint by joint, per step.
 *
 * `storyDrifts` above works on the average displacement of a floor, which is
 * the floor's rigid-body translation when the diaphragm is rigid and a fair
 * summary when it is not. It is not the whole story: a floor that twists has a
 * corner drifting further than the average, and averaging is exactly what hides
 * it. So each joint is paired with the joint directly beneath it and the drift
 * is worked out across that pair, which leaves the spread across the floor
 * visible.
 *
 * A node tag carries its level in its leading digits, so the joint one level
 * down is exactly 10000 less — and it is only used when that joint is really
 * there, which keeps a floor that does not sit over the one below it out of
 * the reckoning rather than pairing it with nothing.
 */
function pairedNodeDrifts(results, dof) {
  if (!results.has(DISP)) return null;

  const steps = results.steps(DISP);
  const rows = results.series[DISP].rows;
  const stories = results.stories;
  const out = [];

  for (let k = 1; k < stories.length; k++) {
    const upper = stories[k];
    const lower = stories[k - 1];
    const height = upper.height || (upper.z - lower.z);
    if (!(height > 0)) continue;

    const below = new Set(lower.nodes);
    const pairs = [];
    for (const tag of upper.nodes) {
      const under = tag - LEVEL_STRIDE;
      if (!below.has(under)) continue;
      const a = results.nodeColumn(DISP, tag, dof);
      const b = results.nodeColumn(DISP, under, dof);
      if (a >= 0 && b >= 0) pairs.push([a, b]);
    }
    if (!pairs.length) continue;

    const mean = new Float64Array(steps);
    const max = new Float64Array(steps);
    const min = new Float64Array(steps);
    for (let step = 0; step < steps; step++) {
      const row = rows[step];
      let total = 0;
      let hi = -Infinity;
      let lo = Infinity;
      for (const [a, b] of pairs) {
        const d = (row[a] - row[b]) / height;
        total += d;
        if (d > hi) hi = d;
        if (d < lo) lo = d;
      }
      mean[step] = total / pairs.length;
      max[step] = hi;
      min[step] = lo;
    }
    out.push({ level: upper.level, z: upper.z, height, joints: pairs.length, mean, max, min });
  }
  return out.length ? out : null;
}

/**
 * The largest drift any single joint of a story sees, per step, carrying its
 * sign. This is the one a drift limit has to be checked against: the average
 * can sit comfortably inside the limit while a corner is well past it.
 */
export function storyDriftsMax(results, dof) {
  const drifts = pairedNodeDrifts(results, dof);
  if (!drifts) return null;

  return drifts.map((story) => {
    const values = new Float64Array(story.mean.length);
    for (let s = 0; s < values.length; s++) {
      values[s] = Math.abs(story.max[s]) >= Math.abs(story.min[s]) ? story.max[s] : story.min[s];
    }
    return { level: story.level, z: story.z, height: story.height, joints: story.joints, values };
  });
}

/**
 * Torsional irregularity coefficient, per story and per step:
 *
 *     ηbi = (Δi)max / (Δi)ort
 *
 * the largest story drift over a floor divided by the average of them, which is
 * how TBDY 2018 §3.6.2.2 and ASCE 7-22 §12.8.4.3 both define it. Above 1.2 the
 * floor is torsionally irregular and the code has more to say about it.
 *
 * The ratio only means something while the floor is actually translating, and
 * two things can take that away. Within a history, a zero crossing leaves two
 * numbers on their way to zero whose quotient is noise, so the ratio is read
 * only where the average drift is at least a tenth of its own peak. Across a
 * whole direction, a frame pushed along X answers along Y with nothing but
 * round-off — an average drift of 1e-22 against a joint drift of 1e-6 — and
 * dividing one by the other gives 1e16 and means nothing at all. So a story
 * whose average drift never reaches a twentieth of its largest joint drift is
 * left out entirely: it is not translating, and there is no translation to
 * measure the twist against. That also puts a ceiling of about 20 on what can
 * be reported, which is far above the 1.2 the codes draw their line at and far
 * above anything a building would be built to.
 */
export function storyTorsion(results, dof) {
  const drifts = pairedNodeDrifts(results, dof);
  if (!drifts) return null;

  return drifts.map((story) => {
    const values = new Float64Array(story.mean.length);

    let peakMean = 0;
    let peakJoint = 0;
    for (let s = 0; s < values.length; s++) {
      peakMean = Math.max(peakMean, Math.abs(story.mean[s]));
      peakJoint = Math.max(peakJoint, Math.abs(story.max[s]), Math.abs(story.min[s]));
    }

    const translating = peakMean > 0 && peakMean >= peakJoint * 0.05;
    if (translating) {
      const floor = peakMean * 0.1;
      for (let s = 0; s < values.length; s++) {
        const mean = Math.abs(story.mean[s]);
        if (!(mean > floor)) continue;
        values[s] = Math.max(Math.abs(story.max[s]), Math.abs(story.min[s])) / mean;
      }
    }
    return { level: story.level, z: story.z, height: story.height, joints: story.joints, values };
  });
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
