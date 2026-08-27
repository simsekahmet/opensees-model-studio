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
const { ISOLATOR_TYPES, DAMPER_TYPES, FRICTION_MODELS } = await import('../js/model/devices.js');

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
for (const key of Object.keys(CONCRETE_MODELS)) {
  add(`concrete-${key}`, { matSystem: 'rc', sectionKind: 'Fiber', concreteMat: key });
}
for (const key of Object.keys(STEEL_MODELS)) {
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
for (const isolatorType of Object.keys(ISOLATOR_TYPES)) {
  add(`isolator-${isolatorType}`, { useIsolation: true, isolatorType, useRecorders: true });
}
for (const frictionType of Object.keys(FRICTION_MODELS)) {
  add(`friction-${frictionType}`, { useIsolation: true, isolatorType: 'singleFPBearing', frictionType });
}
for (const damperType of Object.keys(DAMPER_TYPES)) {
  add(`damper-${damperType}`, { useDampers: true, damperType });
}
for (const damperConfig of ['diagonal', 'chevron']) {
  add(`damper-config-${damperConfig}`, { useDampers: true, damperConfig });
}
add('isolation-and-dampers', { useIsolation: true, useDampers: true, useRecorders: true });
add('isolation-partial', { useIsolation: true, isolatorPlacement: 'perimeter', useRecorders: true });

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
add('slab-and-isolation', { useSlabs: true, useIsolation: true, useRecorders: true });

/* ── analysis cases ──────────────────────────────────────────────────── */
add('modal', { runModal: true });
add('pushover', { runPushover: true });
add('cyclic', { runCyclic: true });
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
