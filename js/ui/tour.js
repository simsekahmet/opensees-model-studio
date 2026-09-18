/**
 * ui/tour.js — the guided tour.
 *
 * A first-time visitor sees a form with ten collapsed sections and an empty
 * viewport, and nothing on screen says that moving a joint rewrites the script,
 * or that an insertion point is a rigid offset rather than a drawing. So the
 * tour does not describe the app: it drives it. Each step performs the thing it
 * is explaining — builds the model, picks a joint, moves it, copies a member,
 * sets an insertion point — and then points at the line of Python that changed
 * because of it.
 *
 * The visitor's own model is not collateral. Everything is snapshotted before
 * the first step and put back on the way out, however the tour ends.
 */

const SPOT_PAD = 8;          // breathing room around a highlighted element
const TIP_GAP = 14;          // between the spotlight and the tooltip

/** Everything the tour needs from the app it is driving. */
let app = null;
let live = null;             // the running tour, or null

/**
 * @param {object} deps
 *  - `state`, `setValue`, `snapshot()`, `restore(snap)` — the parameter store
 *  - `compile()` — build the model
 *  - `viewer`, `tabs`, `setSceneView`
 */
export function initTour(deps) {
  app = deps;
}

export async function startTour() {
  if (live || !app) return;

  // Whatever the visitor had is put back when the tour ends, so nothing here
  // costs them the model they were working on.
  const snap = app.snapshot();
  app.begin?.(snap);
  const overlay = buildOverlay();
  live = { overlay, snap, index: 0, done: false };

  try {
    await run(overlay);
  } finally {
    await finish();
  }
}

/* ────────────────────────────── the steps ───────────────────────────── */

/**
 * Each step is `{ title, body, target, before }`.
 *
 * `target` is a CSS selector or a function returning an element — what the
 * spotlight opens onto. `before` runs before the step is shown and is where the
 * tour actually operates the app.
 */
