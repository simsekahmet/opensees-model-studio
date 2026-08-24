/**
 * ui/reports.js — the Sections, Model Data and inspector panels.
 *
 * Everything here reads the built model, so the numbers shown are the same
 * ones the generated script uses.
 */

import { unitsOf, fmt } from '../units.js';
import { EDITABLE_DIMS, usesFibers, editedSectionGroups } from '../model/sections.js';

const MAX_ROWS = 600;

const FAMILY = {
  column: 'Column',
  beamX: 'Beam X',
  beamY: 'Beam Y',
  isolator: 'Isolator',
  damper: 'Damper',
};

/* ═══════════════════════════════ Sections ═══════════════════════════ */

export function renderSections(root, s, model) {
  root.textContent = '';
  if (!model) return empty(root, 'Compile the model to see the cross-sections.');

  const u = unitsOf(s.unitSystem);
  const { column, beamX, beamY, shared } = model.sections;
  const list = shared ? [column, beamX] : [column, beamX, beamY];

  root.append(heading('Cross-sections'));

  const grid = document.createElement('div');
  grid.className = 'card-grid';
  for (const sec of list) grid.append(sectionCard(sec, s, u, shared));
  root.append(grid);

  root.append(heading('Section properties'));
  root.append(wrapTable(table(
    ['Section', 'Shape', `b [${u.length}]`, `h [${u.length}]`, `A [${u.area}]`,
     `Iz [${u.inertia}]`, `Iy [${u.inertia}]`, `J [${u.inertia}]`, 'Ig factor'],
    list.map((sec) => [
      shared && sec.family === 'beamX' ? 'Beam — X and Y' : sec.name,
      sec.shape, fmt(sec.b), fmt(sec.h), fmt(sec.A),
      fmt(sec.IzEff), fmt(sec.IyEff), fmt(sec.J), fmt(sec.modifier, 2),
    ]),
    0
  )));

  const note = document.createElement('p');
  note.className = 'tbl-note';
  note.textContent = usesFibers(s)
    ? 'Fiber sections use the gross geometry; Iz and Iy above are reported for reference only.'
    : 'Iz and Iy include the cracked-section modifiers set in the Sections group.';
  root.append(note);

  renderEditedSections(root, s, model, u);
}

/**
 * Sections that exist only because members were edited in the inspector. They
 * are drawn and tabulated exactly like the model-wide ones, and each card says
 * which members carry it.
 */
function renderEditedSections(root, s, model, u) {
  const groups = editedSectionGroups(model);
  if (!groups.length) return;

  root.append(heading(`Sections from member edits — ${groups.length}`));

  const grid = document.createElement('div');
  grid.className = 'card-grid';
  for (const g of groups) {
    const named = { ...g.section, name: `${FAMILY[g.family]} — ${g.elements.length} member${g.elements.length > 1 ? 's' : ''}` };
    const card = sectionCard(named, s, u, false);

    const tags = document.createElement('p');
    tags.className = 'tbl-note';
    const shown = g.elements.slice(0, 12).map((e) => e.tag).join(', ');
    tags.textContent = `Members: ${shown}${g.elements.length > 12 ? `, +${g.elements.length - 12} more` : ''}`;
    card.append(tags);

    grid.append(card);
  }
  root.append(grid);

  root.append(wrapTable(table(
    ['Section', 'Shape', `b [${u.length}]`, `h [${u.length}]`, `A [${u.area}]`,
     `Iz [${u.inertia}]`, `Iy [${u.inertia}]`, `J [${u.inertia}]`, 'Members'],
    groups.map((g) => [
      FAMILY[g.family],
      g.section.shape, fmt(g.section.b), fmt(g.section.h), fmt(g.section.A),
      fmt(g.section.IzEff), fmt(g.section.IyEff), fmt(g.section.J), String(g.elements.length),
    ]),
    0
  )));
}

