/**
 * model/builder.js — turns the parameter state into an explicit model.
 *
 * The result is a plain data object: nodes, elements, restraints, diaphragms,
 * distributed loads and lumped masses.  Both the 3D viewer and the OpenSeesPy
 * code generator consume this same object, so what you see is always what the
 * script will build.
 *
 * Global axes: X and Y are horizontal, Z is the vertical (building) axis.
 *
 * Tag scheme (chosen to stay readable in recorder output)
 *   node    (level+1)·10000 + gridIndex + 1        e.g. 20007 → level 1, 7th grid point
 *   master  (level+1)·10000 + 9999
 *   column  100000 + level·1000 + index + 1
 *   beam X  200000 + level·1000 + index + 1
 *   beam Y  300000 + level·1000 + index + 1
 */

import { expandList } from '../state.js';
import { allSections } from './sections.js';

const NODE_BASE = 10000;
const MASTER_OFFSET = 9999;
const TAG_COLUMN = 100000;
const TAG_BEAM_X = 200000;
const TAG_BEAM_Y = 300000;

const FIXITY = {
  Fixed:  [1, 1, 1, 1, 1, 1],
  Pinned: [1, 1, 1, 0, 0, 0],
  Roller: [0, 0, 1, 0, 0, 0],
  Free:   null,
};

