/**
 * main.js — application entry point.
 *
 * Wires the parameter form, the compile pipeline (build → view → report →
 * generate) and the viewport controls together.  Nothing else in the app
 * reaches across module boundaries.
 */

import {
  state, resetAll, moveNodes, clearNodeOffsets, setElementOverrides, clearElementOverrides,
  deleteElements, replicate, manualEdits, clearManualEdits,
  undo, redo, subscribeHistory, exportProject, importProject,
  storage, subscribeStorage, validateState, firstIssue,
} from './state.js';
import { renderForm } from './ui/form.js';
import {
  initTheme, initTabs, toast, setStatus, downloadText, slug,
  confirmDialog, promptDialog, infoDialog,
} from './ui/shell.js';
import { APP_VERSION } from './version.js';
import {
  renderSections, renderData, renderInspector, renderSelectionSummary, renderNodeSelection,
} from './ui/reports.js';
import { renderResults, toCsv } from './ui/results.js';
import { loadResults, ResultError } from './results/load.js';
import { buildModel } from './model/builder.js';
import { generateScript } from './codegen/openseespy.js';
import { toNotebook } from './codegen/notebook.js';
import { getRecord, subscribeGM, exportSeries, scriptFileName } from './model/groundmotion.js';
import { createViewer } from './viewer/viewer.js';
import { fmt, unitsOf } from './units.js';

const el = (id) => document.getElementById(id);

const dom = {
  formRoot: el('form-root'),
  formSummary: el('form-summary'),
  sceneCanvas: el('scene-canvas'),
  sceneLabels: el('scene-labels'),
  sceneEmpty: el('scene-empty'),
  storyPicker: el('story-picker'),
  framePicker: el('frame-picker'),
  selStory: el('sel-story'),
  selFrame: el('sel-frame'),
  band: el('rubber-band'),
  selectInfo: el('select-info'),
  viewMenu: el('view-menu'),
  inspector: el('inspector'),
  inspectorTitle: el('inspector-title'),
  inspectorBody: el('inspector-body'),
  codeOut: el('code-out'),
  codeMeta: el('code-meta'),
  sectionsRoot: el('sections-root'),
  dataRoot: el('data-root'),
  resultsRoot: el('results-root'),
};

let model = null;
let script = '';
let movePanel = null;   // handle to the joint move controls, when they are up

/* ─────────────────────────────── boot ───────────────────────────────── */

initTheme(el('btn-theme'), () => {
  viewer.refreshTheme();
  if (model) refreshPanels();
});

const tabs = initTabs(onTabChange);

const viewer = createViewer(dom.sceneCanvas, dom.sceneLabels, {
  band: dom.band,
  onSelect: showSelection,
});

renderForm(dom.formRoot, markStale);

el('btn-compile').addEventListener('click', compile);
el('btn-copy').addEventListener('click', copyScript);
el('btn-download').addEventListener('click', download);
el('btn-download-2').addEventListener('click', download);
el('btn-download-gm').addEventListener('click', downloadRecord);
el('btn-download-nb').addEventListener('click', downloadNotebook);

subscribeGM(() => { markStale(); updateRecordButton(); });
el('inspector-close').addEventListener('click', () => {
  dom.inspector.hidden = true;
  viewer.clearSelection();
});

/* Reset — asks first, and stays undoable afterwards. */
for (const id of ['btn-reset', 'mi-reset']) el(id).addEventListener('click', askReset);

async function askReset() {
  closeMenus();
  const ok = await confirmDialog({
    title: 'Start over?',
    message: 'This puts every input back to where it started and throws away the joints you '
      + 'moved, the members you resized, deleted or copied. Undo will bring it back if you '
      + 'change your mind — but if the model took a while, save it first.',
    confirmLabel: 'Start over',
  });
  if (!ok) return;
  resetAll();
  toast('Inputs reset', 'All parameters are back to their defaults — press Undo to bring them back.', 'info');
  compile();
}

/* ─────────────────────────── undo / redo ────────────────────────────── */

el('btn-undo').addEventListener('click', () => stepHistory(undo));
el('btn-redo').addEventListener('click', () => stepHistory(redo));

