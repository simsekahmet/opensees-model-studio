/**
 * model/groundmotion.js — ground motion records for time-history analysis.
 *
 * The record itself lives in memory only: acceleration series are far too
 * large for localStorage, and the generated script reads the file from disk
 * anyway.  What the app keeps is the parsed series (for the summary and the
 * clean re-export) plus a small descriptor that does get persisted.
 */

const listeners = new Set();

let record = null;   // { name, values, dt, npts, pga, source }

export function subscribeGM(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getRecord() {
  return record;
}

export function clearRecord() {
  record = null;
  for (const fn of listeners) fn(null);
}

/**
 * Reads an uploaded acceleration file. Understands the PEER NGA header as well
 * as plain whitespace- or comma-separated values.
 */
export async function loadRecordFile(file) {
  const text = await file.text();
  const parsed = parseRecord(text);
  if (!parsed.values.length) throw new Error('No numeric acceleration values were found in the file.');

  record = {
    name: file.name,
    values: parsed.values,
    dt: parsed.dt,
    npts: parsed.values.length,
    pga: parsed.values.reduce((m, v) => Math.max(m, Math.abs(v)), 0),
    source: parsed.source,
  };
  for (const fn of listeners) fn(record);
  return record;
}

/**
 * Splits a record file into its numeric series and, where the header declares
 * them, the time step and point count.
 *
 * PEER NGA files carry four header lines, the fourth of which reads something
 * like `NPTS=  3000, DT= .0100 SEC`.
 */
export function parseRecord(text) {
  const lines = text.split(/\r?\n/);
  let dt = null;
  let source = 'plain';
  let start = 0;

  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    const m = /NPTS\s*[=:]\s*([\d.]+)\s*,?\s*DT\s*[=:]\s*([\d.eE+-]+)/i.exec(lines[i]);
    if (m) {
      dt = Number(m[2]);
      source = 'PEER NGA';
      start = i + 1;
      break;
    }
    const alt = /\bDT\s*[=:]\s*([\d.eE+-]+)/i.exec(lines[i]);
    if (alt) { dt = Number(alt[1]); source = 'header'; start = i + 1; }
  }

  const values = [];
  for (let i = start; i < lines.length; i++) {
    // Skip any remaining prose header lines.
    if (/[A-DF-Za-df-z]/.test(lines[i].replace(/[eE][+-]?\d/g, ''))) continue;
    for (const token of lines[i].trim().split(/[\s,]+/)) {
      if (!token) continue;
      const n = Number(token);
      if (Number.isFinite(n)) values.push(n);
    }
  }

  return { values, dt: Number.isFinite(dt) && dt > 0 ? dt : null, source };
}

/** One value per line — the form `timeSeries('Path', ..., '-filePath', …)` wants. */
export function exportSeries(rec) {
  return `${rec.values.map((v) => v.toExponential(6)).join('\n')}\n`;
}

/** File name the generated script will reference. */
export function scriptFileName(rec) {
  return `${(rec?.name || 'ground_motion').replace(/\.[^.]*$/, '').replace(/[^\w.-]+/g, '_')}.txt`;
}
