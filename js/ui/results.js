/**
 * ui/results.js — the Results panel.
 *
 * The browser cannot run OpenSees, so results come back the way they left: as
 * files. The user runs the generated script, drops the output directory here,
 * and every recorder column is identified from `manifest.json` rather than
 * guessed at.
 *
 * What the panel shows is what an engineer checks first — periods and mass
 * participation, story drift and shear, the capacity curve, the hysteresis
 * loop, the traces and the convergence history — followed by the raw tables
 * with their columns finally labelled.
 */

import { fmt } from '../units.js';
import { heading, table, wrapTable } from './reports.js';
import { xyChart, storyChart } from './charts.js';
import {
  DIRECTIONS, storyDisplacements, storyDrifts, storyShears, baseShear, envelope,
  capacityCurve, convergence, nodeTrace, roofNode,
} from '../results/derive.js';

const MAX_TABLE_ROWS = 300;

/**
 * Renders the whole panel.
 *
 * @param {HTMLElement} root
 * @param {object|null} results  from `results/load.js`, or null when none loaded
 * @param {object} handlers      { onPick, onClear, onExport }
 */
export function renderResults(root, results, handlers) {
  root.textContent = '';
  root.append(dropZone(results, handlers));
  if (!results) return;

  summary(root, results);
  modal(root, results);
  storySection(root, results);
  capacity(root, results);
  traces(root, results);
  convergenceSection(root, results);
  rawTables(root, results, handlers);
}

/* ─────────────────────────────── loading ────────────────────────────── */

function dropZone(results, handlers) {
  const box = document.createElement('div');
  box.className = 'res-drop';
  box.dataset.state = results ? 'loaded' : 'empty';

  const body = document.createElement('div');
  body.className = 'res-drop-body';

  if (results) {
    const m = results.manifest;
    const title = document.createElement('strong');
    title.textContent = m.model || 'Analysis results';
    const detail = document.createElement('span');
    const files = Object.keys(results.series).length;
    detail.textContent = `${files} result file${files > 1 ? 's' : ''} · `
      + `${results.nodes.size} nodes · ${results.elements.size} elements · `
      + `${m.unitSystem || ''} · written by version ${m.version || '?'}`;
    body.append(title, detail);

    if (results.missing.length) {
      const missing = document.createElement('span');
      missing.className = 'res-missing';
      missing.textContent = `Not found: ${results.missing.join(', ')}`;
      body.append(missing);
    }
  } else {
    const title = document.createElement('strong');
    title.textContent = 'Load an analysis';
    const detail = document.createElement('span');
    detail.textContent = 'Run the generated script, then drop its output folder here — '
      + 'or pick the files, including manifest.json.';
    body.append(title, detail);
  }

  const actions = document.createElement('div');
  actions.className = 'res-drop-actions';

  const pick = document.createElement('button');
  pick.className = 'btn btn-ghost btn-sm';
  pick.textContent = results ? 'Load another' : 'Choose files…';
  pick.addEventListener('click', () => handlers.onPick());
  actions.append(pick);

  if (results) {
    const clear = document.createElement('button');
    clear.className = 'btn btn-ghost btn-sm';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => handlers.onClear());
    actions.append(clear);
  }

  box.append(body, actions);

  // Dropping a folder is the natural gesture, so the whole card accepts it.
  box.addEventListener('dragover', (ev) => { ev.preventDefault(); box.dataset.over = 'yes'; });
  box.addEventListener('dragleave', () => { delete box.dataset.over; });
  box.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    delete box.dataset.over;
    const files = await filesFromDrop(ev.dataTransfer);
    if (files.length) handlers.onFiles(files);
  });

  return box;
}

/** Expands a dropped directory into the files inside it, one level deep. */
async function filesFromDrop(transfer) {
  const items = [...(transfer.items || [])];
  const entries = items
    .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
    .filter(Boolean);

  if (!entries.some((e) => e.isDirectory)) return [...transfer.files];

  const files = [];
  for (const entry of entries) {
    if (entry.isFile) files.push(await fileOf(entry));
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      const children = await new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
      for (const child of children) if (child.isFile) files.push(await fileOf(child));
    }
  }
  return files.filter(Boolean);
}

const fileOf = (entry) => new Promise((resolve) => entry.file(resolve, () => resolve(null)));

/* ─────────────────────────────── summary ────────────────────────────── */

