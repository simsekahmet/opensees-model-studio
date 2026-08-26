/**
 * tests/roundtrip.mjs — a model must survive the trip out and back.
 *
 * The generated script, the notebook and the project file all carry the model
 * definition, which is what `Load model file` reads. If any of them loses a
 * field, someone reopens their model and finds a different building — so every
 * format is round-tripped here and compared field by field.
 *
 *   node tests/roundtrip.mjs
 */

globalThis.localStorage = {
  store: null,
  getItem() { return this.store; },
  setItem(key, value) { this.store = value; },
  removeItem() { this.store = null; },
};

const st = await import('../js/state.js');
const { buildModel } = await import('../js/model/builder.js');
const { generateScript } = await import('../js/codegen/openseespy.js');
const { toNotebook } = await import('../js/codegen/notebook.js');

let failures = 0;

function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `   ${detail}` : ''}`);
  if (!ok) failures += 1;
}

/* A model that is nothing like the defaults, including work done by hand. */
const CHANGES = {
  projectName: 'Round Trip',
  unitSystem: 'kN-m',
  baysX: 5,
  baysY: 3,
  numStories: 6,
  spanX: '6, 7.5, 6, 7.5, 6',
  storyHeight: '4.2, 3.2, 3.2, 3.2, 3.2, 3.0',
  matSystem: 'rc',
  concreteMat: 'Concrete04',
  steelMat: 'Steel02',
  sectionKind: 'Fiber',
  colShape: 'Circular',
  colD: 0.72,
  beamB: 0.35,
  beamH: 0.62,
  useIsolation: true,
  isolatorType: 'LeadRubberX',
  useDampers: true,
  damperType: 'ViscousDamper',
  runModal: true,
  runPushover: true,
  numModes: 12,
  tol: 1e-7,
  systemCmd: 'UmfPack',
};

for (const [key, value] of Object.entries(CHANGES)) st.setValue(key, value);
st.moveNodes([20001], [0.35, 0, 0]);
st.setElementOverrides([100001], { D: 0.9 });

const model = buildModel(st.state);
if (!model.ok) {
  console.error(model.errors[0]);
  process.exit(1);
}

st.deleteElements([model.elements.find((e) => e.kind === 'beamX').tag]);
const rebuilt = buildModel(st.state);
st.replicate([rebuilt.elements.find((e) => e.kind === 'column')], [0, 0, 3.2], 2);

const built = buildModel(st.state);
const script = generateScript(st.state, built, null);
const formats = {
  script,
  notebook: toNotebook(script, { title: 'Round Trip' }),
  project: st.exportProject(),
};

const expected = JSON.parse(JSON.stringify(st.state));

console.log('Round-tripping a model with hand edits through every format\n');

for (const [name, text] of Object.entries(formats)) {
  st.resetAll();
  check(`${name}: reset really cleared it`, st.state.baysX !== expected.baysX);

  let info;
  try {
    info = st.importProject(text);
  } catch (err) {
    check(`${name}: loads`, false, err.message);
    continue;
  }

  const differing = Object.keys(expected).filter(
    (key) => JSON.stringify(st.state[key]) !== JSON.stringify(expected[key])
  );
  check(`${name}: every field came back`, differing.length === 0,
    differing.length ? `differs: ${differing.slice(0, 6).join(', ')}` : `written by ${info.version}`);

  const again = buildModel(st.state);
  check(`${name}: rebuilds to the same model`,
    again.ok && again.stats.elements === built.stats.elements && again.stats.nodes === built.stats.nodes,
    `${again.stats.nodes} nodes, ${again.stats.elements} elements`);
}

/* A script that was not written here has to say so, not load half a model. */
st.resetAll();
try {
  st.importProject('import openseespy.opensees as ops\nops.node(1, 0.0, 0.0, 0.0)\n');
  check('a foreign script is refused', false, 'it was accepted');
} catch (err) {
  check('a foreign script is refused', /no model definition/.test(err.message));
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nEvery format round-trips.');
process.exit(failures ? 1 : 0);
