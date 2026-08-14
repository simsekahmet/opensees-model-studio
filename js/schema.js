/**
 * schema.js — the declarative parameter catalogue.
 *
 * Every control in the sidebar is described here; `ui/form.js` renders it and
 * `state.js` derives its defaults from it.  Adding a new OpenSeesPy option is
 * therefore a matter of adding one entry, not of touching the DOM.
 *
 * Field shape
 *   id       unique key, also the state key
 *   type     'number' | 'text' | 'select' | 'check' | 'note'
 *   label    visible label
 *   unit     key into the active unit system (see units.js)
 *   d        default — a scalar, or an object keyed by unit system id
 *   options  [{ value, label }] for selects
 *   showIf   (state) => boolean, for conditional visibility
 *   half     render two fields per row
 *   hint     small helper text below the control
 */

import { UNIT_SYSTEMS } from './units.js';

const systemOptions = Object.entries(UNIT_SYSTEMS).map(([value, u]) => ({ value, label: u.label }));

const isRC    = (s) => s.matSystem === 'rc';
const isSteel = (s) => s.matSystem === 'steel';
const isFiber = (s) => s.sectionKind === 'Fiber';

export const SCHEMA = [

  /* ══════════════════════════════════════════════════════ Project ══════ */
  {
    id: 'project', title: 'Project & Units',
    fields: [
      { id: 'projectName', type: 'text', label: 'Model name', d: 'Frame Model' },
      {
        id: 'unitSystem', type: 'select', label: 'Unit system', options: systemOptions,
        d: 'kN-m',
        hint: 'OpenSees is unit agnostic — changing this resets unit-dependent defaults.',
      },
      { id: 'gravityAccel', type: 'number', label: 'Gravity g', unit: 'accel', step: 0.01,
        d: { 'kN-m': 9.81, 'N-mm': 9810, 'kip-in': 386.1 },
        hint: 'Used to convert gravity loads into nodal masses.' },
    ],
  },

  /* ═════════════════════════════════════════════════════ Geometry ══════ */
  {
    id: 'geometry', title: 'Geometry',
    fields: [
      { id: 'baysX', type: 'number', label: 'Bays along X', d: 3, min: 1, max: 30, step: 1, half: true },
      { id: 'baysY', type: 'number', label: 'Bays along Y', d: 2, min: 1, max: 30, step: 1, half: true },
      { id: 'spanX', type: 'text', label: 'Bay widths — X', unit: 'length',
        d: { 'kN-m': '6.0', 'N-mm': '6000', 'kip-in': '240' },
        hint: 'One value repeats for every bay, or list them: 6, 7.5, 6' },
      { id: 'spanY', type: 'text', label: 'Bay widths — Y', unit: 'length',
        d: { 'kN-m': '5.0', 'N-mm': '5000', 'kip-in': '200' } },
      { id: 'numStories', type: 'number', label: 'Number of stories', d: 4, min: 1, max: 60, step: 1 },
      { id: 'storyHeight', type: 'text', label: 'Story heights', unit: 'length',
        d: { 'kN-m': '3.2', 'N-mm': '3200', 'kip-in': '126' },
        hint: 'Listed bottom-up. A single value repeats for every story.' },
    ],
  },

  /* ════════════════════════════════════════════════════ Materials ══════ */
  {
    id: 'materials', title: 'Materials',
    fields: [
      { id: 'matSystem', type: 'select', label: 'Structural system', d: 'rc', options: [
        { value: 'rc',    label: 'Reinforced concrete' },
        { value: 'steel', label: 'Structural steel' },
      ]},

      { kind: 'sub', label: 'Concrete', showIf: isRC },
      { id: 'concreteMat', type: 'select', label: 'Concrete model', d: 'Concrete02', showIf: isRC, options: [
        { value: 'Elastic',     label: 'Elastic' },
        { value: 'Concrete01',  label: 'Concrete01 — Kent–Scott–Park' },
        { value: 'Concrete02',  label: 'Concrete02 — linear tension softening' },
        { value: 'Concrete04',  label: 'Concrete04 — Popovics' },
      ]},
      { id: 'fpc', type: 'number', label: 'f′c (compressive strength)', unit: 'stress', showIf: isRC,
        d: { 'kN-m': -30000, 'N-mm': -30, 'kip-in': -4.35 },
        hint: 'Negative in compression, per OpenSees sign convention.' },
      { id: 'epsc0', type: 'number', label: 'εc0 at f′c', step: 0.0001, showIf: isRC,
        d: -0.002, half: true },
      { id: 'epsU', type: 'number', label: 'εcu (crushing)', step: 0.0001, showIf: isRC,
        d: -0.0035, half: true },
      { id: 'fpcu', type: 'number', label: 'f′cu (residual)', unit: 'stress',
        showIf: (s) => isRC(s) && ['Concrete01', 'Concrete02'].includes(s.concreteMat),
        d: { 'kN-m': -6000, 'N-mm': -6, 'kip-in': -0.87 } },
      { id: 'ft', type: 'number', label: 'ft (tensile strength)', unit: 'stress', half: true,
        showIf: (s) => isRC(s) && s.concreteMat === 'Concrete02',
        d: { 'kN-m': 3000, 'N-mm': 3, 'kip-in': 0.435 } },
      { id: 'Ets', type: 'number', label: 'Ets (tension softening)', unit: 'stress', half: true,
        showIf: (s) => isRC(s) && s.concreteMat === 'Concrete02',
        d: { 'kN-m': 1500000, 'N-mm': 1500, 'kip-in': 218 } },
      { id: 'lambdaC', type: 'number', label: 'λ (unloading slope ratio)', step: 0.01,
        showIf: (s) => isRC(s) && s.concreteMat === 'Concrete02', d: 0.1 },
      { id: 'Ec', type: 'number', label: 'Ec (elastic modulus)', unit: 'stress', showIf: isRC,
        d: { 'kN-m': 30000000, 'N-mm': 30000, 'kip-in': 4350 },
        hint: 'Used for elastic sections, Concrete04 and section property output.' },
      { id: 'nu', type: 'number', label: 'Poisson ratio ν', step: 0.01, d: 0.2, half: true },
      { id: 'density', type: 'number', label: 'Mass density', unit: 'massVol', half: true,
        d: { 'kN-m': 2.4, 'N-mm': 2.4e-9, 'kip-in': 2.25e-4 } },
      { id: 'confineFactor', type: 'number', label: 'Core confinement factor K', step: 0.05, d: 1.30,
        showIf: (s) => isRC(s) && isFiber(s),
        hint: 'Confined core strength = K · f′c (Mander-type enhancement).' },

      { kind: 'sub', label: 'Steel / reinforcement' },
      { id: 'steelMat', type: 'select', label: 'Steel model', d: 'Steel02', options: [
        { value: 'Elastic',    label: 'Elastic' },
        { value: 'ElasticPP',  label: 'ElasticPP — elastic perfectly plastic' },
        { value: 'Steel01',    label: 'Steel01 — bilinear kinematic' },
        { value: 'Steel02',    label: 'Steel02 — Giuffré–Menegotto–Pinto' },
        { value: 'Hysteretic', label: 'Hysteretic — pinched' },
      ]},
      { id: 'Fy', type: 'number', label: 'Fy (yield strength)', unit: 'stress', half: true,
        d: { 'kN-m': 420000, 'N-mm': 420, 'kip-in': 60 } },
      { id: 'Es', type: 'number', label: 'Es (elastic modulus)', unit: 'stress', half: true,
        d: { 'kN-m': 200000000, 'N-mm': 200000, 'kip-in': 29000 } },
      { id: 'bHard', type: 'number', label: 'b (strain-hardening ratio)', step: 0.001, d: 0.01,
        showIf: (s) => ['Steel01', 'Steel02'].includes(s.steelMat) },
      { id: 'R0',  type: 'number', label: 'R0',  step: 0.5,  d: 18, half: true, showIf: (s) => s.steelMat === 'Steel02' },
      { id: 'cR1', type: 'number', label: 'cR1', step: 0.005, d: 0.925, half: true, showIf: (s) => s.steelMat === 'Steel02' },
      { id: 'cR2', type: 'number', label: 'cR2', step: 0.005, d: 0.15, showIf: (s) => s.steelMat === 'Steel02' },
      { id: 'pinchX', type: 'number', label: 'pinchX', step: 0.05, d: 0.8, half: true, showIf: (s) => s.steelMat === 'Hysteretic' },
      { id: 'pinchY', type: 'number', label: 'pinchY', step: 0.05, d: 0.5, half: true, showIf: (s) => s.steelMat === 'Hysteretic' },
      { id: 'damage1', type: 'number', label: 'damage1', step: 0.01, d: 0.0, half: true, showIf: (s) => s.steelMat === 'Hysteretic' },
      { id: 'damage2', type: 'number', label: 'damage2', step: 0.01, d: 0.0, half: true, showIf: (s) => s.steelMat === 'Hysteretic' },
      { id: 'betaH', type: 'number', label: 'beta', step: 0.05, d: 0.0, showIf: (s) => s.steelMat === 'Hysteretic' },
    ],
  },

  /* ═════════════════════════════════════════════════════ Sections ══════ */
  {
    id: 'sections', title: 'Sections',
    fields: [
      { id: 'sectionKind', type: 'select', label: 'Section formulation', d: 'Elastic', options: [
        { value: 'Elastic', label: 'Elastic — section(\'Elastic\', …)' },
        { value: 'Fiber',   label: 'Fiber — patches & layers' },
      ]},

      { kind: 'sub', label: 'Columns' },
      { id: 'colShape', type: 'select', label: 'Column shape', d: 'Rectangular', options: [
        { value: 'Rectangular', label: 'Rectangular' },
        { value: 'Circular',    label: 'Circular' },
        { value: 'ISection',    label: 'I / wide flange' },
      ]},
      { id: 'colB', type: 'number', label: 'Width b (local z)', unit: 'length', half: true,
        showIf: (s) => s.colShape === 'Rectangular',
        d: { 'kN-m': 0.50, 'N-mm': 500, 'kip-in': 20 } },
      { id: 'colH', type: 'number', label: 'Depth h (local y)', unit: 'length', half: true,
        showIf: (s) => s.colShape === 'Rectangular',
        d: { 'kN-m': 0.50, 'N-mm': 500, 'kip-in': 20 } },
      { id: 'colD', type: 'number', label: 'Diameter D', unit: 'length',
        showIf: (s) => s.colShape === 'Circular',
        d: { 'kN-m': 0.60, 'N-mm': 600, 'kip-in': 24 } },
      { id: 'colIh', type: 'number', label: 'Section depth d', unit: 'length', half: true,
        showIf: (s) => s.colShape === 'ISection', d: { 'kN-m': 0.40, 'N-mm': 400, 'kip-in': 16 } },
      { id: 'colIbf', type: 'number', label: 'Flange width bf', unit: 'length', half: true,
        showIf: (s) => s.colShape === 'ISection', d: { 'kN-m': 0.30, 'N-mm': 300, 'kip-in': 12 } },
      { id: 'colItf', type: 'number', label: 'Flange thk. tf', unit: 'length', half: true,
        showIf: (s) => s.colShape === 'ISection', d: { 'kN-m': 0.019, 'N-mm': 19, 'kip-in': 0.75 } },
      { id: 'colItw', type: 'number', label: 'Web thk. tw', unit: 'length', half: true,
        showIf: (s) => s.colShape === 'ISection', d: { 'kN-m': 0.012, 'N-mm': 12, 'kip-in': 0.47 } },

      { kind: 'sub', label: 'Beams' },
      { id: 'beamShape', type: 'select', label: 'Beam shape', d: 'Rectangular', options: [
        { value: 'Rectangular', label: 'Rectangular' },
        { value: 'ISection',    label: 'I / wide flange' },
      ]},
      { id: 'beamB', type: 'number', label: 'Width b (local z)', unit: 'length', half: true,
        showIf: (s) => s.beamShape === 'Rectangular',
        d: { 'kN-m': 0.30, 'N-mm': 300, 'kip-in': 12 } },
      { id: 'beamH', type: 'number', label: 'Depth h (local y)', unit: 'length', half: true,
        showIf: (s) => s.beamShape === 'Rectangular',
        d: { 'kN-m': 0.55, 'N-mm': 550, 'kip-in': 22 } },
      { id: 'beamIh', type: 'number', label: 'Section depth d', unit: 'length', half: true,
        showIf: (s) => s.beamShape === 'ISection', d: { 'kN-m': 0.45, 'N-mm': 450, 'kip-in': 18 } },
      { id: 'beamIbf', type: 'number', label: 'Flange width bf', unit: 'length', half: true,
        showIf: (s) => s.beamShape === 'ISection', d: { 'kN-m': 0.20, 'N-mm': 200, 'kip-in': 8 } },
      { id: 'beamItf', type: 'number', label: 'Flange thk. tf', unit: 'length', half: true,
        showIf: (s) => s.beamShape === 'ISection', d: { 'kN-m': 0.016, 'N-mm': 16, 'kip-in': 0.63 } },
      { id: 'beamItw', type: 'number', label: 'Web thk. tw', unit: 'length', half: true,
        showIf: (s) => s.beamShape === 'ISection', d: { 'kN-m': 0.010, 'N-mm': 10, 'kip-in': 0.39 } },
      { id: 'useSeparateGirder', type: 'check', d: false,
        label: 'Different section for Y-direction beams',
        hint: 'When off, X and Y beams share one section.' },
      { id: 'girderB', type: 'number', label: 'Y-beam width b', unit: 'length', half: true,
        showIf: (s) => s.useSeparateGirder, d: { 'kN-m': 0.30, 'N-mm': 300, 'kip-in': 12 } },
      { id: 'girderH', type: 'number', label: 'Y-beam depth h', unit: 'length', half: true,
        showIf: (s) => s.useSeparateGirder, d: { 'kN-m': 0.50, 'N-mm': 500, 'kip-in': 20 } },

      { kind: 'sub', label: 'Elastic stiffness modifiers', showIf: (s) => !isFiber(s) },
      { id: 'modCol', type: 'number', label: 'Column Ig factor', step: 0.05, d: 0.70, half: true, showIf: (s) => !isFiber(s) },
      { id: 'modBeam', type: 'number', label: 'Beam Ig factor', step: 0.05, d: 0.35, half: true, showIf: (s) => !isFiber(s) },

      { kind: 'sub', label: 'Fiber discretisation', showIf: isFiber },
      { id: 'cover', type: 'number', label: 'Clear cover', unit: 'length', showIf: isFiber,
        d: { 'kN-m': 0.04, 'N-mm': 40, 'kip-in': 1.6 } },
      { id: 'colBarsY', type: 'number', label: 'Column bars per y-face', d: 4, min: 2, max: 20, step: 1, half: true, showIf: isFiber },
      { id: 'colBarsZ', type: 'number', label: 'Column bars per z-face', d: 4, min: 2, max: 20, step: 1, half: true, showIf: isFiber },
      { id: 'colBarArea', type: 'number', label: 'Column bar area', unit: 'area', showIf: isFiber,
        d: { 'kN-m': 4.91e-4, 'N-mm': 491, 'kip-in': 0.79 },
        hint: 'Ø25 mm ≈ 491 mm²' },
      { id: 'beamBarsTop', type: 'number', label: 'Beam bars — top', d: 3, min: 2, max: 20, step: 1, half: true, showIf: isFiber },
      { id: 'beamBarsBot', type: 'number', label: 'Beam bars — bottom', d: 3, min: 2, max: 20, step: 1, half: true, showIf: isFiber },
      { id: 'beamBarArea', type: 'number', label: 'Beam bar area', unit: 'area', showIf: isFiber,
        d: { 'kN-m': 3.14e-4, 'N-mm': 314, 'kip-in': 0.44 },
        hint: 'Ø20 mm ≈ 314 mm²' },
      { id: 'nfCoreY', type: 'number', label: 'Core fibers — y', d: 10, min: 2, max: 40, step: 1, half: true, showIf: isFiber },
      { id: 'nfCoreZ', type: 'number', label: 'Core fibers — z', d: 10, min: 2, max: 40, step: 1, half: true, showIf: isFiber },
      { id: 'nfCoverY', type: 'number', label: 'Cover fibers — y', d: 8, min: 2, max: 40, step: 1, half: true, showIf: isFiber },
      { id: 'nfCoverZ', type: 'number', label: 'Cover fibers — z', d: 8, min: 2, max: 40, step: 1, half: true, showIf: isFiber },
      { id: 'torsionStiff', type: 'check', d: true, showIf: isFiber,
        label: 'Add elastic torsion (section Aggregator)',
        hint: 'Fiber sections have no torsional stiffness on their own.' },
    ],
  },

  /* ═════════════════════════════════════════════════════ Elements ══════ */
  {
    id: 'elements', title: 'Elements',
    fields: [
      { id: 'colElement', type: 'select', label: 'Column element', d: 'forceBeamColumn', options: [
        { value: 'elasticBeamColumn',    label: 'elasticBeamColumn' },
        { value: 'forceBeamColumn',      label: 'forceBeamColumn' },
        { value: 'dispBeamColumn',       label: 'dispBeamColumn' },
        { value: 'elasticTimoshenkoBeam',label: 'elasticTimoshenkoBeam' },
      ]},
      { id: 'beamElement', type: 'select', label: 'Beam element', d: 'forceBeamColumn', options: [
        { value: 'elasticBeamColumn',    label: 'elasticBeamColumn' },
        { value: 'forceBeamColumn',      label: 'forceBeamColumn' },
        { value: 'dispBeamColumn',       label: 'dispBeamColumn' },
        { value: 'elasticTimoshenkoBeam',label: 'elasticTimoshenkoBeam' },
      ]},
      { id: 'integration', type: 'select', label: 'Integration rule', d: 'Lobatto',
        showIf: (s) => ['forceBeamColumn', 'dispBeamColumn'].includes(s.colElement)
                    || ['forceBeamColumn', 'dispBeamColumn'].includes(s.beamElement),
        options: [
          { value: 'Lobatto',     label: 'Lobatto' },
          { value: 'Legendre',    label: 'Legendre' },
          { value: 'NewtonCotes', label: 'NewtonCotes' },
          { value: 'Radau',       label: 'Radau' },
          { value: 'Trapezoidal', label: 'Trapezoidal' },
        ]},
      { id: 'numIntPts', type: 'number', label: 'Integration points', d: 5, min: 2, max: 12, step: 1,
        showIf: (s) => ['forceBeamColumn', 'dispBeamColumn'].includes(s.colElement)
                    || ['forceBeamColumn', 'dispBeamColumn'].includes(s.beamElement) },

      { kind: 'sub', label: 'Geometric transformation' },
      { id: 'colTransf', type: 'select', label: 'Columns', d: 'PDelta', options: transfOptions(), half: true },
      { id: 'beamTransf', type: 'select', label: 'Beams', d: 'Linear', options: transfOptions(), half: true },

      { kind: 'sub', label: 'Element mass' },
      { id: 'elementMass', type: 'check', d: true,
        label: 'Assign consistent element mass',
        hint: 'Adds -mass ρ·A to every element, computed from the section area and mass density.' },
    ],
  },

  /* ══════════════════════════════════════════ Supports & constraints ══ */
  {
    id: 'supports', title: 'Supports & Constraints',
    fields: [
      { id: 'baseFixity', type: 'select', label: 'Base restraint', d: 'Fixed', options: [
        { value: 'Fixed',  label: 'Fixed — 1 1 1 1 1 1' },
        { value: 'Pinned', label: 'Pinned — 1 1 1 0 0 0' },
        { value: 'Roller', label: 'Roller — 0 0 1 0 0 0' },
        { value: 'Free',   label: 'Free — unrestrained' },
      ]},
      { id: 'rigidDiaphragm', type: 'check', d: false,
        label: 'Rigid floor diaphragms',
        hint: 'Creates a master node at each floor centroid and ties the slab nodes to it (perpDirn 3).' },
      { id: 'restrainDiaphragmDofs', type: 'check', d: true, showIf: (s) => s.rigidDiaphragm,
        label: 'Restrain out-of-plane DOFs of master nodes',
        hint: 'Fixes UZ, RX and RY of every master node.' },
    ],
  },

  /* ═════════════════════════════════════════════════ Loads & mass ══════ */
  {
    id: 'loads', title: 'Loads & Mass',
    fields: [
      { id: 'deadFloor', type: 'number', label: 'Floor dead load', unit: 'areaLoad', half: true,
        d: { 'kN-m': 4.5, 'N-mm': 4.5e-3, 'kip-in': 6.5e-4 } },
      { id: 'liveFloor', type: 'number', label: 'Floor live load', unit: 'areaLoad', half: true,
        d: { 'kN-m': 2.0, 'N-mm': 2.0e-3, 'kip-in': 2.9e-4 } },
      { id: 'deadRoof', type: 'number', label: 'Roof dead load', unit: 'areaLoad', half: true,
        d: { 'kN-m': 3.5, 'N-mm': 3.5e-3, 'kip-in': 5.1e-4 } },
      { id: 'liveRoof', type: 'number', label: 'Roof live load', unit: 'areaLoad', half: true,
        d: { 'kN-m': 1.5, 'N-mm': 1.5e-3, 'kip-in': 2.2e-4 } },
      { id: 'loadDistribution', type: 'select', label: 'Slab load distribution', d: 'tributary', options: [
        { value: 'tributary', label: 'Tributary width onto beams' },
        { value: 'oneway-x',  label: 'One-way — spanning along X' },
        { value: 'oneway-y',  label: 'One-way — spanning along Y' },
      ]},
      { id: 'dlFactor', type: 'number', label: 'Dead load factor', step: 0.05, d: 1.0, half: true },
      { id: 'llFactor', type: 'number', label: 'Live load factor', step: 0.05, d: 1.0, half: true },
      { id: 'selfWeight', type: 'check', d: true, label: 'Include member self weight',
        hint: 'Adds ρ·g·A as an extra uniform load on every element.' },

      { kind: 'sub', label: 'Seismic mass' },
      { id: 'massSource', type: 'select', label: 'Mass source', d: 'nodal', options: [
        { value: 'nodal', label: 'Lumped nodal mass from gravity loads' },
        { value: 'none',  label: 'No nodal mass (element mass only)' },
      ]},
      { id: 'massLiveFactor', type: 'number', label: 'Live load mass participation', step: 0.05, d: 0.30,
        showIf: (s) => s.massSource === 'nodal' },
    ],
  },

  /* ═════════════════════════════════════════════════════ Analysis ══════ */
  {
    id: 'analysis', title: 'Analysis',
    fields: [
      { id: 'runGravity', type: 'check', d: true, label: 'Run gravity analysis' },
      { id: 'gravitySteps', type: 'number', label: 'Load steps', d: 10, min: 1, max: 500, step: 1,
        showIf: (s) => s.runGravity },

      { kind: 'sub', label: 'Solution strategy' },
      { id: 'constraintsCmd', type: 'select', label: 'constraints', d: 'Transformation', options: opts(
        'Transformation', 'Plain', 'Penalty', 'Lagrange') },
      { id: 'numbererCmd', type: 'select', label: 'numberer', d: 'RCM', options: opts('RCM', 'Plain', 'AMD') },
      { id: 'systemCmd', type: 'select', label: 'system', d: 'BandGeneral', options: opts(
        'BandGeneral', 'BandSPD', 'ProfileSPD', 'SuperLU', 'UmfPack', 'FullGeneral', 'SparseSYM') },
      { id: 'testCmd', type: 'select', label: 'test', d: 'NormDispIncr', options: opts(
        'NormDispIncr', 'NormUnbalance', 'EnergyIncr', 'RelativeNormDispIncr', 'RelativeEnergyIncr') },
      { id: 'tol', type: 'number', label: 'Tolerance', step: 1e-9, d: 1e-8, half: true },
      { id: 'maxIter', type: 'number', label: 'Max iterations', d: 100, min: 1, max: 5000, step: 1, half: true },
      { id: 'algorithmCmd', type: 'select', label: 'algorithm', d: 'Newton', options: opts(
        'Newton', 'ModifiedNewton', 'KrylovNewton', 'NewtonLineSearch', 'BFGS', 'Broyden', 'Linear') },

      { kind: 'sub', label: 'Modal analysis' },
      { id: 'runModal', type: 'check', d: true, label: 'Run eigenvalue analysis' },
      { id: 'numModes', type: 'number', label: 'Number of modes', d: 6, min: 1, max: 60, step: 1,
        showIf: (s) => s.runModal },
      { id: 'eigenSolver', type: 'select', label: 'Eigen solver', d: '-genBandArpack',
        showIf: (s) => s.runModal, options: [
          { value: '-genBandArpack', label: '-genBandArpack' },
          { value: '-fullGenLapack', label: '-fullGenLapack' },
          { value: '-symmBandLapack', label: '-symmBandLapack' },
        ]},

      { kind: 'sub', label: 'Recorders' },
      { id: 'useRecorders', type: 'check', d: true, label: 'Write recorder output' },
      { id: 'recorderDir', type: 'text', label: 'Output folder', d: 'output',
        showIf: (s) => s.useRecorders },
    ],
  },
];

/* ────────────────────────────── helpers ─────────────────────────────── */

function opts(...values) {
  return values.map((v) => ({ value: v, label: v }));
}

function transfOptions() {
  return [
    { value: 'Linear',        label: 'Linear' },
    { value: 'PDelta',        label: 'PDelta' },
    { value: 'Corotational',  label: 'Corotational' },
  ];
}

/** Flat list of every real (non-decorative) field, used for defaults. */
export function allFields() {
  return SCHEMA.flatMap((g) => g.fields.filter((f) => f.id && f.type !== 'note'));
}