function summary(root, results) {
  const u = results.units;
  const cases = results.cases;
  const tiles = [];

  if (cases.gravity && Array.isArray(cases.gravity.baseReaction)) {
    const vertical = cases.gravity.baseReaction[2];
    tiles.push(['Vertical base reaction', fmt(Math.abs(vertical), 2), u.force || '']);
  }
  if (cases.modal && cases.modal.periods && cases.modal.periods.length) {
    tiles.push(['Fundamental period', `${fmt(cases.modal.periods[0], 4)} s`,
      `${cases.modal.modes} modes`]);
  }
  if (cases.pushover) {
    tiles.push(['Pushover steps', String(cases.pushover.steps),
      `target drift ${fmt(cases.pushover.targetDrift, 3)}`]);
  }
  if (cases.cyclic) {
    tiles.push(['Cyclic steps', String(cases.cyclic.steps),
      `${cases.cyclic.amplitudes.length} amplitudes`]);
  }
  if (cases.timeHistory) {
    const th = cases.timeHistory;
    const complete = th.steps >= th.requestedSteps;
    tiles.push(['Time history', `${th.steps} steps`,
      complete ? `dt ${th.dt} s — completed` : `dt ${th.dt} s — stopped early`]);
  }
  if (!tiles.length) return;

  root.append(heading('Summary'));
  const row = document.createElement('div');
  row.className = 'stat-row';
  for (const [label, value, sub] of tiles) {
    const box = document.createElement('div');
    box.className = 'stat';
    box.innerHTML = '<div class="lbl"></div><div class="val"></div><div class="sub"></div>';
    box.querySelector('.lbl').textContent = label;
    box.querySelector('.val').textContent = value;
    box.querySelector('.sub').textContent = sub;
    row.append(box);
  }
  root.append(row);
}

/* ──────────────────────────────── modal ─────────────────────────────── */

const MASS_AXES = [['MX', 'X'], ['MY', 'Y'], ['MZ', 'Z']];

function modal(root, results) {
  const c = results.cases.modal;
  if (!c || !c.periods || !c.periods.length) return;

  root.append(heading('Modal'));

  const ratios = c.massRatios || {};
  const cumulative = c.massRatiosCumulative || {};
  const hasMass = MASS_AXES.some(([key]) => Array.isArray(ratios[key]));

  const headers = ['Mode', 'Period [s]', 'Frequency [Hz]'];
  if (hasMass) headers.push(...MASS_AXES.map(([, label]) => `${label} mass %`),
    ...MASS_AXES.map(([, label]) => `Σ ${label} %`));

  const rows = c.periods.map((period, i) => {
    const row = [String(i + 1), fmt(period, 4), period > 0 ? fmt(1 / period, 4) : '—'];
    if (hasMass) {
      for (const [key] of MASS_AXES) row.push(pct(ratios[key], i));
      for (const [key] of MASS_AXES) row.push(pct(cumulative[key], i));
    }
    return row;
  });

  root.append(wrapTable(table(headers, rows, 0)));

  const note = document.createElement('p');
  note.className = 'tbl-note';
  note.textContent = hasMass
    ? 'Participating mass ratios come from OpenSees itself, so they match what the solver used.'
    : 'Participation factors were not available in this run; only the periods were recorded.';
  root.append(note);
}

const pct = (list, i) => (Array.isArray(list) && Number.isFinite(list[i]) ? list[i].toFixed(2) : '—');

/* ─────────────────────────── story results ──────────────────────────── */

function storySection(root, results) {
  const drifts = DIRECTIONS.map((d) => ({ ...d, data: envelope(storyDrifts(results, d.dof)) }));
  const shears = DIRECTIONS.map((d) => ({ ...d, data: storyShears(results, d.dof) }));
  const disps = DIRECTIONS.map((d) => ({ ...d, data: envelope(storyDisplacements(results, d.dof)) }));

  if (!drifts.some((d) => d.data) && !shears.some((d) => d.data)) return;

  root.append(heading('Story results — envelopes'));

  const grid = document.createElement('div');
  grid.className = 'chart-grid';

  const driftSets = drifts
    .filter((d) => d.data && d.data.length)
    .map((d) => ({ name: `Drift ${d.label}`, values: d.data.map((s) => ({ level: s.level, value: s.peak })) }));

  grid.append(storyChart(driftSets, {
    title: 'Story drift ratio',
    xTitle: 'Drift ratio',
    note: 'Largest relative displacement across each story over the whole analysis, divided by '
      + 'the story height.',
    limit: 0.02,
    limitLabel: '2 %',
    emptyText: 'No displacement record was found.',
  }));

  const shearSets = shears
    .filter((d) => d.data && d.data.length)
    .map((d) => ({ name: `Shear ${d.label}`, values: d.data.map((s) => ({ level: s.level, value: s.peak })) }));

  grid.append(storyChart(shearSets, {
    title: `Story shear [${results.units.force || ''}]`,
    xTitle: `Shear [${results.units.force || ''}]`,
    note: 'Sum of the horizontal force at the base of every column in the story, at its peak.',
    emptyText: 'No element force record was found.',
  }));

  const dispSets = disps
    .filter((d) => d.data && d.data.length)
    .map((d) => ({ name: `Displacement ${d.label}`, values: d.data.map((s) => ({ level: s.level, value: s.peak })) }));

  grid.append(storyChart(dispSets, {
    title: `Story displacement [${results.units.length || ''}]`,
    xTitle: `Displacement [${results.units.length || ''}]`,
    note: 'Average horizontal displacement of the nodes on each floor, at its peak.',
  }));

  root.append(grid);
  root.append(storyTable(results, drifts, shears, disps));
}