function sectionCard(sec, s, u, shared) {
  const card = document.createElement('div');
  card.className = 'card';

  const title = document.createElement('h4');
  title.textContent = shared && sec.family === 'beamX' ? 'Beam — X and Y direction' : sec.name;
  card.append(title);

  const fig = document.createElement('div');
  fig.className = 'sec-fig';
  fig.append(drawSection(sec, s));

  const dl = document.createElement('dl');
  dl.className = 'kv';
  const rows = sec.shape === 'Circular'
    ? [[`Diameter [${u.length}]`, fmt(sec.D)]]
    : sec.shape === 'ISection'
      ? [[`Depth d [${u.length}]`, fmt(sec.h)], [`Flange bf [${u.length}]`, fmt(sec.bf)],
         [`Flange tf [${u.length}]`, fmt(sec.tf)], [`Web tw [${u.length}]`, fmt(sec.tw)]]
      : [[`Width b [${u.length}]`, fmt(sec.b)], [`Depth h [${u.length}]`, fmt(sec.h)]];

  rows.push(
    [`Area [${u.area}]`, fmt(sec.A)],
    [`Iz [${u.inertia}]`, fmt(sec.Iz)],
    [`Iy [${u.inertia}]`, fmt(sec.Iy)],
    [`J [${u.inertia}]`, fmt(sec.J)],
    [`E [${u.stress}]`, fmt(sec.E)],
  );
  if (sec.fiber?.totalBarArea) {
    rows.push([`Rebar [${u.area}]`, fmt(sec.fiber.totalBarArea)]);
    rows.push(['Reinf. ratio', `${(100 * sec.fiber.totalBarArea / sec.A).toFixed(2)} %`]);
  }

  for (const [k, v] of rows) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  }

  fig.append(dl);
  card.append(fig);
  return card;
}

/* ─────────────────────────── SVG cross-section ──────────────────────── */

const SVG_NS = 'http://www.w3.org/2000/svg';
const BOX = 190;      // drawing box in px
const MARGIN = 34;

function drawSection(sec, s) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const size = BOX + MARGIN * 2;
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

  const w = sec.shape === 'Circular' ? sec.D : sec.b;
  const h = sec.shape === 'Circular' ? sec.D : sec.h;
  const k = BOX / Math.max(w, h);                 // model units → px
  const cx = size / 2, cy = size / 2;
  const px = (z) => cx + z * k;                   // section z → screen x
  const py = (y) => cy - y * k;                   // section y → screen y (up)

  if (sec.shape === 'Circular') {
    add(svg, 'circle', { cx, cy, r: (sec.D / 2) * k, class: 'svg-outline' });
    if (sec.fiber) {
      add(svg, 'circle', { cx, cy, r: sec.fiber.Rcore * k, class: 'svg-core' });
      const { n, area, radius } = sec.fiber.bars[0];
      const rBar = Math.max(2, Math.sqrt(area / Math.PI) * k);
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n;
        add(svg, 'circle', { cx: px(radius * Math.cos(a)), cy: py(radius * Math.sin(a)), r: rBar, class: 'svg-bar' });
      }
    }
    dimH(svg, px(-sec.D / 2), px(sec.D / 2), py(-sec.D / 2) + 16, `D = ${fmt(sec.D)}`);
    return svg;
  }

  if (sec.shape === 'ISection') {
    const hz = sec.bf / 2, hy = sec.h / 2, hw = sec.tw / 2, yf = sec.h / 2 - sec.tf;
    const pts = [
      [-hz, -hy], [hz, -hy], [hz, -yf], [hw, -yf], [hw, yf],
      [hz, yf], [hz, hy], [-hz, hy], [-hz, yf], [-hw, yf], [-hw, -yf], [-hz, -yf],
    ].map(([z, y]) => `${px(z)},${py(y)}`).join(' ');
    add(svg, 'polygon', { points: pts, class: 'svg-outline' });
    dimH(svg, px(-hz), px(hz), py(-hy) + 16, `bf = ${fmt(sec.bf)}`);
    dimV(svg, py(-hy), py(hy), px(hz) + 16, `d = ${fmt(sec.h)}`);
    return svg;
  }

  // Rectangular
  add(svg, 'rect', {
    x: px(-sec.b / 2), y: py(sec.h / 2), width: sec.b * k, height: sec.h * k, class: 'svg-outline',
  });

  if (sec.fiber) {
    const f = sec.fiber;
    add(svg, 'rect', {
      x: px(-f.zc), y: py(f.yc), width: 2 * f.zc * k, height: 2 * f.yc * k, class: 'svg-core',
    });
    for (const layer of f.bars) {
      const rBar = Math.max(1.8, Math.sqrt(layer.area / Math.PI) * k);
      if (layer.sideOnly) {
        add(svg, 'circle', { cx: px(-f.zc), cy: py(layer.y), r: rBar, class: 'svg-bar' });
        add(svg, 'circle', { cx: px(f.zc), cy: py(layer.y), r: rBar, class: 'svg-bar' });
        continue;
      }
      for (let i = 0; i < layer.n; i++) {
        const t = layer.n === 1 ? 0.5 : i / (layer.n - 1);
        add(svg, 'circle', { cx: px(layer.z1 + t * (layer.z2 - layer.z1)), cy: py(layer.y), r: rBar, class: 'svg-bar' });
      }
    }
  }

  dimH(svg, px(-sec.b / 2), px(sec.b / 2), py(-sec.h / 2) + 16, `b = ${fmt(sec.b)}`);
  dimV(svg, py(-sec.h / 2), py(sec.h / 2), px(sec.b / 2) + 16, `h = ${fmt(sec.h)}`);
  return svg;
}

