/**
 * model/sections.js — cross-section geometry and stiffness properties.
 *
 * Local axis convention follows OpenSees: local x runs along the member,
 * h is the depth measured along local y and b the width along local z, so
 * Iz = ∫y²dA governs bending in the local x–y plane.
 */

/** Formulations whose geometry is discretised into fibers. */
export const FIBER_KINDS = ['Fiber', 'NDFiber', 'RCCircularSection'];
export const usesFibers = (s) => FIBER_KINDS.includes(s.sectionKind);

/* ───────────────────────────── primitives ───────────────────────────── */

export function rectangle(b, h) {
  const a = Math.max(b, h);
  const t = Math.min(b, h);
  // Saint-Venant torsion constant for a solid rectangle.
  const J = a * t ** 3 * (1 / 3 - 0.21 * (t / a) * (1 - t ** 4 / (12 * a ** 4)));
  return {
    shape: 'Rectangular',
    b, h,
    A: b * h,
    Iz: (b * h ** 3) / 12,
    Iy: (h * b ** 3) / 12,
    J,
    perimeter: 2 * (b + h),
  };
}

export function circle(D) {
  const r = D / 2;
  const I = (Math.PI * D ** 4) / 64;
  return {
    shape: 'Circular',
    D, b: D, h: D,
    A: Math.PI * r * r,
    Iz: I,
    Iy: I,
    J: (Math.PI * D ** 4) / 32,
    perimeter: Math.PI * D,
  };
}

export function iSection(d, bf, tf, tw) {
  const hw = d - 2 * tf;                       // clear web depth
  const A = 2 * bf * tf + hw * tw;
  const Iz = (bf * d ** 3 - (bf - tw) * hw ** 3) / 12;
  const Iy = (2 * tf * bf ** 3 + hw * tw ** 3) / 12;
  const J = (2 * bf * tf ** 3 + (d - tf) * tw ** 3) / 3;
  return { shape: 'ISection', d, bf, tf, tw, b: bf, h: d, A, Iz, Iy, J, perimeter: 2 * (bf + d) };
}

/* ─────────────────────────── from the state ─────────────────────────── */

/**
 * Builds the raw geometry of one member family.
 * @param {object} s   parameter state
 * @param {'column'|'beamX'|'beamY'} family
 */
export function geometryFor(s, family) {
  if (family === 'column') {
    if (s.colShape === 'Circular') return circle(num(s.colD));
    if (s.colShape === 'ISection') return iSection(num(s.colIh), num(s.colIbf), num(s.colItf), num(s.colItw));
    return rectangle(num(s.colB), num(s.colH));
  }

  // Both beam directions come from the same section. Where they differ it is a
  // decision about particular members, made by selecting them in the view.
  if (s.beamShape === 'ISection') {
    return iSection(num(s.beamIh), num(s.beamIbf), num(s.beamItf), num(s.beamItw));
  }
  return rectangle(num(s.beamB), num(s.beamH));
}

/**
 * Full section descriptor: geometry, elastic constants and the stiffness
 * modifier that will be applied to an elastic section.
 */
export function sectionFor(s, family) {
  const geom = geometryFor(s, family);
  const E = s.matSystem === 'steel' ? num(s.Es) : num(s.Ec);
  const G = E / (2 * (1 + num(s.nu)));
  const mod = family === 'column' ? num(s.modCol) : num(s.modBeam);
  const isFiber = usesFibers(s);

  return {
    family,
    name: familyName(family),
    ...geom,
    E, G,
    modifier: isFiber ? 1 : mod,
    IzEff: geom.Iz * (isFiber ? 1 : mod),
    IyEff: geom.Iy * (isFiber ? 1 : mod),
    fiber: isFiber ? fiberLayout(s, geom, family) : null,
  };
}

/** All three families in one call — the model builder and reports use this. */
export function allSections(s) {
  const col = sectionFor(s, 'column');
  const bx = sectionFor(s, 'beamX');
  const by = { ...bx, family: 'beamY', name: familyName('beamY') };
  return { column: col, beamX: bx, beamY: by, shared: true };
}

function familyName(family) {
  return { column: 'Column', beamX: 'Beam — X direction', beamY: 'Beam — Y direction' }[family];
}

/** Dimensions a shape exposes for editing, in the order they are shown. */
export const EDITABLE_DIMS = {
  Rectangular: ['b', 'h'],
  Circular: ['D'],
  ISection: ['h', 'bf', 'tf', 'tw'],
};

/**
 * Rebuilds one member's section from edited dimensions, recomputing area,
 * inertia, torsion constant and — for a fiber section — the whole fiber mesh,
 * so an edited member is described exactly like any other.
 */