function storyTable(results, drifts, shears, disps) {
  const levels = new Map();
  const put = (list, key) => {
    for (const entry of list) {
      if (!entry.data) continue;
      for (const story of entry.data) {
        if (!levels.has(story.level)) levels.set(story.level, { level: story.level, z: story.z });
        levels.get(story.level)[`${key}${entry.label}`] = story.peak;
      }
    }
  };
  put(drifts, 'drift');
  put(shears, 'shear');
  put(disps, 'disp');

  const rows = [...levels.values()]
    .sort((a, b) => b.level - a.level)
    .map((r) => [
      r.level === 0 ? 'Base' : `Level ${r.level}`,
      fmt(r.z, 3),
      value(r.dispX), value(r.dispY),
      value(r.driftX), value(r.driftY),
      value(r.shearX), value(r.shearY),
    ]);

  const u = results.units;
  return wrapTable(table(
    ['Story', `z [${u.length || ''}]`,
     `ux [${u.length || ''}]`, `uy [${u.length || ''}]`,
     'Drift X', 'Drift Y',
     `Vx [${u.force || ''}]`, `Vy [${u.force || ''}]`],
    rows, 0
  ));
}

const value = (v) => (Number.isFinite(v) ? fmt(v, 4) : '—');

/* ──────────────────── capacity and hysteresis curves ────────────────── */

function capacity(root, results) {
  const push = capacityCurve(results, 'pushover.out');
  const cyc = capacityCurve(results, 'cyclic.out');
  if (!push && !cyc) return;

  root.append(heading('Capacity'));
  const grid = document.createElement('div');
  grid.className = 'chart-grid';
  const u = results.units;

  if (push) {
    grid.append(xyChart([{ name: 'Pushover', points: push }], {
      title: 'Pushover capacity curve',
      xTitle: `Roof displacement [${u.length || ''}]`,
      yTitle: `Base shear [${u.force || ''}]`,
      note: 'Base shear is the sum of the support reactions along the pushover direction.',
      width: 640, height: 320,
    }));

    // The same curve read as drift is what a performance check works in.
    const height = results.cases.pushover && results.cases.pushover.height;
    if (height > 0) {
      grid.append(xyChart([{ name: 'Normalised', points: push.map(([d, v]) => [d / height, v]) }], {
        title: 'Capacity — roof drift ratio',
        xTitle: 'Roof drift ratio',
        yTitle: `Base shear [${u.force || ''}]`,
        width: 640, height: 320,
      }));
    }
  }

  if (cyc) {
    grid.append(xyChart([{ name: 'Cyclic', points: cyc, color: '--el-damper' }], {
      title: 'Hysteresis',
      xTitle: `Roof displacement [${u.length || ''}]`,
      yTitle: `Base shear [${u.force || ''}]`,
      note: 'Every analysis step is plotted, so the enclosed area is the energy the model dissipated.',
      symmetric: true,
      width: 640, height: 420,
    }));
  }

  root.append(grid);
}

/* ─────────────────────────────── traces ─────────────────────────────── */

