/**
 * model/devices.js — seismic isolators, friction models and dampers.
 *
 * Same contract as `materials.js`: each entry lists its arguments in OpenSees
 * order so the sidebar, the defaults and the generated call share one source.
 *
 * Every signature here is the **three-dimensional** form. That distinction
 * matters: the bearing elements take `-P -Mz` in 2D but `-P -T -My -Mz` in 3D,
 * and the studio always builds an ndm 3 / ndf 6 model.
 *
 * Entry shape
 *   label     visible name
 *   friction  number of frictionModel tags the element consumes
 *   aux       auxiliary uniaxial material flags the element needs, in order
 *   params    positional arguments, before the flags
 *   trailing  positional arguments emitted after the flag block
 */

const S = (kNm, Nmm, kipin) => ({ 'kN-m': kNm, 'N-mm': Nmm, 'kip-in': kipin });

const KINIT = S(2500, 2500, 14.3);          // shear stiffness, ~2.5 s isolated period
const QD = S(50, 50000, 11);                // characteristic strength
const GR = S(700, 0.7, 0.1);                // rubber shear modulus
const KBULK = S(2000000, 2000, 290);        // rubber bulk modulus
const CD = S(1000, 1e6, 220);               // damper coefficient

/* ═════════════════════════════════════════════ friction models ═══════ */

export const FRICTION_MODELS = {
  Coulomb: {
    label: 'Coulomb — constant μ',
    params: [{ key: 'mu', label: 'μ', d: 0.06, step: 0.005 }],
  },
  VelDependent: {
    label: 'VelDependent — velocity dependent',
    params: [
      { key: 'muSlow', label: 'μ slow', d: 0.03, step: 0.005, half: true },
      { key: 'muFast', label: 'μ fast', d: 0.05, step: 0.005, half: true },
      { key: 'transRate', label: 'Transition rate', d: 100.0, step: 5 },
    ],
  },
  VelNormalFrcDep: {
    label: 'VelNormalFrcDep — velocity and normal force',
    params: [
      { key: 'aSlow', label: 'aSlow', d: 0.05, step: 0.005, half: true },
      { key: 'nSlow', label: 'nSlow', d: 0.0, step: 0.05, half: true },
      { key: 'aFast', label: 'aFast', d: 0.08, step: 0.005, half: true },
      { key: 'nFast', label: 'nFast', d: 0.0, step: 0.05, half: true },
      { key: 'alpha0', label: 'α0', d: 0.0, step: 0.05, half: true },
      { key: 'alpha1', label: 'α1', d: 0.0, step: 0.05, half: true },
      { key: 'alpha2', label: 'α2', d: 0.0, step: 0.05, half: true },
      { key: 'maxMuFact', label: 'max μ factor', d: 2.0, step: 0.1, half: true },
    ],
  },
  VelPressureDep: {
    label: 'VelPressureDep — velocity and pressure',
    params: [
      { key: 'muSlow', label: 'μ slow', d: 0.03, step: 0.005, half: true },
      { key: 'muFast0', label: 'μ fast at p = 0', d: 0.05, step: 0.005, half: true },
      { key: 'A', label: 'Contact area', unit: 'area', d: S(0.05, 50000, 78), half: true },
      { key: 'deltaMu', label: 'Δμ', d: 0.01, step: 0.005, half: true },
      { key: 'alpha', label: 'α', d: 0.0, step: 0.05, half: true },
      { key: 'transRate', label: 'Transition rate', d: 100.0, step: 5, half: true },
    ],
  },
};

/* ══════════════════════════════════════════════════ isolators ════════ */

/** Auxiliary material flags a 3D bearing element expects, in order. */
const BEARING_3D = ['-P', '-T', '-My', '-Mz'];

