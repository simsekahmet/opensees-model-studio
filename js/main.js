/**
 * main.js — application entry point.
 *
 * Wires the parameter form, the compile pipeline (build → view → report →
 * generate) and the viewport controls together.  Nothing else in the app
 * reaches across module boundaries.
 */

import {
  state, resetAll, moveNodes, clearNodeOffsets, setElementOverrides, clearElementOverrides,
  undo, redo, subscribeHistory, exportProject, importProject,
  storage, subscribeStorage, validateState, firstIssue,
} from './state.js';
import { renderForm } from './ui/form.js';
import {
  initTheme, initTabs, toast, setStatus, downloadText, slug, confirmDialog,
} from './ui/shell.js';
import { APP_VERSION } from './version.js';
import {
  renderSections, renderData, renderInspector, renderSelectionSummary, renderNodeSelection,
} from './ui/reports.js';
import { buildModel } from './model/builder.js';
import { generateScript } from './codegen/openseespy.js';
import { toNotebook } from './codegen/notebook.js';
import { getRecord, subscribeGM, exportSeries, scriptFileName } from './model/groundmotion.js';
import { createViewer } from './viewer/viewer.js';
import { fmt } from './units.js';

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
};

let model = null;
let script = '';
let movePanel = null;   // handle to the joint move controls, when they are up

/* ─────────────────────────────── boot ───────────────────────────────── */

initTheme(el('btn-theme'), () => {
  viewer.refreshTheme();
  if (model) refreshPanels();
});

initTabs(onTabChange);

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
    title: 'Reset every input?',
    message: 'All parameters go back to their defaults, and joint moves and member edits '
      + 'are discarded. You can undo this afterwards, but exporting the project first is safer.',
    confirmLabel: 'Reset',
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

el('mi-download').addEventListener('click', () => { closeMenus(); download(); });
el('mi-notebook').addEventListener('click', () => { closeMenus(); downloadNotebook(); });

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
};
for (const [id, key] of Object.entries(TOGGLES)) {
  el(id).addEventListener('change', (ev) => viewer.setOptions({ [key]: ev.target.checked }));
}

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

dom.selStory.addEventListener('change', () => viewer.setOptions({ story: Number(dom.selStory.value) }));
dom.selFrame.addEventListener('change', () => {
  const [axis, index] = dom.selFrame.value.split(':');
  viewer.setOptions({ frame: { axis, index: Number(index) } });
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

  // Ctrl+R jumps straight to the move fields when joints are selected.
  if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'r' || ev.key === 'R') && movePanel) {
    ev.preventDefault();
    movePanel.focus();
  }
});

compile();

/* ───────────────────────────── pipeline ─────────────────────────────── */

function compile() {
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
  dom.sceneEmpty.classList.add('is-hidden');

  viewer.setModel(model);
  showSelection({ mode: 'element', elements: [], nodes: [] });

  populatePickers();
  refreshPanels();

  const s = model.stats;
  el('legend-iso').hidden = !s.isolators;
  el('legend-damp').hidden = !s.dampers;
  setStatus(`Model built · ${s.nodes} nodes · ${s.elements} elements`, 'ok');
  dom.formSummary.textContent =
    `${model.grid.nz} stories · ${model.grid.nx}×${model.grid.ny} bays · ${s.dof} DOF`;

  if (model.warnings.length) {
    toast(`${model.warnings.length} warning${model.warnings.length > 1 ? 's' : ''}`,
      model.warnings[0], 'warn', 6500);
  }
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
  if (model) setStatus('Modified — press Build model', 'stale');
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

function recompileKeepingMembers(tags) {
  compile();
  viewer.setSelection(tags);
}

/** Moves the selected joints, then rebuilds with them still selected. */
function applyMove(tags, delta) {
  moveNodes(tags, delta);
  recompileKeepingJoints(tags);
  toast('Joints moved',
    `${tags.length} joint${tags.length > 1 ? 's' : ''} by (${delta.join(', ')}) — attached members followed.`,
    'ok');
}

function recompileKeepingJoints(tags) {
  compile();
  viewer.setNodeSelection(tags);
}

/* ──────────────────────────── view controls ─────────────────────────── */

function onTabChange(id) {
  const sceneTab = ['view3d', 'plan', 'elevation'].includes(id);
  if (!sceneTab) return;
  dom.storyPicker.hidden = id !== 'plan';
  dom.framePicker.hidden = id !== 'elevation';
  viewer.setOptions({ view: id });
}

function populatePickers() {
  const { nx, ny, nz, xs, ys } = model.grid;

  const story = Number(dom.selStory.value) || nz;
  dom.selStory.textContent = '';
  for (let level = nz; level >= 1; level--) {
    const o = document.createElement('option');
    o.value = String(level);
    o.textContent = level === nz ? `Roof — level ${level}` : `Level ${level}`;
    dom.selStory.append(o);
  }
  dom.selStory.value = String(Math.min(story, nz));

  dom.selFrame.textContent = '';
  for (let j = 0; j <= ny; j++) {
    const o = document.createElement('option');
    o.value = `x:${j}`;
    o.textContent = `X–Z frame at Y = ${fmt(ys[j], 2)}`;
    dom.selFrame.append(o);
  }
  for (let i = 0; i <= nx; i++) {
    const o = document.createElement('option');
    o.value = `y:${i}`;
    o.textContent = `Y–Z frame at X = ${fmt(xs[i], 2)}`;
    dom.selFrame.append(o);
  }
  dom.selFrame.value = 'x:0';

  viewer.setOptions({ story: Number(dom.selStory.value), frame: { axis: 'x', index: 0 } });
}

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