export function buildModel(s) {
  const errors = [];
  const warnings = [];

  /* ── grid ───────────────────────────────────────────────────────────── */
  const nx = clampInt(s.baysX, 1, 30);
  const ny = clampInt(s.baysY, 1, 30);
  const nz = clampInt(s.numStories, 1, 60);

  const spansX = expandList(s.spanX, nx, 1);
  const spansY = expandList(s.spanY, ny, 1);
  const heights = expandList(s.storyHeight, nz, 1);

  const xs = cumulative(spansX);
  const ys = cumulative(spansY);
  const zs = cumulative(heights);

  const nxN = nx + 1, nyN = ny + 1;
  const perLevel = nxN * nyN;

  if (perLevel * (nz + 1) > 12000) {
    errors.push('Model is too large for the browser viewer (over 12 000 nodes). Reduce bays or stories.');
  }

  const sections = allSections(s);
  const gridIndex = (i, j) => j * nxN + i;
  const nodeTag = (level, i, j) => (level + 1) * NODE_BASE + gridIndex(i, j) + 1;

  /* ── nodes ──────────────────────────────────────────────────────────── */
  const nodes = [];
  const nodeByTag = new Map();
  const fixity = FIXITY[s.baseFixity] ?? FIXITY.Fixed;

  for (let level = 0; level <= nz; level++) {
    for (let j = 0; j < nyN; j++) {
      for (let i = 0; i < nxN; i++) {
        const n = {
          tag: nodeTag(level, i, j),
          x: xs[i], y: ys[j], z: zs[level],
          i, j, level,
          fix: level === 0 ? fixity : null,
          mass: 0,
          master: false,
        };
        nodes.push(n);
        nodeByTag.set(n.tag, n);
      }
    }
  }

  /* ── elements ───────────────────────────────────────────────────────── */
  const elements = [];

  // Columns — one per grid point per story.
  for (let level = 0; level < nz; level++) {
    for (let j = 0; j < nyN; j++) {
      for (let i = 0; i < nxN; i++) {
        elements.push(makeElement({
          tag: TAG_COLUMN + level * 1000 + gridIndex(i, j) + 1,
          kind: 'column',
          ni: nodeTag(level, i, j),
          nj: nodeTag(level + 1, i, j),
          nodeByTag, story: level + 1, i, j,
          section: sections.column,
        }));
      }
    }
  }

  // Beams spanning X, at every floor level above the base.
  for (let level = 1; level <= nz; level++) {
    let k = 0;
    for (let j = 0; j < nyN; j++) {
      for (let i = 0; i < nx; i++) {
        elements.push(makeElement({
          tag: TAG_BEAM_X + level * 1000 + (k++) + 1,
          kind: 'beamX',
          ni: nodeTag(level, i, j),
          nj: nodeTag(level, i + 1, j),
          nodeByTag, story: level, i, j,
          section: sections.beamX,
        }));
      }
    }
  }

  // Beams spanning Y.
  for (let level = 1; level <= nz; level++) {
    let k = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nxN; i++) {
        elements.push(makeElement({
          tag: TAG_BEAM_Y + level * 1000 + (k++) + 1,
          kind: 'beamY',
          ni: nodeTag(level, i, j),
          nj: nodeTag(level, i, j + 1),
          nodeByTag, story: level, i, j,
          section: sections.beamY,
        }));
      }
    }
  }

  const elementByTag = new Map(elements.map((e) => [e.tag, e]));

  /* ── slab loads onto the beams ──────────────────────────────────────── */
  const dlF = numOr(s.dlFactor, 1);
  const llF = numOr(s.llFactor, 1);

  for (let level = 1; level <= nz; level++) {
    const roof = level === nz;
    const q = dlF * numOr(roof ? s.deadRoof : s.deadFloor, 0)
            + llF * numOr(roof ? s.liveRoof : s.liveFloor, 0);
    if (q === 0) continue;

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const Lx = spansX[i], Ly = spansY[j];
        const { wX, wY } = panelShare(q, Lx, Ly, s.loadDistribution);

        // The two X-beams bounding this panel (at y = j and y = j+1).
        addLoad(elementByTag, TAG_BEAM_X, level, beamXIndex(nx, i, j), wX);
        addLoad(elementByTag, TAG_BEAM_X, level, beamXIndex(nx, i, j + 1), wX);
        // The two Y-beams bounding this panel (at x = i and x = i+1).
        addLoad(elementByTag, TAG_BEAM_Y, level, beamYIndex(nxN, i, j), wY);
        addLoad(elementByTag, TAG_BEAM_Y, level, beamYIndex(nxN, i + 1, j), wY);
      }
    }
  }

  // Self weight, applied as an extra uniform load along the member.
  const rho = numOr(s.density, 0);
  const g = numOr(s.gravityAccel, 9.81);
  if (s.selfWeight && rho > 0) {
    for (const e of elements) e.wSelf = rho * g * e.section.A;
  }

  /* ── lumped nodal mass ──────────────────────────────────────────────── */
  let totalMass = 0;
  const storyMass = new Array(nz + 1).fill(0);

  if (s.massSource === 'nodal') {
    const lam = numOr(s.massLiveFactor, 0.3);
    for (const n of nodes) {
      if (n.level === 0) continue;
      const roof = n.level === nz;
      const q = numOr(roof ? s.deadRoof : s.deadFloor, 0)
              + lam * numOr(roof ? s.liveRoof : s.liveFloor, 0);
      const area = tributaryArea(spansX, spansY, n.i, n.j);
      n.mass = (q * area) / g;
      totalMass += n.mass;
      storyMass[n.level] += n.mass;
    }
  }

  /* ── rigid diaphragms ───────────────────────────────────────────────── */
  const diaphragms = [];
  if (s.rigidDiaphragm) {
    const cx = xs[xs.length - 1] / 2;
    const cy = ys[ys.length - 1] / 2;
    for (let level = 1; level <= nz; level++) {
      const tag = (level + 1) * NODE_BASE + MASTER_OFFSET;
      const master = {
        tag, x: cx, y: cy, z: zs[level],
        i: -1, j: -1, level,
        fix: s.restrainDiaphragmDofs ? [0, 0, 1, 1, 1, 0] : null,
        mass: 0, master: true,
      };
      nodes.push(master);
      nodeByTag.set(tag, master);
      diaphragms.push({
        level,
        master: tag,
        slaves: nodes.filter((n) => n.level === level && !n.master).map((n) => n.tag),
      });
    }
  }

  /* ── sanity checks ──────────────────────────────────────────────────── */
  if (s.baseFixity === 'Free') {
    warnings.push('The base is unrestrained — the model has rigid body modes and the analysis will not converge.');
  }
  if (s.massSource === 'none' && !s.elementMass && s.runModal) {
    warnings.push('No mass is defined anywhere, so the eigenvalue analysis cannot run. Enable nodal mass or element mass.');
  }
  if (s.sectionKind === 'Fiber' && ['elasticBeamColumn', 'elasticTimoshenkoBeam'].includes(s.colElement)) {
    warnings.push('Columns use an elastic element, so the fiber section is ignored for them.');
  }
  if (s.sectionKind === 'Fiber' && ['elasticBeamColumn', 'elasticTimoshenkoBeam'].includes(s.beamElement)) {
    warnings.push('Beams use an elastic element, so the fiber section is ignored for them.');
  }
  if (s.sectionKind === 'Fiber' && s.colShape === 'ISection') {
    warnings.push('The I-section fiber mesh is generated as three rectangular patches without reinforcement layers.');
  }
  if (s.matSystem === 'steel' && s.sectionKind === 'Fiber') {
    warnings.push('Steel fiber sections use the steel material for the whole cross-section; concrete parameters are ignored.');
  }
  for (const [name, v] of Object.entries({ 'Bay width X': spansX, 'Bay width Y': spansY, 'Story height': heights })) {
    if (v.some((x) => !(x > 0))) errors.push(`${name} must be greater than zero.`);
  }

  /* ── summary ────────────────────────────────────────────────────────── */
  const floorArea = xs[xs.length - 1] * ys[ys.length - 1];
  const totalLoad = elements.reduce((t, e) => t + (e.w + (e.wSelf || 0)) * e.length, 0);

  return {
    ok: errors.length === 0,
    errors, warnings,
    grid: { nx, ny, nz, xs, ys, zs, spansX, spansY, heights, perLevel },
    sections,
    nodes, nodeByTag,
    elements, elementByTag,
    diaphragms,
    stats: {
      nodes: nodes.length,
      elements: elements.length,
      columns: elements.filter((e) => e.kind === 'column').length,
      beamsX: elements.filter((e) => e.kind === 'beamX').length,
      beamsY: elements.filter((e) => e.kind === 'beamY').length,
      dof: nodes.length * 6,
      floorArea,
      totalFloorArea: floorArea * nz,
      buildingHeight: zs[zs.length - 1],
      footprint: [xs[xs.length - 1], ys[ys.length - 1]],
      totalMass, storyMass,
      totalGravityLoad: totalLoad,
    },
    bounds: {
      min: [0, 0, 0],
      max: [xs[xs.length - 1], ys[ys.length - 1], zs[zs.length - 1]],
    },
  };
}

