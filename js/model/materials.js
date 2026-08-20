/**
 * model/materials.js — the uniaxialMaterial catalogue.
 *
 * Every entry lists its parameters in the exact order OpenSees expects them,
 * so the sidebar fields, the state defaults and the generated
 * `ops.uniaxialMaterial(...)` call all come from one declaration.  Signatures
 * were taken from the OpenSeesPy documentation.
 *
 * Parameter shape
 *   key      state key suffix and Python constant name
 *   label    visible label
 *   unit     key into the active unit system (see units.js)
 *   d        default — scalar, or an object keyed by unit system id
 *   options  present for string-valued arguments (rendered as a select)
 *   flag     emitted verbatim before this argument, e.g. '-kin'
 *
 * `confine` marks the arguments a Mander-style core enhancement scales, which
 * is what lets a fiber section have a confined core and an unconfined cover.
 */

/** Stress-valued default: 30 MPa expressed in each unit system. */
const S = (kNm, Nmm, kipin) => ({ 'kN-m': kNm, 'N-mm': Nmm, 'kip-in': kipin });
/** Length-valued default. */
const L = (kNm, Nmm, kipin) => ({ 'kN-m': kNm, 'N-mm': Nmm, 'kip-in': kipin });

const FPC = S(-30000, -30, -4.35);
const FCU = S(-6000, -6, -0.87);
const FT = S(3000, 3, 0.435);
const EC = S(30000000, 30000, 4350);
const ETS = S(1500000, 1500, 218);
const FY = S(420000, 420, 60);
const FU = S(550000, 550, 80);
const ES = S(200000000, 200000, 29000);

/* ═══════════════════════════════════════════════════ concrete ════════ */

