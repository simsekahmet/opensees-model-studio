/**
 * tests/sample.mjs — writes the one script whose *results* are checked.
 *
 * `generate.mjs` covers breadth: does every option produce a script that runs.
 * This produces a single model that exercises every kind of result output —
 * gravity, modal, pushover and cyclic, with recorders on — so that
 * `results_check.mjs` has a real analysis to read back.
 *
 *   node tests/sample.mjs
 *   cd tests/sample && python sample.py
 *   node tests/results_check.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'sample');

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { defaultsFor } = await import('../js/state.js');
const { buildModel } = await import('../js/model/builder.js');
const { generateScript } = await import('../js/codegen/openseespy.js');

const s = {
  ...defaultsFor('kN-m'),
  projectName: 'Sample Frame',
  baysX: 2,
  baysY: 2,
  numStories: 3,
  runModal: true,
  runPushover: true,
  runCyclic: true,
  useRecorders: true,
};

const model = buildModel(s);
if (!model.ok) {
  console.error(model.errors[0]);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'sample.py'), generateScript(s, model, null), 'utf8');

console.log(`sample.py written to ${outDir} — `
  + `${model.stats.nodes} nodes, ${model.stats.elements} elements`);