function stepHistory(step) {
  // A focused field is not repainted by the form (it would fight the caret),
  // so it has to let go before the state underneath it changes.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  if (!step()) return;
  compile();
}

subscribeHistory(({ undo: hasUndo, redo: hasRedo }) => {
  el('btn-undo').disabled = !hasUndo;
  el('btn-redo').disabled = !hasRedo;
});

/* ───────────────────────── project files ────────────────────────────── */

el('mi-export').addEventListener('click', () => {
  closeMenus();
  downloadText(`${slug(state.projectName)}.osms.json`, exportProject());
  toast('Project exported', 'Every input, joint move and member edit is in that file.', 'ok');
});

const importInput = el('import-file');
el('mi-import').addEventListener('click', () => { closeMenus(); importInput.click(); });

importInput.addEventListener('change', async () => {
  const file = importInput.files?.[0];
  importInput.value = '';
  if (!file) return;
  try {
    const { version } = importProject(await file.text());
    toast('Project opened', `${file.name} — written by version ${version}.`, 'ok');
    compile();
  } catch (err) {
    toast('Could not open that file', err.message, 'error', 7000);
  }
});

const loadInput = el('load-file');
el('mi-load').addEventListener('click', () => { closeMenus(); loadInput.click(); });

loadInput.addEventListener('change', async () => {
  const file = loadInput.files?.[0];
  loadInput.value = '';
  if (!file) return;
  try {
    const { version } = importProject(await file.text());
    compile();
    tabs.select('view3d');
    toast('Model loaded', `${file.name} — written by version ${version}. Its sections, `
      + 'materials and analysis settings are now in the panel on the left.', 'ok', 7000);
  } catch (err) {
    toast('Could not load that model', err.message, 'error', 10000);
  }
});

el('mi-download').addEventListener('click', () => { closeMenus(); download(); });
el('mi-notebook').addEventListener('click', () => { closeMenus(); downloadNotebook(); });

/* ─────────────────────────── analysis results ───────────────────────── */

let results = null;
const resultsInput = el('results-file');

resultsInput.addEventListener('change', () => {
  const files = [...resultsInput.files];
  resultsInput.value = '';
  if (files.length) ingestResults(files);
});

async function ingestResults(files) {
  try {
    results = await loadResults(files);
  } catch (err) {
    if (!(err instanceof ResultError)) console.error(err);
    toast('Could not read the results', err.message, 'error', 9000);
    return;
  }
  viewer.setResults(results);
  resetOverlay();
  paintResults();
  const n = Object.keys(results.series).length;
  toast('Results loaded', `${n} file${n > 1 ? 's' : ''} — the deformed shape and mode shapes `
    + 'are now available in the 3D view.', 'ok', 6000);
}

function paintResults() {
  renderResults(dom.resultsRoot, results, {
    onPick: () => resultsInput.click(),
    onFiles: ingestResults,
    onClear: () => {
      results = null;
      viewer.setResults(null);
      resetOverlay();
      paintResults();
      toast('Results cleared', 'The model itself is untouched.', 'info', 2500);
    },
    overlay,
    onOverlay: (patch) => { setOverlay(patch); tabs.select('view3d'); },
    onExport: (name) => {
      downloadText(`${slug(state.projectName)}-${name.replace(/\.out$/, '')}.csv`,
        toCsv(results, name));
      toast('CSV saved', `${name} with its columns named from the manifest.`, 'ok');
    },
  });
}

/* ── result overlays, driven from the Results panel ──────────────────── */

/**
 * What the 3D view is showing of the results. It is kept here rather than in
 * the panel so that clearing the results, or loading a new set, cannot leave
 * the scene drawing something that is no longer there.
 */
const overlay = { deform: 'none', modeNumber: 1, deformScale: 1, animate: false, diagram: null };

function setOverlay(patch) {
  Object.assign(overlay, patch);
  viewer.setOptions(patch);
}

function resetOverlay() {
  Object.assign(overlay, { deform: 'none', modeNumber: 1, deformScale: 1, animate: false, diagram: null });
  viewer.setOptions(overlay);
}

paintResults();

/* ─────────────────────── local storage health ───────────────────────── */