function dimH(svg, x1, x2, y, text) {
  add(svg, 'line', { x1, y1: y, x2, y2: y, class: 'svg-dim' });
  add(svg, 'line', { x1, y1: y - 4, x2: x1, y2: y + 4, class: 'svg-dim' });
  add(svg, 'line', { x1: x2, y1: y - 4, x2, y2: y + 4, class: 'svg-dim' });
  const t = add(svg, 'text', { x: (x1 + x2) / 2, y: y + 15, class: 'svg-txt', 'text-anchor': 'middle' });
  t.textContent = text;
}

function dimV(svg, y1, y2, x, text) {
  add(svg, 'line', { x1: x, y1, x2: x, y2, class: 'svg-dim' });
  add(svg, 'line', { x1: x - 4, y1, x2: x + 4, y2: y1, class: 'svg-dim' });
  add(svg, 'line', { x1: x - 4, y1: y2, x2: x + 4, y2, class: 'svg-dim' });
  const t = add(svg, 'text', {
    x: x + 12, y: (y1 + y2) / 2, class: 'svg-txt', 'text-anchor': 'middle',
    transform: `rotate(-90 ${x + 12} ${(y1 + y2) / 2})`,
  });
  t.textContent = text;
}

function add(svg, tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  svg.append(el);
  return el;
}

/* ═══════════════════════════════ Model data ═════════════════════════ */