function steps() {
  const { viewer, tabs } = app;

  return [
    {
      title: 'What this is',
      body: 'OpenSees Model Studio builds an OpenSeesPy model from a form and writes the script '
        + 'that runs it. Nothing is solved here — the browser cannot run OpenSees — so what you '
        + 'take away is a Python file you run yourself. This tour builds a small model and '
        + 'changes it, so you can see how each move reaches the script.',
      target: null,
      async before() {
        tabs.select('view3d');
        app.setValue('baysX', 2);
        app.setValue('baysY', 1);
        app.setValue('numStories', 2);
        app.setValue('spanX', '6.0');
        app.setValue('spanY', '5.0');
        app.setValue('storyHeight', '3.2');
        await app.compile();
      },
    },
    {
      title: 'Model definition',
      body: 'Every parameter lives here, in ten sections. Geometry sets the grid; Materials and '
        + 'Sections decide what the members are made of and how they are formulated; Loads & Mass '
        + 'and Analysis decide what is done to them. Sections open one at a time so the sidebar '
        + 'stays a short index rather than a wall.',
      target: '#form-root',
      before: () => collapseAll(),
    },
    {
      title: 'Geometry',
      body: 'Bays, spans and story heights. A span list can be one number for every bay, or one '
        + 'per bay — "6, 5, 6" is three bays of different widths. Nothing is substituted behind '
        + 'your back: a list that does not match the bay count is an error, not a guess.',
      target: '[data-group="geometry"]',
      before: () => openGroup('geometry'),
    },
    {
      title: 'Build model',
      body: 'This is the one button the page exists for. It validates every field, builds the '
        + 'model, draws it, and regenerates the script. Press it after any change — the status '
        + 'beside it says when the model is behind the form.',
      target: '#btn-compile',
      async before() {
        collapseAll();
        await app.compile();
      },
    },
    {
      title: 'The model',
      body: 'Left-drag selects, middle-drag pans, right-drag orbits — the ETABS mapping. The view '
        + 'also takes keyboard focus: arrow keys orbit, + and − zoom, Escape clears the '
        + 'selection. Frame draws members as lines, Extruded as solids.',
      target: '#scene-canvas',
      before: () => tabs.select('view3d'),
    },
    {
      title: 'Selecting joints',
      body: 'Switch the selection mode to Nodes and the joints become the thing you pick. Click '
        + 'one, or drag a box over several. A selected joint carries its tag even with labels '
        + 'switched off, so you always know which one you have.',
      target: '.seg-btn[data-select="node"]',
      before() {
        segClick('[data-select="node"]');
        const tag = topJoint();
        if (tag) viewer.setNodeSelection([tag]);
      },
    },
    {
      title: 'Moving a joint',
      body: 'The panel takes a distance in the model\'s own length unit and moves the joint by it. '
        + 'Every member touching the joint follows, because member ends are read from the joint '
        + 'coordinates — the geometry is not drawn twice. Back to grid undoes it, and so does '
        + 'Ctrl+Z.',
      target: '#inspector',
      async before() {
        const tag = topJoint();
        if (!tag) return;
        viewer.setNodeSelection([tag]);
        app.moveNodes([tag], [1.5, 0, 0]);
        await app.compile();
        viewer.setNodeSelection([tag]);
        viewer.revealNodes([tag]);
      },
    },
    {
      title: 'and in the script',
      body: 'The move is not a drawing. It appears in the script as NODE_MOVES, applied where the '
        + 'nodes are created, so the model OpenSees builds is the model you see. Slab loads and '
        + 'tributary masses are worked out from where the joints actually sit, not from the '
        + 'nominal bay spacing.',
      target: '#code-out',
      before: () => { tabs.select('code'); markCode('NODE_MOVES'); },
    },
    {
      title: 'Copying members',
      body: 'Select members, press Ctrl+R, and give a distance and a count: the selection is '
        + 'repeated along any of the three axes. Copies are members only — they carry no slab '
        + 'load and no tributary mass, and the model data panel says so.',
      target: '.seg-btn[data-select="element"]',
      async before() {
        tabs.select('view3d');
        segClick('[data-select="element"]');
        const tag = firstColumn();
        if (tag) viewer.setSelection([tag]);
      },
    },
    {
      title: 'Editing a member',
      body: 'With a member selected, the panel gives its section, its length, its end forces once '
        + 'results are loaded — and the dimensions, which can be edited here for that member '
        + 'alone. The edit overrides the section for that one member and leaves every other one '
        + 'on the parametric value.',
      target: '#inspector',
      async before() {
        const tag = firstColumn();
        if (!tag) return;
        app.setElementOverrides([tag], { b: 0.5, h: 0.7 });
        await app.compile();
        viewer.setSelection([tag]);
      },
    },
    {
      title: 'Insertion point',
      body: 'An insertion point says which point of the section the joint line passes through — a '
        + 'column flush with a façade, a beam hung under the slab line. The joints do not move: '
        + 'the member is carried off the line by a rigid offset, so the eccentricity it creates '
        + 'is real and carries moment.',
      target: '#inspector',
      async before() {
        const tag = firstColumn();
        if (!tag) return;
        app.setElementOverrides([tag], { insertion: 'middleRight' });
        await app.compile();
        viewer.setSelection([tag]);
        segClick('[data-display="extruded"]');
      },
    },
    {
      title: 'Frame against Extruded',
      body: 'In Frame the joint line runs unbroken from base to roof, because that is where the '
        + 'joints are. In Extruded the section leans onto its face. Two views of one model: the '
        + 'analytical line and the steel or concrete that hangs off it.',
      target: '.seg-btn[data-display="extruded"]',
      before: () => tabs.select('view3d'),
    },
    {
      title: 'and in the script again',
      body: 'The insertion point is written as a rigid end offset on the transformation — '
        + "geomTransf(..., '-jntOffset', ...). The element still connects the same two joints; "
        + 'only the transformation carries the section away from them.',
      target: '#code-out',
      before: () => { tabs.select('code'); markCode('-jntOffset'); },
    },
    {
      title: 'Running it',
      body: 'Download the Python file and run it where openseespy is installed — it is tested on '
        + 'Python 3.12. It writes its results next to itself, and the Results tab reads that '
        + 'folder, or a .zip of it, back into charts, story drifts and a deformed shape on this '
        + 'same model.',
      target: '.code-actions',
      before: () => tabs.select('code'),
    },
    {
      title: 'One last thing',
      body: 'This is an interface tool. It builds the model and writes the script; it does not '
        + 'verify either. The OpenSees model must be checked and approved by the responsible '
        + 'engineer. Your own model is being restored now — the tour changed nothing.',
      target: '.foot-warning',
      before: () => app.tabs.select('view3d'),
    },
  ];
}