el('foot-version').textContent = `v${APP_VERSION}`;

subscribeStorage(paintStorage);
paintStorage(storage);

function paintStorage({ ok, reason }) {
  el('foot-storage').hidden = ok;
  if (ok) return;
  toast('Changes are not being saved', `${reason} Export the project to keep it.`, 'warn', 9000);
}

const collapseAll = el('btn-collapse-all');
collapseAll.textContent = 'Expand all';
collapseAll.addEventListener('click', () => {
  const groups = [...dom.formRoot.querySelectorAll('.group')];
  const collapse = groups.some((g) => !g.classList.contains('is-collapsed'));
  for (const g of groups) g.classList.toggle('is-collapsed', collapse);
  collapseAll.textContent = collapse ? 'Expand all' : 'Collapse all';
});

/* Display mode */
for (const btn of document.querySelectorAll('.seg-btn[data-display]')) {
  btn.addEventListener('click', () => {
    for (const b of document.querySelectorAll('.seg-btn[data-display]')) b.classList.toggle('is-active', b === btn);
    viewer.setOptions({ display: btn.dataset.display });
    saveViewOptions();
  });
}

/* Selection mode — members or joints */
for (const btn of document.querySelectorAll('.seg-btn[data-select]')) {
  btn.addEventListener('click', () => {
    for (const b of document.querySelectorAll('.seg-btn[data-select]')) b.classList.toggle('is-active', b === btn);
    viewer.clearSelection();
    viewer.setOptions({ selectMode: btn.dataset.select });
  });
}

/* View options — one menu holds every overlay toggle */
const TOGGLES = {
  'tg-nodes': 'nodeLabels',
  'tg-elements': 'elemLabels',
  'tg-local': 'localAxes',
  'tg-dims': 'dims',
  'tg-grid': 'grid',
  'tg-supports': 'supports',
  'tg-axes': 'axes',
  'tg-slabs': 'slabs',
};

const VIEW_KEY = 'osms.view.v1';

/**
 * What is on screen is a decision the user makes once. It is remembered across
 * builds and across sessions, so changing a bay width does not also turn the
 * labels back on.
 */
function loadViewOptions() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null'); }
  catch { saved = null; }
  if (!saved || typeof saved !== 'object') return;

  const patch = {};
  for (const [id, key] of Object.entries(TOGGLES)) {
    if (typeof saved[key] !== 'boolean') continue;
    patch[key] = saved[key];
    el(id).checked = saved[key];
  }
  if (saved.display === 'wireframe' || saved.display === 'extruded') {
    patch.display = saved.display;
    for (const b of document.querySelectorAll('.seg-btn[data-display]')) {
      b.classList.toggle('is-active', b.dataset.display === saved.display);
    }
  }
  viewer.setOptions(patch);
}

function saveViewOptions() {
  const saved = { display: activeDisplay() };
  for (const [id, key] of Object.entries(TOGGLES)) saved[key] = el(id).checked;
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(saved)); }
  catch { /* the storage warning already covers this */ }
}

const activeDisplay = () =>
  document.querySelector('.seg-btn[data-display].is-active')?.dataset.display || 'wireframe';

for (const [id, key] of Object.entries(TOGGLES)) {
  el(id).addEventListener('change', (ev) => {
    viewer.setOptions({ [key]: ev.target.checked });
    saveViewOptions();
  });
}

el('mi-fit').addEventListener('click', () => { closeMenus(); viewer.fit(); });

/* Popover menus — the view toggles and the topbar overflow behave the same. */
const MENUS = [
  { btn: el('btn-view-menu'), pop: dom.viewMenu },
  { btn: el('btn-more'), pop: el('more-menu') },
];

for (const menu of MENUS) {
  menu.btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const open = menu.pop.hidden;
    closeMenus();
    menu.pop.hidden = !open;
    menu.btn.setAttribute('aria-expanded', String(open));
  });
}

document.addEventListener('click', (ev) => {
  for (const menu of MENUS) {
    if (menu.pop.hidden || menu.pop.contains(ev.target)) continue;
    menu.pop.hidden = true;
    menu.btn.setAttribute('aria-expanded', 'false');
  }
});

