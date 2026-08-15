/**
 * codegen/openseespy.js — emits a runnable OpenSeesPy script.
 *
 * The script is written parametrically (grids and loops rather than thousands
 * of literal `ops.node` calls) and reproduces exactly the tags, sections,
 * loads and masses that `model/builder.js` produced for the viewer.
 */

import { unitsOf } from '../units.js';
import {
  CONCRETE_MODELS, STEEL_MODELS, materialArgs, constName, matKey,
} from '../model/materials.js';
import { scriptFileName } from '../model/groundmotion.js';
import {
  ISOLATOR_TYPES, DAMPER_TYPES, FRICTION_MODELS, devKey, devConst,
} from '../model/devices.js';

/* Fixed tag constants, mirrored in the generated script. */
const T = {
  matCore: 1, matCover: 2, matSteel: 3,
  secCol: 1, secBeamX: 2, secBeamY: 3,
  intCol: 1, intBeamX: 2, intBeamY: 3,
  transfCol: 1, transfBeamX: 2, transfBeamY: 3,
};

const ELEMENT_NAME = {
  elasticBeamColumn: 'elasticBeamColumn',
  forceBeamColumn: 'forceBeamColumn',
  dispBeamColumn: 'dispBeamColumn',
  elasticTimoshenkoBeam: 'ElasticTimoshenkoBeam',
};

const usesSection = (name) => name === 'forceBeamColumn' || name === 'dispBeamColumn';