export function renderData(root, s, model) {
  root.textContent = '';
  if (!model) return empty(root, 'Compile the model to see its node, element and story tables.');

  const u = unitsOf(s.unitSystem);
  const st = model.stats;

  /* Summary tiles */
  const stats = document.createElement('div');
  stats.className = 'stat-row';
  for (const [lbl, val, sub] of [
    ['Nodes', String(st.nodes), `${st.dof} DOF`],
    ['Elements', String(st.elements),
      `${st.columns} col · ${st.beamsX + st.beamsY} beam`
      + (st.isolators ? ` · ${st.isolators} iso` : '')
      + (st.dampers ? ` · ${st.dampers} damper` : '')],
    ['Footprint', `${fmt(st.footprint[0], 2)} × ${fmt(st.footprint[1], 2)}`, u.length],
    ['Height', fmt(st.buildingHeight, 2), u.length],
    ['Total floor area', fmt(st.totalFloorArea, 1), u.area],
    ['Seismic mass', fmt(st.totalMass, 2), u.mass],
  ]) {
    const box = document.createElement('div');
    box.className = 'stat';
    box.innerHTML = '<div class="lbl"></div><div class="val"></div><div class="sub"></div>';
    box.querySelector('.lbl').textContent = lbl;
    box.querySelector('.val').textContent = val;
    box.querySelector('.sub').textContent = sub;
    stats.append(box);
  }
  root.append(stats);

  /* Warnings */
  if (model.warnings.length) {
    root.append(heading('Warnings'));
    const card = document.createElement('div');
    card.className = 'card';
    const ul = document.createElement('ul');
    for (const wtext of model.warnings) {
      const li = document.createElement('li');
      li.style.cssText = 'margin:4px 0;padding-left:14px;position:relative;color:var(--text-2)';
      li.textContent = wtext;
      ul.append(li);
    }
    card.append(ul);
    root.append(card);
  }

  /* Stories */
  root.append(heading('Stories'));
  const zs = model.grid.zs;
  const storyRows = [];
  for (let level = model.grid.nz; level >= 1; level--) {
    storyRows.push([
      level === model.grid.nz ? `Roof (L${level})` : `Level ${level}`,
      fmt(zs[level], 2),
      fmt(zs[level] - zs[level - 1], 2),
      String(model.grid.perLevel),
      String(model.elements.filter((e) => e.story === level).length),
      fmt(st.storyMass[level], 2),
    ]);
  }
  storyRows.push(['Base (L0)', fmt(0, 2), '—', String(model.grid.perLevel), '0', '0']);
  root.append(wrapTable(table(
    ['Level', `Elevation [${u.length}]`, `Height [${u.length}]`, 'Nodes', 'Elements', `Mass [${u.mass}]`],
    storyRows, 0
  )));

  /* Elements */
  root.append(heading('Elements'));
  const elementType = (kind) => (kind === 'column' ? s.colElement : s.beamElement);
  const elRows = model.elements.slice(0, MAX_ROWS).map((e) => [
    String(e.tag),
    FAMILY[e.kind] || e.kind,
    e.kind === 'isolator' ? s.isolatorType
      : e.kind === 'damper' ? `twoNodeLink · ${s.damperType}`
      : elementType(e.kind),
    String(e.ni), String(e.nj),
    fmt(e.length, 3),
    e.section.shape === 'Circular' ? `Ø${fmt(e.section.D)}` : `${fmt(e.section.b)} × ${fmt(e.section.h)}`,
    fmt(e.section.A),
    fmt(e.w + (e.wSelf || 0), 3),
  ]);
  root.append(wrapTable(table(
    ['Tag', 'Family', 'Element', 'Node i', 'Node j', `Length [${u.length}]`,
     `Section [${u.length}]`, `A [${u.area}]`, `w [${u.lineLoad}]`],
    elRows, model.elements.length
  )));

  /* Nodes */
  root.append(heading('Nodes'));
  const ndRows = model.nodes.slice(0, MAX_ROWS).map((n) => [
    String(n.tag),
    fmt(n.x, 3), fmt(n.y, 3), fmt(n.z, 3),
    String(n.level),
    n.fix ? n.fix.join(' ') : '— free —',
    fmt(n.mass, 4),
  ]);
  root.append(wrapTable(table(
    ['Tag', `X [${u.length}]`, `Y [${u.length}]`, `Z [${u.length}]`, 'Level', 'Restraint', `Mass [${u.mass}]`],
    ndRows, model.nodes.length
  )));
}

/* ═══════════════════════════════ Inspector ══════════════════════════ */