export function sectionWithDims(s, base, dims) {
  const pick = (key) => {
    const v = Number(dims[key]);
    return Number.isFinite(v) && v > 0 ? v : base[key];
  };

  const geom = base.shape === 'Circular'
    ? circle(pick('D'))
    : base.shape === 'ISection'
      ? iSection(pick('h'), pick('bf'), pick('tf'), pick('tw'))
      : rectangle(pick('b'), pick('h'));

  const isFiber = usesFibers(s);
  return {
    ...base,
    ...geom,
    IzEff: geom.Iz * base.modifier,
    IyEff: geom.Iy * base.modifier,
    fiber: isFiber ? fiberLayout(s, geom, base.family === 'column' ? 'column' : 'beam') : null,
  };
}

/* ────────────────────────── fiber definition ────────────────────────── */

/**
 * Describes the fiber patches and rebar layers for one section.
 * Coordinates are section-local: y is the depth axis, z the width axis, with
 * the origin at the centroid — exactly what `ops.patch` / `ops.layer` expect.
 */
function fiberLayout(s, geom, family) {
  const cover = num(s.cover);
  const isColumn = family === 'column';

  if (geom.shape === 'Circular') {
    const R = geom.D / 2;
    const nBars = Math.max(6, num(s.colBarsY) * 2 + num(s.colBarsZ) * 2 - 4);
    return {
      kind: 'circular',
      R, Rcore: R - cover, cover,
      nfRadCore: 8, nfCircCore: 12, nfRadCover: 2, nfCircCover: 12,
      bars: [{ n: nBars, area: num(s.colBarArea), radius: R - cover }],
      barArea: num(s.colBarArea),
    };
  }

  // Rectangular (an I-section still falls back to its bounding rectangle for
  // the fiber mesh; a true I fiber mesh needs three separate patches and is
  // handled in the code generator).
  const h = geom.h;
  const b = geom.b;
  const yc = h / 2 - cover;   // core half-depth
  const zc = b / 2 - cover;   // core half-width

  const bars = isColumn
    ? rectBarRing(num(s.colBarsY), num(s.colBarsZ), yc, zc, num(s.colBarArea))
    : [
        { label: 'top', n: num(s.beamBarsTop), area: num(s.beamBarArea), y: yc, z1: -zc, z2: zc },
        { label: 'bottom', n: num(s.beamBarsBot), area: num(s.beamBarArea), y: -yc, z1: -zc, z2: zc },
      ];

  return {
    kind: 'rect',
    h, b, cover, yc, zc,
    nfCoreY: num(s.nfCoreY), nfCoreZ: num(s.nfCoreZ),
    nfCoverY: num(s.nfCoverY), nfCoverZ: num(s.nfCoverZ),
    bars,
    barArea: isColumn ? num(s.colBarArea) : num(s.beamBarArea),
    totalBarArea: bars.reduce((t, l) => t + l.n * l.area, 0),
  };
}

/** Perimeter rebar for a rectangular column: two full faces plus the sides. */
function rectBarRing(nY, nZ, yc, zc, area) {
  const layers = [
    { label: 'top',    n: nZ, area, y: yc,  z1: -zc, z2: zc },
    { label: 'bottom', n: nZ, area, y: -yc, z1: -zc, z2: zc },
  ];
  const nSide = Math.max(0, nY - 2);
  if (nSide > 0) {
    const step = (2 * yc) / (nY - 1);
    for (let i = 1; i <= nSide; i++) {
      const y = -yc + i * step;
      layers.push({ label: `side ${i}`, n: 2, area, y, z1: -zc, z2: zc, sideOnly: true });
    }
  }
  return layers;
}


/* ─────────────────────── sections made by member edits ──────────────── */

/** Everything that makes two sections different to look at and to analyse. */
export function sectionSignature(sec) {
  return [sec.shape, sec.b, sec.h, sec.D ?? '', sec.bf ?? '', sec.tf ?? '', sec.tw ?? ''].join('|');
}

/** The section a member would have without any per-member edit. */
export function familySection(model, kind) {
  const { column, beamX, beamY } = model.sections;
  return kind === 'column' ? column : kind === 'beamX' ? beamX : beamY;
}

/**
 * Sections that exist only because members were edited in the inspector,
 * grouped so twenty columns resized the same way appear once. A member edited
 * for its load alone keeps the family section and is not listed here.
 */
export function editedSectionGroups(model) {
  const byKey = new Map();
  for (const e of model.elements) {
    if (!e.overridden || e.section.shape === 'Device') continue;
    if (e.section === familySection(model, e.kind)) continue;
    const key = `${e.kind}|${sectionSignature(e.section)}`;
    if (!byKey.has(key)) byKey.set(key, { family: e.kind, section: e.section, elements: [] });
    byKey.get(key).elements.push(e);
  }
  return [...byKey.values()];
}

/* ──────────────────────────────── util ─────────────────────────────── */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
