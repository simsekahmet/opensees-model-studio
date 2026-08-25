/**
 * units.js — unit systems.
 *
 * OpenSees itself is unit agnostic: it only requires that every number the
 * user supplies belongs to one consistent system.  This module defines the
 * three systems the studio offers, the labels shown next to each input, and
 * the gravitational acceleration used to turn weights into masses.
 */

export const UNIT_SYSTEMS = {
  'kN-m': {
    label: 'kN · m (stress in kPa)',
    force: 'kN', length: 'm', stress: 'kPa',
    area: 'm²', inertia: 'm⁴',
    areaLoad: 'kN/m²', lineLoad: 'kN/m',
    mass: 't', massArea: 't/m²', massVol: 't/m³',
    g: 9.81,
    accel: 'm/s²',
    stiffness: 'kN/m', rotStiffness: 'kN·m/rad', damping: 'kN·(s/m)^α',
  },
  'N-mm': {
    label: 'N · mm (stress in MPa)',
    force: 'N', length: 'mm', stress: 'MPa',
    area: 'mm²', inertia: 'mm⁴',
    areaLoad: 'N/mm²', lineLoad: 'N/mm',
    mass: 't', massArea: 't/mm²', massVol: 't/mm³',
    g: 9810,
    accel: 'mm/s²',
    stiffness: 'N/mm', rotStiffness: 'N·mm/rad', damping: 'N·(s/mm)^α',
  },
  'kip-in': {
    label: 'kip · in (stress in ksi)',
    force: 'kip', length: 'in', stress: 'ksi',
    area: 'in²', inertia: 'in⁴',
    areaLoad: 'kip/in²', lineLoad: 'kip/in',
    mass: 'kip·s²/in', massArea: 'kip·s²/in³', massVol: 'kip·s²/in⁴',
    g: 386.1,
    accel: 'in/s²',
    stiffness: 'kip/in', rotStiffness: 'kip·in/rad', damping: 'kip·(s/in)^α',
  },
};

export const DEFAULT_SYSTEM = 'kN-m';

/** Returns the unit descriptor for a system id, falling back to the default. */
export function unitsOf(systemId) {
  return UNIT_SYSTEMS[systemId] || UNIT_SYSTEMS[DEFAULT_SYSTEM];
}

/** Resolves a schema `unit` key (e.g. 'stress') to a printable label. */
export function unitLabel(systemId, key) {
  if (!key) return '';
  const u = unitsOf(systemId);
  return u[key] || key;
}

/** Relative error at which fixed notation stops being an honest rendering. */
const FIXED_TOLERANCE = 0.01;

/**
 * Formats a number for display: fixed notation for human-scale values,
 * exponential for the very large and for anything fixed notation would round
 * away.
 *
 * The cutoff is measured, not assumed. A beam's effective Iy of 0.000433 m⁴
 * rounds to `0.000` at three decimals — a report that says a section has zero
 * inertia is worse than one that says `4.33e-4`, so whenever the fixed form
 * misrepresents the value by more than a per cent, the exponential form is used
 * instead.
 */
export function fmt(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (!Number.isFinite(value)) return String(value);

  const a = Math.abs(value);
  if (a === 0) return '0';
  if (a >= 1e6) return trimExponent(value, digits);

  const fixed = Number(value.toFixed(digits));
  if (fixed !== 0 && Math.abs((fixed - value) / value) <= FIXED_TOLERANCE) return String(fixed);
  return trimExponent(value, digits);
}

/** `4.330e-4` → `4.33e-4`: the trailing zeros claim precision that is not there. */
function trimExponent(value, digits) {
  return Number(value.toExponential(digits)).toExponential();
}
