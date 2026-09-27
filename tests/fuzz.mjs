/**
 * tests/fuzz.mjs — every option at once.
 *
 * The variants in generate.mjs change one option at a time from the defaults,
 * and that is exactly why they could not see the defects that live between
 * options: a chevron that unloads half its beam, a gravity integrator that
 * stops at ten times the load, a torsion switch that is fatal only on a fiber
 * section. Here every select and every toggle is drawn at random, together,
 * from a seeded generator — so a failure is always reproducible from its seed
 * and number — and each model is validated, built and written out for
 * tests/fuzz.py to run.
 *
 *   node tests/fuzz.mjs [count] [seed]        defaults: 60, 7
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'out-fuzz');

const st = await import('../js/state.js');
const { allFields } = await import('../js/schema.js');
const { buildModel } = await import('../js/model/builder.js');
const { generateScript } = await import('../js/codegen/openseespy.js');
const { unitFactor } = await import('../js/units.js');

const COUNT = Number(process.argv[2] || 60);
const SEED = Number(process.argv[3] || 7);

/** mulberry32: small, seeded, and even enough to spread the choices. */
function generator(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = generator(SEED);
const pick = (list) => list[Math.floor(rand() * list.length)];

const fields = allFields();
const selects = fields.filter((f) => f.type === 'select' && Array.isArray(f.options) && f.id !== 'unitSystem');
const checks = fields.filter((f) => f.type === 'check');

// The expensive analyses are drawn less often, so a run of the suite stays in
// minutes; every other toggle is a fair coin.
const CHANCE = {
  runGravity: 0.92, runModal: 0.7, runPushover: 0.3, runCyclic: 0.25, runTimeHistory: 0.3,
  useRecorders: 0.9,
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const manifest = [];
const tally = { generated: 0, rejected: 0, crashed: 0 };

for (let i = 1; i <= COUNT; i++) {
  const unit = pick(['kN-m', 'N-mm', 'kip-in']);
  const s = st.defaultsFor(unit);
  const k = unitFactor('length', 'kN-m', unit);
  const len = (m) => String(Number((m * k).toPrecision(10)));
  Object.assign(s, { baysX: 2, baysY: 1, numStories: 2, spanX: len(6), spanY: len(5), storyHeight: len(3.2) });

  const choices = { unit };
  for (const f of selects) {
    s[f.id] = pick(f.options.map((o) => (typeof o === 'object' ? o.value : o)));
    if (!/^(mat|dev)\./.test(f.id)) choices[f.id] = s[f.id];
  }
  for (const f of checks) {
    s[f.id] = rand() < (CHANCE[f.id] ?? 0.5);
    choices[f.id] = s[f.id];
  }
  s.gmDt = 0.01;                       // the record fuzz.py writes is sampled at 0.01 s

  const name = `fz${String(i).padStart(4, '0')}`;
  const entry = { name, seed: SEED, choices };

  // A combination the validation turns away is a fine outcome — that is what
  // it is for — as long as it says why. A throw anywhere below is a defect.
  try {
    const check = st.validateState(s);
    if (!check.ok) {
      tally.rejected += 1;
      entry.outcome = 'rejected';
      entry.reason = Object.values(check.errors)[0];
      manifest.push(entry);
      continue;
    }
    const model = buildModel(s);
    if (!model.ok) {
      tally.rejected += 1;
      entry.outcome = 'rejected';
      entry.reason = model.errors[0];
      manifest.push(entry);
      continue;
    }
    writeFileSync(join(OUT, `${name}.py`), generateScript(s, model, null), 'utf8');
    tally.generated += 1;
    entry.outcome = 'generated';
    entry.gravityLoad = model.stats.totalGravityLoad;
  } catch (err) {
    tally.crashed += 1;
    entry.outcome = 'crashed';
    entry.reason = String(err && err.stack || err).split('\n').slice(0, 3).join(' | ');
  }
  manifest.push(entry);
}

writeFileSync(join(OUT, 'fuzz.json'), JSON.stringify(manifest, null, 1), 'utf8');
console.log(`seed ${SEED}: ${COUNT} combinations — ${tally.generated} generated, `
  + `${tally.rejected} rejected by validation, ${tally.crashed} crashed the generator`);
for (const e of manifest.filter((x) => x.outcome === 'crashed')) console.log(`  CRASH ${e.name}: ${e.reason}`);
process.exit(tally.crashed ? 1 : 0);