function traces(root, results) {
  const roof = roofNode(results);
  if (!roof) return;

  const sets = [];
  const u = results.units;

  for (const d of DIRECTIONS) {
    const trace = nodeTrace(results, roof, d.dof);
    if (trace && trace.values.length > 1) {
      sets.push({ name: `u${d.label}`, points: trace.time.map((t, i) => [t, trace.values[i]]) });
    }
  }
  if (!sets.length) return;

  root.append(heading('Time history'));
  const grid = document.createElement('div');
  grid.className = 'chart-grid';

  const xTitle = results.cases.timeHistory ? 'Time [s]' : 'Pseudo-time';

  grid.append(xyChart(sets, {
    title: `Roof displacement — node ${roof}`,
    xTitle,
    yTitle: `Displacement [${u.length || ''}]`,
    width: 640, height: 300,
  }));

  const shearSets = DIRECTIONS
    .map((d) => ({ d, values: baseShear(results, d.dof) }))
    .filter((s) => s.values && s.values.length > 1);

  if (shearSets.length) {
    const time = results.time('reactions.out');
    grid.append(xyChart(shearSets.map((s) => ({
      name: `V${s.d.label}`,
      points: time.map((t, i) => [t, s.values[i]]),
    })), {
      title: 'Base shear',
      xTitle,
      yTitle: `Base shear [${u.force || ''}]`,
      note: 'Summed from the reactions at the nodes that actually carry the supports.',
      width: 640, height: 300,
    }));
  }

  root.append(grid);
}

/* ─────────────────────────── convergence ────────────────────────────── */

function convergenceSection(root, results) {
  const history = convergence(results);
  if (!history || !history.points.length) return;

  root.append(heading('Convergence'));

  const worst = history.points.reduce((a, p) => Math.max(a, p[1]), 0);
  const mean = history.points.reduce((a, p) => a + p[1], 0) / history.points.length;

  const grid = document.createElement('div');
  grid.className = 'chart-grid';
  grid.append(xyChart([{ name: 'Iterations', points: history.points, color: '--warn' }], {
    title: `Iterations per step — ${history.label}`,
    xTitle: history.xLabel,
    yTitle: 'Iterations',
    note: `Worst step took ${worst} iterations; the average was ${mean.toFixed(1)}. `
      + 'A run that climbs towards the iteration limit is about to stop converging.',
    width: 640, height: 260,
  }));

  if (history.norms) {
    grid.append(xyChart([{ name: 'Final norm', points: history.norms, color: '--danger' }], {
      title: 'Test norm at the end of each step',
      xTitle: history.xLabel,
      yTitle: 'Norm',
      width: 640, height: 260,
    }));
  }

  root.append(grid);
}

/* ────────────────────────────── raw tables ──────────────────────────── */

function rawTables(root, results, handlers) {
  root.append(heading('Result files'));

  const names = Object.keys(results.series);
  const picker = document.createElement('div');
  picker.className = 'res-file-bar';

  const select = document.createElement('select');
  select.className = 'mini-select';
  for (const name of names) {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = `${name} — ${results.steps(name)} rows × ${results.series[name].width} columns`;
    select.append(o);
  }

  const download = document.createElement('button');
  download.className = 'btn btn-ghost btn-sm';
  download.textContent = 'Download as CSV';
  download.addEventListener('click', () => handlers.onExport(select.value));

  picker.append(select, download);
  root.append(picker);

  const host = document.createElement('div');
  root.append(host);

  const paint = () => {
    host.textContent = '';
    const spec = results.series[select.value];
    const headers = spec.columns.map(columnLabel);
    const rows = spec.rows.slice(0, MAX_TABLE_ROWS).map((row) => [...row].map((v) => fmt(v, 5)));
    host.append(wrapTable(table(headers, rows, spec.rows.length)));

    const note = document.createElement('p');
    note.className = 'tbl-note';
    note.textContent = `${spec.response} · ${spec.layout === 'table' ? 'one row per step' : 'time series'}`
      + (spec.rows.length > MAX_TABLE_ROWS
        ? ` · showing the first ${MAX_TABLE_ROWS} of ${spec.rows.length} rows — download the CSV for all of them.`
        : '');
    host.append(note);
  };

  select.addEventListener('change', paint);
  paint();
}

/** The header a manifest column deserves — this is the whole point of it. */
export function columnLabel(col) {
  if (col.name) return col.name;
  if (col.node !== undefined) return `node ${col.node} · dof ${col.dof}`;
  if (col.element !== undefined) return `ele ${col.element} · ${col.component}`;
  return '?';
}

/** One result file as CSV, with the manifest's names as its header row. */
export function toCsv(results, name) {
  const spec = results.series[name];
  if (!spec) return '';
  const header = spec.columns.map((c) => `"${columnLabel(c).replace(/"/g, '""')}"`).join(',');
  const body = spec.rows.map((row) => [...row].join(',')).join('\n');
  return `${header}\n${body}\n`;
}