/* ───────────────────────────── the machinery ─────────────────────────── */

async function run(overlay) {
  const list = steps();

  for (let i = 0; i < list.length; i++) {
    live.index = i;
    const step = list[i];

    try {
      await step.before?.();
    } catch (err) {
      console.error('tour step failed', step.title, err);
    }

    const answer = await show(overlay, step, i, list.length);
    if (answer === 'quit') return;
    if (answer === 'back') i = Math.max(-1, i - 2);
  }
}

/** Paints one step and resolves with 'next', 'back' or 'quit'. */
function show(overlay, step, index, total) {
  return new Promise((resolve) => {
    const target = resolve_target(step.target);
    place(overlay, target);

    overlay.title.textContent = step.title;
    overlay.body.textContent = step.body;
    overlay.count.textContent = `${index + 1} / ${total}`;
    overlay.back.disabled = index === 0;
    overlay.next.textContent = index === total - 1 ? 'Finish' : 'Next';
    overlay.tip.setAttribute('aria-label', `Tour step ${index + 1} of ${total}: ${step.title}`);

    const done = (answer) => {
      overlay.next.onclick = null;
      overlay.back.onclick = null;
      overlay.quit.onclick = null;
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
      resolve(answer);
    };

    overlay.next.onclick = () => done('next');
    overlay.back.onclick = () => done('back');
    overlay.quit.onclick = () => done('quit');

    const onKey = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); done('quit'); }
      else if (ev.key === 'ArrowRight' || ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); done('next'); }
      else if (ev.key === 'ArrowLeft' && index > 0) { ev.preventDefault(); ev.stopPropagation(); done('back'); }
      else if (ev.key === 'Tab') trap(ev, overlay.tip);
    };
    // Captured, because the app itself listens for arrow keys and Escape.
    document.addEventListener('keydown', onKey, true);

    const onResize = () => place(overlay, resolve_target(step.target));
    window.addEventListener('resize', onResize);

    overlay.next.focus();
  });
}

function resolve_target(target) {
  if (!target) return null;
  const el = typeof target === 'function' ? target() : document.querySelector(target);
  return el && el.isConnected ? el : null;
}

/**
 * Opens the spotlight onto one element and puts the tooltip beside it.
 *
 * The dimming is a single huge box-shadow around the lit rectangle rather than
 * four panels, which keeps it one element to move and leaves no seams.
 */
function place(overlay, target) {
  const view = { w: window.innerWidth, h: window.innerHeight };

  if (!target) {
    overlay.spot.style.opacity = '0';
    overlay.tip.style.left = `${Math.round(view.w / 2 - overlay.tip.offsetWidth / 2)}px`;
    overlay.tip.style.top = `${Math.round(view.h / 2 - overlay.tip.offsetHeight / 2)}px`;
    return;
  }

  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const box = target.getBoundingClientRect();
  const x = Math.max(0, box.left - SPOT_PAD);
  const y = Math.max(0, box.top - SPOT_PAD);
  const w = Math.min(view.w - x, box.width + SPOT_PAD * 2);
  const h = Math.min(view.h - y, box.height + SPOT_PAD * 2);

  overlay.spot.style.opacity = '1';
  overlay.spot.style.left = `${Math.round(x)}px`;
  overlay.spot.style.top = `${Math.round(y)}px`;
  overlay.spot.style.width = `${Math.round(w)}px`;
  overlay.spot.style.height = `${Math.round(h)}px`;

  // The tooltip goes wherever there is room: below, above, or beside.
  const tw = overlay.tip.offsetWidth;
  const th = overlay.tip.offsetHeight;
  let tx = x;
  let ty = y + h + TIP_GAP;

  if (ty + th > view.h - 8) {
    ty = y - th - TIP_GAP;
    if (ty < 8) {
      ty = Math.min(Math.max(8, y), view.h - th - 8);
      tx = x + w + TIP_GAP;
      if (tx + tw > view.w - 8) tx = x - tw - TIP_GAP;
    }
  }
  overlay.tip.style.left = `${Math.round(Math.min(Math.max(8, tx), view.w - tw - 8))}px`;
  overlay.tip.style.top = `${Math.round(Math.min(Math.max(8, ty), view.h - th - 8))}px`;
}