export function renderInspector(panel, titleEl, bodyEl, element, s, handlers = {}) {
  if (!element) { panel.hidden = true; return; }
  const u = unitsOf(s.unitSystem);
  const sec = element.section;

  titleEl.textContent = `${element.kind === 'column' ? 'Column' : element.kind === 'beamX' ? 'Beam · X' : 'Beam · Y'} ${element.tag}`;
  bodyEl.textContent = '';

  const rows = [
    ['Element', element.kind === 'column' ? s.colElement : s.beamElement],
    ['Nodes', `${element.ni} → ${element.nj}`],
    [element.kind === 'column' ? 'Story' : 'Level', String(element.story)],
    ['Length', `${fmt(element.length, 3)} ${u.length}`],
    null,
    ['Section', sec.shape],
    ['Dimensions', sec.shape === 'Circular'
      ? `Ø ${fmt(sec.D)} ${u.length}`
      : `${fmt(sec.b)} × ${fmt(sec.h)} ${u.length}`],
    ['Area', `${fmt(sec.A)} ${u.area}`],
    ['Iz', `${fmt(sec.IzEff)} ${u.inertia}`],
    ['Iy', `${fmt(sec.IyEff)} ${u.inertia}`],
    ['J', `${fmt(sec.J)} ${u.inertia}`],
    null,
    ['Slab load', `${fmt(element.w, 3)} ${u.lineLoad}`],
    ['Self weight', `${fmt(element.wSelf || 0, 3)} ${u.lineLoad}`],
  ];

  const dl = document.createElement('dl');
  dl.className = 'kv';
  for (const row of rows) {
    if (!row) { dl.append(sep()); continue; }
    const dt = document.createElement('dt'); dt.textContent = row[0];
    const dd = document.createElement('dd'); dd.textContent = row[1];
    dl.append(dt, dd);
  }
  bodyEl.append(dl);
  bodyEl.append(memberEditor([element], s, handlers));
  panel.hidden = false;
}

/**
 * Editable section dimensions and slab load for the selected members. Values
 * shared by every selected member are pre-filled; where they differ the field
 * is left blank and only takes effect if the user types something.
 */
function memberEditor(elements, s, { onEdit, onResetEdit } = {}) {
  const box = document.createElement('div');
  box.className = 'move-box';
  if (!onEdit) return box;

  const editable = elements.filter((e) => e.section.shape !== 'Device');
  if (!editable.length) return box;

  const u = unitsOf(s.unitSystem);
  const shape = editable[0].section.shape;
  const uniformShape = editable.every((e) => e.section.shape === shape);

  const head = document.createElement('p');
  head.className = 'move-head';
  head.textContent = uniformShape ? `Edit ${shape.toLowerCase()} section` : 'Edit slab load';
  box.append(head);

  const inputs = {};
  const addField = (key, label, unit, current) => {
    const cell = document.createElement('label');
    cell.className = 'move-cell';
    const lab = document.createElement('span');
    lab.textContent = unit ? `${label} [${unit}]` : label;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'input';
    inp.step = 'any';
    inp.autocomplete = 'off';
    if (current !== null) inp.value = String(Number(current.toPrecision(10)));
    else inp.placeholder = 'mixed';
    // Remembered so Apply submits only what the user actually changed.
    inp.dataset.initial = inp.value;
    inputs[key] = inp;
    cell.append(lab, inp);
    return cell;
  };

  /** The common value across the selection, or null when they disagree. */
  const common = (read) => {
    const first = read(editable[0]);
    return editable.every((e) => Math.abs(read(e) - first) < 1e-12) ? first : null;
  };

  if (uniformShape) {
    const row = document.createElement('div');
    row.className = 'move-row';
    const keys = EDITABLE_DIMS[shape] || [];
    row.style.gridTemplateColumns = `repeat(${Math.min(keys.length, 2)}, 1fr)`;
    for (const key of keys) {
      row.append(addField(key, DIM_LABEL[key] || key, u.length, common((e) => e.section[key])));
    }
    box.append(row);
  }

  // Only beams carry a slab load, so columns are not offered the field.
  if (editable.some((e) => e.kind !== 'column')) {
    const loadRow = document.createElement('div');
    loadRow.className = 'move-row';
    loadRow.style.gridTemplateColumns = '1fr';
    loadRow.append(addField('w', 'Slab load w', u.lineLoad, common((e) => e.w)));
    box.append(loadRow);
  }

  const actions = document.createElement('div');
  actions.className = 'move-actions';

  const apply = document.createElement('button');
  apply.className = 'btn btn-primary btn-sm';
  apply.textContent = 'Apply to selection';
  apply.addEventListener('click', () => {
    const patch = {};
    for (const [key, inp] of Object.entries(inputs)) {
      const text = inp.value.trim();
      if (text === '' || text === inp.dataset.initial) continue;   // untouched
      const v = Number(text);
      if (Number.isFinite(v)) patch[key] = v;
    }
    if (Object.keys(patch).length) onEdit(editable.map((e) => e.tag), patch);
  });

  const reset = document.createElement('button');
  reset.className = 'btn btn-ghost btn-sm';
  reset.textContent = 'Use model values';
  reset.disabled = !editable.some((e) => (s.elementOverrides || {})[e.tag]);
  reset.addEventListener('click', () => onResetEdit(editable.map((e) => e.tag)));

  actions.append(apply, reset);
  box.append(actions);

  const hint = document.createElement('p');
  hint.className = 'move-hint';
  hint.textContent = 'Applied on Compile, and written into the generated script.';
  box.append(hint);

  return box;
}

