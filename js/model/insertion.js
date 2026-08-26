/**
 * model/insertion.js — where a member's section sits relative to its joints.
 *
 * By default a frame member is drawn and analysed through the centroid of its
 * section: the grid line runs down the middle of the beam. That is rarely how a
 * building is detailed — a spandrel beam is flush with the outside face, a slab
 * band hangs under the floor line — so the *insertion point* names which point
 * of the section the joint line passes through.
 *
 * OpenSees expresses this as a rigid end offset on the transformation:
 * `geomTransf(..., '-jntOffset', dXi, dYi, dZi, dXj, dYj, dZj)`. The joints stay
 * exactly where they are; the member is carried off the line by the offset, and
 * the offset is rigid, so the stiffness it adds is real and not a drafting
 * convenience.
 *
 * Local axes follow the generated script: local y is the section depth `h`,
 * local z the width `b`, and the triad is built from the member's own axis and
 * the `vecxz` its family is given.
 */

/** `vecxz` per element family — the one source for this convention. */
export const VECXZ = {
  column: [1, 0, 0],
  beamX: [0, -1, 0],
  beamY: [1, 0, 0],
  isolator: [1, 0, 0],
  damper: [0, 0, 1],
};

/**
 * The nine cardinal points, plus the centroid. `y` and `z` are fractions of the
 * section depth and width, measured from the centroid towards the positive
 * local axes, so `top` is +y and `right` is +z.
 */
export const INSERTION_POINTS = {
  centroid: { label: 'Centroid — through the middle', y: 0, z: 0 },
  bottomLeft: { label: 'Bottom left', y: -0.5, z: -0.5 },
  bottomCentre: { label: 'Bottom centre', y: -0.5, z: 0 },
  bottomRight: { label: 'Bottom right', y: -0.5, z: 0.5 },
  middleLeft: { label: 'Middle left', y: 0, z: -0.5 },
  middleRight: { label: 'Middle right', y: 0, z: 0.5 },
  topLeft: { label: 'Top left', y: 0.5, z: -0.5 },
  topCentre: { label: 'Top centre', y: 0.5, z: 0 },
  topRight: { label: 'Top right', y: 0.5, z: 0.5 },
};

export const DEFAULT_INSERTION = 'centroid';

/** Only these carry an insertion point; a bearing or a damper has no section. */
export const INSERTABLE_KINDS = ['column', 'beamX', 'beamY'];

/* ─────────────────────────────── geometry ───────────────────────────── */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const unit = (v) => {
  const n = norm(v);
  return n > 1e-12 ? [v[0] / n, v[1] / n, v[2] / n] : [0, 0, 1];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The member's local triad, built the way OpenSees builds it: x from end i to
 * end j, then y = vecxz × x and z = x × y.
 *
 * @returns {[number[], number[], number[]]} the x, y and z axes in global coords
 */
export function memberBasis(kind, p1, p2) {
  const x = unit(sub(p2, p1));

  let reference = VECXZ[kind] || VECXZ.damper;
  // A reference parallel to the member leaves the roll undefined.
  if (Math.abs(dot(reference, x)) > 0.999) {
    reference = Math.abs(x[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  }

  const y = unit(cross(reference, x));
  const z = unit(cross(x, y));
  return [x, y, z];
}

/**
 * Global offset that carries the member off its joint line so that the chosen
 * point of the section lands on it.
 *
 * The point is the part of the section that must sit on the line, so the
 * centroid moves the other way: choose `topCentre` and the member hangs below.
 *
 * @returns {number[]} `[dx, dy, dz]`, zero for the centroid
 */
export function insertionOffset(kind, section, p1, p2, name) {
  const point = INSERTION_POINTS[name];
  if (!point || (!point.y && !point.z)) return [0, 0, 0];
  if (!INSERTABLE_KINDS.includes(kind) || !section) return [0, 0, 0];

  const depth = section.shape === 'Circular' ? section.D : section.h;
  const width = section.shape === 'Circular' ? section.D : section.b;
  if (!(depth > 0) || !(width > 0)) return [0, 0, 0];

  const [, y, z] = memberBasis(kind, p1, p2);
  const alongY = -point.y * depth;
  const alongZ = -point.z * width;

  return [
    y[0] * alongY + z[0] * alongZ,
    y[1] * alongY + z[1] * alongZ,
    y[2] * alongY + z[2] * alongZ,
  ];
}

/** True when the offset is large enough to be worth emitting. */
export function hasOffset(offset) {
  return !!offset && norm(offset) > 1e-9;
}