export const CONCRETE_MODELS = {
  Elastic: {
    label: 'Elastic — linear',
    params: [{ key: 'E', label: 'E', unit: 'stress', d: EC }],
  },

  Concrete01: {
    label: 'Concrete01 — Kent–Scott–Park',
    confine: { strength: ['fpc', 'fpcu'], strain: ['epsc0', 'epsU'] },
    params: [
      { key: 'fpc', label: "f′c", unit: 'stress', d: FPC },
      { key: 'epsc0', label: 'εc0', d: -0.002, step: 0.0001, half: true },
      { key: 'fpcu', label: "f′cu", unit: 'stress', d: FCU, half: true },
      { key: 'epsU', label: 'εU', d: -0.0035, step: 0.0001 },
    ],
  },

  Concrete02: {
    label: 'Concrete02 — linear tension softening',
    confine: { strength: ['fpc', 'fpcu'], strain: ['epsc0', 'epsU'] },
    params: [
      { key: 'fpc', label: "f′c", unit: 'stress', d: FPC },
      { key: 'epsc0', label: 'εc0', d: -0.002, step: 0.0001, half: true },
      { key: 'fpcu', label: "f′cu", unit: 'stress', d: FCU, half: true },
      { key: 'epsU', label: 'εU', d: -0.0035, step: 0.0001, half: true },
      { key: 'lambda', label: 'λ', d: 0.1, step: 0.01, half: true },
      { key: 'ft', label: 'ft', unit: 'stress', d: FT, half: true },
      { key: 'Ets', label: 'Ets', unit: 'stress', d: ETS, half: true },
    ],
  },

  Concrete02IS: {
    label: 'Concrete02IS — with initial stiffness',
    confine: { strength: ['fpc', 'fpcu'], strain: ['epsc0', 'epsU'] },
    params: [
      { key: 'E0', label: 'E0', unit: 'stress', d: EC },
      { key: 'fpc', label: "f′c", unit: 'stress', d: FPC },
      { key: 'epsc0', label: 'εc0', d: -0.002, step: 0.0001, half: true },
      { key: 'fpcu', label: "f′cu", unit: 'stress', d: FCU, half: true },
      { key: 'epsU', label: 'εU', d: -0.0035, step: 0.0001, half: true },
      { key: 'lambda', label: 'λ', d: 0.1, step: 0.01, half: true },
      { key: 'ft', label: 'ft', unit: 'stress', d: FT, half: true },
      { key: 'Ets', label: 'Ets', unit: 'stress', d: ETS, half: true },
    ],
  },

  Concrete04: {
    label: 'Concrete04 — Popovics',
    confine: { strength: ['fc'], strain: ['ec', 'ecu'] },
    params: [
      { key: 'fc', label: "f′c", unit: 'stress', d: FPC },
      { key: 'ec', label: 'εc', d: -0.002, step: 0.0001, half: true },
      { key: 'ecu', label: 'εcu', d: -0.004, step: 0.0001, half: true },
      { key: 'Ec', label: 'Ec', unit: 'stress', d: EC },
      { key: 'fct', label: 'fct', unit: 'stress', d: FT, half: true },
      { key: 'et', label: 'εt', d: 0.0001, step: 0.00001, half: true },
      { key: 'beta', label: 'β', d: 0.1, step: 0.01 },
    ],
  },

  Concrete06: {
    label: 'Concrete06 — Chang & Mander',
    params: [
      { key: 'fc', label: "f′c", unit: 'stress', d: FPC },
      { key: 'e0', label: 'ε0', d: -0.002, step: 0.0001, half: true },
      { key: 'n', label: 'n — compressive shape', d: 4.0, step: 0.1, half: true },
      { key: 'k', label: 'k — post-peak shape', d: 1.0, step: 0.05, half: true },
      { key: 'alpha1', label: 'α1', d: 0.32, step: 0.01, half: true },
      { key: 'fcr', label: 'fcr — tensile strength', unit: 'stress', d: FT },
      { key: 'ecr', label: 'εcr', d: 0.00008, step: 0.00001, half: true },
      { key: 'b', label: 'b — tension exponent', d: 4.0, step: 0.1, half: true },
      { key: 'alpha2', label: 'α2', d: 0.08, step: 0.01 },
    ],
  },

  Concrete07: {
    label: 'Concrete07 — Chang & Mander simplified',
    params: [
      { key: 'fc', label: "f′c", unit: 'stress', d: FPC },
      { key: 'epsc', label: 'εc', d: -0.002, step: 0.0001, half: true },
      { key: 'Ec', label: 'Ec', unit: 'stress', d: EC, half: true },
      { key: 'ft', label: 'ft', unit: 'stress', d: FT, half: true },
      { key: 'et', label: 'εt', d: 0.0001, step: 0.00001, half: true },
      { key: 'xp', label: 'xp — tension descent', d: 2.0, step: 0.1, half: true },
      { key: 'xn', label: 'xn — compression descent', d: 2.3, step: 0.1, half: true },
      { key: 'r', label: 'r — descending branch', d: 4.0, step: 0.1 },
    ],
  },

  Concrete01WithSITC: {
    label: 'Concrete01WithSITC — stuff in the crack',
    confine: { strength: ['fpc', 'fpcu'], strain: ['epsc0', 'epsU'] },
    params: [
      { key: 'fpc', label: "f′c", unit: 'stress', d: FPC },
      { key: 'epsc0', label: 'εc0', d: -0.002, step: 0.0001, half: true },
      { key: 'fpcu', label: "f′cu", unit: 'stress', d: FCU, half: true },
      { key: 'epsU', label: 'εU', d: -0.0035, step: 0.0001, half: true },
      { key: 'endStrainSITC', label: 'end strain SITC', d: 0.03, step: 0.001, half: true },
    ],
  },

  ConfinedConcrete01: {
    label: 'ConfinedConcrete01 — Braga et al.',
    note: 'Confinement is computed from the hoop layout, so the core factor above is not applied.',
    params: [
      { key: 'secType', label: 'Section type', d: 'R', options: [
        { value: 'S1', label: 'S1 — square, one hoop' },
        { value: 'S2', label: 'S2 — square, two hoops' },
        { value: 'S3', label: 'S3 — square, one hoop + cross ties' },
        { value: 'S4', label: 'S4 — square, two hoops + cross ties' },
        { value: 'S5', label: 'S5 — square, three hoops' },
        { value: 'C',  label: 'C — circular' },
        { value: 'R',  label: 'R — rectangular' },
      ]},
      { key: 'fpc', label: "f′c (unconfined)", unit: 'stress', d: FPC },
      { key: 'Ec', label: 'Ec', unit: 'stress', d: EC },
      { key: 'epscu_type', label: 'εcu definition', d: '-epscu', options: [
        { value: '-epscu', label: '-epscu — direct ultimate strain' },
        { value: '-gamma', label: '-gamma — from confinement energy' },
      ]},
      { key: 'epscu_val', label: 'εcu value', d: -0.02, step: 0.001, half: true },
      { key: 'nu', label: 'ν', d: 0.2, step: 0.01, half: true },
      { key: 'L1', label: 'L1 — core dimension', unit: 'length', d: L(0.42, 420, 16.8), half: true },
      { key: 'L2', label: 'L2', unit: 'length', d: L(0.42, 420, 16.8), half: true },
      { key: 'L3', label: 'L3', unit: 'length', d: L(0.42, 420, 16.8), half: true },
      { key: 'phis', label: 'Hoop diameter', unit: 'length', d: L(0.010, 10, 0.4), half: true },
      { key: 'S', label: 'Hoop spacing', unit: 'length', d: L(0.10, 100, 4), half: true },
      { key: 'fyh', label: 'fyh — hoop yield', unit: 'stress', d: S(420000, 420, 60), half: true },
      { key: 'Es0', label: 'Es0 — hoop modulus', unit: 'stress', d: ES, half: true },
      { key: 'haRatio', label: 'Hardening ratio', d: 0.01, step: 0.001, half: true },
      { key: 'mu', label: 'Ductility factor', d: 100.0, step: 1, half: true },
      { key: 'phiLon', label: 'Long. bar diameter', unit: 'length', d: L(0.025, 25, 1.0), half: true },
    ],
  },

  ConcreteD: {
    label: 'ConcreteD — Chinese design code',
    params: [
      { key: 'fc', label: "f′c", unit: 'stress', d: FPC },
      { key: 'epsc', label: 'εc', d: -0.002, step: 0.0001, half: true },
      { key: 'ft', label: 'ft', unit: 'stress', d: FT, half: true },
      { key: 'epst', label: 'εt', d: 0.0001, step: 0.00001, half: true },
      { key: 'Ec', label: 'Ec', unit: 'stress', d: EC, half: true },
      { key: 'alphac', label: 'αc — compressive descent', d: 1.5, step: 0.1, half: true },
      { key: 'alphat', label: 'αt — tensile descent', d: 1.5, step: 0.1, half: true },
      { key: 'cesp', label: 'cesp', d: 0.25, step: 0.01, half: true },
      { key: 'etap', label: 'ηp', d: 1.15, step: 0.01, half: true },
    ],
  },


  FRPConfinedConcrete02: {
    label: 'FRPConfinedConcrete02 — circular jacket',
    note: 'Emitted with the -JacketC form for circular sections.',
    params: [
      { key: 'fc0', label: "f′c0", unit: 'stress', d: FPC, half: true },
      { key: 'Ec', label: 'Ec', unit: 'stress', d: EC, half: true },
      { key: 'ec0', label: 'εc0', d: -0.002, step: 0.0001 },
      { key: 'tfrp', label: 'FRP thickness', unit: 'length', flag: '-JacketC', d: L(0.001, 1, 0.04), half: true },
      { key: 'Efrp', label: 'FRP modulus', unit: 'stress', d: S(230000000, 230000, 33000), half: true },
      { key: 'erup', label: 'Rupture strain', d: 0.015, step: 0.001, half: true },
      { key: 'R', label: 'Column radius', unit: 'length', d: L(0.3, 300, 12), half: true },
      { key: 'ft', label: 'ft', unit: 'stress', d: FT, half: true },
      { key: 'Ets', label: 'Ets', unit: 'stress', d: ETS, half: true },
      { key: 'Unit', label: 'Unit flag (1 = SI, 0 = US)', d: 1, step: 1 , int: true },
    ],
  },

  ConcreteCM: {
    label: 'ConcreteCM — Chang & Mander, full cyclic',
    confine: { strength: ['fpcc'], strain: ['epcc'] },
    params: [
      { key: 'fpcc', label: "f′cc", unit: 'stress', d: FPC },
      { key: 'epcc', label: 'εcc', d: -0.002, step: 0.0001, half: true },
      { key: 'Ec', label: 'Ec', unit: 'stress', d: EC, half: true },
      { key: 'rc', label: 'rc — compression shape', d: 7.0, step: 0.1, half: true },
      { key: 'xcrn', label: 'xcrn', d: 1.035, step: 0.005, half: true },
      { key: 'ft', label: 'ft', unit: 'stress', d: FT, half: true },
      { key: 'et', label: 'εt', d: 0.00008, step: 0.00001, half: true },
      { key: 'rt', label: 'rt — tension shape', d: 1.2, step: 0.1, half: true },
      { key: 'xcrp', label: 'xcrp', d: 10000.0, step: 100, half: true },
    ],
  },

  TDConcrete: {
    label: 'TDConcrete — creep and shrinkage',
    params: [
      { key: 'fc', label: "f′c", unit: 'stress', d: FPC, half: true },
      { key: 'fct', label: 'fct', unit: 'stress', d: FT, half: true },
      { key: 'Ec', label: 'Ec', unit: 'stress', d: EC },
      { key: 'beta', label: 'β — tension softening', d: 0.4, step: 0.05, half: true },
      { key: 'tD', label: 'tD — drying start [days]', d: 14.0, step: 1, half: true },
      { key: 'epsshu', label: 'εshu — ultimate shrinkage', d: -0.0004, step: 0.00001, half: true },
      { key: 'psish', label: 'ψsh', d: 64.174, step: 0.1, half: true },
      { key: 'Tcr', label: 'Tcr — creep age [days]', d: 28.0, step: 1, half: true },
      { key: 'phiu', label: 'φu — ultimate creep', d: 2.0, step: 0.1, half: true },
      { key: 'psicr1', label: 'ψcr1', d: 1.0, step: 0.1, half: true },
      { key: 'psicr2', label: 'ψcr2', d: 75.4, step: 0.1, half: true },
      { key: 'tcast', label: 'tcast [days]', d: 2.0, step: 1, half: true },
    ],
  },

  TDConcreteEXP: {
    label: 'TDConcreteEXP — exponential creep',
    params: [
      { key: 'fc', label: "f′c", unit: 'stress', d: FPC, half: true },
      { key: 'fct', label: 'fct', unit: 'stress', d: FT, half: true },
      { key: 'Ec', label: 'Ec', unit: 'stress', d: EC },
      { key: 'beta', label: 'β', d: 0.4, step: 0.05, half: true },
      { key: 'tD', label: 'tD [days]', d: 14.0, step: 1, half: true },
      { key: 'epsshu', label: 'εshu', d: -0.0004, step: 0.00001, half: true },
      { key: 'psish', label: 'ψsh', d: 64.174, step: 0.1, half: true },
      { key: 'Tcr', label: 'Tcr [days]', d: 28.0, step: 1, half: true },
      { key: 'epscru', label: 'εcru — ultimate creep', d: 0.0002, step: 0.00001, half: true },
      { key: 'sigCr', label: 'σcr', unit: 'stress', d: S(-15000, -15, -2.2), half: true },
      { key: 'psicr1', label: 'ψcr1', d: 1.0, step: 0.1, half: true },
      { key: 'psicr2', label: 'ψcr2', d: 75.4, step: 0.1, half: true },
      { key: 'tcast', label: 'tcast [days]', d: 2.0, step: 1 },
    ],
  },

  TDConcreteMC10: {
    label: 'TDConcreteMC10 — fib Model Code 2010',
    params: [
      { key: 'fc', label: "f′c", unit: 'stress', d: FPC, half: true },
      { key: 'fct', label: 'fct', unit: 'stress', d: FT, half: true },
      { key: 'Ec', label: 'Ec', unit: 'stress', d: EC, half: true },
      { key: 'Ecm', label: 'Ecm (28 day)', unit: 'stress', d: EC, half: true },
      { key: 'beta', label: 'β', d: 0.4, step: 0.05, half: true },
      { key: 'tD', label: 'tD [days]', d: 14.0, step: 1, half: true },
      { key: 'epsba', label: 'εba', d: -0.0001, step: 0.00001, half: true },
      { key: 'epsbb', label: 'εbb', d: 1.0, step: 0.1, half: true },
      { key: 'epsda', label: 'εda', d: -0.0003, step: 0.00001, half: true },
      { key: 'epsdb', label: 'εdb', d: 1.0, step: 0.1, half: true },
      { key: 'phiba', label: 'φba', d: 0.5, step: 0.05, half: true },
      { key: 'phibb', label: 'φbb', d: 1.0, step: 0.1, half: true },
      { key: 'phida', label: 'φda', d: 1.5, step: 0.1, half: true },
      { key: 'phidb', label: 'φdb', d: 1.0, step: 0.1, half: true },
      { key: 'tcast', label: 'tcast [days]', d: 2.0, step: 1, half: true },
      { key: 'cem', label: 'cem — cement class', d: 1.0, step: 1, half: true , int: true },
    ],
  },

  TDConcreteMC10NL: {
    label: 'TDConcreteMC10NL — MC2010, nonlinear compression',
    params: [
      { key: 'fc', label: "f′c", unit: 'stress', d: FPC, half: true },
      { key: 'fcu', label: "f′cu", unit: 'stress', d: FCU, half: true },
      { key: 'epscu', label: 'εcu', d: -0.0035, step: 0.0001, half: true },
      { key: 'fct', label: 'fct', unit: 'stress', d: FT, half: true },
      { key: 'Ec', label: 'Ec', unit: 'stress', d: EC, half: true },
      { key: 'Ecm', label: 'Ecm (28 day)', unit: 'stress', d: EC, half: true },
      { key: 'beta', label: 'β', d: 0.4, step: 0.05, half: true },
      { key: 'tD', label: 'tD [days]', d: 14.0, step: 1, half: true },
      { key: 'epsba', label: 'εba', d: -0.0001, step: 0.00001, half: true },
      { key: 'epsbb', label: 'εbb', d: 1.0, step: 0.1, half: true },
      { key: 'epsda', label: 'εda', d: -0.0003, step: 0.00001, half: true },
      { key: 'epsdb', label: 'εdb', d: 1.0, step: 0.1, half: true },
      { key: 'phiba', label: 'φba', d: 0.5, step: 0.05, half: true },
      { key: 'phibb', label: 'φbb', d: 1.0, step: 0.1, half: true },
      { key: 'phida', label: 'φda', d: 1.5, step: 0.1, half: true },
      { key: 'phidb', label: 'φdb', d: 1.0, step: 0.1, half: true },
      { key: 'tcast', label: 'tcast [days]', d: 2.0, step: 1, half: true },
      { key: 'cem', label: 'cem — cement class', d: 1.0, step: 1, half: true , int: true },
    ],
  },
};