function closeMenus() {
  for (const menu of MENUS) {
    menu.pop.hidden = true;
    menu.btn.setAttribute('aria-expanded', 'false');
  }
}

/* ───────────────────── sidebar drawer (narrow screens) ──────────────── */

const navToggle = el('btn-nav');
const scrim = el('scrim');

navToggle.addEventListener('click', () => setDrawer(!document.body.classList.contains('nav-open')));
el('btn-nav-close').addEventListener('click', () => setDrawer(false));
scrim.addEventListener('click', () => setDrawer(false));

function setDrawer(open) {
  document.body.classList.toggle('nav-open', open);
  scrim.hidden = !open;
  navToggle.setAttribute('aria-expanded', String(open));
}

// The drawer only exists below the breakpoint; widening the window must not
// leave the page stuck behind a scrim.
window.matchMedia('(min-width: 841px)').addEventListener('change', (ev) => {
  if (ev.matches) setDrawer(false);
});

window.addEventListener('keydown', (ev) => {
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.key === 'Enter') { ev.preventDefault(); compile(); }
  if (ev.key === 'Escape') { viewer.clearSelection(); closeMenus(); setDrawer(false); }

  // Undo and redo act on the model, not on the focused text field, so they are
  // taken before the browser's own text history sees them.
  const key = ev.key.toLowerCase();
  if (mod && key === 'z' && !ev.shiftKey) { ev.preventDefault(); stepHistory(undo); }
  else if (mod && ((key === 'z' && ev.shiftKey) || key === 'y')) { ev.preventDefault(); stepHistory(redo); }

  // Ctrl+R moves joints when joints are selected, and copies members when
  // members are. Both are "put this somewhere else", so they share the key.
  if (mod && key === 'r') {
    ev.preventDefault();
    if (movePanel) movePanel.focus();
    else askReplicate();
  }

  if (typing(ev.target)) return;

  if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deleteSelection(); }
  if (key === 'f') { ev.preventDefault(); viewer.fit(); }
  if (key === '?' || (ev.shiftKey && key === '/')) { ev.preventDefault(); showShortcuts(); }
});

/** True while the keystroke belongs to a field the user is filling in. */
function typing(target) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable
    || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/* ─────────────────── deleting and copying members ───────────────────── */

function deleteSelection() {
  const picked = viewer.getSelection();
  if (!picked.length) {
    return toast('Nothing selected', 'Pick the members to delete first.', 'info', 2500);
  }
  deleteElements(picked.map((e) => e.tag));
  compile();
  toast(`${picked.length} member${picked.length > 1 ? 's' : ''} deleted`,
    'The remaining tags are unchanged. Ctrl+Z brings them back.', 'ok');
}

/**
 * Copies the selected members to a new position. The offset is given in model
 * units along the global axes, so "one story up" is simply the story height.
 */
async function askReplicate() {
  const picked = viewer.getSelection();
  if (!picked.length) {
    return toast('Nothing selected', 'Pick the members to copy first.', 'info', 2500);
  }

  const u = unitsOf(state.unitSystem);
  const answer = await promptDialog({
    title: `Copy ${picked.length} member${picked.length > 1 ? 's' : ''}`,
    message: 'Each copy is placed this far from the one before it, along the global axes. '
      + 'A copy carries the member only — no slab load and no tributary mass.',
    fields: [
      { id: 'dx', label: `dX [${u.length}]`, value: '0' },
      { id: 'dy', label: `dY [${u.length}]`, value: '0' },
      { id: 'dz', label: `dZ [${u.length}]`, value: fmt(model.grid.heights[0] || 1, 4) },
      { id: 'count', label: 'Copies', value: '1' },
    ],
    confirmLabel: 'Copy',
  });
  if (!answer) return;

  const delta = ['dx', 'dy', 'dz'].map((k) => Number(answer[k]));
  const count = Math.round(Number(answer.count));
  if (delta.some((v) => !Number.isFinite(v)) || !Number.isFinite(count) || count < 1) {
    return toast('Those numbers cannot be used', 'Give a distance on each axis and a whole '
      + 'number of copies.', 'error', 6000);
  }
  if (delta.every((v) => v === 0)) {
    return toast('Nowhere to copy to', 'A copy on top of the original would be a duplicate '
      + 'member in the same place.', 'warn', 6000);
  }

  const made = replicate(picked, delta, count);
  compile();
  toast(`${made} member${made > 1 ? 's' : ''} copied`,
    'They are written into the script as free-standing members.', 'ok');
}

