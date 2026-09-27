/**
 * tests/generate.mjs — writes one OpenSeesPy script per model variant.
 *
 * The app's own modules are imported unchanged; only `localStorage` is stubbed,
 * because `js/state.js` reads it while it is being evaluated. What comes out is
 * exactly what the browser would produce for the same settings, so running these
 * scripts tests the shipped code generator rather than a copy of it.
 *
 *   node tests/generate.mjs [outDir]      default: tests/out
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ? process.argv[2] : join(here, 'out');

// `state.js` reads localStorage at module scope, so the stub goes in first.
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const { defaultsFor } = await import('../js/state.js');
const { buildModel } = await import('../js/model/builder.js');
const { generateScript } = await import('../js/codegen/openseespy.js');
const { CONCRETE_MODELS, STEEL_MODELS } = await import('../js/model/materials.js');
const {
  ISOLATOR_TYPES, DAMPER_TYPES, FRICTION_MODELS, ISOLATION_ENABLED, DAMPERS_ENABLED,
} = await import('../js/model/devices.js');

const base = defaultsFor('kN-m');

/* A small frame keeps every variant quick; the shapes under test are the
   commands the generator emits, not the size of the model. */
const small = { baysX: 2, baysY: 1, numStories: 2, spanX: '6.0', spanY: '5.0', storyHeight: '3.2' };

/** @type {{ name: string, patch: object }[]} */
const variants = [];
const add = (name, patch) => variants.push({ name, patch: { ...small, ...patch } });

/* ── the default model, in every unit system ─────────────────────────── */
add('default', {});
for (const unitSystem of ['kN-m', 'N-mm', 'kip-in']) {
  const d = defaultsFor(unitSystem);
  variants.push({
    name: `units-${unitSystem}`,
    patch: { ...d, ...small, unitSystem,
      spanX: d.spanX, spanY: d.spanY, storyHeight: d.storyHeight, gravityAccel: d.gravityAccel },
  });
}

/* ── section kinds ───────────────────────────────────────────────────── */
for (const sectionKind of ['Elastic', 'Fiber', 'NDFiber', 'RCCircularSection']) {
  add(`section-${sectionKind}`, { sectionKind });
}
add('section-aggregator', { sectionKind: 'Fiber', useAggregator: true });

/* ── every material model that is offered ────────────────────────────── */
// A withdrawn entry is not offered, so there is nothing of it to test.
const offered = (models) => Object.keys(models).filter((k) => !models[k].withdrawn);

for (const key of offered(CONCRETE_MODELS)) {
  add(`concrete-${key}`, { matSystem: 'rc', sectionKind: 'Fiber', concreteMat: key });
}
for (const key of offered(STEEL_MODELS)) {
  add(`steel-${key}`, { matSystem: 'rc', sectionKind: 'Fiber', steelMat: key });
}

/* ── elements, integration and transformations ───────────────────────── */
for (const element of ['elasticBeamColumn', 'forceBeamColumn', 'dispBeamColumn', 'elasticTimoshenkoBeam']) {
  add(`element-${element}`, { colElement: element, beamElement: element });
}
for (const transf of ['Linear', 'PDelta', 'Corotational']) {
  add(`transf-${transf}`, { colTransf: transf, beamTransf: transf });
}

/* ── isolators, friction models and dampers ──────────────────────────── */
// Base isolation is switched off for now (see ISOLATION_ENABLED); its variants
// come back with it rather than testing a layer the model no longer builds.
if (ISOLATION_ENABLED) {
  for (const isolatorType of offered(ISOLATOR_TYPES)) {
    add(`isolator-${isolatorType}`, { useIsolation: true, isolatorType, useRecorders: true });
  }
  for (const frictionType of offered(FRICTION_MODELS)) {
    add(`friction-${frictionType}`, { useIsolation: true, isolatorType: 'singleFPBearing', frictionType });
  }
}
// Dampers are switched off in the same way (see DAMPERS_ENABLED).
if (DAMPERS_ENABLED) {
  for (const damperType of offered(DAMPER_TYPES)) {
    add(`damper-${damperType}`, { useDampers: true, damperType });
  }
  for (const damperConfig of ['diagonal', 'chevron']) {
    add(`damper-config-${damperConfig}`, { useDampers: true, damperConfig });
  }
}
if (ISOLATION_ENABLED && DAMPERS_ENABLED) {
  add('isolation-and-dampers', { useIsolation: true, useDampers: true, useRecorders: true });
}
if (ISOLATION_ENABLED) {
  add('isolation-partial', { useIsolation: true, isolatorPlacement: 'perimeter', useRecorders: true });
}

/* ── time history ─────────────────────────────────────────────────────
   None of the variants above ran one, so the whole path — the record, the
   Rayleigh anchor, the integrators — had never met a real openseespy. The
   runner puts a synthetic record named ground_motion.txt beside every script;
   gmDt matches it. */
const TH = { runTimeHistory: true, useRecorders: true, gmDt: 0.01 };
for (const thIntegrator of ['Newmark', 'HHT', 'GeneralizedAlpha', 'TRBDF2']) {
  add(`time-history-${thIntegrator}`, { ...TH, thIntegrator });
}
if (DAMPERS_ENABLED) add('time-history-dampers', { ...TH, useDampers: true });
add('time-history-after-pushover', { ...TH, runPushover: true });
// Without gravity the modal step's eigen call left an analysis behind, and the
// time history's own eigen call then found no eigen solver on it.
add('time-history-no-gravity', { ...TH, runGravity: false });