export function generateScript(s, model, gm = null) {
  const u = unitsOf(s.unitSystem);
  const L = [];
  const w = (...lines) => L.push(...lines);
  const rule = (title) => w(
    '',
    `# ${'═'.repeat(72)}`,
    `#  ${title}`,
    `# ${'═'.repeat(72)}`,
    ''
  );

  const { column, beamX, beamY, shared } = model.sections;
  const fiber = s.sectionKind === 'Fiber';
  const steelSystem = s.matSystem === 'steel';
  const isolated = !!s.useIsolation;
  const chevron = !!s.useDampers && s.damperConfig === 'chevron';
  const isoH = isolated ? Number(s.isolatorHeight) || 0 : 0;

  /* ─────────────────────────────── header ──────────────────────────── */
  w(
    '"""',
    `${s.projectName || 'Frame Model'}`,
    '',
    `${model.grid.nx}×${model.grid.ny} bay, ${model.grid.nz}-story space frame.`,
    `${model.stats.nodes} nodes · ${model.stats.elements} elements · ${model.stats.dof} DOF.`,
    '',
    `Units       : ${u.force}, ${u.length} (stress in ${u.stress})`,
    `Sections    : ${s.sectionKind}`,
    `Generated   : ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
    '',
    'Global axes',
    '    X, Y  horizontal in plan; Z  vertical, positive upwards.',
    '    The origin (0, 0, 0) is the first base grid point, node 10001.',
    '    Gravity therefore acts along -Z.',
    '',
    'Element local axes (set by the geomTransf vecxz values in section 6)',
    '    local x  along the member, from node i to node j',
    '    local y  section depth h;  local z  section width b',
    '    columns      x = +Z,  y = -Y,  z = +X',
    '    beams  X     x = +X,  y = +Z,  z = -Y',
    '    beams  Y     x = +Y,  y = +Z,  z = +X',
    '',
    'Run with:  python model.py',
    '"""',
    '',
    'import math',
    'import os',
    '',
    'import openseespy.opensees as ops',
    ''
  );

  /* ───────────────────────────── parameters ────────────────────────── */
  rule('1 — Parameters');

  w(
    '# Geometry',
    `BAY_X   = [${model.grid.spansX.map(pf).join(', ')}]  # bay widths along X  [${u.length}]`,
    `BAY_Y   = [${model.grid.spansY.map(pf).join(', ')}]  # bay widths along Y  [${u.length}]`,
    `STORY_H = [${model.grid.heights.map(pf).join(', ')}]  # story heights       [${u.length}]`,
    '',
    'N_X, N_Y, N_Z = len(BAY_X), len(BAY_Y), len(STORY_H)',
    'NX_N, NY_N = N_X + 1, N_Y + 1',
    '',
    `G_ACC = ${pf(s.gravityAccel)}  # gravitational acceleration [${u.accel}]`,
    `RHO   = ${pf(s.density)}  # mass density [${u.massVol}]`,
    `NU    = ${pf(s.nu)}  # Poisson ratio`,
    ...(isolated ? [`ISO_H = ${pf(isoH)}  # bearing height [${u.length}]`] : []),
    ''
  );

  w(
    '# Section properties',
    `E_MOD = ${pf(column.E)}  # ${steelSystem ? 'steel' : 'concrete'} elastic modulus`,
    'G_MOD = E_MOD / (2.0 * (1.0 + NU))',
    ''
  );
  emitSectionConsts(w, 'COL', column, u, fiber);
  emitSectionConsts(w, 'BX', beamX, u, fiber);
  if (!shared) emitSectionConsts(w, 'BY', beamY, u, fiber);

  w(
    '# Loads',
    `DEAD_FLOOR = ${pf(s.deadFloor)}  # [${u.areaLoad}]`,
    `LIVE_FLOOR = ${pf(s.liveFloor)}`,
    `DEAD_ROOF  = ${pf(s.deadRoof)}`,
    `LIVE_ROOF  = ${pf(s.liveRoof)}`,
    `DL_FACTOR  = ${pf(s.dlFactor)}`,
    `LL_FACTOR  = ${pf(s.llFactor)}`,
    `MASS_LIVE  = ${pf(s.massLiveFactor)}  # live load participating in seismic mass`,
    `LOAD_DIST  = ${py(s.loadDistribution)}`,
    ''
  );

  w(
    '# Analysis',
    `TOL       = ${pf(s.tol)}`,
    `MAX_ITER  = ${pi(s.maxIter)}`,
    `N_STEPS   = ${pi(s.gravitySteps)}`,
    `N_MODES   = ${pi(s.numModes)}`,
    `OUT_DIR   = ${py(s.recorderDir || 'output')}`,
    ''
  );

  /* ────────────────────────────── helpers ──────────────────────────── */
  rule('2 — Grid and tag helpers');
  w(
    'def cumulative(spans):',
    '    """Running coordinates of a list of spans, starting at zero."""',
    '    out = [0.0]',
    '    for span in spans:',
    '        out.append(out[-1] + span)',
    '    return out',
    '',
    '',
    'X = cumulative(BAY_X)',
    'Y = cumulative(BAY_Y)',
    isolated
      ? 'Z = [z + ISO_H for z in cumulative(STORY_H)]  # lifted by the bearing height'
      : 'Z = cumulative(STORY_H)',
    '',
    '',
    'def node_tag(level, i, j):',
    '    """Grid node: leading digits carry the level, so tags stay readable."""',
    '    return (level + 1) * 10000 + j * NX_N + i + 1',
    '',
    '',
    'def master_tag(level):',
    '    return (level + 1) * 10000 + 9999',
    '',
    '',
    'def col_tag(story, i, j):',
    '    """Column of story `story` (0 = ground story) at grid point (i, j)."""',
    '    return 100000 + story * 1000 + j * NX_N + i + 1',
    '',
    '',
    'def beam_x_tag(level, i, j):',
    '    return 200000 + level * 1000 + j * N_X + i + 1',
    '',
    '',
    'def beam_y_tag(level, i, j):',
    '    return 300000 + level * 1000 + j * NX_N + i + 1',
    ''
  );
  if (s.useIsolation) {
    w(
      '',
      'def foundation_tag(i, j):',
      '    """Node under a bearing, numbered below the grid."""',
      '    return j * NX_N + i + 1',
      '',
      '',
      'def isolator_tag(i, j):',
      '    return 400000 + j * NX_N + i + 1',
      ''
    );
  }
  if (chevron) {
    w(
      '',
      'def mid_x_tag(level, i, j):',
      '    """Midspan node of an X beam split by a chevron."""',
      '    return (level + 1) * 10000 + 5000 + j * N_X + i + 1',
      '',
      '',
      'def mid_y_tag(level, i, j):',
      '    return (level + 1) * 10000 + 7000 + j * NX_N + i + 1',
      ''
    );
  }

  /* ─────────────────────────────── model ───────────────────────────── */
  rule('3 — Model space, nodes and restraints');
  const moves = Object.entries(s.nodeOffsets || {})
    .filter(([, d]) => d && (d[0] || d[1] || d[2]));

  w(
    'ops.wipe()',
    "ops.model('basic', '-ndm', 3, '-ndf', 6)",
    ''
  );

  if (moves.length) {
    w(
      '# Joints moved off the grid, as a displacement in global coordinates.',
      '# Every element touching one of these follows it, because element ends',
      '# are read from the node coordinates.',
      'NODE_MOVES = {',
      ...moves.map(([tag, d]) => `    ${tag}: (${pf(d[0])}, ${pf(d[1])}, ${pf(d[2])}),`),
      '}',
      '',
      '',
      'def moved(tag, x, y, z):',
      '    dx, dy, dz = NODE_MOVES.get(tag, (0.0, 0.0, 0.0))',
      '    return x + dx, y + dy, z + dz',
      '',
      '',
      'for level in range(N_Z + 1):',
      '    for j in range(NY_N):',
      '        for i in range(NX_N):',
      '            tag = node_tag(level, i, j)',
      '            ops.node(tag, *moved(tag, X[i], Y[j], Z[level]))',
      ''
    );
  } else {
    w(
      'for level in range(N_Z + 1):',
      '    for j in range(NY_N):',
      '        for i in range(NX_N):',
      '            ops.node(node_tag(level, i, j), X[i], Y[j], Z[level])',
      ''
    );
  }

  const fix = { Fixed: '1, 1, 1, 1, 1, 1', Pinned: '1, 1, 1, 0, 0, 0', Roller: '0, 0, 1, 0, 0, 0' }[s.baseFixity];

  if (isolated) {
    w(
      '# Foundation nodes: the restraint sits below the bearings, and only the',
      '# column bases that carry one are lifted off the ground.',
      `HAS_BEARING = ${isolatorPredicate(s.isolatorPlacement)}`,
      '',
      'for j in range(NY_N):',
      '    for i in range(NX_N):',
      '        if HAS_BEARING(i, j):',
      moves.length
        ? '            ops.node(foundation_tag(i, j), *moved(foundation_tag(i, j), X[i], Y[j], 0.0))'
        : '            ops.node(foundation_tag(i, j), X[i], Y[j], 0.0)',
      `            ops.fix(foundation_tag(i, j), ${fix || '1, 1, 1, 1, 1, 1'})`,
      ...(fix ? [
        '        else:',
        `            ops.fix(node_tag(0, i, j), ${fix})`,
      ] : []),
      ''
    );
  } else if (fix) {
    w(
      `# Base restraint — ${s.baseFixity.toLowerCase()}`,
      'for j in range(NY_N):',
      '    for i in range(NX_N):',
      `        ops.fix(node_tag(0, i, j), ${fix})`,
      ''
    );
  } else {
    w('# Base is unrestrained (Free) — no ops.fix calls emitted.', '');
  }

  if (s.rigidDiaphragm) {
    w(
      '# Rigid floor diaphragms — a master node at each floor centroid',
      'X_C, Y_C = X[-1] / 2.0, Y[-1] / 2.0',
      'for level in range(1, N_Z + 1):',
      '    ops.node(master_tag(level), X_C, Y_C, Z[level])',
      s.restrainDiaphragmDofs
        ? '    ops.fix(master_tag(level), 0, 0, 1, 1, 1, 0)'
        : '    # master node left unrestrained',
      '    slaves = [node_tag(level, i, j) for j in range(NY_N) for i in range(NX_N)]',
      '    ops.rigidDiaphragm(3, master_tag(level), *slaves)',
      ''
    );
  }

  /* ────────────────────────────── materials ────────────────────────── */
  rule('4 — Materials');
  emitMaterials(w, s, fiber, steelSystem);

  /* ─────────────────────────────── sections ────────────────────────── */
  rule('5 — Sections');
  if (fiber) {
    emitFiberSection(w, s, column, T.secCol, 'COL', steelSystem);
    emitFiberSection(w, s, beamX, T.secBeamX, 'BX', steelSystem);
    if (!shared) emitFiberSection(w, s, beamY, T.secBeamY, 'BY', steelSystem);
  } else {
    w(
      '# Elastic sections. The Ig modifiers below account for cracking.',
      `ops.section('Elastic', ${T.secCol}, E_MOD, COL_A, COL_IZ, COL_IY, G_MOD, COL_J)`,
      `ops.section('Elastic', ${T.secBeamX}, E_MOD, BX_A, BX_IZ, BX_IY, G_MOD, BX_J)`
    );
    if (!shared) w(`ops.section('Elastic', ${T.secBeamY}, E_MOD, BY_A, BY_IZ, BY_IY, G_MOD, BY_J)`);
    w('');
  }

  /* ───────────────────────── transformations ───────────────────────── */
  rule('6 — Geometric transformations');
  w(
    '# vecxz orients each section: the local y-axis is vecxz × local x.',
    `ops.geomTransf(${py(s.colTransf)}, ${T.transfCol}, 1.0, 0.0, 0.0)   # columns  — local y along −Y`,
    `ops.geomTransf(${py(s.beamTransf)}, ${T.transfBeamX}, 0.0, -1.0, 0.0)  # X beams  — local y vertical`,
    `ops.geomTransf(${py(s.beamTransf)}, ${T.transfBeamY}, 1.0, 0.0, 0.0)   # Y beams  — local y vertical`,
    ''
  );

  /* ──────────────────────── beam integrations ──────────────────────── */
  const needInt = usesSection(s.colElement) || usesSection(s.beamElement);
  if (needInt) {
    rule('7 — Beam integration');
    if (usesSection(s.colElement)) {
      w(`ops.beamIntegration(${py(s.integration)}, ${T.intCol}, ${T.secCol}, ${pi(s.numIntPts)})`);
    }
    if (usesSection(s.beamElement)) {
      w(`ops.beamIntegration(${py(s.integration)}, ${T.intBeamX}, ${T.secBeamX}, ${pi(s.numIntPts)})`);
      w(`ops.beamIntegration(${py(s.integration)}, ${T.intBeamY}, ${shared ? T.secBeamX : T.secBeamY}, ${pi(s.numIntPts)})`);
    }
    w('');
  }

  /* ─────────────────────────────── elements ────────────────────────── */
  rule(`${needInt ? 8 : 7} — Elements`);
  w(
    '# Columns',
    'for story in range(N_Z):',
    '    for j in range(NY_N):',
    '        for i in range(NX_N):',
    '            ops.element(' + elementArgs(s, 'column', 'col_tag(story, i, j)',
      'node_tag(story, i, j)', 'node_tag(story + 1, i, j)', 'COL', T.transfCol, T.intCol) + ')',
    ''
  );

  if (chevron) {
    const splitX = model.elements.filter((e) => e.kind === 'beamX' && e.splitSibling);
    const splitY = model.elements.filter((e) => e.kind === 'beamY' && e.splitSibling);
    w(
      '# Beams. Those carrying a chevron are split at midspan into two elements.',
      `CHEVRON_X = {${splitX.map((e) => `(${e.story}, ${e.i}, ${e.j})`).join(', ') || ''}}`,
      `CHEVRON_Y = {${splitY.map((e) => `(${e.story}, ${e.i}, ${e.j})`).join(', ') || ''}}`,
      '',
      'for level in range(1, N_Z + 1):',
      '    for j in range(NY_N):',
      '        for i in range(N_X):',
      '            if (level, i, j) in CHEVRON_X:',
      '                mid = mid_x_tag(level, i, j)',
      '                a, b = ops.nodeCoord(node_tag(level, i, j)), ops.nodeCoord(node_tag(level, i + 1, j))',
      '                ops.node(mid, (a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0, (a[2] + b[2]) / 2.0)',
      '                ops.element(' + elementArgs(s, 'beamX', 'beam_x_tag(level, i, j)',
        'node_tag(level, i, j)', 'mid', 'BX', T.transfBeamX, T.intBeamX) + ')',
      '                ops.element(' + elementArgs(s, 'beamX', '600000 + level * 1000 + j * N_X + i + 1',
        'mid', 'node_tag(level, i + 1, j)', 'BX', T.transfBeamX, T.intBeamX) + ')',
      '            else:',
      '                ops.element(' + elementArgs(s, 'beamX', 'beam_x_tag(level, i, j)',
        'node_tag(level, i, j)', 'node_tag(level, i + 1, j)', 'BX', T.transfBeamX, T.intBeamX) + ')',
      '',
      'for level in range(1, N_Z + 1):',
      '    for j in range(N_Y):',
      '        for i in range(NX_N):',
      '            if (level, i, j) in CHEVRON_Y:',
      '                mid = mid_y_tag(level, i, j)',
      '                a, b = ops.nodeCoord(node_tag(level, i, j)), ops.nodeCoord(node_tag(level, i, j + 1))',
      '                ops.node(mid, (a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0, (a[2] + b[2]) / 2.0)',
      '                ops.element(' + elementArgs(s, 'beamY', 'beam_y_tag(level, i, j)',
        'node_tag(level, i, j)', 'mid', shared ? 'BX' : 'BY', T.transfBeamY, T.intBeamY) + ')',
      '                ops.element(' + elementArgs(s, 'beamY', '700000 + level * 1000 + j * NX_N + i + 1',
        'mid', 'node_tag(level, i, j + 1)', shared ? 'BX' : 'BY', T.transfBeamY, T.intBeamY) + ')',
      '            else:',
      '                ops.element(' + elementArgs(s, 'beamY', 'beam_y_tag(level, i, j)',
        'node_tag(level, i, j)', 'node_tag(level, i, j + 1)', shared ? 'BX' : 'BY', T.transfBeamY, T.intBeamY) + ')',
      ''
    );
  } else {
    w(
      '# Beams spanning X',
      'for level in range(1, N_Z + 1):',
      '    for j in range(NY_N):',
      '        for i in range(N_X):',
      '            ops.element(' + elementArgs(s, 'beamX', 'beam_x_tag(level, i, j)',
        'node_tag(level, i, j)', 'node_tag(level, i + 1, j)', 'BX', T.transfBeamX, T.intBeamX) + ')',
      '',
      '# Beams spanning Y',
      'for level in range(1, N_Z + 1):',
      '    for j in range(N_Y):',
      '        for i in range(NX_N):',
      '            ops.element(' + elementArgs(s, 'beamY', 'beam_y_tag(level, i, j)',
        'node_tag(level, i, j)', 'node_tag(level, i, j + 1)', shared ? 'BX' : 'BY', T.transfBeamY, T.intBeamY) + ')',
      ''
    );
  }

  if (isolated || s.useDampers) emitDevices(w, s, model, u, isolated);

  /* ──────────────────────────────── loads ──────────────────────────── */
  rule(`${needInt ? 9 : 8} — Gravity loads`);
  w(
    'def panel_share(q, lx, ly):',
    '    """Split a panel area load onto its four bounding beams.',
    '',
    '    The two-way case uses exact 45° tributary areas turned into a',
    '    force-equivalent uniform load, so the sum over all beams is q·lx·ly.',
    '    """',
    "    if LOAD_DIST == 'oneway-x':",
    '        return 0.0, q * lx / 2.0',
    "    if LOAD_DIST == 'oneway-y':",
    '        return q * ly / 2.0, 0.0',
    '    if ly <= lx:',
    '        return q * ly * (2.0 * lx - ly) / (4.0 * lx), q * ly / 4.0',
    '    return q * lx / 4.0, q * lx * (2.0 * ly - lx) / (4.0 * ly)',
    '',
    '',
    'beam_load = {}',
    '',
    '',
    'def add_load(tag, w):',
    '    beam_load[tag] = beam_load.get(tag, 0.0) + w',
    '',
    '',
    'for level in range(1, N_Z + 1):',
    '    roof = level == N_Z',
    '    q = (DL_FACTOR * (DEAD_ROOF if roof else DEAD_FLOOR)',
    '         + LL_FACTOR * (LIVE_ROOF if roof else LIVE_FLOOR))',
    '    for j in range(N_Y):',
    '        for i in range(N_X):',
    '            w_x, w_y = panel_share(q, BAY_X[i], BAY_Y[j])',
    '            add_load(beam_x_tag(level, i, j), w_x)',
    '            add_load(beam_x_tag(level, i, j + 1), w_x)',
    '            add_load(beam_y_tag(level, i, j), w_y)',
    '            add_load(beam_y_tag(level, i + 1, j), w_y)',
    '',
    "ops.timeSeries('Linear', 1)",
    "ops.pattern('Plain', 1, 1)",
    '',
    '# Slab load — acts along −local y, which the transformation puts vertical.',
    'for tag, w in beam_load.items():',
    "    ops.eleLoad('-ele', tag, '-type', '-beamUniform', -w, 0.0)",
    ''
  );

  if (s.selfWeight) {
    w(
      '# Member self weight',
      'W_COL, W_BX = RHO * G_ACC * COL_A, RHO * G_ACC * BX_A',
      shared ? 'W_BY = W_BX' : 'W_BY = RHO * G_ACC * BY_A',
      'for story in range(N_Z):',
      '    for j in range(NY_N):',
      '        for i in range(NX_N):',
      "            ops.eleLoad('-ele', col_tag(story, i, j), '-type', '-beamUniform', 0.0, 0.0, -W_COL)",
      'for level in range(1, N_Z + 1):',
      '    for j in range(NY_N):',
      '        for i in range(N_X):',
      "            ops.eleLoad('-ele', beam_x_tag(level, i, j), '-type', '-beamUniform', -W_BX, 0.0)",
      '    for j in range(N_Y):',
      '        for i in range(NX_N):',
      "            ops.eleLoad('-ele', beam_y_tag(level, i, j), '-type', '-beamUniform', -W_BY, 0.0)",
      ''
    );
  }

  /* ──────────────────────────────── mass ───────────────────────────── */
  if (s.massSource === 'nodal') {
    rule(`${needInt ? 10 : 9} — Lumped nodal mass`);
    w(
      'def tributary_area(i, j):',
      '    """A quarter of each adjoining panel."""',
      '    dx = (BAY_X[i - 1] if i > 0 else 0.0) / 2.0 + (BAY_X[i] if i < N_X else 0.0) / 2.0',
      '    dy = (BAY_Y[j - 1] if j > 0 else 0.0) / 2.0 + (BAY_Y[j] if j < N_Y else 0.0) / 2.0',
      '    return dx * dy',
      '',
      '',
      'for level in range(1, N_Z + 1):',
      '    roof = level == N_Z',
      '    q = ((DEAD_ROOF if roof else DEAD_FLOOR)',
      '         + MASS_LIVE * (LIVE_ROOF if roof else LIVE_FLOOR))',
      '    for j in range(NY_N):',
      '        for i in range(NX_N):',
      '            m = q * tributary_area(i, j) / G_ACC',
      '            ops.mass(node_tag(level, i, j), m, m, m, 0.0, 0.0, 0.0)',
      ''
    );
  }

  /* ───────────────────────────── recorders ─────────────────────────── */
  if (s.useRecorders) {
    rule('Recorders');
    w(
      'os.makedirs(OUT_DIR, exist_ok=True)',
      '',
      'floor_nodes = [node_tag(level, i, j)',
      '               for level in range(1, N_Z + 1)',
      '               for j in range(NY_N) for i in range(NX_N)]',
      'all_elements = ops.getEleTags()',
      '',
      "ops.recorder('Node', '-file', os.path.join(OUT_DIR, 'node_disp.out'),",
      "             '-time', '-node', *floor_nodes, '-dof', 1, 2, 3, 'disp')",
      "ops.recorder('Node', '-file', os.path.join(OUT_DIR, 'reactions.out'),",
      "             '-time', '-node', *[node_tag(0, i, j) for j in range(NY_N) for i in range(NX_N)],",
      "             '-dof', 1, 2, 3, 'reaction')",
      "ops.recorder('Element', '-file', os.path.join(OUT_DIR, 'element_forces.out'),",
      "             '-time', '-ele', *all_elements, 'globalForce')",
      ''
    );
  }

  /* ────────────────────────────── analysis ─────────────────────────── */
  rule('Analysis');
  emitSolutionStrategy(w, s);
  if (s.runGravity) emitGravity(w, s);
  if (s.runModal) emitModal(w, s);
  if (s.runPushover) emitLateral(w, s, model, 'push', false);
  if (s.runCyclic) emitLateral(w, s, model, 'cyc', true);
  if (s.runTimeHistory) emitTimeHistory(w, s, model, gm);

  w(
    'ops.wipe()',
    ''
  );

  return alignComments(L).join('\n');
}