export const ISOLATOR_TYPES = {
  elastomericBearingPlasticity: {
    label: 'elastomericBearingPlasticity — bilinear rubber',
    aux: BEARING_3D,
    params: [
      { key: 'kInit', label: 'kInit — shear stiffness', unit: 'stiffness', d: KINIT },
      { key: 'qd', label: 'qd — characteristic strength', unit: 'force', d: QD },
      { key: 'alpha1', label: 'α1 — linear hardening', d: 0.05, step: 0.005, half: true },
      { key: 'alpha2', label: 'α2 — nonlinear hardening', d: 0.0, step: 0.005, half: true },
      { key: 'mu', label: 'μ — hardening exponent', d: 2.0, step: 0.1 },
    ],
  },

  elastomericBearingBoucWen: {
    label: 'elastomericBearingBoucWen — Bouc–Wen rubber',
    aux: BEARING_3D,
    params: [
      { key: 'kInit', label: 'kInit — shear stiffness', unit: 'stiffness', d: KINIT },
      { key: 'qd', label: 'qd — characteristic strength', unit: 'force', d: QD },
      { key: 'alpha1', label: 'α1', d: 0.05, step: 0.005, half: true },
      { key: 'alpha2', label: 'α2', d: 0.0, step: 0.005, half: true },
      { key: 'mu', label: 'μ', d: 2.0, step: 0.1, half: true },
      { key: 'eta', label: 'η', d: 1.0, step: 0.1, half: true },
      { key: 'beta', label: 'β', d: 0.5, step: 0.05, half: true },
      { key: 'gamma', label: 'γ', d: 0.5, step: 0.05, half: true },
    ],
  },

  flatSliderBearing: {
    label: 'flatSliderBearing — flat sliding surface',
    friction: 1,
    aux: BEARING_3D,
    params: [{ key: 'kInit', label: 'kInit — initial stiffness', unit: 'stiffness', d: KINIT }],
  },

  singleFPBearing: {
    label: 'singleFPBearing — single friction pendulum',
    friction: 1,
    aux: BEARING_3D,
    params: [
      { key: 'Reff', label: 'Reff — effective radius', unit: 'length', d: S(2.0, 2000, 80) },
      { key: 'kInit', label: 'kInit — initial stiffness', unit: 'stiffness', d: KINIT },
    ],
  },

  RJWatsonEqsBearing: {
    label: 'RJWatsonEqsBearing — EQS sliding bearing',
    friction: 1,
    aux: ['-P', '-Vy', '-Vz', '-T', '-My', '-Mz'],
    params: [{ key: 'kInit', label: 'kInit — initial stiffness', unit: 'stiffness', d: KINIT }],
  },

  TripleFrictionPendulum: {
    label: 'TripleFrictionPendulum — three sliding surfaces',
    friction: 3,
    // This element takes its four material tags positionally, not behind flags,
    // but it still needs them defined.
    materialsPositional: ['vert', 'rotZ', 'rotX', 'rotY'],
    needsAuxMaterials: true,
    params: [
      { key: 'L1', label: 'L1', unit: 'length', d: S(0.4, 400, 16), half: true },
      { key: 'L2', label: 'L2', unit: 'length', d: S(1.5, 1500, 60), half: true },
      { key: 'L3', label: 'L3', unit: 'length', d: S(1.5, 1500, 60), half: true },
      { key: 'd1', label: 'd1 — displacement limit', unit: 'length', d: S(0.05, 50, 2), half: true },
      { key: 'd2', label: 'd2', unit: 'length', d: S(0.30, 300, 12), half: true },
      { key: 'd3', label: 'd3', unit: 'length', d: S(0.30, 300, 12), half: true },
      { key: 'W', label: 'W — axial force on the bearing', unit: 'force', d: S(1000, 1e6, 220), half: true },
      { key: 'uy', label: 'uy — yield displacement', unit: 'length', d: S(0.001, 1, 0.04), half: true },
      { key: 'kvt', label: 'kvt — tension stiffness', unit: 'stiffness', d: S(1, 1, 0.006), half: true },
      { key: 'minFv', label: 'minFv', unit: 'force', d: S(0.1, 100, 0.02), half: true },
      { key: 'tol', label: 'tol', d: 1e-6, step: 1e-7, half: true },
    ],
  },

  // `TFP` is deliberately not offered. The element is created without
  // complaint and the documented argument order is accepted, but the gravity
  // analysis ends in an access violation inside the compiled TFP_Bearing —
  // the process dies rather than reporting an error, so a script using it
  // could never be trusted. Use `TripleFrictionPendulum` for the same
  // mechanism; it is verified and takes its surfaces as L1/L2/L3.

  ElastomericX: {
    label: 'ElastomericX — rubber bearing, geometry based',
    partialDOF: true,
    note: 'Carries shear only — it supplies no vertical or torsional stiffness, so on its own it leaves the isolation level with a zero-energy mode. Pair it with a companion element, or use one of the bearings that take -P, -T, -My and -Mz.',
    params: [
      { key: 'Fy', label: 'Fy — yield force', unit: 'force', d: QD, half: true },
      { key: 'alpha', label: 'α — hardening ratio', d: 0.05, step: 0.005, half: true },
      { key: 'Gr', label: 'Gr — shear modulus', unit: 'stress', d: GR, half: true },
      { key: 'Kbulk', label: 'Kbulk', unit: 'stress', d: KBULK, half: true },
      { key: 'D1', label: 'D1 — inner diameter', unit: 'length', d: S(0.0, 0, 0), half: true },
      { key: 'D2', label: 'D2 — outer diameter', unit: 'length', d: S(0.7, 700, 28), half: true },
      { key: 'ts', label: 'ts — steel shim thickness', unit: 'length', d: S(0.003, 3, 0.12), half: true },
      { key: 'tr', label: 'tr — single rubber layer', unit: 'length', d: S(0.010, 10, 0.4), half: true },
      { key: 'n', label: 'n — rubber layers', d: 20, step: 1, int: true, half: true },
    ],
  },

  LeadRubberX: {
    label: 'LeadRubberX — lead rubber bearing, geometry based',
    partialDOF: true,
    note: 'Carries shear only — it supplies no vertical or torsional stiffness, so on its own it leaves the isolation level with a zero-energy mode. Pair it with a companion element, or use one of the bearings that take -P, -T, -My and -Mz.',
    params: [
      { key: 'Fy', label: 'Fy — yield force', unit: 'force', d: QD, half: true },
      { key: 'alpha', label: 'α — hardening ratio', d: 0.05, step: 0.005, half: true },
      { key: 'Gr', label: 'Gr — shear modulus', unit: 'stress', d: GR, half: true },
      { key: 'Kbulk', label: 'Kbulk', unit: 'stress', d: KBULK, half: true },
      { key: 'D1', label: 'D1 — inner diameter', unit: 'length', d: S(0.0, 0, 0), half: true },
      { key: 'D2', label: 'D2 — outer diameter', unit: 'length', d: S(0.7, 700, 28), half: true },
      { key: 'ts', label: 'ts — steel shim thickness', unit: 'length', d: S(0.003, 3, 0.12), half: true },
      { key: 'tr', label: 'tr — single rubber layer', unit: 'length', d: S(0.010, 10, 0.4), half: true },
      { key: 'n', label: 'n — rubber layers', d: 20, step: 1, int: true, half: true },
    ],
  },

  HDR: {
    label: 'HDR — high damping rubber bearing',
    partialDOF: true,
    note: 'Carries shear only — it supplies no vertical or torsional stiffness, so on its own it leaves the isolation level with a zero-energy mode. Pair it with a companion element, or use one of the bearings that take -P, -T, -My and -Mz.',
    params: [
      { key: 'Gr', label: 'Gr — shear modulus', unit: 'stress', d: GR, half: true },
      { key: 'Kbulk', label: 'Kbulk', unit: 'stress', d: KBULK, half: true },
      { key: 'D1', label: 'D1 — inner diameter', unit: 'length', d: S(0.0, 0, 0), half: true },
      { key: 'D2', label: 'D2 — outer diameter', unit: 'length', d: S(0.7, 700, 28), half: true },
      { key: 'ts', label: 'ts', unit: 'length', d: S(0.003, 3, 0.12), half: true },
      { key: 'tr', label: 'tr', unit: 'length', d: S(0.010, 10, 0.4), half: true },
      { key: 'n', label: 'n — rubber layers', d: 20, step: 1, int: true, half: true },
      { key: 'a1', label: 'a1', d: 0.84, step: 0.01, half: true },
      { key: 'a2', label: 'a2', d: 5.0, step: 0.1, half: true },
      { key: 'a3', label: 'a3', d: 0.0, step: 0.1, half: true },
      { key: 'b1', label: 'b1', d: 0.32, step: 0.01, half: true },
      { key: 'b2', label: 'b2', d: 4.0, step: 0.1, half: true },
      { key: 'b3', label: 'b3', d: 0.0, step: 0.1, half: true },
      { key: 'c1', label: 'c1', d: 1.0, step: 0.1, half: true },
      { key: 'c2', label: 'c2', d: 1.0, step: 0.1, half: true },
      { key: 'c3', label: 'c3', d: 1.0, step: 0.1, half: true },
      { key: 'c4', label: 'c4', d: 1.0, step: 0.1, half: true },
    ],
  },

  multipleShearSpring: {
    label: 'multipleShearSpring — radial spring set',
    partialDOF: true,
    note: 'Carries shear only — it supplies no vertical or torsional stiffness, so on its own it leaves the isolation level with a zero-energy mode. Pair it with a companion element, or use one of the bearings that take -P, -T, -My and -Mz.',
    // The element carries one shear spring material, emitted as a bilinear
    // Steel01 built from the two properties below.
    matFlag: '-mat',
    springMaterial: { qd: 'qd', kInit: 'kInit', alpha: 'alpha' },
    params: [
      { key: 'nSpring', label: 'Number of springs', d: 8, step: 1, int: true },
      { key: 'qd', label: 'qd — spring yield force', unit: 'force', d: QD, half: true },
      { key: 'kInit', label: 'kInit — spring stiffness', unit: 'stiffness', d: KINIT, half: true },
      { key: 'alpha', label: 'α — hardening ratio', d: 0.05, step: 0.005 },
    ],
    /** nSpring is the only positional argument; the rest feed the material. */
    positional: ['nSpring'],
  },

  YamamotoBiaxialHDR: {
    label: 'YamamotoBiaxialHDR — biaxial high damping rubber',
    partialDOF: true,
    note: 'Carries shear only — it supplies no vertical or torsional stiffness, so on its own it leaves the isolation level with a zero-energy mode. Pair it with a companion element, or use one of the bearings that take -P, -T, -My and -Mz.',
    params: [
      { key: 'Tp', label: 'Tp — rubber type (1)', d: 1, step: 1, int: true, half: true },
      { key: 'DDo', label: 'DDo — outer diameter', unit: 'length', d: S(0.7, 700, 28), half: true },
      { key: 'DDi', label: 'DDi — inner diameter', unit: 'length', d: S(0.0, 0, 0), half: true },
      { key: 'Hr', label: 'Hr — total rubber height', unit: 'length', d: S(0.2, 200, 8), half: true },
    ],
  },
};