const DIM_LABEL = { b: 'Width b', h: 'Depth h', D: 'Diameter D', bf: 'Flange bf', tf: 'Flange tf', tw: 'Web tw' };

/** Aggregate card shown when a selection window catches more than one member. */
export function renderSelectionSummary(panel, titleEl, bodyEl, elements, s, handlers = {}) {
  const u = unitsOf(s.unitSystem);
  const byKind = { column: 0, beamX: 0, beamY: 0, isolator: 0, damper: 0 };
  const stories = new Set();
  let length = 0;
  let load = 0;

  for (const e of elements) {
    byKind[e.kind]++;
    stories.add(e.story);
    length += e.length;
    load += (e.w + (e.wSelf || 0)) * e.length;
  }

  titleEl.textContent = `${elements.length} elements selected`;
  bodyEl.textContent = '';

  const rows = [
    ['Columns', String(byKind.column)],
    ['Beams — X', String(byKind.beamX)],
    ['Beams — Y', String(byKind.beamY)],
    ...(byKind.isolator ? [['Isolators', String(byKind.isolator)]] : []),
    ...(byKind.damper ? [['Dampers', String(byKind.damper)]] : []),
    null,
    ['Stories', [...stories].sort((a, b) => a - b).join(', ')],
    ['Total length', `${fmt(length, 2)} ${u.length}`],
    ['Total load', `${fmt(load, 2)} ${u.force}`],
  ];

  const dl = document.createElement('dl');
  dl.className = 'kv';
  for (const row of rows) {
    if (!row) { dl.append(sep()); continue; }
    const dt = document.createElement('dt'); dt.textContent = row[0];
    const dd = document.createElement('dd'); dd.textContent = row[1];
    dl.append(dt, dd);
  }
  bodyEl.append(dl);
  bodyEl.append(memberEditor(elements, s, handlers));
  panel.hidden = false;
}

function sep() {
  const d = document.createElement('div');
  d.className = 'kv-sep';
  d.style.gridColumn = '1 / -1';
  return d;
}

/**
 * Joint panel: what is selected, and the move controls. A move is a
 * displacement in global coordinates applied to the selected joints; every
 * element that touches one of them follows, because element ends are read
 * from the node coordinates.
 */