/* ── rigid diaphragms under displacement control ─────────────────────
   The control joint used to be one tied to the floor master, which the
   Transformation handler takes out of the equations. tests/analyses.py holds
   both lateral cases to reaching their targets. */
add('diaphragm-pushover-cyclic', { rigidDiaphragm: true, runPushover: true, runCyclic: true, useRecorders: true });
add('diaphragm-pushover-corner', { rigidDiaphragm: true, runPushover: true, pushNode: 'corner', useRecorders: true });

/* ── the modal load pattern ──────────────────────────────────────────
   The frame is weaker along Y, so its first mode is a Y translation. The
   pattern used to follow mode 1 whatever the push direction, and pushing along
   X it put almost no load on anything. */
add('pushover-dominant-mode', { runPushover: true, pushShape: 'modal', useRecorders: true });
add('cyclic-dominant-mode-no-gravity', { runGravity: false, runCyclic: true, cycShape: 'modal', useRecorders: true });

/* ── options that used to point at things that were never built ────── */
// An elastic section never had an aggregator, but members pointed at one.
add('section-elastic-aggregator', { sectionKind: 'Elastic', useAggregator: true });

/* ── the solver stack ────────────────────────────────────────────────── */
for (const systemCmd of ['BandGeneral', 'BandSPD', 'ProfileSPD', 'SuperLU', 'UmfPack',
                         'FullGeneral', 'SparseSYM', 'PythonSparse']) {
  add(`system-${systemCmd}`, { systemCmd });
}
for (const constraintsCmd of ['Plain', 'Transformation', 'Penalty', 'Lagrange']) {
  add(`constraints-${constraintsCmd}`, { constraintsCmd });
}
for (const numbererCmd of ['Plain', 'RCM', 'AMD']) {
  add(`numberer-${numbererCmd}`, { numbererCmd });
}
for (const algorithmCmd of ['Linear', 'Newton', 'ModifiedNewton', 'KrylovNewton', 'BFGS', 'Broyden']) {
  add(`algorithm-${algorithmCmd}`, { algorithmCmd });
}

/* ── floor slabs ─────────────────────────────────────────────────────── */
for (const slabElement of ['ShellMITC4', 'ShellDKGQ', 'ShellNLDKGQ']) {
  add(`slab-${slabElement}`, { useSlabs: true, slabElement, runModal: true });
}
add('slab-mass-from-shell', { useSlabs: true, slabMassSource: 'shell', runModal: true });
add('slab-and-diaphragm', { useSlabs: true, rigidDiaphragm: true, runModal: true });
if (ISOLATION_ENABLED) add('slab-and-isolation', { useSlabs: true, useIsolation: true, useRecorders: true });

/* ── analysis cases ──────────────────────────────────────────────────── */
add('modal', { runModal: true });
add('pushover', { runPushover: true });
add('cyclic', { runCyclic: true });
// Two lateral cases on one domain. Nothing of the pushover may reach the
// cyclic run — not the displacement it ended on, not its load pattern — so
// this is the variant that exercises reset_to_gravity against real openseespy.
add('pushover-then-cyclic', { runPushover: true, runCyclic: true });
add('recorders', { useRecorders: true });
add('diaphragm', { rigidDiaphragm: true });
add('no-gravity', { runGravity: false });

/* ── overrides: moved joints and edited members ──────────────────────── */
add('moved-joints', { nodeOffsets: { 20001: [0.4, 0, 0], 20002: [0, 0.3, -0.1] } });
// A whole column line shifted in plan, base included, so every column stays
// plumb and every beam stays level. The panels it touches are no longer
// rectangles, which is the arithmetic under test, and nothing tilts — so the
// statics check can hold this one to full tolerance.
add('moved-column-line', { nodeOffsets: { 10001: [0.4, 0, 0], 20001: [0.4, 0, 0], 30001: [0.4, 0, 0] } });
add('edited-members', { elementOverrides: { 101001: { b: 0.5, h: 0.7 }, 201001: { h: 0.65, w: 12 } } });
// Members set on an insertion point other than the centroid: the joints stay
// put and each member is carried off its line by a rigid end offset, so this
// covers the '-jntOffset' transformations and the tags that point at them.
add('insertion-points', {
  elementOverrides: {
    100001: { insertion: 'middleRight' },
    101001: { insertion: 'middleRight' },
    201001: { insertion: 'topCentre' },
  },
});
add('moved-and-edited', {
  nodeOffsets: { 20001: [0.25, 0, 0] },
  elementOverrides: { 101001: { b: 0.45 } },
});

/* ─────────────────────────────── write ──────────────────────────────── */

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const manifest = [];
let failed = 0;

for (const { name, patch } of variants) {
  const s = { ...base, ...patch, projectName: name };
  const model = buildModel(s);
  if (!model.ok) {
    console.error(`  ${name}: ${model.errors[0]}`);
    failed += 1;
    continue;
  }
  const file = `${name.replace(/[^a-zA-Z0-9._-]+/g, '_')}.py`;
  writeFileSync(join(outDir, file), generateScript(s, model, null), 'utf8');
  manifest.push({
    name, file,
    nodes: model.stats.nodes,
    elements: model.stats.elements,
    // What the statics check compares the recorded base reactions against.
    gravityLoad: model.stats.totalGravityLoad,
    unitSystem: s.unitSystem,
  });
}

writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`${manifest.length} scripts written to ${outDir}`);
if (failed) {
  console.error(`${failed} variant(s) could not be built.`);
  process.exit(1);
}
