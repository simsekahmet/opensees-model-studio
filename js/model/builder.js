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

import { expandList, validateState, firstIssue } from '../state.js';
import { allSections, sectionWithDims, EDITABLE_DIMS, usesFibers } from './sections.js';
import { ISOLATOR_TYPES } from './devices.js';

const NODE_BASE = 10000;
const MASTER_OFFSET = 9999;
const MID_X_OFFSET = 5000;      // midspan node of a split X beam
const MID_Y_OFFSET = 7000;      // midspan node of a split Y beam
const TAG_COLUMN = 100000;
const TAG_BEAM_X = 200000;
const TAG_BEAM_Y = 300000;
const TAG_ISOLATOR = 400000;
const TAG_DAMPER = 500000;
const TAG_SPLIT_X = 600000;     // second half of a split X beam
const TAG_SPLIT_Y = 700000;     // second half of a split Y beam

const FIXITY = {
  Fixed:  [1, 1, 1, 1, 1, 1],
  Pinned: [1, 1, 1, 0, 0, 0],
  Roller: [0, 0, 1, 0, 0, 0],
  Free:   null,
};

export function buildModel(s) {
  const errors = [];
  const warnings = [];

  // Nothing is built from an invalid input. The sidebar shows the same errors
  // in place, so this is the backstop rather than the first line of defence.
  const check = validateState(s);
  if (!check.ok) {
    return { ok: false, errors: Object.keys(check.errors).map((id) => firstIssue({ [id]: check.errors[id] })), warnings };
  }

  /* ── grid ───────────────────────────────────────────────────────────── */
  const nx = clampInt(s.baysX, 1, 30);
  const ny = clampInt(s.baysY, 1, 30);
  const nz = clampInt(s.numStories, 1, 60);

  const spansX = expandList(s.spanX, nx);
  const spansY = expandList(s.spanY, ny);
  const heights = expandList(s.storyHeight, nz);

  const xs = cumulative(spansX);
  const ys = cumulative(spansY);
  const zs = cumulative(heights);

  const nxN = nx + 1, nyN = ny + 1;
  const perLevel = nxN * nyN;

  if (perLevel * (nz + 1) > 12000) {
    errors.push('Model is too large for the browser viewer (over 12 000 nodes). Reduce bays or stories.');
  }

  const sections = allSections(s);

  // Per-member edits made in the inspector. A dimension edit gives that member
  // its own section; a load edit is applied after the slab distribution below.
  const overrides = s.elementOverrides || {};
  const sectionCache = new Map();
  const sectionFor = (tag, base) => {
    const ov = overrides[tag];
    if (!ov) return base;
    const dims = EDITABLE_DIMS[base.shape] || [];
    if (!dims.some((k) => ov[k] !== undefined)) return base;

    const key = `${base.shape}|${dims.map((k) => ov[k] ?? base[k]).join(',')}`;
    if (!sectionCache.has(key)) sectionCache.set(key, sectionWithDims(s, base, ov));
    return sectionCache.get(key);
  };

  const gridIndex = (i, j) => j * nxN + i;
  const nodeTag = (level, i, j) => (level + 1) * NODE_BASE + gridIndex(i, j) + 1;

  /* ── nodes ──────────────────────────────────────────────────────────── */
  const nodes = [];
  const nodeByTag = new Map();
  const fixity = FIXITY[s.baseFixity] ?? FIXITY.Fixed;

  // With base isolation the restraint moves down to a separate foundation
  // node, and the superstructure base is lifted by the bearing height.
  const isolated = !!s.useIsolation;
  const isoH = isolated ? Math.max(0, numOr(s.isolatorHeight, 0)) : 0;
  const isoAt = isolated ? isolatorGrid(s.isolatorPlacement, nxN, nyN) : null;

  const levelZ = (level) => zs[level] + isoH;

  // Manual joint moves are applied here, before any element is built, so every
  // member touching a moved joint picks up the new coordinates automatically.
  const offsets = s.nodeOffsets || {};
  const movedTags = [];

  for (let level = 0; level <= nz; level++) {
    for (let j = 0; j < nyN; j++) {
      for (let i = 0; i < nxN; i++) {
        const carriesBearing = isolated && isoAt(i, j);
        const tag = nodeTag(level, i, j);
        const [dx, dy, dz] = offsets[tag] || [0, 0, 0];
        if (dx || dy || dz) movedTags.push(tag);
        const n = {
          tag,
          x: xs[i] + dx, y: ys[j] + dy, z: levelZ(level) + dz,
          i, j, level,
          // A column that has no bearing under it keeps its own restraint.
          fix: level === 0 && !carriesBearing ? fixity : null,
          mass: 0,
          master: false,
          moved: !!(dx || dy || dz),
        };
        nodes.push(n);
        nodeByTag.set(n.tag, n);
      }
    }
  }

  // Foundation nodes, numbered below the grid so tags stay easy to read.
  const foundationTag = (i, j) => gridIndex(i, j) + 1;
  if (isolated) {
    for (let j = 0; j < nyN; j++) {
      for (let i = 0; i < nxN; i++) {
        if (!isoAt(i, j)) continue;
        const tag = foundationTag(i, j);
        const [dx, dy, dz] = offsets[tag] || [0, 0, 0];
        if (dx || dy || dz) movedTags.push(tag);
        const n = {
          tag,
          x: xs[i] + dx, y: ys[j] + dy, z: dz,
          i, j, level: -1,
          fix: fixity ?? FIXITY.Fixed,
          mass: 0, master: false, foundation: true,
          moved: !!(dx || dy || dz),
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
        const tag = TAG_COLUMN + level * 1000 + gridIndex(i, j) + 1;
        elements.push(makeElement({
          tag,
          kind: 'column',
          ni: nodeTag(level, i, j),
          nj: nodeTag(level + 1, i, j),
          nodeByTag, story: level + 1, i, j,
          section: sectionFor(tag, sections.column),
        }));
      }
    }
  }

  // Beams spanning X, at every floor level above the base.
  for (let level = 1; level <= nz; level++) {
    let k = 0;
    for (let j = 0; j < nyN; j++) {
      for (let i = 0; i < nx; i++) {
        const tag = TAG_BEAM_X + level * 1000 + (k++) + 1;
        elements.push(makeElement({
          tag,
          kind: 'beamX',
          ni: nodeTag(level, i, j),
          nj: nodeTag(level, i + 1, j),
          nodeByTag, story: level, i, j,
          section: sectionFor(tag, sections.beamX),
        }));
      }
    }
  }

  // Beams spanning Y.
  for (let level = 1; level <= nz; level++) {
    let k = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nxN; i++) {
        const tag = TAG_BEAM_Y + level * 1000 + (k++) + 1;
        elements.push(makeElement({
          tag,
          kind: 'beamY',
          ni: nodeTag(level, i, j),
          nj: nodeTag(level, i, j + 1),
          nodeByTag, story: level, i, j,
          section: sectionFor(tag, sections.beamY),
        }));
      }
    }
  }

  /* ── isolators ──────────────────────────────────────────────────────── */
  const isoSection = deviceSection(s, sections.column, 'Isolator');
  if (isolated) {
    for (let j = 0; j < nyN; j++) {
      for (let i = 0; i < nxN; i++) {
        if (!isoAt(i, j)) continue;
        elements.push(makeElement({
          tag: TAG_ISOLATOR + gridIndex(i, j) + 1,
          kind: 'isolator',
          ni: foundationTag(i, j),
          nj: nodeTag(0, i, j),
          nodeByTag, story: 0, i, j,
          section: isoSection,
        }));
      }
    }
  }

  /* ── dampers ────────────────────────────────────────────────────────── */
  const damperSection = deviceSection(s, sections.beamX, 'Damper');
  const dampers = [];
  if (s.useDampers) {
    const stories = selector(s.damperStories, range(1, nz), new Set([1]));
    const bays = { x: selector(s.damperBays, range(0, nx - 1), new Set([0, nx - 1])),
                   y: selector(s.damperBays, range(0, ny - 1), new Set([0, ny - 1])) };
    const lines = { x: selector(s.damperLines, range(0, ny), new Set([0, ny])),
                    y: selector(s.damperLines, range(0, nx), new Set([0, nx])) };
    const axes = s.damperAxis === 'both' ? ['x', 'y'] : [s.damperAxis];
    let counter = 0;

    for (const axis of axes) {
      const nBays = axis === 'x' ? nx : ny;
      for (const story of stories) {
        for (const line of lines[axis]) {
          for (const bay of bays[axis]) {
            if (bay >= nBays) continue;
            // Grid indices of the bay's two bottom corners.
            const lo = axis === 'x' ? [bay, line] : [line, bay];
            const hi = axis === 'x' ? [bay + 1, line] : [line, bay + 1];

            const bl = nodeTag(story - 1, ...lo);
            const br = nodeTag(story - 1, ...hi);
            const tl = nodeTag(story, ...lo);
            const tr = nodeTag(story, ...hi);

            const add = (ni, nj) => dampers.push(Object.assign(makeElement({
              tag: TAG_DAMPER + story * 1000 + (++counter),
              kind: 'damper',
              ni, nj, nodeByTag, story, i: lo[0], j: lo[1],
              section: damperSection,
            }), { axis, line, bay }));

            if (s.damperConfig === 'chevron') {
              const beamTag = axis === 'x'
                ? TAG_BEAM_X + story * 1000 + beamXIndex(nx, bay, line) + 1
                : TAG_BEAM_Y + story * 1000 + beamYIndex(nxN, line, bay) + 1;
              const beam = elements.find((e) => e.tag === beamTag);
              if (!beam) continue;
              const mid = splitBeam(beam, story, nodes, nodeByTag, elements);
              add(bl, mid);
              add(br, mid);
            } else {
              add(bl, tr);
              if (s.damperConfig === 'cross') add(br, tl);
            }
          }
        }
      }
    }
    elements.push(...dampers);
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

  // Per-member load edits replace whatever the slab distribution produced.
  const editedTags = [];
  for (const [key, ov] of Object.entries(overrides)) {
    const el = elementByTag.get(Number(key));
    if (!el) continue;
    el.overridden = true;
    editedTags.push(el.tag);
    if (ov.w !== undefined) {
      el.w = numOr(ov.w, el.w);
      el.loadEdited = true;
      if (el.splitSibling) {
        const other = elementByTag.get(el.splitSibling);
        if (other) { other.w = el.w; other.loadEdited = true; other.overridden = true; }
      }
    }
  }

  // Self weight, applied as an extra uniform load along the member.
  const rho = numOr(s.density, 0);
  const g = numOr(s.gravityAccel, 9.81);
  if (s.selfWeight && rho > 0) {
    for (const e of elements) {
      if (e.kind === 'isolator' || e.kind === 'damper') continue;   // devices are weightless here
      e.wSelf = rho * g * e.section.A;
    }
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
  if (movedTags.length) {
    warnings.push(`${movedTags.length} joint${movedTags.length > 1 ? 's have' : ' has'} been moved off the grid. `
      + 'Member lengths follow the moved joints, but slab loads and tributary masses are still '
      + 'computed from the nominal bay spacing.');
  }
  if (isolated && ISOLATOR_TYPES[s.isolatorType]?.partialDOF) {
    warnings.push(`${s.isolatorType} carries shear only — it supplies no vertical or torsional `
      + 'stiffness, so the isolation level has a zero-energy mode and the analysis will not '
      + 'converge on its own. Use a bearing that takes -P, -T, -My and -Mz, or add a companion element.');
  }
  if (isolated && s.rigidDiaphragm) {
    warnings.push('Rigid diaphragms and base isolation are both on; the isolation level itself has no diaphragm.');
  }
  if (s.useDampers && !dampers.length) {
    warnings.push('No dampers were placed — check the frame line, bay and story selectors.');
  }
  if (s.useDampers && s.damperConfig === 'chevron') {
    warnings.push(`Chevron dampers split ${elements.filter((e) => e.splitSibling).length} beams at midspan, so those beams are two elements each.`);
  }
  if (s.massSource === 'none' && !s.elementMass && s.runModal) {
    warnings.push('No mass is defined anywhere, so the eigenvalue analysis cannot run. Enable nodal mass or element mass.');
  }
  if (usesFibers(s) && ['elasticBeamColumn', 'elasticTimoshenkoBeam'].includes(s.colElement)) {
    warnings.push('Columns use an elastic element, so the fiber section is ignored for them.');
  }
  if (usesFibers(s) && ['elasticBeamColumn', 'elasticTimoshenkoBeam'].includes(s.beamElement)) {
    warnings.push('Beams use an elastic element, so the fiber section is ignored for them.');
  }
  if (usesFibers(s) && s.colShape === 'ISection') {
    warnings.push('The I-section fiber mesh is generated as three rectangular patches without reinforcement layers.');
  }
  if (s.matSystem === 'steel' && usesFibers(s)) {
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
      isolators: elements.filter((e) => e.kind === 'isolator').length,
      dampers: elements.filter((e) => e.kind === 'damper').length,
      movedNodes: movedTags.length,
      editedElements: editedTags.length,
      dof: nodes.length * 6,
      floorArea,
      totalFloorArea: floorArea * nz,
      buildingHeight: zs[zs.length - 1] + isoH,
      isolationHeight: isoH,
      footprint: [xs[xs.length - 1], ys[ys.length - 1]],
      totalMass, storyMass,
      totalGravityLoad: totalLoad,
    },
    // Taken from the nodes themselves so a moved joint cannot fall outside the
    // extents the viewer frames and scales against.
    bounds: extentsOf(nodes, [xs[xs.length - 1], ys[ys.length - 1], zs[zs.length - 1] + isoH]),
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
  if (!el) return;
  el.w += w;
  // A beam split for a chevron carries the same intensity on both halves.
  if (el.splitSibling) {
    const other = map.get(el.splitSibling);
    if (other) other.w += w;
  }
}

/**
 * Replaces a beam with two halves joined at a new midspan node, which is what
 * a chevron damper pair needs to land on. Returns the midspan node tag.
 */
function splitBeam(beam, story, nodes, nodeByTag, elements) {
  if (beam.splitSibling) return beam.nj;

  const alongX = beam.kind === 'beamX';
  const midOffset = alongX ? MID_X_OFFSET : MID_Y_OFFSET;
  const splitBase = alongX ? TAG_SPLIT_X : TAG_SPLIT_Y;

  const a = nodeByTag.get(beam.ni);
  const b = nodeByTag.get(beam.nj);
  const index = beam.tag % 1000;
  const midTag = (story + 1) * NODE_BASE + midOffset + index;

  const mid = {
    tag: midTag,
    x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2,
    i: beam.i, j: beam.j, level: story,
    fix: null, mass: 0, master: false, midspan: true,
  };
  nodes.push(mid);
  nodeByTag.set(midTag, mid);

  const second = makeElement({
    tag: splitBase + story * 1000 + index,
    kind: beam.kind,
    ni: midTag, nj: beam.nj,
    nodeByTag, story, i: beam.i, j: beam.j,
    section: beam.section,
  });
  elements.push(second);

  beam.nj = midTag;
  beam.p2 = [mid.x, mid.y, mid.z];
  beam.length /= 2;
  beam.splitSibling = second.tag;

  return midTag;
}

/** Which column bases receive a bearing. */
function isolatorGrid(placement, nxN, nyN) {
  if (placement === 'perimeter') {
    return (i, j) => i === 0 || j === 0 || i === nxN - 1 || j === nyN - 1;
  }
  if (placement === 'corner') {
    return (i, j) => (i === 0 || i === nxN - 1) && (j === 0 || j === nyN - 1);
  }
  return () => true;
}

/**
 * Parses a selector field: `all`, `perimeter`, or an explicit index list.
 * Anything outside the valid range is dropped rather than silently clamped.
 */
function selector(text, all, perimeter) {
  const raw = String(text ?? '').trim().toLowerCase();
  if (!raw || raw === 'all') return new Set(all);
  if (raw === 'perimeter') return new Set([...perimeter].filter((v) => all.includes(v)));
  const picked = raw.split(/[,;\s]+/).map(Number).filter((n) => Number.isInteger(n) && all.includes(n));
  return new Set(picked.length ? picked : all);
}

const range = (from, to) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

/** Bounding box of the built nodes, never smaller than the nominal grid. */
function extentsOf(nodes, gridMax) {
  const min = [0, 0, 0];
  const max = [...gridMax];
  for (const n of nodes) {
    min[0] = Math.min(min[0], n.x); max[0] = Math.max(max[0], n.x);
    min[1] = Math.min(min[1], n.y); max[1] = Math.max(max[1], n.y);
    min[2] = Math.min(min[2], n.z); max[2] = Math.max(max[2], n.z);
  }
  return { min, max };
}

/** A stand-in section so devices can be drawn and listed like any member. */
function deviceSection(s, reference, name) {
  const b = Math.max(reference.b * 0.5, 1e-6);
  return {
    family: name.toLowerCase(), name, shape: 'Device',
    b, h: b, A: b * b, Iz: 0, Iy: 0, J: 0,
    E: reference.E, G: reference.G,
    modifier: 1, IzEff: 0, IyEff: 0, fiber: null,
  };
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