/* ───────────────────────── keyboard shortcuts ───────────────────────── */

const SHORTCUTS = [
  ['Ctrl + Enter', 'Build the model'],
  ['Ctrl + Z', 'Undo'],
  ['Ctrl + Shift + Z', 'Redo'],
  ['Ctrl + R', 'Move the selected joints, or copy the selected members'],
  ['Delete', 'Delete the selected members'],
  ['F', 'Fit the view to the model'],
  ['Esc', 'Clear the selection and close any menu'],
  ['?', 'This list'],
  ['Left drag', 'Select — left to right takes what is inside, right to left what it touches'],
  ['Ctrl / Shift + drag', 'Add to the selection'],
  ['Middle drag', 'Pan'],
  ['Right drag', 'Orbit'],
  ['Wheel', 'Zoom'],
];

el('mi-shortcuts').addEventListener('click', () => { closeMenus(); showShortcuts(); });

function showShortcuts() {
  const list = document.createElement('dl');
  list.className = 'shortcut-list';
  for (const [keys, what] of SHORTCUTS) {
    const dt = document.createElement('dt');
    for (const part of keys.split(' + ')) {
      const kbd = document.createElement('kbd');
      kbd.textContent = part;
      dt.append(kbd);
    }
    const dd = document.createElement('dd');
    dd.textContent = what;
    list.append(dt, dd);
  }
  infoDialog({ title: 'Keyboard and mouse', body: list });
}

/* ───────────────────────────── pipeline ─────────────────────────────── */

/** The fields that decide where every joint of the grid lands. */
const gridSignature = (s) =>
  [s.baysX, s.baysY, s.numStories, s.spanX, s.spanY, s.storyHeight, s.unitSystem].join('|');

let builtGrid = null;

/**
 * Work done by hand — moved joints, resized, deleted or copied members — is
 * pinned to tags and coordinates that a new grid may not have. Rather than
 * quietly dragging it onto a building it was not drawn for, the grid change is
 * the moment to ask.
 */
async function confirmGridChange() {
  const signature = gridSignature(state);
  if (builtGrid === null || signature === builtGrid) return true;

  const counts = manualEdits();
  const total = counts.moves + counts.edits + counts.deleted + counts.added;
  if (!total) return true;

  const parts = [];
  if (counts.moves) parts.push(`${counts.moves} moved joint${counts.moves > 1 ? 's' : ''}`);
  if (counts.edits) parts.push(`${counts.edits} resized member${counts.edits > 1 ? 's' : ''}`);
  if (counts.deleted) parts.push(`${counts.deleted} deleted member${counts.deleted > 1 ? 's' : ''}`);
  if (counts.added) parts.push(`${counts.added} copied member${counts.added > 1 ? 's' : ''}`);

  const keep = await confirmDialog({
    title: 'The grid has changed',
    message: `You have ${parts.join(', ')} on the old grid. They were placed against bays and `
      + 'stories that are about to move, so keeping them would put them somewhere you did not '
      + 'choose. Clear them and rebuild from the parameters alone?',
    confirmLabel: 'Clear them',
  });

  if (keep) {
    clearManualEdits();
    toast('Hand edits cleared', 'The model is back to the parameters on the left — Ctrl+Z '
      + 'brings the edits back.', 'info', 6000);
  }
  return true;
}

