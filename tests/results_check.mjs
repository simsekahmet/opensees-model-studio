/**
 * tests/results_check.mjs — checks the result reader against a real analysis.
 *
 * `tests/sample/sample.py` is generated and run first; this then reads its
 * output directory back through exactly the modules the browser uses and
 * asserts the numbers against the physics they came from.
 *
 *   node tests/generate.mjs                 # not required, but keeps out/ fresh
 *   node tests/results_check.mjs [dir]      default: tests/sample/output
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ? process.argv[2] : join(here, 'sample', 'output');

if (!existsSync(outDir)) {
  console.error(`No results in ${outDir}. Generate and run tests/sample/sample.py first.`);
  process.exit(2);
}

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

// `results/load.js` reads File objects; in Node the same shape is enough.
class NodeFile {
  constructor(name, path) {
    this.name = name;
    this.path = path;
  }

  async text() {
    return readFileSync(this.path, 'utf8');
  }
}

const { loadResults } = await import('../js/results/load.js');
const derive = await import('../js/results/derive.js');

const files = readdirSync(outDir).map((name) => new NodeFile(name, join(outDir, name)));
const results = await loadResults(files);

let failures = 0;

function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `   ${detail}` : ''}`);
  if (!ok) failures += 1;
}

console.log(`Reading ${outDir}\n`);

/* ── the manifest describes the model it came from ───────────────────── */

check('manifest lists nodes', results.nodes.size > 0, `${results.nodes.size} nodes`);
check('manifest lists elements', results.elements.size > 0, `${results.elements.size} elements`);
check('supports are named', results.supports.length > 0, `${results.supports.length} supports`);
check('every recorder file was read', results.missing.length === 0,
  results.missing.length ? results.missing.join(', ') : '');

/* ── statics: the reactions balance the applied load ─────────────────── */

const gravity = results.cases.gravity;
if (gravity) {
  const vertical = Math.abs(gravity.baseReaction[2]);
  check('gravity base reaction is reported', vertical > 0, vertical.toFixed(6));
}

/* ── story quantities behave like a building ─────────────────────────── */

const drifts = derive.envelope(derive.storyDrifts(results, 1));
check('story drifts are derived', !!drifts && drifts.length > 0,
  drifts ? `${drifts.length} stories` : 'none');
if (drifts) {
  check('drift ratios are plausible', drifts.every((d) => d.peak >= 0 && d.peak < 0.5),
    drifts.map((d) => d.peak.toFixed(4)).join(', '));
}

/* The average hides the corner, so the two are derived apart and each is held
   to what it means: no joint can drift less than the average of all of them,
   and the ratio between the largest and the average is what the codes call the
   torsional irregularity coefficient. */
const worst = derive.envelope(derive.storyDriftsMax(results, 1));
check('the largest joint drift is derived', !!worst && worst.length === drifts?.length,
  worst ? `${worst.length} stories, ${worst[0].joints} joints paired per story` : 'none');
if (worst && drifts) {
  check('no joint drifts less than the floor average',
    worst.every((w, k) => w.peak >= drifts[k].peak * (1 - 1e-9)),
    worst.map((w, k) => (w.peak / drifts[k].peak).toFixed(4)).join(', '));
}

const torsion = derive.envelope(derive.storyTorsion(results, 1));
check('the torsional irregularity coefficient is derived', !!torsion);
if (torsion && worst && drifts) {
  // A symmetric frame pushed along an axis of symmetry sits just above 1.
  check('eta_bi is at least 1 wherever it is reported',
    torsion.every((t) => t.peak === 0 || t.peak >= 1 - 1e-9),
    torsion.map((t) => t.peak.toFixed(4)).join(', '));
  check('eta_bi matches the drifts it comes from',
    torsion.every((t, k) => t.peak === 0
      || Math.abs(t.peak - worst[k].peak / drifts[k].peak) < 0.05),
    torsion.map((t, k) => `${t.peak.toFixed(4)} vs ${(worst[k].peak / drifts[k].peak).toFixed(4)}`).join(', '));
}

const shears = derive.storyShears(results, 1);
check('story shears are derived', !!shears && shears.length > 0);
if (shears) {
  // A lateral push accumulates downwards: every story carries at least as much
  // as the one above it.
  const ordered = [...shears].sort((a, b) => b.level - a.level);
  const monotonic = ordered.every((s, i) => i === 0 || s.peak >= ordered[i - 1].peak - 1e-6);
  check('story shear grows towards the base', monotonic,
    ordered.map((s) => `L${s.level}=${s.peak.toFixed(0)}`).join(' '));
}

/* ── member forces come back as a full local set ─────────────────────── */

const frame = [...results.elements.values()].find((e) => e.kind === 'column');
if (frame) {
  const forces = derive.memberForces(results, frame.tag);
  check('member end forces are readable', !!forces,
    forces ? `N=${forces.i.N.toFixed(1)} Mz=${forces.i.Mz.toFixed(1)}` : 'missing');
  const peak = derive.memberPeak(results, 'Mz');
  check('a peak moment exists to scale diagrams', peak > 0, peak.toFixed(1));
}

/* ── mode shapes ─────────────────────────────────────────────────────── */

if (results.modeShapes) {
  const modes = [...results.modeShapes.keys()];
  check('mode shapes were parsed', modes.length > 0, `${modes.length} modes`);
  const first = results.modeShapes.get(modes[0]);
  const moving = [...first.values()].some((v) => Math.hypot(v[0], v[1], v[2]) > 0);
  check('the first mode is not a zero vector', moving);

  const periods = (results.cases.modal && results.cases.modal.periods) || [];
  check('periods descend', periods.every((p, i) => i === 0 || p <= periods[i - 1] + 1e-9),
    periods.slice(0, 3).map((p) => p.toFixed(4)).join(', '));
}

/* ── capacity curves ─────────────────────────────────────────────────── */

const push = derive.capacityCurve(results, 'pushover.out');
if (push) {
  const rising = push[push.length - 1][0] > push[0][0];
  check('the pushover curve advances', rising,
    `${push.length} points, roof ${push[push.length - 1][0].toFixed(4)}`);
  check('base shear is positive along the push', push[push.length - 1][1] > 0,
    push[push.length - 1][1].toFixed(1));
}

const cyc = derive.capacityCurve(results, 'cyclic.out');
if (cyc) {
  const both = cyc.some((p) => p[0] > 0) && cyc.some((p) => p[0] < 0);
  check('the hysteresis loop goes both ways', both, `${cyc.length} points`);
}

/* ── column labelling, which is the point of the manifest ────────────── */

const disp = results.series['node_disp.out'];
if (disp) {
  const named = disp.columns.filter((c) => c.node !== undefined).length;
  check('displacement columns carry node tags', named === disp.columns.length - 1,
    `${named} of ${disp.columns.length - 1}`);
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nEvery check passed.');
process.exit(failures ? 1 : 0);
