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
import { CONCRETE_MODELS, STEEL_MODELS, modelsOf, matKey } from './model/materials.js';
import {
  ISOLATOR_TYPES, DAMPER_TYPES, FRICTION_MODELS, catalogueOf, devKey,
} from './model/devices.js';

const systemOptions = Object.entries(UNIT_SYSTEMS).map(([value, u]) => ({ value, label: u.label }));

const isRC    = (s) => s.matSystem === 'rc';
const isSteel = (s) => s.matSystem === 'steel';
const isFiber = (s) => s.sectionKind === 'Fiber';

/**
 * Which formulations actually read the uniaxial concrete and steel models.
 *
 * An elastic section is built from E, G and the section geometry, and an
 * NDFiber section from a single nDMaterial. Both leave every field below
 * untouched, so asking for them would be asking for numbers that change
 * nothing — and the script would define three materials nothing refers to.
 */
const usesUniaxial = (s) => s.sectionKind === 'Fiber' || s.sectionKind === 'RCCircularSection';

const usesIso      = (s) => !!s.useIsolation;
const usesDampers  = (s) => !!s.useDampers;
const usesFriction = (s) => usesIso(s) && !!ISOLATOR_TYPES[s.isolatorType]?.friction;
const usesAux      = (s) => usesIso(s) && !!ISOLATOR_TYPES[s.isolatorType]?.aux;

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
      { id: 'gravityAccel', type: 'number', gt: 0, label: 'Gravity g', unit: 'accel', step: 0.01,
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

      { kind: 'sub', label: 'Concrete', showIf: (s) => isRC(s) && usesUniaxial(s) },
      { id: 'concreteMat', type: 'select', label: 'Concrete model', d: 'Concrete02',
        showIf: (s) => isRC(s) && usesUniaxial(s),
        options: modelOptions(CONCRETE_MODELS) },
      ...materialFields('conc', 'concreteMat', (s) => isRC(s) && usesUniaxial(s)),
      { id: 'confineFactor', type: 'number', gt: 0, label: 'Core confinement factor K', step: 0.05, d: 1.30,
        showIf: (s) => isRC(s) && isFiber(s) && !!CONCRETE_MODELS[s.concreteMat]?.confine,
        hint: 'Core strength = K · f′c and core strain = 1 + 5(K − 1) times the cover value.' },

      { kind: 'sub', label: 'Steel / reinforcement', showIf: usesUniaxial },
      { id: 'steelMat', type: 'select', label: 'Steel model', d: 'Steel02',
        showIf: usesUniaxial, options: modelOptions(STEEL_MODELS) },
      ...materialFields('steel', 'steelMat', usesUniaxial),

      { kind: 'sub', label: 'General properties' },
      { id: 'Ec', type: 'number', gt: 0, label: 'Ec — concrete elastic modulus', unit: 'stress', showIf: isRC,
        d: { 'kN-m': 30000000, 'N-mm': 30000, 'kip-in': 4350 },
        hint: 'Used for elastic sections and the reported section properties.' },
      { id: 'Es', type: 'number', gt: 0, label: 'Es — steel elastic modulus', unit: 'stress', showIf: isSteel,
        d: { 'kN-m': 200000000, 'N-mm': 200000, 'kip-in': 29000 },
        hint: 'Used for elastic sections and the reported section properties.' },
      { id: 'nu', type: 'number', gt: -1, max: 0.5, label: 'Poisson ratio ν', step: 0.01, d: 0.2, half: true },
      { id: 'density', type: 'number', gt: 0, label: 'Mass density', unit: 'massVol', half: true,
        d: { 'kN-m': 2.4, 'N-mm': 2.4e-9, 'kip-in': 2.25e-4 } },
    ],
  },

  /* ═════════════════════════════════════════════════════ Sections ══════ */
  {
    id: 'sections', title: 'Sections',
    fields: [
      { id: 'sectionKind', type: 'select', label: 'Section formulation', d: 'Elastic', options: [
        { value: 'Elastic', label: 'Elastic — linear, section(Elastic)' },
        { value: 'Fiber',   label: 'Fiber — uniaxial fibers, patches & layers' },
        { value: 'NDFiber', label: 'NDFiber — fibers of an nDMaterial' },
        { value: 'RCCircularSection', label: 'RCCircularSection — built-in circular RC' },
      ],
        hint: 'Elastic keeps the material response linear. The others give material '
            + 'nonlinearity; geometric nonlinearity is separate, set by the transformation '
            + 'in the Elements group.' },
      { kind: 'note-line', showIf: (s) => s.sectionKind === 'RCCircularSection',
        label: 'RCCircularSection applies to circular members only. Rectangular and '
             + 'I-shaped members fall back to a Fiber section.' },
      { id: 'ndMaterial', type: 'select', label: 'nDMaterial for the fibers', d: 'ElasticIsotropic',
        showIf: (s) => s.sectionKind === 'NDFiber', options: [
          { value: 'ElasticIsotropic', label: 'ElasticIsotropic' },
          { value: 'J2Plasticity', label: 'J2Plasticity' },
        ]},
      { id: 'ndSig0', type: 'number', gt: 0, label: 'sigma0 — yield stress', unit: 'stress', half: true,
        showIf: (s) => s.sectionKind === 'NDFiber' && s.ndMaterial === 'J2Plasticity',
        d: { 'kN-m': 20000, 'N-mm': 20, 'kip-in': 2.9 } },
      { id: 'ndHard', type: 'number', min: 0, label: 'H — hardening modulus', unit: 'stress', half: true,
        showIf: (s) => s.sectionKind === 'NDFiber' && s.ndMaterial === 'J2Plasticity',
        d: { 'kN-m': 100000, 'N-mm': 100, 'kip-in': 14.5 } },
      { id: 'rcRingsCore', type: 'number', label: 'Core rings', d: 8, min: 2, max: 40, step: 1, half: true,
        showIf: (s) => s.sectionKind === 'RCCircularSection' },
      { id: 'rcRingsCover', type: 'number', label: 'Cover rings', d: 2, min: 1, max: 20, step: 1, half: true,
        showIf: (s) => s.sectionKind === 'RCCircularSection' },
      { id: 'rcWedges', type: 'number', label: 'Wedges', d: 16, min: 4, max: 60, step: 1, half: true,
        showIf: (s) => s.sectionKind === 'RCCircularSection' },
      { id: 'rcNsteel', type: 'number', label: 'Longitudinal bars', d: 12, min: 4, max: 60, step: 1, half: true,
        showIf: (s) => s.sectionKind === 'RCCircularSection' },
      { id: 'useAggregator', type: 'check', d: false,
        label: 'Add shear and torsion (section Aggregator)',
        hint: 'A fiber section carries no shear or torsional stiffness of its own. This wraps '
            + 'it with elastic Vy, Vz and T responses.' },
      { id: 'aggShearFactor', type: 'number', gt: 0, label: 'Shear area factor', step: 0.05, d: 0.833,
        showIf: (s) => s.useAggregator,
        hint: 'Av = factor x A, used for the Vy and Vz stiffness.' },

      { kind: 'sub', label: 'Columns' },
      { id: 'colShape', type: 'select', label: 'Column shape', d: 'Rectangular', options: [
        { value: 'Rectangular', label: 'Rectangular' },
        { value: 'Circular',    label: 'Circular' },
        { value: 'ISection',    label: 'I / wide flange' },
      ]},
      { id: 'colB', type: 'number', gt: 0, label: 'Width b (local z)', unit: 'length', half: true,
        showIf: (s) => s.colShape === 'Rectangular',
        d: { 'kN-m': 0.50, 'N-mm': 500, 'kip-in': 20 } },
      { id: 'colH', type: 'number', gt: 0, label: 'Depth h (local y)', unit: 'length', half: true,
        showIf: (s) => s.colShape === 'Rectangular',
        d: { 'kN-m': 0.50, 'N-mm': 500, 'kip-in': 20 } },
      { id: 'colD', type: 'number', gt: 0, label: 'Diameter D', unit: 'length',
        showIf: (s) => s.colShape === 'Circular',
        d: { 'kN-m': 0.60, 'N-mm': 600, 'kip-in': 24 } },
      { id: 'colIh', type: 'number', gt: 0, label: 'Section depth d', unit: 'length', half: true,
        showIf: (s) => s.colShape === 'ISection', d: { 'kN-m': 0.40, 'N-mm': 400, 'kip-in': 16 } },
      { id: 'colIbf', type: 'number', gt: 0, label: 'Flange width bf', unit: 'length', half: true,
        showIf: (s) => s.colShape === 'ISection', d: { 'kN-m': 0.30, 'N-mm': 300, 'kip-in': 12 } },
      { id: 'colItf', type: 'number', gt: 0, label: 'Flange thk. tf', unit: 'length', half: true,
        showIf: (s) => s.colShape === 'ISection', d: { 'kN-m': 0.019, 'N-mm': 19, 'kip-in': 0.75 } },
      { id: 'colItw', type: 'number', gt: 0, label: 'Web thk. tw', unit: 'length', half: true,
        showIf: (s) => s.colShape === 'ISection', d: { 'kN-m': 0.012, 'N-mm': 12, 'kip-in': 0.47 } },

      { kind: 'sub', label: 'Beams' },
      { id: 'beamShape', type: 'select', label: 'Beam shape', d: 'Rectangular', options: [
        { value: 'Rectangular', label: 'Rectangular' },
        { value: 'ISection',    label: 'I / wide flange' },
      ]},
      { id: 'beamB', type: 'number', gt: 0, label: 'Width b (local z)', unit: 'length', half: true,
        showIf: (s) => s.beamShape === 'Rectangular',
        d: { 'kN-m': 0.30, 'N-mm': 300, 'kip-in': 12 } },
      { id: 'beamH', type: 'number', gt: 0, label: 'Depth h (local y)', unit: 'length', half: true,
        showIf: (s) => s.beamShape === 'Rectangular',
        d: { 'kN-m': 0.55, 'N-mm': 550, 'kip-in': 22 } },
      { id: 'beamIh', type: 'number', gt: 0, label: 'Section depth d', unit: 'length', half: true,
        showIf: (s) => s.beamShape === 'ISection', d: { 'kN-m': 0.45, 'N-mm': 450, 'kip-in': 18 } },
      { id: 'beamIbf', type: 'number', gt: 0, label: 'Flange width bf', unit: 'length', half: true,
        showIf: (s) => s.beamShape === 'ISection', d: { 'kN-m': 0.20, 'N-mm': 200, 'kip-in': 8 } },
      { id: 'beamItf', type: 'number', gt: 0, label: 'Flange thk. tf', unit: 'length', half: true,
        showIf: (s) => s.beamShape === 'ISection', d: { 'kN-m': 0.016, 'N-mm': 16, 'kip-in': 0.63 } },
      { id: 'beamItw', type: 'number', gt: 0, label: 'Web thk. tw', unit: 'length', half: true,
        showIf: (s) => s.beamShape === 'ISection', d: { 'kN-m': 0.010, 'N-mm': 10, 'kip-in': 0.39 } },
      // Y beams share the X beam's section. A different one is a per-member
      // decision now: select the beams in the view and resize them there.

      { kind: 'sub', label: 'Elastic stiffness modifiers', showIf: (s) => !isFiber(s) },
      { id: 'modCol', type: 'number', gt: 0, label: 'Column Ig factor', step: 0.05, d: 0.70, half: true, showIf: (s) => !isFiber(s) },
      { id: 'modBeam', type: 'number', gt: 0, label: 'Beam Ig factor', step: 0.05, d: 0.35, half: true, showIf: (s) => !isFiber(s) },

      { kind: 'sub', label: 'Fiber discretisation', showIf: isFiber },
      { id: 'cover', type: 'number', gt: 0, label: 'Clear cover', unit: 'length', showIf: isFiber,
        d: { 'kN-m': 0.04, 'N-mm': 40, 'kip-in': 1.6 } },
      { id: 'colBarsY', type: 'number', label: 'Column bars per y-face', d: 4, min: 2, max: 20, step: 1, half: true, showIf: isFiber },
      { id: 'colBarsZ', type: 'number', label: 'Column bars per z-face', d: 4, min: 2, max: 20, step: 1, half: true, showIf: isFiber },
      { id: 'colBarArea', type: 'number', gt: 0, label: 'Column bar area', unit: 'area', showIf: isFiber,
        d: { 'kN-m': 4.91e-4, 'N-mm': 491, 'kip-in': 0.79 },
        hint: 'Ø25 mm ≈ 491 mm²' },
      { id: 'beamBarsTop', type: 'number', label: 'Beam bars — top', d: 3, min: 2, max: 20, step: 1, half: true, showIf: isFiber },
      { id: 'beamBarsBot', type: 'number', label: 'Beam bars — bottom', d: 3, min: 2, max: 20, step: 1, half: true, showIf: isFiber },
      { id: 'beamBarArea', type: 'number', gt: 0, label: 'Beam bar area', unit: 'area', showIf: isFiber,
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
        hint: 'rigidDiaphragm only ties UX, UY and RZ. Without this the master node keeps '
            + 'three degrees of freedom that carry no stiffness and no mass, and the analysis '
            + 'stops on a zero-energy mode. Leave it on unless you restrain them yourself.' },
    ],
  },

  /* ═══════════════════════════════════════════════════════ Slabs ═══════ */
  {
    id: 'slabs', title: 'Floor Slabs',
    fields: [
      { id: 'useSlabs', type: 'check', d: false,
        label: 'Model the floor slabs as shell elements',
        hint: 'One shell per bay panel, spanning the four columns that bound it. The slab is '
            + 'then part of the structure: it carries in-plane (diaphragm) stiffness and '
            + 'out-of-plane stiffness, and both change the periods.' },
      { id: 'slabElement', type: 'select', label: 'Shell element', d: 'ShellMITC4',
        showIf: (s) => s.useSlabs, options: [
          { value: 'ShellMITC4', label: 'ShellMITC4 — 4-node MITC, general purpose' },
          { value: 'ShellDKGQ', label: 'ShellDKGQ — discrete Kirchhoff, thin slabs' },
          { value: 'ShellNLDKGQ', label: 'ShellNLDKGQ — as DKGQ, large displacement' },
        ]},
      { id: 'slabThickness', type: 'number', gt: 0, label: 'Slab thickness', unit: 'length',
        showIf: (s) => s.useSlabs,
        d: { 'kN-m': 0.15, 'N-mm': 150, 'kip-in': 6 } },
      { id: 'slabE', type: 'number', gt: 0, label: 'Slab elastic modulus', unit: 'stress',
        showIf: (s) => s.useSlabs,
        d: { 'kN-m': 30000000, 'N-mm': 30000, 'kip-in': 4350 },
        hint: 'Separate from the frame modulus so a cracked slab can be softened on its own.' },
      { id: 'slabMassSource', type: 'select', label: 'Slab mass', d: 'loads',
        showIf: (s) => s.useSlabs, options: [
          { value: 'loads', label: 'From the dead load, as before' },
          { value: 'shell', label: 'From the shell density' },
        ],
        hint: 'The slab already contributes to the lumped nodal mass through the dead load. '
            + 'Giving the shell a density as well would count it twice, so only one of the two '
            + 'is used.' },
      { kind: 'note-line', showIf: (s) => s.useSlabs,
        label: 'The slab load still reaches the beams by tributary area — the shells add '
             + 'stiffness and are not loaded. OpenSees shells ignore a surface load '
             + '(ShellMITC4::addLoad refuses it), and one shell per panel would carry the '
             + 'load straight into the columns rather than along the beams.' },
      { kind: 'note-line', showIf: (s) => s.useSlabs && s.rigidDiaphragm,
        label: 'Rigid diaphragms are on as well. The slab already ties the floor together in '
             + 'plane, so the two are doing the same job and the diaphragm will dominate.' },
    ],
  },

  /* ══════════════════════════════════════════ Isolators & dampers ══════ */
  {
    id: 'devices', title: 'Isolators & Dampers',
    fields: [
      { kind: 'sub', label: 'Base isolation' },
      { id: 'useIsolation', type: 'check', d: false, label: 'Insert a base isolation layer',
        hint: 'Adds a foundation node under every column and an isolator between it and the superstructure.' },
      { id: 'isolatorPlacement', type: 'select', label: 'Placement', d: 'all', showIf: usesIso, options: [
        { value: 'all', label: 'Under every column' },
        { value: 'perimeter', label: 'Perimeter columns only' },
        { value: 'corner', label: 'Corner columns only' },
      ]},
      { id: 'isolatorHeight', type: 'number', gt: 0, label: 'Bearing height', unit: 'length', showIf: usesIso,
        d: { 'kN-m': 0.30, 'N-mm': 300, 'kip-in': 12 },
        hint: 'Zero gives a coincident-node bearing; a height lifts the superstructure.' },
      { id: 'isolatorType', type: 'select', label: 'Isolator', d: 'elastomericBearingPlasticity',
        showIf: usesIso, options: modelOptions(ISOLATOR_TYPES) },
      ...deviceFields('iso', 'isolatorType', usesIso),

      { id: 'frictionType', type: 'select', label: 'Friction model', d: 'Coulomb',
        showIf: usesFriction, options: modelOptions(FRICTION_MODELS) },
      ...deviceFields('frn', 'frictionType', usesFriction),

      { kind: 'sub', label: 'Bearing auxiliary stiffness', showIf: usesAux },
      { id: 'isoKv', type: 'number', gt: 0, label: 'Vertical (P)', unit: 'stiffness', showIf: usesAux,
        d: { 'kN-m': 1e7, 'N-mm': 1e7, 'kip-in': 57000 } },
      { id: 'isoKt', type: 'number', gt: 0, label: 'Torsion (T)', unit: 'rotStiffness', half: true, showIf: usesAux,
        d: { 'kN-m': 1e5, 'N-mm': 1e11, 'kip-in': 5.7e5 } },
      { id: 'isoKr', type: 'number', gt: 0, label: 'Rotation (My, Mz)', unit: 'rotStiffness', half: true, showIf: usesAux,
        d: { 'kN-m': 1e5, 'N-mm': 1e11, 'kip-in': 5.7e5 } },
      { id: 'isoShearDist', type: 'number', min: 0, max: 1, label: 'Shear distance ratio', d: 0.5, step: 0.05, showIf: usesAux,
        hint: 'Fraction of the P-Delta moment carried by the top node.' },
      { id: 'isoRayleigh', type: 'check', d: false, showIf: usesIso,
        label: 'Include bearings in Rayleigh damping',
        hint: 'Off by default — bearings otherwise leak artificial viscous damping into the isolation system.' },

      { kind: 'sub', label: 'Dampers' },
      { id: 'useDampers', type: 'check', d: false, label: 'Add diagonal dampers',
        hint: 'Placed as twoNodeLink devices acting along their own axis.' },
      { id: 'damperType', type: 'select', label: 'Device', d: 'ViscousDamper',
        showIf: usesDampers, options: modelOptions(DAMPER_TYPES) },
      ...deviceFields('damp', 'damperType', usesDampers),

      { id: 'damperConfig', type: 'select', label: 'Configuration', d: 'diagonal', showIf: usesDampers, options: [
        { value: 'diagonal', label: 'Single diagonal' },
        { value: 'cross', label: 'Cross — both diagonals' },
        { value: 'chevron', label: 'Chevron — to the beam midspan' },
      ]},
      { id: 'damperAxis', type: 'select', label: 'Frames', d: 'both', showIf: usesDampers, options: [
        { value: 'x', label: 'X–Z frames only' },
        { value: 'y', label: 'Y–Z frames only' },
        { value: 'both', label: 'Both directions' },
      ]},
      { id: 'damperLines', type: 'text', label: 'Frame lines', d: 'perimeter', showIf: usesDampers,
        hint: 'all, perimeter, or grid line indices such as 0, 2' },
      { id: 'damperBays', type: 'text', label: 'Bays', d: 'all', half: true, showIf: usesDampers,
        hint: 'all or bay indices' },
      { id: 'damperStories', type: 'text', label: 'Stories', d: 'all', half: true, showIf: usesDampers,
        hint: 'all or story numbers' },
    ],
  },

  /* ═════════════════════════════════════════════════ Loads & mass ══════ */
  {
    id: 'loads', title: 'Loads & Mass',
    fields: [
      { id: 'deadFloor', type: 'number', min: 0, label: 'Slab dead load', unit: 'areaLoad', half: true,
        d: { 'kN-m': 4.5, 'N-mm': 4.5e-3, 'kip-in': 6.5e-4 } },
      { id: 'liveFloor', type: 'number', min: 0, label: 'Slab live load', unit: 'areaLoad', half: true,
        d: { 'kN-m': 2.0, 'N-mm': 2.0e-3, 'kip-in': 2.9e-4 } },
      { id: 'loadDistribution', type: 'select', label: 'Slab load distribution', d: 'tributary', options: [
        { value: 'tributary', label: 'Tributary width onto beams' },
        { value: 'oneway-x',  label: 'One-way — spanning along X' },
        { value: 'oneway-y',  label: 'One-way — spanning along Y' },
      ]},
      { id: 'dlFactor', type: 'number', min: 0, label: 'Dead load factor', step: 0.05, d: 1.0, half: true },
      { id: 'llFactor', type: 'number', min: 0, label: 'Live load factor', step: 0.05, d: 1.0, half: true },
      { id: 'selfWeight', type: 'check', d: true, label: 'Include member self weight',
        hint: 'Adds ρ·g·A as an extra uniform load on every element.' },

      { kind: 'sub', label: 'Seismic mass' },
      { id: 'massSource', type: 'select', label: 'Mass source', d: 'nodal', options: [
        { value: 'nodal', label: 'Lumped nodal mass from gravity loads' },
        { value: 'none',  label: 'No nodal mass (element mass only)' },
      ]},
      { id: 'massLiveFactor', type: 'number', min: 0, max: 1, label: 'Live load mass participation', step: 0.05, d: 0.30,
        showIf: (s) => s.massSource === 'nodal' },
    ],
  },

  /* ═════════════════════════════════════════════════════ Analysis ══════ */
  {
    id: 'analysis', title: 'Analysis',
    fields: [
      { kind: 'sub', label: 'Solution strategy' },
      { id: 'constraintsCmd', type: 'select', label: 'constraints', d: 'Transformation', options: opts(
        'Plain', 'Transformation', 'Penalty', 'Lagrange') },
      { id: 'penaltyAlpha', type: 'number', gt: 0, label: 'Penalty αS = αM', d: 1e14, step: 1e12,
        showIf: (s) => s.constraintsCmd === 'Penalty' },
      { id: 'lagrangeAlpha', type: 'number', gt: 0, label: 'Lagrange αS = αM', d: 1.0, step: 0.1,
        showIf: (s) => s.constraintsCmd === 'Lagrange' },
      { id: 'numbererCmd', type: 'select', label: 'numberer', d: 'RCM', options: opts(
        'Plain', 'RCM', 'AMD', 'ParallelPlain', 'ParallelRCM'),
        hint: 'The two Parallel numberers only apply to an MPI run.' },
      { id: 'systemCmd', type: 'select', label: 'system', d: 'BandGeneral', options: opts(
        'BandGeneral', 'BandSPD', 'ProfileSPD', 'SuperLU', 'UmfPack', 'FullGeneral', 'SparseSYM',
        'Diagonal', 'MUMPS', 'PFEM', 'PythonSparse'),
        hint: 'PFEM needs a matching analysis type. PythonSparse solves in Python: the script '
          + 'carries a SciPy solver object, so it also needs numpy and scipy installed.' },
      { id: 'testCmd', type: 'select', label: 'test', d: 'NormDispIncr', options: opts(
        'NormUnbalance', 'NormDispIncr', 'EnergyIncr',
        'RelativeNormUnbalance', 'RelativeNormDispIncr', 'RelativeTotalNormDispIncr', 'RelativeEnergyIncr',
        'FixedNumIter', 'NormDispAndUnbalance', 'NormDispOrUnbalance') },
      // The convergence test measures a displacement increment, so the tolerance
      // is a length and has to follow the unit system. A metre-based default of
      // 1e-8 is ten nanometres — a bar a nonlinear section can never clear, and
      // the run stalls at a norm of about 1e-6 until the iteration limit.
      { id: 'tol', type: 'number', gt: 0, label: 'Tolerance', step: 1e-9, half: true,
        d: { 'kN-m': 1e-6, 'N-mm': 1e-3, 'kip-in': 1e-5 },
        hint: 'What the test above must reach. NormDispIncr and NormUnbalance measure a '
            + 'displacement increment, so this is a length in the current unit system; '
            + 'EnergyIncr measures work. Too tight and a nonlinear model never converges.' },
      { id: 'maxIter', type: 'number', label: 'Max iterations', d: 100, min: 1, max: 5000, step: 1, half: true },
      { id: 'algorithmCmd', type: 'select', label: 'algorithm', d: 'Newton', options: opts(
        'Linear', 'Newton', 'NewtonLineSearch', 'ModifiedNewton', 'KrylovNewton',
        'SecantNewton', 'RaphsonNewton', 'PeriodicNewton', 'BFGS', 'Broyden') },

      { kind: 'sub', label: 'Gravity' },
      { id: 'runGravity', type: 'check', d: true, label: 'Run gravity analysis',
        hint: 'Applied first and held constant; every case below starts from this state.' },
      { id: 'gravityIntegrator', type: 'select', label: 'Static integrator', d: 'LoadControl',
        showIf: (s) => s.runGravity, options: opts(
          'LoadControl', 'DisplacementControl', 'ParallelDisplacementControl', 'MinUnbalDispNorm', 'ArcLength') },
      { id: 'gravitySteps', type: 'number', label: 'Load steps', d: 10, min: 1, max: 500, step: 1,
        showIf: (s) => s.runGravity },
      { id: 'arcLength', type: 'number', gt: 0, label: 'Arc length s', d: 1.0, step: 0.1, half: true,
        showIf: (s) => s.runGravity && s.gravityIntegrator === 'ArcLength' },
      { id: 'arcAlpha', type: 'number', label: 'Arc α', d: 1.0, step: 0.1, half: true,
        showIf: (s) => s.runGravity && s.gravityIntegrator === 'ArcLength' },

      { kind: 'sub', label: 'Load cases to run' },
      { id: 'runModal', type: 'check', d: true, label: 'Modal — eigenvalue analysis' },
      { id: 'numModes', type: 'number', label: 'Number of modes', d: 6, min: 1, max: 60, step: 1,
        half: true, showIf: (s) => s.runModal },
      { id: 'eigenSolver', type: 'select', label: 'Eigen solver', d: '-genBandArpack',
        showIf: (s) => s.runModal, options: [
          { value: '-genBandArpack', label: '-genBandArpack' },
          { value: '-fullGenLapack', label: '-fullGenLapack' },
          { value: '-symmBandLapack', label: '-symmBandLapack' },
          { value: '-symmBandArpack', label: '-symmBandArpack' },
        ]},

      { id: 'runPushover', type: 'check', d: false, label: 'Pushover — monotonic lateral' },
      ...pushoverFields((s) => s.runPushover, 'push'),

      { id: 'runCyclic', type: 'check', d: false, label: 'Cyclic — reversed displacement cycles' },
      ...pushoverFields((s) => s.runCyclic, 'cyc'),
      { id: 'cycAmplitudes', type: 'text', label: 'Drift amplitudes', d: '0.0025, 0.005, 0.01, 0.02, 0.03',
        showIf: (s) => s.runCyclic, hint: 'Ratios of the total building height, run in the order given.' },
      { id: 'cycRepeats', type: 'number', label: 'Cycles per amplitude', d: 2, min: 1, max: 10, step: 1,
        showIf: (s) => s.runCyclic },

      { id: 'runTimeHistory', type: 'check', d: false, label: 'Time history — ground motion' },
      { id: 'gmFile', type: 'file', label: 'Acceleration record',
        showIf: (s) => s.runTimeHistory,
        hint: 'PEER NGA or plain text. The script reads the exported one-column file next to it.' },
      { id: 'gmDir', type: 'select', label: 'Excitation direction', d: '1',
        showIf: (s) => s.runTimeHistory, options: [
          { value: '1', label: 'DOF 1 — global X' },
          { value: '2', label: 'DOF 2 — global Y' },
          { value: '3', label: 'DOF 3 — global Z' },
        ]},
      { id: 'gmDt', type: 'number', gt: 0, label: 'Record dt [s]', d: 0.01, step: 0.001, half: true,
        showIf: (s) => s.runTimeHistory },
      { id: 'gmScale', type: 'number', gt: 0, label: 'Scale factor', d: 1.0, step: 0.05, half: true,
        showIf: (s) => s.runTimeHistory,
        hint: 'Multiplied by g, so a record in units of g needs no further conversion.' },
      { id: 'thIntegrator', type: 'select', label: 'Transient integrator', d: 'Newmark',
        showIf: (s) => s.runTimeHistory, options: opts(
          'Newmark', 'HHT', 'GeneralizedAlpha', 'TRBDF2', 'CentralDifference', 'ExplicitDifference') },
      { id: 'newmarkGamma', type: 'number', label: 'Newmark γ', d: 0.5, step: 0.05, half: true,
        showIf: (s) => s.runTimeHistory && s.thIntegrator === 'Newmark' },
      { id: 'newmarkBeta', type: 'number', label: 'Newmark β', d: 0.25, step: 0.05, half: true,
        showIf: (s) => s.runTimeHistory && s.thIntegrator === 'Newmark' },
      { id: 'hhtAlpha', type: 'number', label: 'α', d: 0.9, step: 0.05,
        showIf: (s) => s.runTimeHistory && ['HHT', 'GeneralizedAlpha'].includes(s.thIntegrator) },
      { id: 'thDt', type: 'number', gt: 0, label: 'Analysis dt [s]', d: 0.005, step: 0.001, half: true,
        showIf: (s) => s.runTimeHistory },
      { id: 'thDuration', type: 'number', min: 0, label: 'Duration [s]', d: 0, step: 1, half: true,
        showIf: (s) => s.runTimeHistory, hint: '0 uses the full length of the record.' },

      { kind: 'sub', label: 'Damping', showIf: (s) => s.runTimeHistory },
      { id: 'dampRatio', type: 'number', min: 0, lt: 1, label: 'Rayleigh damping ratio', d: 0.05, step: 0.005,
        showIf: (s) => s.runTimeHistory },
      { id: 'dampModeI', type: 'number', label: 'Anchor mode i', d: 1, min: 1, max: 30, step: 1, half: true,
        showIf: (s) => s.runTimeHistory },
      { id: 'dampModeJ', type: 'number', label: 'Anchor mode j', d: 3, min: 1, max: 30, step: 1, half: true,
        showIf: (s) => s.runTimeHistory },

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

/**
 * Displacement-controlled lateral loading, shared by the pushover and cyclic
 * cases. `p` prefixes the state keys so the two cases stay independent.
 */
function pushoverFields(shown, p) {
  return [
    { id: `${p}Dof`, type: 'select', label: 'Direction', d: '1', showIf: shown, options: [
      { value: '1', label: 'DOF 1 — global X' },
      { value: '2', label: 'DOF 2 — global Y' },
    ]},
    { id: `${p}Node`, type: 'select', label: 'Control node', d: 'centre', showIf: shown, options: [
      { value: 'centre', label: 'Roof — nearest plan centre' },
      { value: 'corner', label: 'Roof — origin corner' },
    ]},
    { id: `${p}Shape`, type: 'select', label: 'Lateral load pattern', d: 'triangular', showIf: shown, options: [
      { value: 'triangular', label: 'Inverted triangular — mass × height' },
      { value: 'uniform', label: 'Uniform — mass proportional' },
      { value: 'modal', label: 'First mode — from the eigenvectors' },
    ]},
    { id: `${p}Drift`, type: 'number', gt: 0, label: 'Target roof drift ratio', d: 0.02, step: 0.005,
      half: true, showIf: shown },
    { id: `${p}Steps`, type: 'number', label: 'Steps to target', d: 200, min: 10, max: 5000, step: 10,
      half: true, showIf: shown },
    { kind: 'break' },
  ];
}

function modelOptions(models) {
  return Object.entries(models).map(([value, def]) => ({ value, label: def.label }));
}

/** Same expansion as materialFields, for the isolator, friction and damper catalogues. */
function deviceFields(group, selectKey, visible) {
  const out = [];
  for (const [type, def] of Object.entries(catalogueOf(group))) {
    const shown = (s) => visible(s) && s[selectKey] === type;
    if (def.note) out.push({ kind: 'note-line', label: def.note, showIf: shown });
    for (const p of def.params) {
      out.push({
        id: devKey(group, type, p.key),
        type: 'number',
        label: p.label,
        unit: p.unit,
        d: p.d,
        step: p.step,
        half: !!p.half,
        showIf: shown,
      });
    }
    out.push({ kind: 'break' });
  }
  return out;
}

/**
 * Expands a material catalogue into sidebar fields — one block per model, only
 * the selected block visible. A row break between models stops a half-width
 * field of one model pairing up with the next model's first field.
 */
function materialFields(family, selectKey, visible) {
  const out = [];
  for (const [type, def] of Object.entries(modelsOf(family))) {
    const shown = (s) => visible(s) && s[selectKey] === type;
    if (def.note) out.push({ kind: 'note-line', label: def.note, showIf: shown });
    for (const p of def.params) {
      out.push({
        id: matKey(family, type, p.key),
        type: p.options ? 'select' : 'number',
        label: p.label,
        unit: p.unit,
        d: p.d,
        step: p.step,
        options: p.options,
        half: !p.options && !!p.half,
        showIf: shown,
      });
    }
    out.push({ kind: 'break' });
  }
  return out;
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