async function compile() {
  await confirmGridChange();

  // Invalid input never reaches the builder: the sidebar already marks each
  // offending field, and nothing is substituted on the user's behalf.
  const check = validateState(state);
  if (!check.ok) {
    const n = Object.keys(check.errors).length;
    setStatus(`${n} input error${n > 1 ? 's' : ''}`, 'error');
    toast('Cannot build the model', `${firstIssue(check.errors)}${n > 1 ? ` (+${n - 1} more)` : ''}`,
      'error', 7000);
    return;
  }

  setStatus('Building…', 'busy');

  let next;
  try {
    next = buildModel(state);
  } catch (err) {
    console.error(err);
    setStatus('Build failed', 'error');
    toast('Build failed', err.message, 'error', 7000);
    return;
  }

  if (!next.ok) {
    setStatus('Invalid input', 'error');
    toast('Cannot build the model', next.errors[0], 'error', 7000);
    return;
  }

  model = next;
  builtGrid = gridSignature(state);
  dom.sceneEmpty.classList.add('is-hidden');

  viewer.setModel(model);
  showSelection({
    mode: viewer.getNodeSelection().length ? 'node' : 'element',
    elements: viewer.getSelection(),
    nodes: viewer.getNodeSelection(),
  });

  populatePickers();
  refreshPanels();

  const s = model.stats;
  paintLegend(s);
  dom.formSummary.textContent =
    `${model.grid.nz} stories · ${model.grid.nx}×${model.grid.ny} bays · ${s.dof} DOF`;

  reportBuild(model.warnings);
}

/**
 * The build status carries the warnings rather than hiding them in a toast that
 * has already faded by the time the model is being read. Green means nothing
 * was flagged; amber means something is worth reading; red means the analysis
 * is known in advance not to run. Either of the last two opens the list.
 */
function reportBuild(warnings) {
  const s = model.stats;
  const blocking = warnings.filter((w) => w.level === 'critical');
  const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

  if (!warnings.length) {
    setStatus(`Model built · ${s.nodes} nodes · ${s.elements} elements`, 'ok');
    return;
  }

  if (blocking.length) {
    setStatus(`Model built · ${plural(blocking.length, 'blocking issue')}`, 'error', showWarnings);
    toast(plural(blocking.length, 'blocking issue'), blocking[0].text, 'error', 9000);
    return;
  }

  setStatus(`Model built with ${plural(warnings.length, 'warning')}`, 'warn', showWarnings);
  toast(plural(warnings.length, 'warning'), warnings[0].text, 'warn', 6500);
}

/** A legend entry for every kind of member the model actually contains. */
function paintLegend(stats) {
  const present = {
    'legend-col': stats.columns,
    'legend-beam': stats.beamsX + stats.beamsY,
    'legend-iso': stats.isolators,
    'legend-damp': stats.dampers,
    'legend-slab': stats.slabs,
  };
  let any = false;
  for (const [id, count] of Object.entries(present)) {
    el(id).hidden = !count;
    if (count) any = true;
  }
  el('scene-legend').hidden = !any;
}

