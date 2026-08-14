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
  },
  'N-mm': {
    label: 'N · mm (stress in MPa)',
    force: 'N', length: 'mm', stress: 'MPa',
    area: 'mm²', inertia: 'mm⁴',
    areaLoad: 'N/mm²', lineLoad: 'N/mm',
    mass: 't', massArea: 't/mm²', massVol: 't/mm³',
    g: 9810,
    accel: 'mm/s²',
  },
  'kip-in': {
    label: 'kip · in (stress in ksi)',
    force: 'kip', length: 'in', stress: 'ksi',
    area: 'in²', inertia: 'in⁴',
    areaLoad: 'kip/in²', lineLoad: 'kip/in',
    mass: 'kip·s²/in', massArea: 'kip·s²/in³', massVol: 'kip·s²/in⁴',
    g: 386.1,
    accel: 'in/s²',
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

/**
 * Formats a number for display: fixed notation for human-scale values,
 * exponential for the very large / very small (moments of inertia in mm⁴,
 * strains, and so on).
 */
export function fmt(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const a = Math.abs(value);
  if (a !== 0 && (a >= 1e6 || a < 1e-4)) return value.toExponential(digits);
  return Number(value.toFixed(digits)).toString();
}