/* ══════════════════════════ isolators and dampers ═══════════════════ */

/** Python lambda deciding which column bases carry a bearing. */
function isolatorPredicate(placement) {
  if (placement === 'perimeter') return 'lambda i, j: i in (0, NX_N - 1) or j in (0, NY_N - 1)';
  if (placement === 'corner') return 'lambda i, j: i in (0, NX_N - 1) and j in (0, NY_N - 1)';
  return 'lambda i, j: True';
}

function emitDevices(w, s, model, u, isolated) {
  w(
    `# ${'═'.repeat(70)}`,
    '#  Isolators and dampers',
    `# ${'═'.repeat(70)}`,
    ''
  );

  if (isolated) {
    const def = ISOLATOR_TYPES[s.isolatorType];

    w(`# ${def.label}`);
    emitDeviceConstants(w, def, 'iso', s.isolatorType, s);

    if (def.friction) {
      const frn = FRICTION_MODELS[s.frictionType];
      w(`# Friction — ${frn.label}`);
      emitDeviceConstants(w, frn, 'frn', s.frictionType, s);
      for (let k = 0; k < def.friction; k++) {
        w(`ops.frictionModel(${py(s.frictionType)}, ${80 + k}, ${deviceArgs(frn, 'frn').join(', ')})`);
      }
      w('');
    }

    if (def.springMaterial) {
      w(
        '# Shear spring shared by every spring of the bearing.',
        `ops.uniaxialMaterial('Steel01', 94, ${devConst('iso', 'qd')}, ${devConst('iso', 'kInit')}, ${devConst('iso', 'alpha')})`,
        ''
      );
    }

    if (def.aux) {
      w(
        '# Bearing behaviour outside the shear plane.',
        `ISO_KV = ${pf(s.isoKv)}  # vertical [${u.stiffness}]`,
        `ISO_KT = ${pf(s.isoKt)}  # torsion [${u.rotStiffness}]`,
        `ISO_KR = ${pf(s.isoKr)}  # rotation [${u.rotStiffness}]`,
        "ops.uniaxialMaterial('Elastic', 90, ISO_KV)",
        "ops.uniaxialMaterial('Elastic', 91, ISO_KT)",
        "ops.uniaxialMaterial('Elastic', 92, ISO_KR)",
        "ops.uniaxialMaterial('Elastic', 93, ISO_KR)",
        ''
      );
    }

    w(
      'for j in range(NY_N):',
      '    for i in range(NX_N):',
      '        if not HAS_BEARING(i, j):',
      '            continue',
      '        ops.element(' + isolatorArgs(s, def) + ')',
      ''
    );
  }

  if (s.useDampers) {
    const def = DAMPER_TYPES[s.damperType];
    const dampers = model.elements.filter((e) => e.kind === 'damper');

    w(`# Dampers — ${def.label}, ${s.damperConfig} in ${dampers.length} locations`);
    emitDeviceConstants(w, def, 'damp', s.damperType, s);
    w(
      `ops.uniaxialMaterial('${s.damperType}', 95, ${deviceArgs(def, 'damp').join(', ')})`,
      '',
      '# Each device acts along its own axis, so direction 1 of the link.',
      'DAMPERS = [',
      ...chunk(dampers.map((e) => `(${e.tag}, ${e.ni}, ${e.nj})`), 4)
        .map((row) => `    ${row.join(', ')},`),
      ']',
      '',
      'for tag, ni, nj in DAMPERS:',
      "    ops.element('twoNodeLink', tag, ni, nj, '-mat', 95, '-dir', 1)",
      ''
    );
  }
}