/** Opens Model Data at the warnings block. */
function showWarnings() {
  tabs.select('data');
  const target = document.getElementById('data-warnings');
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Regenerates every panel that depends on the current model or theme. */
function refreshPanels() {
  script = generateScript(state, model, getRecord());
  updateRecordButton();
  dom.codeOut.innerHTML = highlightPython(script);
  dom.codeMeta.textContent =
    `${script.split('\n').length} lines · ${(new Blob([script]).size / 1024).toFixed(1)} kB · `
    + `${state.sectionKind} sections · ${state.unitSystem}`;

  renderSections(dom.sectionsRoot, state, model);
  renderData(dom.dataRoot, state, model);
}

function markStale() {
  if (model) setStatus('Build model', 'stale');
}

/** Mirrors the viewer's selection into the toolbar counter and the inspector. */
function showSelection({ mode, elements, nodes }) {
  const picked = mode === 'node' ? nodes : elements;
  const noun = mode === 'node' ? 'joint' : 'element';
  const n = picked.length;

  dom.selectInfo.textContent = n === 0
    ? 'No selection'
    : `${n} ${noun}${n > 1 ? 's' : ''} selected`;
  dom.selectInfo.classList.toggle('has-selection', n > 0);

  if (n === 0) { dom.inspector.hidden = true; movePanel = null; return; }

  if (mode === 'node') {
    movePanel = renderNodeSelection(dom.inspector, dom.inspectorTitle, dom.inspectorBody, nodes, state, {
      onMove: applyMove,
      onReset: (tags) => { clearNodeOffsets(tags); recompileKeepingJoints(tags); },
    });
    return;
  }

  movePanel = null;
  const handlers = { onEdit: applyMemberEdit, onResetEdit: resetMemberEdit };
  if (n === 1) renderInspector(dom.inspector, dom.inspectorTitle, dom.inspectorBody, elements[0], state, handlers);
  else renderSelectionSummary(dom.inspector, dom.inspectorTitle, dom.inspectorBody, elements, state, handlers);
}

/** Applies edited dimensions or slab load, then rebuilds keeping the selection. */
function applyMemberEdit(tags, patch) {
  setElementOverrides(tags, patch);
  recompileKeepingMembers(tags);
  const what = Object.keys(patch).map((k) => (k === 'w' ? 'slab load' : k)).join(', ');
  toast('Members updated',
    `${tags.length} member${tags.length > 1 ? 's' : ''} — ${what}. The script now carries the change.`,
    'ok');
}

function resetMemberEdit(tags) {
  clearElementOverrides(tags);
  recompileKeepingMembers(tags);
}

async function recompileKeepingMembers(tags) {
  await compile();
  viewer.setSelection(tags);
  showSelection({ mode: 'element', elements: viewer.getSelection(), nodes: [] });
}

/** Moves the selected joints, then rebuilds with them still selected. */
function applyMove(tags, delta) {
  moveNodes(tags, delta);
  recompileKeepingJoints(tags);
  toast('Joints moved',
    `${tags.length} joint${tags.length > 1 ? 's' : ''} by (${delta.join(', ')}) — attached members followed.`,
    'ok');
}

async function recompileKeepingJoints(tags) {
  await compile();
  viewer.setNodeSelection(tags);
  showSelection({ mode: 'node', elements: [], nodes: viewer.getNodeSelection() });
}

/* ──────────────────────────── view controls ─────────────────────────── */

function onTabChange() { /* the scene keeps whatever view the pickers set */ }

/**
 * Story, elevation and 3D are three ways of looking at one model, so exactly one
 * of them is active. The pickers keep their choice while another view is on, so
 * stepping from a plan to 3D and back does not lose the floor you were reading.
 */
let sceneView = 'view3d';

function setSceneView(next, focus = true) {
  const changed = next !== sceneView;
  sceneView = next;

  if (next === 'plan') {
    viewer.setOptions({ view: 'plan', story: Number(dom.selStory.value) });
  } else if (next === 'elevation') {
    const [axis, index] = dom.selFrame.value.split(':');
    viewer.setOptions({ view: 'elevation', frame: { axis, index: Number(index) } });
  } else {
    viewer.setOptions({ view: 'view3d' });
  }

  // Asking for a different view means asking to see it: the camera is framed on
  // the model rather than left wherever the last one happened to be pointing.
  // A rebuild keeps the camera; only a deliberate change re-frames it.
  if (focus && (changed || next !== 'view3d')) viewer.fit();

  // Rebuilding must not drag the user away from the tab they were reading.
  if (focus) tabs.select('view3d');
}

function paintSceneView() {
  el('btn-view-3d').classList.toggle('is-active', sceneView === 'view3d');
  dom.storyPicker.classList.toggle('is-active-view', sceneView === 'plan');
  dom.framePicker.classList.toggle('is-active-view', sceneView === 'elevation');
}

el('btn-view-3d').addEventListener('click', () => setSceneView('view3d'));
dom.selStory.addEventListener('change', () => setSceneView('plan'));
dom.selFrame.addEventListener('change', () => setSceneView('elevation'));

/**
 * Refills the story and elevation pickers after a rebuild, keeping whatever the
 * user was looking at. A model with one more story is still the same building;
 * throwing the view back to the roof every time would make it tiresome to work
 * on one floor.
 */
function populatePickers() {
  const { nx, ny, nz, xs, ys } = model.grid;
  const wantedStory = dom.selStory.value;
  const wantedFrame = dom.selFrame.value;

  dom.selStory.textContent = '';
  for (let level = nz; level >= 1; level--) {
    dom.selStory.append(option(String(level),
      level === nz ? `Roof — level ${level}` : `Level ${level}`));
  }

  dom.selFrame.textContent = '';
  for (let j = 0; j <= ny; j++) {
    dom.selFrame.append(option(`x:${j}`, `X–Z frame at Y = ${fmt(ys[j], 2)}`));
  }
  for (let i = 0; i <= nx; i++) {
    dom.selFrame.append(option(`y:${i}`, `Y–Z frame at X = ${fmt(xs[i], 2)}`));
  }

  // A choice that no longer exists — the story it named has been removed —
  // drops back to 3D rather than silently showing a different floor.
  if (has(dom.selStory, wantedStory)) dom.selStory.value = wantedStory;
  else if (sceneView === 'plan') sceneView = 'view3d';

  if (has(dom.selFrame, wantedFrame)) dom.selFrame.value = wantedFrame;
  else if (sceneView === 'elevation') sceneView = 'view3d';

  setSceneView(sceneView, false);
}

const option = (value, label) => {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
};

const has = (select, value) => [...select.options].some((o) => o.value === value);

/* ──────────────────────────── script output ─────────────────────────── */

function download() {
  if (!script) return toast('Nothing to download', 'Build the model first.', 'warn');
  downloadText(`${slug(state.projectName)}.py`, script);
  const rec = getRecord();
  toast('Script saved',
    rec && state.runTimeHistory
      ? `Put ${scriptFileName(rec)} in the same folder, then run: python <file>.py`
      : 'Run it with: python <file>.py',
    'ok');
}

/** The same script as a notebook: one code cell per section, headings above. */
function downloadNotebook() {
  if (!script) return toast('Nothing to download', 'Build the model first.', 'warn');
  downloadText(`${slug(state.projectName)}.ipynb`,
    toNotebook(script, { title: state.projectName || 'Frame Model' }));
  toast('Notebook saved', 'Run the cells in order; the last one wipes the model.', 'ok');
}

/** The cleaned one-column record the generated timeSeries('Path', …) reads. */
function downloadRecord() {
  const rec = getRecord();
  if (!rec) return;
  downloadText(scriptFileName(rec), exportSeries(rec));
  toast('Record saved', `${rec.npts} values, one per line.`, 'ok');
}

function updateRecordButton() {
  el('btn-download-gm').hidden = !getRecord();
}

async function copyScript() {
  if (!script) return;
  try {
    await navigator.clipboard.writeText(script);
    toast('Copied', 'The full script is on your clipboard.', 'ok', 2500);
  } catch {
    toast('Copy blocked', 'Your browser refused clipboard access — use Download instead.', 'warn');
  }
}

/**
 * Minimal Python highlighter. One pass over an alternation keeps comments and
 * strings from being re-tokenised by the later rules.
 */
function highlightPython(code) {
  const escaped = code.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const KEYWORDS = 'def|class|for|while|in|if|elif|else|return|import|as|with|raise|try|except'
                 + '|from|lambda|not|and|or|is|None|True|False|pass|break|continue';
  const BUILTINS = 'range|len|print|open|enumerate|max|min|sum|abs|float|int|str|list|dict';

  const pattern = new RegExp(
    '("""[\\s\\S]*?""")'                       // docstrings
    + "|(#[^\\n]*)"                            // comments
    + "|(f?'(?:[^'\\\\\\n]|\\\\.)*'|f?\"(?:[^\"\\\\\\n]|\\\\.)*\")"   // strings
    + `|\\b(${KEYWORDS})\\b`
    + `|\\b(${BUILTINS})\\b`
    + '|\\b(\\d+\\.?\\d*(?:[eE][+-]?\\d+)?)\\b',
    'g'
  );

  return escaped.replace(pattern, (m, doc, comment, str, kw, fn, num) => {
    if (doc || comment) return `<span class="c-cmt">${m}</span>`;
    if (str) return `<span class="c-str">${m}</span>`;
    if (kw) return `<span class="c-kw">${m}</span>`;
    if (fn) return `<span class="c-fn">${m}</span>`;
    if (num) return `<span class="c-num">${m}</span>`;
    return m;
  });
}

/* ─────────────────────────── first build ────────────────────────────── */

loadViewOptions();
compile();