/* ══════════════════════════════════════════════ steel & rebar ════════ */

export const STEEL_MODELS = {
  Elastic: {
    label: 'Elastic — linear',
    params: [{ key: 'E', label: 'E', unit: 'stress', d: ES }],
  },

  ElasticPP: {
    label: 'ElasticPP — elastic perfectly plastic',
    params: [
      { key: 'E', label: 'E', unit: 'stress', d: ES },
      { key: 'epsyP', label: 'εy (tension)', d: 0.0021, step: 0.0001, half: true },
      { key: 'epsyN', label: 'εy (compression)', d: -0.0021, step: 0.0001, half: true },
      { key: 'eps0', label: 'Initial strain', d: 0.0, step: 0.0001 },
    ],
  },

  ElasticPPGap: {
    label: 'ElasticPPGap — with initial gap',
    params: [
      { key: 'E', label: 'E', unit: 'stress', d: ES, half: true },
      { key: 'Fy', label: 'Fy', unit: 'stress', d: FY, half: true },
      { key: 'gap', label: 'Initial gap', d: 0.0, step: 0.0001, half: true },
      { key: 'eta', label: 'η — hardening ratio', d: 0.0, step: 0.001, half: true },
      { key: 'damage', label: 'Gap behaviour', d: 'noDamage', options: [
        { value: 'noDamage', label: 'noDamage — gap recentres' },
        { value: 'damage', label: 'damage — permanent gap' },
      ]},
    ],
  },

  ENT: {
    label: 'ENT — elastic, no tension',
    params: [{ key: 'E', label: 'E', unit: 'stress', d: ES }],
  },

  Steel01: {
    label: 'Steel01 — bilinear kinematic',
    params: [
      { key: 'Fy', label: 'Fy', unit: 'stress', d: FY, half: true },
      { key: 'E0', label: 'E0', unit: 'stress', d: ES, half: true },
      { key: 'b', label: 'b — hardening ratio', d: 0.01, step: 0.001 },
    ],
  },

  Steel01Thermal: {
    label: 'Steel01Thermal — bilinear with temperature',
    params: [
      { key: 'Fy', label: 'Fy', unit: 'stress', d: FY, half: true },
      { key: 'E0', label: 'E0', unit: 'stress', d: ES, half: true },
      { key: 'b', label: 'b — hardening ratio', d: 0.01, step: 0.001 },
    ],
  },

  Steel02: {
    label: 'Steel02 — Giuffré–Menegotto–Pinto',
    params: [
      { key: 'Fy', label: 'Fy', unit: 'stress', d: FY, half: true },
      { key: 'E0', label: 'E0', unit: 'stress', d: ES, half: true },
      { key: 'b', label: 'b — hardening ratio', d: 0.01, step: 0.001 },
      { key: 'R0', label: 'R0', d: 18.0, step: 0.5, half: true },
      { key: 'cR1', label: 'cR1', d: 0.925, step: 0.005, half: true },
      { key: 'cR2', label: 'cR2', d: 0.15, step: 0.005 },
    ],
  },

  Steel4: {
    label: 'Steel4 — kinematic hardening',
    note: 'Emitted with the -kin flag; the isotropic, ultimate and asymmetric options are not exposed yet.',
    params: [
      { key: 'Fy', label: 'Fy', unit: 'stress', d: FY, half: true },
      { key: 'E0', label: 'E0', unit: 'stress', d: ES, half: true },
      { key: 'b_k', label: 'b_k — hardening ratio', flag: '-kin', d: 0.01, step: 0.001 },
      { key: 'R_0', label: 'R_0', d: 20.0, step: 0.5, half: true },
      { key: 'r_1', label: 'r_1', d: 0.90, step: 0.01, half: true },
      { key: 'r_2', label: 'r_2', d: 0.15, step: 0.01 },
    ],
  },

  ReinforcingSteel: {
    label: 'ReinforcingSteel — Chang & Mander rebar',
    params: [
      { key: 'fy', label: 'fy', unit: 'stress', d: FY, half: true },
      { key: 'fu', label: 'fu', unit: 'stress', d: FU, half: true },
      { key: 'Es', label: 'Es', unit: 'stress', d: ES, half: true },
      { key: 'Esh', label: 'Esh — hardening modulus', unit: 'stress', d: S(2000000, 2000, 290), half: true },
      { key: 'eps_sh', label: 'εsh — hardening start', d: 0.008, step: 0.0005, half: true },
      { key: 'eps_ult', label: 'εult', d: 0.10, step: 0.005, half: true },
    ],
  },

  Dodd_Restrepo: {
    label: 'Dodd–Restrepo — rebar',
    params: [
      { key: 'Fy', label: 'Fy', unit: 'stress', d: FY, half: true },
      { key: 'Fsu', label: 'Fsu — ultimate', unit: 'stress', d: FU, half: true },
      { key: 'ESH', label: 'εsh', d: 0.008, step: 0.0005, half: true },
      { key: 'ESU', label: 'εsu', d: 0.10, step: 0.005, half: true },
      { key: 'Youngs', label: 'E', unit: 'stress', d: ES },
      { key: 'ESHI', label: 'εshi — curve point strain', d: 0.05, step: 0.005, half: true },
      { key: 'FSHI', label: 'σshi — curve point stress', unit: 'stress', d: S(520000, 520, 75), half: true },
      { key: 'OmegaFac', label: 'Ω — Bauschinger roundedness', d: 1.0, step: 0.05 },
    ],
  },


  SteelMPF: {
    label: 'SteelMPF — asymmetric Menegotto–Pinto',
    params: [
      { key: 'fyp', label: 'fy (tension)', unit: 'stress', d: FY, half: true },
      { key: 'fyn', label: 'fy (compression)', unit: 'stress', d: FY, half: true },
      { key: 'E0', label: 'E0', unit: 'stress', d: ES },
      { key: 'bp', label: 'b (tension)', d: 0.01, step: 0.001, half: true },
      { key: 'bn', label: 'b (compression)', d: 0.01, step: 0.001, half: true },
      { key: 'R0', label: 'R0', d: 20.0, step: 0.5, half: true },
      { key: 'cR1', label: 'cR1', d: 0.925, step: 0.005, half: true },
      { key: 'cR2', label: 'cR2', d: 0.15, step: 0.005 },
    ],
  },

  Hysteretic: {
    label: 'Hysteretic — pinched, three-point backbone',
    params: [
      { key: 's1p', label: 'σ1 (+)', unit: 'stress', d: FY, half: true },
      { key: 'e1p', label: 'ε1 (+)', d: 0.0021, step: 0.0001, half: true },
      { key: 's2p', label: 'σ2 (+)', unit: 'stress', d: S(525000, 525, 75), half: true },
      { key: 'e2p', label: 'ε2 (+)', d: 0.02, step: 0.001, half: true },
      { key: 's3p', label: 'σ3 (+)', unit: 'stress', d: S(84000, 84, 12), half: true },
      { key: 'e3p', label: 'ε3 (+)', d: 0.10, step: 0.005, half: true },
      { key: 's1n', label: 'σ1 (−)', unit: 'stress', d: S(-420000, -420, -60), half: true },
      { key: 'e1n', label: 'ε1 (−)', d: -0.0021, step: 0.0001, half: true },
      { key: 's2n', label: 'σ2 (−)', unit: 'stress', d: S(-525000, -525, -75), half: true },
      { key: 'e2n', label: 'ε2 (−)', d: -0.02, step: 0.001, half: true },
      { key: 's3n', label: 'σ3 (−)', unit: 'stress', d: S(-84000, -84, -12), half: true },
      { key: 'e3n', label: 'ε3 (−)', d: -0.10, step: 0.005, half: true },
      { key: 'pinchX', label: 'pinchX', d: 0.8, step: 0.05, half: true },
      { key: 'pinchY', label: 'pinchY', d: 0.5, step: 0.05, half: true },
      { key: 'damage1', label: 'damage1', d: 0.0, step: 0.01, half: true },
      { key: 'damage2', label: 'damage2', d: 0.0, step: 0.01, half: true },
      { key: 'beta', label: 'β', d: 0.0, step: 0.05 },
    ],
  },
};