/**
 * Positional arguments of a device, as Python constant names. A `positional`
 * list narrows this when some parameters feed a companion material instead.
 */
function deviceArgs(def, group) {
  const keys = def.positional ?? def.params.map((p) => p.key);
  return keys.map((key) => devConst(group, key));
}

function emitDeviceConstants(w, def, group, type, s) {
  const width = Math.max(...def.params.map((p) => devConst(group, p.key).length));
  for (const p of def.params) {
    w(`${devConst(group, p.key).padEnd(width)} = ${pf(s[devKey(group, type, p.key)])}  # ${p.label}`);
  }
  w('');
}

/**
 * A bearing element call. The three-dimensional form of every flag-based
 * bearing takes -P, -T, -My and -Mz; the two-dimensional form does not, which
 * is a common source of broken scripts.
 */
function isolatorArgs(s, def) {
  const head = `'${s.isolatorType}', isolator_tag(i, j), foundation_tag(i, j), node_tag(0, i, j)`;
  const parts = [head];

  if (def.friction) {
    parts.push([...Array(def.friction)].map((_, k) => String(80 + k)).join(', '));
  }
  // TripleFrictionPendulum takes its four material tags positionally, straight
  // after the friction tags and before the geometry: vert, rotZ, rotX, rotY.
  if (def.materialsPositional) parts.push('90, 92, 91, 93');

  parts.push(deviceArgs(def, 'iso').join(', '));

  if (def.matFlag) parts.push(`'${def.matFlag}', 94`);

  if (def.aux) {
    const mats = { '-P': 90, '-T': 91, '-My': 92, '-Mz': 93, '-Vy': 90, '-Vz': 90 };
    parts.push(def.aux.map((flag) => `'${flag}', ${mats[flag]}`).join(', '));
    parts.push(`'-shearDist', ${pf(s.isoShearDist)}`);
  }
  if (s.isoRayleigh) parts.push("'-doRayleigh'");

  return parts.filter(Boolean).join(', ');
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/* ═══════════════════════════════ analyses ═══════════════════════════ */

/** The solver stack, set once and reused by every case below. */
function emitSolutionStrategy(w, s) {
  const extra = s.constraintsCmd === 'Penalty' ? ', PENALTY_A, PENALTY_A'
    : s.constraintsCmd === 'Lagrange' ? ', LAGRANGE_A, LAGRANGE_A' : '';

  w('# Solver stack — shared by every case below.');
  if (s.constraintsCmd === 'Penalty') w(`PENALTY_A = ${pf(s.penaltyAlpha)}`);
  if (s.constraintsCmd === 'Lagrange') w(`LAGRANGE_A = ${pf(s.lagrangeAlpha)}`);
  w(
    'def set_solver():',
    `    ops.constraints(${py(s.constraintsCmd)}${extra})`,
    `    ops.numberer(${py(s.numbererCmd)})`,
    `    ops.system(${py(s.systemCmd)})`,
    `    ops.test(${py(s.testCmd)}, TOL, MAX_ITER, 0)`,
    `    ops.algorithm(${py(s.algorithmCmd)})`,
    '',
    ''
  );
}

function emitGravity(w, s) {
  const integ = {
    LoadControl: "ops.integrator('LoadControl', 1.0 / N_STEPS)",
    DisplacementControl: "ops.integrator('LoadControl', 1.0 / N_STEPS)  # gravity is load driven",
    ParallelDisplacementControl: "ops.integrator('LoadControl', 1.0 / N_STEPS)  # gravity is load driven",
    MinUnbalDispNorm: "ops.integrator('MinUnbalDispNorm', 1.0 / N_STEPS)",
    ArcLength: `ops.integrator('ArcLength', ${pf(s.arcLength)}, ${pf(s.arcAlpha)})`,
  }[s.gravityIntegrator] || "ops.integrator('LoadControl', 1.0 / N_STEPS)";

  w(
    '# ── Gravity ──────────────────────────────────────────────────────────',
    'set_solver()',
    integ,
    "ops.analysis('Static')",
    '',
    'if ops.analyze(N_STEPS) != 0:',
    "    raise RuntimeError('Gravity analysis failed to converge.')",
    '',
    "print(f'Gravity complete: {len(ops.getNodeTags())} nodes, {len(ops.getEleTags())} elements.')",
    '',
    '# Hold the gravity state and restart the pseudo-time for what follows.',
    "ops.loadConst('-time', 0.0)",
    ''
  );
}

function emitModal(w, s) {
  w(
    '# ── Modal ────────────────────────────────────────────────────────────',
    `eigenvalues = ops.eigen(${py(s.eigenSolver)}, N_MODES)`,
    'periods = [2.0 * math.pi / math.sqrt(lam) for lam in eigenvalues]',
    '',
    "print('\\nMode      Period        Frequency')",
    "print('-' * 38)",
    'for n, period in enumerate(periods, start=1):',
    "    print(f'{n:>4}   {period:>10.4f} s   {1.0 / period:>8.4f} Hz')",
    ''
  );
  if (s.useRecorders) {
    w(
      "with open(os.path.join(OUT_DIR, 'periods.out'), 'w') as handle:",
      '    for n, period in enumerate(periods, start=1):',
      "        handle.write(f'{n} {period:.6f}\\n')",
      ''
    );
  }
}

/**
 * Pushover and cyclic share their lateral load pattern and control node; only
 * the displacement schedule differs, so they are emitted from one routine.
 */
function emitLateral(w, s, model, p, cyclic) {
  const title = cyclic ? 'Cyclic' : 'Pushover';
  const tag = cyclic ? 4 : 3;
  const dof = s[`${p}Dof`];
  const shape = s[`${p}Shape`];
  const centre = s[`${p}Node`] === 'centre';
  const P = p.toUpperCase();

  w(
    `# ── ${title} ${'─'.repeat(68 - title.length)}`,
    `${P}_DOF    = ${pi(dof)}`,
    `${P}_DRIFT  = ${pf(s[`${p}Drift`])}  # of the total building height`,
    `${P}_STEPS  = ${pi(s[`${p}Steps`])}`,
    `${P}_NODE   = node_tag(N_Z, ${centre ? 'NX_N // 2, NY_N // 2' : '0, 0'})`,
    `${P}_TARGET = ${P}_DRIFT * Z[-1]`,
    ''
  );

  // Lateral load pattern.
  w(`# Lateral pattern — ${shape}`);
  if (shape === 'modal') {
    w(
      `if not ops.eigen('-genBandArpack', 1):`,
      `    raise RuntimeError('The first mode is needed for a modal load pattern.')`
    );
  }
  w(
    `ops.timeSeries('Linear', ${tag})`,
    `ops.pattern('Plain', ${tag}, ${tag})`,
    'for level in range(1, N_Z + 1):',
    '    for j in range(NY_N):',
    '        for i in range(NX_N):',
    '            tag = node_tag(level, i, j)',
    '            m = ops.nodeMass(tag, 1)',
    shape === 'triangular' ? '            f = m * Z[level]'
      : shape === 'uniform' ? '            f = m'
      : `            f = m * ops.nodeEigenvector(tag, 1, ${P}_DOF)`,
    `            load = [0.0] * 6`,
    `            load[${P}_DOF - 1] = f`,
    '            ops.load(tag, *load)',
    '',
    'set_solver()',
    "ops.analysis('Static')",
    ''
  );

  if (!cyclic) {
    w(
      `ops.integrator('DisplacementControl', ${P}_NODE, ${P}_DOF, ${P}_TARGET / ${P}_STEPS)`,
      `if ops.analyze(${P}_STEPS) != 0:`,
      `    print('Pushover stopped early — the model lost convergence.')`,
      `print(f'Pushover roof displacement: {ops.nodeDisp(${P}_NODE, ${P}_DOF):.4f}')`,
      ''
    );
    return;
  }

  w(
    `${P}_AMPS    = [${expandCsv(s.cycAmplitudes).map(pf).join(', ')}]  # drift ratios`,
    `${P}_REPEATS = ${pi(s.cycRepeats)}`,
    '',
    '',
    'def push_to(node, dof, target, steps):',
    '    """Displacement-controls `node` from where it is to `target`."""',
    '    current = ops.nodeDisp(node, dof)',
    '    incr = (target - current) / steps',
    '    if incr == 0.0:',
    '        return True',
    "    ops.integrator('DisplacementControl', node, dof, incr)",
    '    return ops.analyze(steps) == 0',
    '',
    '',
    `for amp in ${P}_AMPS:`,
    `    peak = amp * Z[-1]`,
    `    for _ in range(${P}_REPEATS):`,
    `        for target in (peak, -peak, 0.0):`,
    `            if not push_to(${P}_NODE, ${P}_DOF, target, ${P}_STEPS):`,
    `                print(f'Cyclic analysis stopped at drift {amp}.')`,
    '                break',
    '        else:',
    '            continue',
    '        break',
    '    else:',
    '        continue',
    '    break',
    ''
  );
}

function emitTimeHistory(w, s, model, gm) {
  const file = gm ? scriptFileName(gm) : 'ground_motion.txt';
  const npts = gm ? gm.npts : 0;
  const steps = s.thDuration > 0
    ? `int(${pf(s.thDuration)} / TH_DT)`
    : (gm ? `int(${pf(npts)} * GM_DT / TH_DT)` : 'TH_STEPS');

  w(
    '# ── Time history ─────────────────────────────────────────────────────',
    `GM_FILE  = ${py(file)}  # one acceleration per line, next to this script`,
    `GM_DT    = ${pf(s.gmDt)}  # time step of the record [s]`,
    `GM_SCALE = ${pf(s.gmScale)}  # multiplied by g, so a record in g needs no conversion`,
    `GM_DOF   = ${pi(s.gmDir)}`,
    `TH_DT    = ${pf(s.thDt)}  # integration time step [s]`,
    gm ? `GM_NPTS  = ${pi(npts)}` : 'TH_STEPS = 2000',
    '',
    'if not os.path.exists(GM_FILE):',
    "    raise FileNotFoundError(f'Ground motion file {GM_FILE!r} was not found.')",
    '',
    '# Rayleigh damping anchored on two modes.',
    `DAMP_RATIO = ${pf(s.dampRatio)}`,
    `MODE_I, MODE_J = ${pi(s.dampModeI)}, ${pi(s.dampModeJ)}`,
    'lambdas = ops.eigen(\'-genBandArpack\', max(MODE_I, MODE_J))',
    'w_i = math.sqrt(lambdas[MODE_I - 1])',
    'w_j = math.sqrt(lambdas[MODE_J - 1])',
    'a0 = 2.0 * DAMP_RATIO * w_i * w_j / (w_i + w_j)',
    'a1 = 2.0 * DAMP_RATIO / (w_i + w_j)',
    'ops.rayleigh(a0, 0.0, 0.0, a1)',
    '',
    "ops.timeSeries('Path', 5, '-dt', GM_DT, '-filePath', GM_FILE, '-factor', GM_SCALE * G_ACC)",
    "ops.pattern('UniformExcitation', 5, GM_DOF, '-accel', 5)",
    '',
    'set_solver()',
    transientIntegrator(s),
    "ops.analysis('Transient')",
    '',
    `n_steps = ${steps}`,
    'if ops.analyze(n_steps, TH_DT) != 0:',
    "    print('Time history stopped early — the model lost convergence.')",
    "print(f'Time history complete: {n_steps} steps of {TH_DT} s.')",
    ''
  );
}

function transientIntegrator(s) {
  switch (s.thIntegrator) {
    case 'Newmark':
      return `ops.integrator('Newmark', ${pf(s.newmarkGamma)}, ${pf(s.newmarkBeta)})`;
    case 'HHT':
      return `ops.integrator('HHT', ${pf(s.hhtAlpha)})`;
    case 'GeneralizedAlpha':
      return `ops.integrator('GeneralizedAlpha', ${pf(s.hhtAlpha)}, ${pf(Math.min(1, Number(s.hhtAlpha) + 0.05))})`;
    case 'TRBDF2':
      return "ops.integrator('TRBDF2')";
    case 'CentralDifference':
      return "ops.integrator('CentralDifference')";
    case 'ExplicitDifference':
      return "ops.integrator('ExplicitDifference')";
    default:
      return "ops.integrator('Newmark', 0.5, 0.25)";
  }
}

/** "0.005, 0.01" → [0.005, 0.01] */
function expandCsv(text) {
  const out = String(text ?? '').split(/[,;\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  return out.length ? out : [0.01];
}

/* ───────────────────────── section constants ────────────────────────── */

function emitSectionConsts(w, prefix, sec, u, fiber) {
  const label = { COL: 'Column', BX: 'Beam — X', BY: 'Beam — Y' }[prefix];
  const dims = sec.shape === 'Circular'
    ? `D = ${pf(sec.D)}`
    : sec.shape === 'ISection'
      ? `d = ${pf(sec.h)}, bf = ${pf(sec.bf)}, tf = ${pf(sec.tf)}, tw = ${pf(sec.tw)}`
      : `b = ${pf(sec.b)}, h = ${pf(sec.h)}`;
  const modNote = fiber ? '' : ` · ${pf(sec.modifier)} × Ig`;

  w(
    `# ${label} — ${sec.shape}, ${dims} [${u.length}]`,
    `${prefix}_B  = ${pf(sec.b)}`,
    `${prefix}_H  = ${pf(sec.h)}`,
    `${prefix}_A  = ${pf(sec.A)}  # [${u.area}]`,
    `${prefix}_IZ = ${pf(sec.IzEff)}  # [${u.inertia}]${modNote}`,
    `${prefix}_IY = ${pf(sec.IyEff)}  # [${u.inertia}]${modNote}`,
    `${prefix}_J  = ${pf(sec.J)}  # torsion constant [${u.inertia}]`,
    `${prefix}_AV = ${pf((5 / 6) * sec.A)}  # shear area`,
    ''
  );
}

/* ──────────────────────────── materials ─────────────────────────────── */

function emitMaterials(w, s, fiber, steelSystem) {
  if (!steelSystem) {
    const type = s.concreteMat;
    const def = CONCRETE_MODELS[type];
    const confined = fiber && !!def.confine;

    w(`# Concrete — ${def.label}`);
    emitMaterialConstants(w, def, 'conc', type, s);

    if (confined) {
      w(
        `K_CONF  = ${pf(s.confineFactor)}  # core strength enhancement`,
        'KE_CONF = 1.0 + 5.0 * (K_CONF - 1.0)  # core strain enhancement, Mander et al. (1988)',
        ''
      );
    }

    w(`ops.uniaxialMaterial('${type}', ${T.matCover}, ${materialArgs(def, 'conc').join(', ')})  # unconfined cover`);
    w(`ops.uniaxialMaterial('${type}', ${T.matCore}, ${materialArgs(def, 'conc', { core: confined }).join(', ')})`
      + `  # ${confined ? 'confined core' : 'core, same as cover'}`);
    w('');
  }

  const stype = s.steelMat;
  const sdef = STEEL_MODELS[stype];
  w(`# ${steelSystem ? 'Structural steel' : 'Reinforcement'} — ${sdef.label}`);
  emitMaterialConstants(w, sdef, 'steel', stype, s);
  w(`ops.uniaxialMaterial('${stype}', ${T.matSteel}, ${materialArgs(sdef, 'steel').join(', ')})`);
  w('');
}

/** Named constants for one material, so the call below stays readable. */
function emitMaterialConstants(w, def, family, type, s) {
  const width = Math.max(...def.params.map((p) => constName(family, p.key).length));
  for (const p of def.params) {
    const value = s[matKey(family, type, p.key)];
    const literal = p.options ? py(value) : pf(value);
    w(`${constName(family, p.key).padEnd(width)} = ${literal}  # ${p.label}`);
  }
  w('');
}

/* ────────────────────────── fiber sections ──────────────────────────── */

function emitFiberSection(w, s, sec, tag, prefix, steelSystem) {
  const label = { COL: 'Column', BX: 'Beam — X', BY: 'Beam — Y' }[prefix];
  const concrete = steelSystem ? T.matSteel : T.matCore;
  const cover = steelSystem ? T.matSteel : T.matCover;
  const gj = s.torsionStiff ? `, '-GJ', G_MOD * ${prefix}_J` : '';

  w(`# ${label} — fiber section ${tag}`);
  w(`ops.section('Fiber', ${tag}${gj})`);

  const f = sec.fiber;

  if (sec.shape === 'Circular') {
    w(
      `R_${prefix}  = ${prefix}_H / 2.0`,
      `RC_${prefix} = R_${prefix} - ${pf(s.cover)}  # core radius`,
      `ops.patch('circ', ${concrete}, ${f.nfCircCore}, ${f.nfRadCore}, 0.0, 0.0, 0.0, RC_${prefix}, 0.0, 360.0)`,
      `ops.patch('circ', ${cover}, ${f.nfCircCover}, ${f.nfRadCover}, 0.0, 0.0, RC_${prefix}, R_${prefix}, 0.0, 360.0)`,
      `ops.layer('circ', ${T.matSteel}, ${f.bars[0].n}, ${pf(f.bars[0].area)}, 0.0, 0.0, RC_${prefix}, 0.0, 360.0)`,
      ''
    );
    return;
  }

  if (sec.shape === 'ISection') {
    w(
      `# Three rectangular patches: bottom flange, web, top flange.`,
      `HW_${prefix} = ${prefix}_H / 2.0 - ${pf(sec.tf)}`,
      `ops.patch('rect', ${T.matSteel}, 2, 12, -${prefix}_H / 2.0, -${prefix}_B / 2.0, -HW_${prefix}, ${prefix}_B / 2.0)`,
      `ops.patch('rect', ${T.matSteel}, 12, 2, -HW_${prefix}, ${pf(-sec.tw / 2)}, HW_${prefix}, ${pf(sec.tw / 2)})`,
      `ops.patch('rect', ${T.matSteel}, 2, 12, HW_${prefix}, -${prefix}_B / 2.0, ${prefix}_H / 2.0, ${prefix}_B / 2.0)`,
      ''
    );
    return;
  }

  // Rectangular: confined core, four cover strips, then the rebar layers.
  w(
    `YC_${prefix} = ${prefix}_H / 2.0 - ${pf(s.cover)}  # core half-depth`,
    `ZC_${prefix} = ${prefix}_B / 2.0 - ${pf(s.cover)}  # core half-width`,
    `ops.patch('rect', ${concrete}, ${pi(f.nfCoreY)}, ${pi(f.nfCoreZ)}, -YC_${prefix}, -ZC_${prefix}, YC_${prefix}, ZC_${prefix})`,
    `ops.patch('rect', ${cover}, ${pi(f.nfCoverY)}, 1, -${prefix}_H / 2.0, -${prefix}_B / 2.0, -YC_${prefix}, ${prefix}_B / 2.0)`,
    `ops.patch('rect', ${cover}, ${pi(f.nfCoverY)}, 1, YC_${prefix}, -${prefix}_B / 2.0, ${prefix}_H / 2.0, ${prefix}_B / 2.0)`,
    `ops.patch('rect', ${cover}, 1, ${pi(f.nfCoverZ)}, -YC_${prefix}, -${prefix}_B / 2.0, YC_${prefix}, -ZC_${prefix})`,
    `ops.patch('rect', ${cover}, 1, ${pi(f.nfCoverZ)}, -YC_${prefix}, ZC_${prefix}, YC_${prefix}, ${prefix}_B / 2.0)`
  );

  for (const layer of f.bars) {
    const y = layer.y >= 0
      ? `YC_${prefix}${layer.sideOnly ? ` * ${pf(layer.y / (f.yc || 1))}` : ''}`
      : `-YC_${prefix}${layer.sideOnly ? ` * ${pf(Math.abs(layer.y) / (f.yc || 1))}` : ''}`;
    w(`ops.layer('straight', ${T.matSteel}, ${pi(layer.n)}, ${pf(layer.area)}, ${y}, -ZC_${prefix}, ${y}, ZC_${prefix})`);
  }
  w('');
}

/* ─────────────────────────── element arguments ──────────────────────── */

function elementArgs(s, family, tagExpr, niExpr, njExpr, prefix, transfTag, intTag) {
  const kind = family === 'column' ? s.colElement : s.beamElement;
  const name = ELEMENT_NAME[kind] || kind;
  const mass = s.elementMass ? `, '-mass', RHO * ${prefix}_A` : '';
  const head = `'${name}', ${tagExpr}, ${niExpr}, ${njExpr}`;

  switch (name) {
    case 'elasticBeamColumn':
      return `${head},\n                        ${prefix}_A, E_MOD, G_MOD, ${prefix}_J, ${prefix}_IY, ${prefix}_IZ, ${transfTag}${mass}`;
    case 'ElasticTimoshenkoBeam':
      return `${head},\n                        E_MOD, G_MOD, ${prefix}_A, ${prefix}_J, ${prefix}_IY, ${prefix}_IZ,`
           + `\n                        ${prefix}_AV, ${prefix}_AV, ${transfTag}${mass}`;
    case 'forceBeamColumn':
      return `${head}, ${transfTag}, ${intTag},\n                        '-iter', MAX_ITER, TOL${mass}`;
    case 'dispBeamColumn':
    default:
      return `${head}, ${transfTag}, ${intTag}${mass}`;
  }
}

/* ────────────────────────────── formatting ──────────────────────────── */

/** Python float literal — always carries a decimal point or an exponent. */
function pf(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0.0';
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return `${n}.0`;
  const a = Math.abs(n);
  if (a !== 0 && (a < 1e-4 || a >= 1e12)) return n.toExponential(6);
  return String(Number(n.toPrecision(10)));
}

/** Python int literal. */
function pi(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? String(n) : '0';
}

/** Python string literal with single quotes. */
function py(v) {
  return `'${String(v).replace(/'/g, "\\'")}'`;
}

/**
 * Aligns trailing `#` comments within each run of consecutive commented lines,
 * which is what makes the parameter block at the top of the script readable.
 */
function alignComments(lines) {
  const out = [...lines];
  let block = [];

  const flush = () => {
    const col = Math.max(...block.map((b) => b.code.length)) + 2;
    // Long statements are left alone; padding them would push the comment far
    // off to the right and hurt the readability alignment is meant to buy.
    if (block.length > 1 && col <= 62) {
      for (const b of block) out[b.idx] = b.code.padEnd(col) + b.comment;
    }
    block = [];
  };

  lines.forEach((line, idx) => {
    const m = /^([^#]*\S)\s{2,}(#\s.*)$/.exec(line);
    if (m && !line.trimStart().startsWith('#')) block.push({ idx, code: m[1], comment: m[2] });
    else flush();
  });
  flush();

  return out;
}