function buildOverlay() {
  const root = document.createElement('div');
  root.className = 'tour';

  const spot = document.createElement('div');
  spot.className = 'tour-spot';

  const tip = document.createElement('div');
  tip.className = 'tour-tip';
  tip.setAttribute('role', 'dialog');
  tip.setAttribute('aria-modal', 'true');

  const title = document.createElement('h3');
  const body = document.createElement('p');

  const foot = document.createElement('div');
  foot.className = 'tour-foot';

  const count = document.createElement('span');
  count.className = 'tour-count';

  const quit = document.createElement('button');
  quit.className = 'btn btn-ghost btn-sm';
  quit.textContent = 'Exit';

  const back = document.createElement('button');
  back.className = 'btn btn-ghost btn-sm';
  back.textContent = 'Back';

  const next = document.createElement('button');
  next.className = 'btn btn-primary btn-sm';
  next.textContent = 'Next';

  foot.append(count, quit, back, next);
  tip.append(title, body, foot);
  root.append(spot, tip);
  document.body.append(root);

  return { root, spot, tip, title, body, count, quit, back, next };
}

async function finish() {
  if (!live) return;
  const { overlay, snap } = live;
  live = null;

  overlay.root.remove();
  app.restore(snap);
  await app.compile();
}

/* ─────────────────────────────── helpers ────────────────────────────── */

const collapseAll = () => {
  for (const g of document.querySelectorAll('.group')) g.classList.add('is-collapsed');
};

function openGroup(id) {
  collapseAll();
  document.querySelector(`[data-group="${id}"]`)?.classList.remove('is-collapsed');
}

function segClick(selector) {
  document.querySelector(`.seg-btn${selector}`)?.click();
}

/** A joint on the top level, away from the corner the camera looks down. */
function topJoint() {
  const model = app.model();
  if (!model) return null;
  const top = model.grid.nz;
  const node = model.nodes.find((n) => n.level === top && n.i === 0 && n.j === 0);
  return node ? node.tag : null;
}

function firstColumn() {
  const model = app.model();
  return model?.elements.find((e) => e.kind === 'column')?.tag ?? null;
}

/**
 * Scrolls the generated script to the first line carrying `text` and marks it,
 * so the step that says "and in the script" can point at the line it means.
 */
function markCode(text) {
  const out = document.getElementById('code-out');
  if (!out) return;
  for (const line of out.querySelectorAll('.tour-line')) line.classList.remove('tour-line');

  // The script is one highlighted block, so the line is found in the text and
  // wrapped where it sits rather than looked up as an element.
  const walker = document.createTreeWalker(out, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const at = node.nodeValue.indexOf(text);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + text.length);
    const mark = document.createElement('span');
    mark.className = 'tour-line';
    try { range.surroundContents(mark); } catch { return; }
    mark.scrollIntoView({ block: 'center' });
    return;
  }
}

/** Keeps Tab inside the tooltip while the tour owns the screen. */
function trap(ev, box) {
  const stops = [...box.querySelectorAll('button')].filter((b) => !b.disabled);
  if (!stops.length) return;
  const edge = ev.shiftKey ? stops[0] : stops[stops.length - 1];
  if (document.activeElement === edge || !box.contains(document.activeElement)) {
    ev.preventDefault();
    (ev.shiftKey ? stops[stops.length - 1] : stops[0]).focus();
  }
}