/* ═══════════════════════════════════════════════════ helpers ═════════ */

/** State key for one material parameter, e.g. `mat.Concrete02.fpc`. */
export const matKey = (family, type, key) => `mat.${family}.${type}.${key}`;

/** Python constant name, e.g. `CONC_FPC`. */
export const constName = (family, key) =>
  `${family === 'conc' ? 'CONC' : 'STEEL'}_${key.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}`;

/**
 * Argument expressions for one material, in OpenSees order.
 * `scale` optionally multiplies the confined-core arguments, which is how the
 * core material is emitted from the same parameter block as the cover.
 */
export function materialArgs(def, family, { core = false } = {}) {
  const out = [];
  for (const p of def.params) {
    if (p.flag) out.push(`'${p.flag}'`);
    if (p.options) { out.push(constName(family, p.key)); continue; }

    const name = constName(family, p.key);
    if (!core || !def.confine) { out.push(name); continue; }

    if (def.confine.strength?.includes(p.key)) out.push(`${name} * K_CONF`);
    else if (def.confine.strain?.includes(p.key)) out.push(`${name} * KE_CONF`);
    else out.push(name);
  }
  return out;
}

/** Every parameter of every model, used to build the schema and defaults. */
export function modelsOf(family) {
  return family === 'conc' ? CONCRETE_MODELS : STEEL_MODELS;
}