export function renderNodeSelection(panel, titleEl, bodyEl, nodes, s, { onMove, onReset }) {
  const u = unitsOf(s.unitSystem);
  titleEl.textContent = nodes.length === 1
    ? `Joint ${nodes[0].tag}`
    : `${nodes.length} joints selected`;
  bodyEl.textContent = '';

  const dl = document.createElement('dl');
  dl.className = 'kv';
  const put = (k, v) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  };

  if (nodes.length === 1) {
    const n = nodes[0];
    put('Position', `${fmt(n.x, 3)}, ${fmt(n.y, 3)}, ${fmt(n.z, 3)}`);
    put('Level', n.foundation ? 'Foundation' : String(n.level));
    put('Restraint', n.fix ? n.fix.join(' ') : '— free —');
    put('Mass', `${fmt(n.mass, 4)} ${u.mass}`);
  } else {
    const levels = [...new Set(nodes.map((n) => n.level))].sort((a, b) => a - b);
    put('Levels', levels.join(', '));
    put('Restrained', String(nodes.filter((n) => n.fix).length));
  }

  const offsets = s.nodeOffsets || {};
  const movedCount = nodes.filter((n) => offsets[n.tag]).length;
  if (movedCount) {
    dl.append(sep());
    if (nodes.length === 1) {
      const [dx, dy, dz] = offsets[nodes[0].tag];
      put('Moved by', `${fmt(dx, 3)}, ${fmt(dy, 3)}, ${fmt(dz, 3)}`);
    } else {
      put('Already moved', `${movedCount} of ${nodes.length}`);
    }
  }
  bodyEl.append(dl);

  /* Move controls */
  const box = document.createElement('div');
  box.className = 'move-box';

  const head = document.createElement('p');
  head.className = 'move-head';
  head.textContent = `Move by [${u.length}]`;
  box.append(head);

  const row = document.createElement('div');
  row.className = 'move-row';
  const inputs = {};
  for (const axis of ['dx', 'dy', 'dz']) {
    const cell = document.createElement('label');
    cell.className = 'move-cell';
    const lab = document.createElement('span');
    lab.textContent = axis.toUpperCase().replace('D', '');
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'input';
    inp.step = 'any';
    inp.value = '0';
    inp.autocomplete = 'off';
    inputs[axis] = inp;
    cell.append(lab, inp);
    row.append(cell);
  }
  box.append(row);

  const read = () => ['dx', 'dy', 'dz'].map((k) => {
    const v = Number(inputs[k].value);
    return Number.isFinite(v) ? v : 0;
  });

  const actions = document.createElement('div');
  actions.className = 'move-actions';

  const apply = document.createElement('button');
  apply.className = 'btn btn-primary btn-sm';
  apply.textContent = 'Apply move';
  apply.addEventListener('click', () => {
    const d = read();
    if (d.every((v) => v === 0)) return;
    onMove(nodes.map((n) => n.tag), d);
  });

  const reset = document.createElement('button');
  reset.className = 'btn btn-ghost btn-sm';
  reset.textContent = 'Back to grid';
  reset.disabled = !movedCount;
  reset.addEventListener('click', () => onReset(nodes.map((n) => n.tag)));

  actions.append(apply, reset);
  box.append(actions);

  const hint = document.createElement('p');
  hint.className = 'move-hint';
  hint.textContent = 'Applied in global axes. Attached members follow the joint.';
  box.append(hint);

  bodyEl.append(box);
  panel.hidden = false;

  // Ctrl+R lands here, so give the first field focus.
  return { focus: () => inputs.dx.focus() };
}

/* ═════════════════════════════════ helpers ══════════════════════════ */

function heading(text) {
  const h = document.createElement('h3');
  h.className = 'doc-h';
  h.textContent = text;
  return h;
}

function empty(root, text) {
  const p = document.createElement('p');
  p.className = 'doc-empty';
  p.textContent = text;
  root.append(p);
}

function table(headers, rows, total) {
  const t = document.createElement('table');
  t.className = 'tbl';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const h of headers) {
    const th = document.createElement('th');
    th.textContent = h;
    hr.append(th);
  }
  thead.append(hr);

  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    row.forEach((cell, i) => {
      const td = document.createElement('td');
      if (i === 0 || i === 1) td.className = 't-name';
      td.textContent = cell;
      tr.append(td);
    });
    tbody.append(tr);
  }

  t.append(thead, tbody);
  t.dataset.total = String(total);
  return t;
}

function wrapTable(t) {
  const wrap = document.createElement('div');
  wrap.className = 'tbl-wrap';
  wrap.append(t);

  const total = Number(t.dataset.total || 0);
  const shown = t.querySelectorAll('tbody tr').length;
  if (total > shown) {
    const note = document.createElement('div');
    note.className = 'tbl-note';
    note.textContent = `Showing the first ${shown} of ${total} rows — the full set is written by the generated script.`;
    const holder = document.createElement('div');
    holder.append(wrap, note);
    return holder;
  }
  return wrap;
}