/* ─────────────────────────────── helpers ────────────────────────────── */

function makeElement({ tag, kind, ni, nj, nodeByTag, story, i, j, section }) {
  const a = nodeByTag.get(ni), b = nodeByTag.get(nj);
  const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  return {
    tag, kind, ni, nj, story, i, j, section, length,
    p1: [a.x, a.y, a.z],
    p2: [b.x, b.y, b.z],
    w: 0,        // slab load, force per unit length
    wSelf: 0,    // self weight, force per unit length
  };
}

function addLoad(map, base, level, index, w) {
  const el = map.get(base + level * 1000 + index + 1);
  if (el) el.w += w;
}

/** Position of a beam within its level, matching the creation order above. */
const beamXIndex = (nx, i, j) => j * nx + i;
const beamYIndex = (nxN, i, j) => j * nxN + i;

/**
 * Splits a panel's uniform area load between its four bounding beams.
 * The two-way rule uses exact 45° tributary areas converted to a force-
 * equivalent uniform load, so the sum over all beams reproduces q·Lx·Ly.
 */
function panelShare(q, Lx, Ly, mode) {
  if (mode === 'oneway-x') return { wX: 0, wY: (q * Lx) / 2 };
  if (mode === 'oneway-y') return { wX: (q * Ly) / 2, wY: 0 };

  if (Ly <= Lx) {
    // Triangles onto the short (Y-direction) beams, trapezoids onto X beams.
    return {
      wY: (q * Ly) / 4,
      wX: (q * Ly * (2 * Lx - Ly)) / (4 * Lx),
    };
  }
  return {
    wX: (q * Lx) / 4,
    wY: (q * Lx * (2 * Ly - Lx)) / (4 * Ly),
  };
}

/** Quarter of each adjoining panel — the classic lumped-mass tributary area. */
function tributaryArea(spansX, spansY, i, j) {
  const dx = (spansX[i - 1] || 0) / 2 + (spansX[i] || 0) / 2;
  const dy = (spansY[j - 1] || 0) / 2 + (spansY[j] || 0) / 2;
  return dx * dy;
}

function cumulative(spans) {
  const out = [0];
  for (const s of spans) out.push(out[out.length - 1] + s);
  return out;
}

function clampInt(v, lo, hi) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function numOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
