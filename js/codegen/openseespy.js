/**
 * codegen/openseespy.js — emits a runnable OpenSeesPy script.
 *
 * The script is written parametrically (grids and loops rather than thousands
 * of literal `ops.node` calls) and reproduces exactly the tags, sections,
 * loads and masses that `model/builder.js` produced for the viewer.
 */

import { unitsOf } from '../units.js';

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

export function generateScript(s, model) {
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
    ''
  );

  w('# Materials');
  if (!steelSystem) {
    w(
      `FC     = ${pf(s.fpc)}  # f'c   [${u.stress}]`,
      `EPSC0  = ${pf(s.epsc0)}  # strain at f\'c`,
      `FCU    = ${pf(s.fpcu)}  # residual strength [${u.stress}]`,
      `EPSU   = ${pf(s.epsU)}  # crushing strain`,
      `EC     = ${pf(s.Ec)}  # concrete elastic modulus [${u.stress}]`
    );
    if (s.concreteMat === 'Concrete02') {
      w(
        `FT     = ${pf(s.ft)}  # tensile strength [${u.stress}]`,
        `ETS    = ${pf(s.Ets)}  # tension softening stiffness`,
        `LAMBDA = ${pf(s.lambdaC)}  # unloading slope ratio`
      );
    }
    if (fiber) {
      w(
        `K_CONF = ${pf(s.confineFactor)}  # core confinement factor`,
        '',
        '# Confined core properties — Mander et al. (1988)',
        'FC_CORE   = FC * K_CONF',
        'EPS_CORE  = EPSC0 * (1.0 + 5.0 * (K_CONF - 1.0))',
        'FCU_CORE  = FCU * K_CONF',
        'EPSU_CORE = EPSU * (1.0 + 5.0 * (K_CONF - 1.0))'
      );
    }
    w('');
  }
  w(
    `FY  = ${pf(s.Fy)}  # yield strength [${u.stress}]`,
    `ES  = ${pf(s.Es)}  # steel elastic modulus [${u.stress}]`,
    `NU  = ${pf(s.nu)}  # Poisson ratio`,
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
    'Z = cumulative(STORY_H)',
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

  /* ─────────────────────────────── model ───────────────────────────── */
  rule('3 — Model space, nodes and restraints');
  w(
    'ops.wipe()',
    "ops.model('basic', '-ndm', 3, '-ndf', 6)",
    '',
    'for level in range(N_Z + 1):',
    '    for j in range(NY_N):',
    '        for i in range(NX_N):',
    '            ops.node(node_tag(level, i, j), X[i], Y[j], Z[level])',
    ''
  );

  const fix = { Fixed: '1, 1, 1, 1, 1, 1', Pinned: '1, 1, 1, 0, 0, 0', Roller: '0, 0, 1, 0, 0, 0' }[s.baseFixity];
  if (fix) {
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
    '',
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
  if (s.runGravity) {
    w(
      '# ── Gravity, applied in N_STEPS equal increments ──',
      `ops.constraints(${py(s.constraintsCmd)}${s.constraintsCmd === 'Penalty' ? ', 1.0e14, 1.0e14' : ''})`,
      `ops.numberer(${py(s.numbererCmd)})`,
      `ops.system(${py(s.systemCmd)})`,
      `ops.test(${py(s.testCmd)}, TOL, MAX_ITER, 0)`,
      `ops.algorithm(${py(s.algorithmCmd)})`,
      "ops.integrator('LoadControl', 1.0 / N_STEPS)",
      "ops.analysis('Static')",
      '',
      'if ops.analyze(N_STEPS) != 0:',
      "    raise RuntimeError('Gravity analysis failed to converge.')",
      '',
      "print(f'Gravity analysis complete: {len(ops.getNodeTags())} nodes, {len(ops.getEleTags())} elements.')",
      '',
      '# Hold the gravity state and restart the pseudo-time for what follows.',
      "ops.loadConst('-time', 0.0)",
      ''
    );
  }

  if (s.runModal) {
    w(
      '# ── Eigenvalue analysis ──',
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
        'with open(os.path.join(OUT_DIR, \'periods.out\'), \'w\') as handle:',
        '    for n, period in enumerate(periods, start=1):',
        "        handle.write(f'{n} {period:.6f}\\n')",
        ''
      );
    }
  }

  w(
    'ops.wipe()',
    ''
  );

  return alignComments(L).join('\n');
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
    const m = s.concreteMat;
    const core = fiber ? ['FC_CORE', 'EPS_CORE', 'FCU_CORE', 'EPSU_CORE'] : ['FC', 'EPSC0', 'FCU', 'EPSU'];

    w('# Concrete — tag 1 is the confined core, tag 2 the unconfined cover.');
    if (m === 'Elastic') {
      w(`ops.uniaxialMaterial('Elastic', ${T.matCore}, EC)`);
      w(`ops.uniaxialMaterial('Elastic', ${T.matCover}, EC)`);
    } else if (m === 'Concrete01') {
      w(`ops.uniaxialMaterial('Concrete01', ${T.matCore}, ${core.join(', ')})`);
      w(`ops.uniaxialMaterial('Concrete01', ${T.matCover}, FC, EPSC0, FCU, EPSU)`);
    } else if (m === 'Concrete02') {
      w(`ops.uniaxialMaterial('Concrete02', ${T.matCore}, ${core.join(', ')}, LAMBDA, FT, ETS)`);
      w(`ops.uniaxialMaterial('Concrete02', ${T.matCover}, FC, EPSC0, FCU, EPSU, LAMBDA, FT, ETS)`);
    } else if (m === 'Concrete04') {
      w(`ops.uniaxialMaterial('Concrete04', ${T.matCore}, ${fiber ? 'FC_CORE, EPS_CORE, EPSU_CORE' : 'FC, EPSC0, EPSU'}, EC)`);
      w(`ops.uniaxialMaterial('Concrete04', ${T.matCover}, FC, EPSC0, EPSU, EC)`);
    }
    w('');
  }

  w(`# ${steelSystem ? 'Structural steel' : 'Reinforcement'} — tag 3`);
  switch (s.steelMat) {
    case 'Elastic':
      w(`ops.uniaxialMaterial('Elastic', ${T.matSteel}, ES)`);
      break;
    case 'ElasticPP':
      w(`ops.uniaxialMaterial('ElasticPP', ${T.matSteel}, ES, FY / ES)`);
      break;
    case 'Steel01':
      w(`ops.uniaxialMaterial('Steel01', ${T.matSteel}, FY, ES, ${pf(s.bHard)})`);
      break;
    case 'Steel02':
      w(`ops.uniaxialMaterial('Steel02', ${T.matSteel}, FY, ES, ${pf(s.bHard)}, ${pf(s.R0)}, ${pf(s.cR1)}, ${pf(s.cR2)})`);
      break;
    case 'Hysteretic':
      w(
        'EPS_Y = FY / ES',
        `ops.uniaxialMaterial('Hysteretic', ${T.matSteel},`,
        '                     FY, EPS_Y, 1.25 * FY, 0.02, 0.2 * FY, 0.10,',
        '                     -FY, -EPS_Y, -1.25 * FY, -0.02, -0.2 * FY, -0.10,',
        `                     ${pf(s.pinchX)}, ${pf(s.pinchY)}, ${pf(s.damage1)}, ${pf(s.damage2)}, ${pf(s.betaH)})`
      );
      break;
    default:
      break;
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
    if (block.length > 1) {
      const col = Math.max(...block.map((b) => b.code.length)) + 2;
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
