/**
 * tests/units.mjs — a change of units changes the numbers, never the building.
 *
 * Switching the unit system has to carry every dimensional quantity across:
 * the spans, the sections, the materials, the loads — and the work done by
 * hand, which lives outside the form. Anything left behind keeps its number and
 * takes the new unit, so a joint moved 1000 mm comes out moved 1000 m.
 *
 * So one model, with hand edits, is walked through all three systems and back,
 * and at every stop the built model is read back in metres and kilonewtons and
 * held to the one it started as: every joint in the same place, the same total
 * gravity load, the same total mass. Then the store itself has to come back to
 * exactly what it was.
 *
 *   node tests/units.mjs
 */

globalThis.localStorage = {
  store: null,
  getItem() { return this.store; },
  setItem(key, value) { this.store = value; },
  removeItem() { this.store = null; },
};

const st = await import('../js/state.js');
const { buildModel } = await import('../js/model/builder.js');
const { unitFactor } = await import('../js/units.js');

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `   ${detail}` : ''}`);
  if (!ok) failures += 1;
}

// Each conversion rounds to ten significant figures, so three of them can leave
// a couple of parts in 1e9. A conversion error is off by a factor of 25 to 1000,
// so this is still six orders of magnitude tighter than anything that matters.
const TOLERANCE = 1e-8;
const close = (a, b) => Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));

/* A model nothing like the defaults, with hand edits of every kind — built on
   the N-mm defaults, so every field it does not name is a millimetre value too. */
Object.assign(st.state, st.defaultsFor('N-mm'), {
  unitSystem: 'N-mm',
  baysX: 3, baysY: 2, numStories: 3,
  spanX: '6000, 4500, 6000', spanY: '5000, 5500', storyHeight: '4200, 3200, 3200',
  colB: 450, colH: 550, beamB: 300, beamH: 600,
  deadFloor: 0.0055, liveFloor: 0.002,
  selfWeight: true, massSource: 'nodal',
  nodeOffsets: { 20001: [1000, 0, 0], 30006: [0, 250, -100] },
  elementOverrides: { 100001: { b: 400, h: 600 }, 201001: { h: 650, w: 14 } },
  deletedElements: {},
  addedElements: [],
});

/** The built model, read back in metres and kilonewtons. */
function physical() {
  const sys = st.state.unitSystem;
  const model = buildModel(st.state);
  if (!model.ok) throw new Error(`${sys}: ${model.errors[0]}`);
  const kL = unitFactor('length', sys, 'kN-m');
  const kF = unitFactor('force', sys, 'kN-m');
  const kM = unitFactor('mass', sys, 'kN-m');
  const joints = new Map(model.nodes.map((n) => [n.tag, [n.x * kL, n.y * kL, n.z * kL]]));
  const mass = model.nodes.reduce((a, n) => a + (n.mass || 0), 0) * kM;
  return { sys, joints, load: model.stats.totalGravityLoad * kF, mass, members: model.elements.length };
}

const start = physical();
const startState = JSON.parse(JSON.stringify(st.state));

console.log(`Units — one building through all three systems\n`);
console.log(`  start in ${start.sys}: ${start.joints.size} joints, ${start.members} members, `
  + `gravity ${start.load.toFixed(3)} kN, mass ${start.mass.toFixed(4)} t\n`);

for (const to of ['kN-m', 'kip-in', 'N-mm']) {
  st.setValue('unitSystem', to);
  const now = physical();

  let worst = 0;
  let moved = 0;
  for (const [tag, p] of start.joints) {
    const q = now.joints.get(tag);
    if (!q) { moved += 1; continue; }
    for (let i = 0; i < 3; i++) {
      if (!close(p[i], q[i])) moved += 1;
      worst = Math.max(worst, Math.abs(p[i] - q[i]));
    }
  }
  check(`${to}: every joint where it was`, moved === 0 && now.joints.size === start.joints.size,
    `${now.joints.size} joints, largest difference ${worst.toExponential(2)} m`);
  check(`${to}: same total gravity load`, close(now.load, start.load),
    `${now.load.toFixed(6)} kN against ${start.load.toFixed(6)}`);
  check(`${to}: same total mass`, close(now.mass, start.mass),
    `${now.mass.toFixed(6)} t against ${start.mass.toFixed(6)}`);
  check(`${to}: same number of members`, now.members === start.members, `${now.members}`);
}

/* Back where it began, the store itself must be what it was. */
const differs = [];
for (const [key, was] of Object.entries(startState)) {
  const is = st.state[key];
  const same = typeof was === 'number'
    ? close(was, is)
    : JSON.stringify(was) === JSON.stringify(is);
  if (!same) differs.push(`${key}: ${JSON.stringify(was)} → ${JSON.stringify(is)}`);
}
check('back in N-mm, every field is what it was', differs.length === 0,
  differs.length ? differs.slice(0, 4).join('; ') : `${Object.keys(startState).length} fields`);

/* And it stays put however often it is done: ten more trips round all three. */
for (let trip = 0; trip < 10; trip++) {
  for (const to of ['kip-in', 'kN-m', 'N-mm']) st.setValue('unitSystem', to);
}
const drifted = Object.entries(startState).filter(([key, was]) => (typeof was === 'number'
  ? !close(was, st.state[key])
  : JSON.stringify(was) !== JSON.stringify(st.state[key]))).map(([key]) => key);
check('ten more round trips, still every field what it was', drifted.length === 0,
  drifted.length ? drifted.slice(0, 4).join(', ') : `spanX ${JSON.stringify(st.state.spanX)}`);

console.log(failures ? `\n${failures} check${failures > 1 ? 's' : ''} failed.` : '\nThe building never moved.');
process.exit(failures ? 1 : 0);