/* ════════════════════════════════════════════════════ dampers ════════ */

/**
 * Dampers are uniaxial materials carried by a `twoNodeLink` acting along its
 * own axis, which is the standard idealisation for a diagonal device.
 */
export const DAMPER_TYPES = {
  ViscousDamper: {
    label: 'ViscousDamper — fluid viscous, with brace stiffness',
    params: [
      { key: 'K_el', label: 'K — brace stiffness', unit: 'stiffness', d: S(400000, 400000, 2300) },
      { key: 'Cd', label: 'Cd — damping coefficient', unit: 'damping', d: CD, half: true },
      { key: 'alpha', label: 'α — velocity exponent', d: 0.5, step: 0.05, half: true },
    ],
  },
  Viscous: {
    label: 'Viscous — pure dashpot, no stiffness',
    params: [
      { key: 'C', label: 'C — damping coefficient', unit: 'damping', d: CD, half: true },
      { key: 'alpha', label: 'α — velocity exponent', d: 0.5, step: 0.05, half: true },
    ],
  },
  BilinearOilDamper: {
    label: 'BilinearOilDamper — relief valve damper',
    params: [
      { key: 'K_el', label: 'K — brace stiffness', unit: 'stiffness', d: S(400000, 400000, 2300) },
      { key: 'Cd', label: 'Cd — damping coefficient', unit: 'damping', d: CD, half: true },
      { key: 'Fr', label: 'Fr — relief force', unit: 'force', d: S(200, 200000, 45), half: true },
      { key: 'p', label: 'p — post-relief ratio', d: 0.1, step: 0.01 },
    ],
  },
  Steel02: {
    label: 'Steel02 — hysteretic brace or BRB',
    params: [
      { key: 'Fy', label: 'Fy — yield force', unit: 'force', d: S(400, 400000, 90), half: true },
      { key: 'E0', label: 'K — axial stiffness', unit: 'stiffness', d: S(400000, 400000, 2300), half: true },
      { key: 'b', label: 'b — hardening ratio', d: 0.02, step: 0.005 },
      { key: 'R0', label: 'R0', d: 20.0, step: 0.5, half: true },
      { key: 'cR1', label: 'cR1', d: 0.925, step: 0.005, half: true },
      { key: 'cR2', label: 'cR2', d: 0.15, step: 0.005 },
    ],
  },
  ElasticPP: {
    label: 'ElasticPP — friction damper',
    params: [
      { key: 'E', label: 'K — axial stiffness', unit: 'stiffness', d: S(400000, 400000, 2300), half: true },
      { key: 'epsyP', label: 'Slip displacement', unit: 'length', d: S(0.001, 1, 0.04), half: true },
    ],
  },
  SelfCentering: {
    label: 'SelfCentering — shape memory or post-tensioned',
    params: [
      { key: 'k1', label: 'k1 — initial stiffness', unit: 'stiffness', d: S(400000, 400000, 2300), half: true },
      { key: 'k2', label: 'k2 — post-activation', unit: 'stiffness', d: S(40000, 40000, 230), half: true },
      { key: 'sigAct', label: 'Activation force', unit: 'force', d: S(300, 300000, 67), half: true },
      { key: 'beta', label: 'β — unloading ratio', d: 0.6, step: 0.05, half: true },
    ],
  },
};

/* ═══════════════════════════════════════════════════ helpers ═════════ */

export const devKey = (group, type, key) => `dev.${group}.${type}.${key}`;

export const devConst = (group, key) =>
  `${group.toUpperCase()}_${key.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}`;

export function catalogueOf(group) {
  return { iso: ISOLATOR_TYPES, damp: DAMPER_TYPES, frn: FRICTION_MODELS }[group];
}
