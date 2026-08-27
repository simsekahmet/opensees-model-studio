/**
 * viewer/viewer.js — the WebGL model viewer.
 *
 * Draws the model built by `model/builder.js` as either frame (stick) elements
 * or extruded solids, and drives the 3D, plan and elevation cameras.  The scene
 * is rebuilt whenever the visible subset changes, which keeps the instance
 * buffers dense and selection indices trivial to map back to elements.
 *
 * Global axes match the model and the generated script: X and Y horizontal,
 * Z vertical, origin at the first base grid point.
 *
 * Navigation follows ETABS: left button draws a selection window, the middle
 * button pans, Shift + middle orbits, and the wheel zooms.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

import { themeColor } from '../ui/shell.js';
import { fmt } from '../units.js';
import { memberForces, memberPeak } from '../results/derive.js';

/** Above these counts the labels would be unreadable anyway, so they are cut. */
const MAX_NODE_LABELS = 400;
const MAX_ELEM_LABELS = 500;
const MAX_LOCAL_AXES = 2000;

/** Pointer travel below this is a click, not a drag. */
const DRAG_THRESHOLD = 4;

/**
 * Where a label's box sits relative to the point it names, as a fraction of
 * the box itself — this is `CSS2DObject.center`, so the gap is fixed on screen
 * at every zoom level. Values outside 0…1 push the box clear of the anchor:
 * a node tag lands up and to the right of the joint, an element tag sits just
 * above the member, and neither covers the geometry it labels.
 */
const ANCHOR = {
  node: [-0.16, 1.34],
  elem: [0.5, 1.34],
  dim:  [0.5, 0.5],
  axis: [0.5, 0.5],
};

/**
 * The `vecxz` each family is given in the generated script. OpenSees builds the
 * member's triad from this and the member's own axis, so deriving the triad the
 * same way here means the drawing and the analysis agree even when a joint has
 * been moved and the member no longer runs along a global axis.
 */
const VECXZ = {
  column: new THREE.Vector3(1, 0, 0),
  beamX: new THREE.Vector3(0, -1, 0),
  beamY: new THREE.Vector3(1, 0, 0),
  isolator: new THREE.Vector3(1, 0, 0),
  damper: new THREE.Vector3(0, 0, 1),
};

const ZERO = [0, 0, 0];

/* ─────────────────────────── support symbols ─────────────────────────── */

/** Reads the restraint pattern back into the name of the support. */
function supportKind(fix) {
  if (!fix) return null;
  const held = fix.reduce((a, v) => a + (v ? 1 : 0), 0);
  if (held === 6) return 'Fixed';
  if (fix[0] && fix[1] && fix[2]) return 'Pinned';
  if (fix[2]) return 'Roller';
  return 'Pinned';
}

/** A cone standing on its apex under the joint — the pin of every drawing. */
function supportCone(s) {
  const geom = new THREE.ConeGeometry(s, s * 1.6, 4);
  geom.rotateX(Math.PI / 2);            // point the cone up the Z axis
  geom.translate(0, 0, -s * 0.8);       // apex at the joint, opening downwards
  return geom;
}

/** The ground line the symbol stands on. */
function groundBar(s, z, width = 2.6) {
  const geom = new THREE.BoxGeometry(s * width, s * width, s * 0.22);
  geom.translate(0, 0, z);
  return geom;
}

/** Hatching under a fixed base, as four bars raked at 45°. */
function hatching(s, z) {
  const bars = [];
  for (let i = -1; i <= 2; i++) {
    const geom = new THREE.BoxGeometry(s * 0.14, s * 1.5, s * 0.14);
    geom.rotateX(Math.PI / 4);
    geom.translate(s * 0.62 * i - s * 0.31, 0, z);
    bars.push(geom);
  }
  return bars;
}

/**
 * The pieces each support symbol is built from, positioned relative to the
 * joint. One instanced mesh is drawn per piece.
 */
const SUPPORT_PIECES = {
  Fixed: (s) => [
    // A plate flush under the joint, hatched beneath: nothing moves, nothing turns.
    groundBar(s, -s * 0.16, 3.0),
    ...hatching(s, -s * 0.75),
  ],
  Pinned: (s) => [supportCone(s), groundBar(s, -s * 1.78)],
  Roller: (s) => [
    supportCone(s),
    rollerBall(s, -s * 1.05),
    rollerBall(s, s * 1.05),
    groundBar(s, -s * 2.35),
  ],
};

/** One of the two rollers a roller support rides on. */
function rollerBall(s, x) {
  const geom = new THREE.SphereGeometry(s * 0.42, 12, 8);
  geom.translate(x, 0, -s * 2.0);
  return geom;
}

/** Drawing order; devices come last so they sit on top of the frame. */
const KINDS = ['column', 'beamX', 'beamY', 'isolator', 'damper'];

/**
 * Local triad of one element, built the way OpenSees builds it: local x runs
 * from end i to end j, `vecxz` fixes the roll about it, local y is `vecxz × x`
 * and local z closes the set.
 *
 * Taking x from the real end coordinates rather than from the family is what
 * makes a member whose joint has been moved draw along the member — the
 * extruded prism follows the skew instead of standing where the grid used to be.
 */
function basisOf(e) {
  const x = new THREE.Vector3(
    e.p2[0] - e.p1[0], e.p2[1] - e.p1[1], e.p2[2] - e.p1[2]
  );
  if (x.lengthSq() < 1e-18) x.set(0, 0, 1);
  x.normalize();

  let reference = VECXZ[e.kind] || VECXZ.damper;
  // A reference parallel to the member leaves the roll undefined, so a second
  // one is used — any direction off the axis gives a usable triad.
  if (Math.abs(reference.dot(x)) > 0.999) {
    reference = Math.abs(x.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  }

  const y = new THREE.Vector3().crossVectors(reference, x).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return [x, y, z];
}

export function createViewer(host, labelHost, { onSelect, band } = {}) {
  /* ── renderers ────────────────────────────────────────────────────── */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.append(renderer.domElement);

  const labelRenderer = new CSS2DRenderer({ element: labelHost });
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.inset = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';

  const scene = new THREE.Scene();

  const perspective = new THREE.PerspectiveCamera(45, 1, 0.01, 1e6);
  perspective.up.set(0, 0, 1);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1e6, 1e6);
  ortho.up.set(0, 0, 1);
  let camera = perspective;

  const controls = new OrbitControls(perspective, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  // Left is reserved for selection. OrbitControls swaps PAN and ROTATE when a
  // modifier is held, which gives the ETABS mapping for free.
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };

  scene.add(new THREE.AmbientLight(0xffffff, 0.72));
  const key = new THREE.DirectionalLight(0xffffff, 1.05);
  key.position.set(1, -1.4, 2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-1.2, 1, 0.6);
  scene.add(fill);

  /* ── scene graph ──────────────────────────────────────────────────── */
  const root = new THREE.Group();
  scene.add(root);

  const gElements = new THREE.Group();
  const gNodes = new THREE.Group();
  const gSupports = new THREE.Group();
  const gGrid = new THREE.Group();
  const gDims = new THREE.Group();
  const gLocal = new THREE.Group();
  const gAxes = new THREE.Group();
  const gLabels = new THREE.Group();
  const gSlabs = new THREE.Group();
  const gDiagrams = new THREE.Group();
  const gSelection = new THREE.Group();
  root.add(gSlabs, gElements, gNodes, gSupports, gGrid, gDims, gLocal, gAxes,
           gLabels, gDiagrams, gSelection);

  /* ── state ────────────────────────────────────────────────────────── */
  let model = null;
  let picks = [];          // per drawable: { object, elements, mode }
  let visibleElements = [];
  let visibleNodes = [];
  let nodePick = null;     // { object, nodes }
  let drawnByTag = new Map();   // tag → element as drawn, offsets included
  const selection = new Set();
  const nodeSelection = new Set();

  const opts = {
    display: 'wireframe',
    selectMode: 'element',   // 'element' | 'node'
    view: 'view3d',
    story: 1,
    frame: { axis: 'x', index: 0 },
    // Off to begin with. A tag on every joint and every member is noise until
    // there is a reason to read one, and the reason is almost always a
    // selection — which carries its own tag whatever these say.
    nodeLabels: false,
    elemLabels: false,
    localAxes: false,
    dims: false,
    grid: true,
    supports: true,
    axes: true,
    slabs: true,

    // Result overlays. `deform` is 'none', 'displaced' or 'mode'; `diagram` is
    // null or one of the local force components.
    deform: 'none',
    deformScale: 1,
    deformStep: -1,      // -1 is the last recorded step
    modeNumber: 1,
    animate: false,
    diagram: null,       // 'N' | 'Vy' | 'Vz' | 'My' | 'Mz' | 'T'
  };

  /** Loaded analysis results, or null. Set from `setResults`. */
  let results = null;

  /** Buffers the mode-shape animation rewrites in place, frame by frame. */
  let animated = null;
  let phase = 1;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  /** Labels by priority, most important first — see `declutter`. */
  const labelSets = { sel: [], axis: [], dim: [], node: [], elem: [] };
  let declutterKey = '';

  /* ── public API ───────────────────────────────────────────────────── */

  /**
   * Hands the viewer a new model.
   *
   * The camera is only framed the first time. Rebuilding after a parameter
   * change would otherwise throw away the zoom and angle the user had chosen,
   * which is exactly the moment they most want to keep looking at the same
   * corner of the building. `Fit view` re-frames on demand.
   */
  function setModel(next) {
    const first = !model;
    model = next;

    // Tags survive a rebuild by design, so the selection does too: keep every
    // member and joint that still exists. Clearing it here is what used to make
    // a joint move look like it had done nothing — the move landed, but the
    // selection and its move panel went with it.
    for (const tag of [...selection]) if (!model.elementByTag.has(tag)) selection.delete(tag);
    for (const tag of [...nodeSelection]) if (!model.nodeByTag.has(tag)) nodeSelection.delete(tag);

    opts.story = Math.min(opts.story, model.grid.nz) || 1;
    rebuild();
    if (first) { applyCamera(); fit(); }
  }

  /**
   * Hands the viewer a loaded analysis. Without one the deformed shape, the
   * mode shapes and the force diagrams have nothing to draw and stay off.
   */
  function setResults(next) {
    results = next;
    if (!results) {
      opts.deform = 'none';
      opts.diagram = null;
      opts.animate = false;
    }
    if (model) rebuild();
  }

  function setOptions(patch) {
    // Only a change of camera mode re-frames the view; toggling labels or the
    // display style must leave the user's current zoom and pan alone.
    const reframe = ['view', 'story', 'frame'].some(
      (k) => patch[k] !== undefined && patch[k] !== opts[k]
    );
    Object.assign(opts, patch);
    if (!model) return;
    rebuild();
    if (reframe) applyCamera();
  }

  function refreshTheme() {
    renderer.setClearColor(new THREE.Color(themeColor('--bg-0', '#0b0f14')), 1);
    if (model) rebuild();
  }

  /**
   * Frames the camera on the model.
   *
   * The centre is taken from the real extents rather than assuming the model
   * starts at the origin — a joint moved to negative X pulls the building off
   * that assumption, and the view ends up looking at empty space beside it.
   */
  function fit() {
    if (!model) return;

    // In a plan or an elevation only the drawn subset matters: framing a single
    // floor against the whole building would leave it a smudge in the middle.
    const shown = visibleElements.length
      ? extentsOfPoints(visibleElements.flatMap((e) => [e.p1, e.p2]))
      : model.bounds;

    const [x0, y0, z0] = shown.min;
    const [x1, y1, z1] = shown.max;
    const center = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const radius = Math.max(0.5 * Math.hypot(x1 - x0, y1 - y0, z1 - z0), 1e-3);

    controls.target.copy(center);

    if (camera === perspective) {
      const dist = radius / Math.sin((perspective.fov * Math.PI) / 360) * 1.15;
      perspective.position.copy(center).add(new THREE.Vector3(1, -1.15, 0.62).normalize().multiplyScalar(dist));
      perspective.near = radius / 500;
      perspective.far = radius * 500;
      perspective.updateProjectionMatrix();
    } else {
      placeOrtho(center, radius);
    }
    controls.update();
  }

  /**
   * Brings moved joints into sight without taking the view away.
   *
   * A joint move is meant to be watched, so the camera holds still and the
   * joint travels across the screen where the eye can follow it. It only
   * intervenes when the move carried the joint out of the frame, and then it
   * pans: the zoom and the angle the user set are carried over untouched, so
   * nothing about the view is thrown away except the part that went missing.
   */
  function revealNodes(tags) {
    if (!model || !tags || !tags.length) return;

    const pts = [];
    for (const tag of tags) {
      const n = model.nodeByTag.get(tag);
      if (n) pts.push(new THREE.Vector3(n.x, n.y, n.z));
    }
    if (!pts.length) return;

    camera.updateMatrixWorld();

    // A joint pressed against the edge of the canvas is as good as lost, so
    // the frame is treated as a little smaller than it really is.
    const EDGE = 0.82;
    const inFrame = (p) => {
      const ndc = p.clone().project(camera);
      return Math.abs(ndc.x) <= EDGE && Math.abs(ndc.y) <= EDGE && ndc.z > -1 && ndc.z < 1;
    };
    if (pts.every(inFrame)) return;

    const centre = pts
      .reduce((a, p) => a.add(p), new THREE.Vector3())
      .divideScalar(pts.length);

    // Keeping the camera-to-target vector is what preserves both the zoom and
    // the viewing angle; only where the pair is aimed changes.
    const offset = camera.position.clone().sub(controls.target);
    controls.target.copy(centre);
    camera.position.copy(centre).add(offset);
    controls.update();
  }

  function clearSelection() {
    selection.clear();
    nodeSelection.clear();
    drawSelection();
    emitSelection();
  }

  function getSelection() {
    return [...selection].map((tag) => model?.elementByTag.get(tag)).filter(Boolean);
  }

  function getNodeSelection() {
    return [...nodeSelection].map((tag) => model?.nodeByTag.get(tag)).filter(Boolean);
  }

  /** Restores a member selection after a recompile replaced the model. */
  function setSelection(tags) {
    selection.clear();
    for (const tag of tags) if (model?.elementByTag.has(tag)) selection.add(tag);
    drawSelection();
    emitSelection();
  }

  /** Restores a joint selection after a recompile replaced the model. */
  function setNodeSelection(tags) {
    nodeSelection.clear();
    for (const tag of tags) if (model?.nodeByTag.has(tag)) nodeSelection.add(tag);
    drawSelection();
    emitSelection();
  }

  function emitSelection() {
    onSelect?.({
      mode: opts.selectMode,
      elements: getSelection(),
      nodes: getNodeSelection(),
    });
  }

  function dispose() {
    resizeObserver.disconnect();
    renderer.dispose();
    renderer.domElement.remove();
  }

  /* ── scene construction ───────────────────────────────────────────── */

  function rebuild() {
    for (const g of [gSlabs, gElements, gNodes, gSupports, gGrid, gDims, gLocal, gAxes,
                     gLabels, gDiagrams, gSelection]) clear(g);
    picks = [];
    for (const set of Object.values(labelSets)) set.length = 0;
    declutterKey = '';
    if (!model) return;

    // Everything below draws `view`, which is the parametric model until a
    // result overlay displaces it. Picking, labels and selection then follow
    // the deformed geometry without knowing that is what they are doing.
    const view = displacedModel();
    animated = view.field ? { field: view.field, targets: [] } : null;

    visibleElements = view.elements.filter(elementVisible);
    drawnByTag = new Map(view.elements.map((e) => [e.tag, e]));
    const nodeTags = new Set();
    for (const e of visibleElements) { nodeTags.add(e.ni); nodeTags.add(e.nj); }
    const nodes = view.nodes.filter((n) => nodeTags.has(n.tag) || (n.master && opts.view === 'view3d'));
    visibleNodes = nodes;
    nodePick = null;

    const scale = Math.max(Math.hypot(...model.bounds.max), 1e-3);

    if (opts.display === 'extruded') buildExtruded(visibleElements);
    else buildWireframe(visibleElements);

    buildNodes(nodes, scale);
    if (opts.supports) buildSupports(scale);
    if (opts.grid) buildGrid();
    if (opts.dims) buildDimensions();
    if (opts.localAxes) buildLocalAxes(visibleElements, scale);
    if (opts.axes) buildGlobalAxes(scale);
    if (opts.slabs) buildSlabs(view);
    if (opts.diagram) buildDiagrams(visibleElements, scale);
    buildLabels(visibleElements, nodes);
    drawSelection();
  }

  function elementVisible(e) {
    if (opts.view === 'plan') return e.story === opts.story;
    if (opts.view === 'elevation') {
      const { axis, index } = opts.frame;
      // Dampers carry the frame line they were placed on, so they follow it
      // rather than being matched by element family.
      if (e.kind === 'damper') return e.axis === axis && e.line === index;
      if (axis === 'x') return e.kind !== 'beamY' && e.j === index;
      return e.kind !== 'beamX' && e.i === index;
    }
    return true;
  }

  /* ---- frame display ---- */

  function buildWireframe(elements) {
    for (const kind of KINDS) {
      const list = elements.filter((e) => e.kind === kind);
      if (!list.length) continue;

      const positions = new Float32Array(list.length * 6);
      list.forEach((e, n) => {
        positions.set(e.p1, n * 6);
        positions.set(e.p2, n * 6 + 3);
      });

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(colorOf(kind)) });
      const lines = new THREE.LineSegments(geom, mat);
      gElements.add(lines);
      picks.push({ object: lines, elements: list, mode: 'line' });
      registerAnimation(geom.getAttribute('position'), positions,
                        list.flatMap((e) => [e.ni, e.nj]));
    }
  }

  /* ---- extruded display ---- */

  function buildExtruded(elements) {
    for (const kind of KINDS) {
      const list = elements.filter((e) => e.kind === kind);
      if (!list.length) continue;

      // One instanced mesh per distinct section, not per family: a member whose
      // dimensions were edited in the inspector must be drawn at its own size.
      const groups = new Map();
      for (const e of list) {
        const key = sectionKey(e.section);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(e);
      }

      const m = new THREE.Matrix4();
      const basis = new THREE.Matrix4();

      for (const group of groups.values()) {
        const geom = sectionGeometry(group[0].section);
        const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(colorOf(kind)) });
        const mesh = new THREE.InstancedMesh(geom, mat, group.length);
        mesh.frustumCulled = false;

        group.forEach((e, n) => {
          const [ax, ay, az] = basisOf(e);
          basis.makeBasis(ax, ay, az);
          m.copy(basis);
          m.scale(new THREE.Vector3(e.length, 1, 1));
          m.setPosition(
            (e.p1[0] + e.p2[0]) / 2,
            (e.p1[1] + e.p2[1]) / 2,
            (e.p1[2] + e.p2[2]) / 2
          );
          mesh.setMatrixAt(n, m);
        });
        mesh.instanceMatrix.needsUpdate = true;

        gElements.add(mesh);
        picks.push({ object: mesh, elements: group, mode: 'instance' });
      }
    }
  }

  /**
   * Floor slabs, drawn as the panels they are. They are translucent and sit
   * behind everything else so the frame stays readable through them, and in a
   * plan only the storey being looked at is drawn.
   */
  function buildSlabs(view) {
    const panels = (view.slabs || []).filter((p) => (
      opts.view !== 'plan' || p.level === opts.story
    ));
    if (!panels.length) return;

    // Two triangles per panel, in one buffer: a floor of a hundred bays is one
    // draw call rather than a hundred.
    const positions = new Float32Array(panels.length * 18);
    panels.forEach((panel, n) => {
      // The corners come from the drawn nodes, so a slab follows a deformed
      // shape or a mode exactly as the frame around it does.
      const p = panel.nodes.map((tag) => {
        const node = view.nodeByTag.get(tag);
        return node ? [node.x, node.y, node.z] : [0, 0, 0];
      });
      const order = [0, 1, 2, 0, 2, 3];
      order.forEach((k, v) => positions.set(p[k], n * 18 + v * 3));
    });

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.computeVertexNormals();

    const mesh = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({
      color: new THREE.Color(themeColor('--el-slab', '#5aa9f0')),
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    }));
    mesh.renderOrder = -1;
    gSlabs.add(mesh);
  }

  /** Bounding box of a set of points, as `{ min, max }`. */
  function extentsOfPoints(points) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const p of points) {
      for (let k = 0; k < 3; k++) {
        if (p[k] < min[k]) min[k] = p[k];
        if (p[k] > max[k]) max[k] = p[k];
      }
    }
    return min[0] === Infinity ? model.bounds : { min, max };
  }

  /** Everything that changes the drawn prism. */
  function sectionKey(sec) {
    return `${sec.shape}|${sec.b}|${sec.h}|${sec.D ?? ''}|${sec.bf ?? ''}|${sec.tf ?? ''}|${sec.tw ?? ''}`;
  }

  /**
   * A unit-length prism of the real cross-section: depth along local y, width
   * along local z, extruded one unit along local x so the instance matrix only
   * has to scale x by the member length.
   */
  function sectionGeometry(sec) {
    if (sec.shape === 'Circular') {
      const g = new THREE.CylinderGeometry(sec.D / 2, sec.D / 2, 1, 20, 1);
      g.rotateZ(Math.PI / 2);
      return g;
    }
    if (sec.shape === 'ISection') {
      const g = new THREE.ExtrudeGeometry(iShape(sec), { depth: 1, bevelEnabled: false });
      g.translate(0, 0, -0.5);
      g.rotateY(Math.PI / 2);
      return g;
    }
    return new THREE.BoxGeometry(1, sec.h, sec.b);
  }

  function iShape(sec) {
    const hz = sec.bf / 2, hy = sec.h / 2, hw = sec.tw / 2, yf = sec.h / 2 - sec.tf;
    const s = new THREE.Shape();
    s.moveTo(-hz, -hy); s.lineTo(hz, -hy); s.lineTo(hz, -yf);
    s.lineTo(hw, -yf);  s.lineTo(hw, yf);  s.lineTo(hz, yf);
    s.lineTo(hz, hy);   s.lineTo(-hz, hy); s.lineTo(-hz, yf);
    s.lineTo(-hw, yf);  s.lineTo(-hw, -yf); s.lineTo(-hz, -yf);
    s.closePath();
    return s;
  }

  /* ---- nodes, supports, grid ---- */

  function buildNodes(nodes, scale) {
    if (!nodes.length) return;
    // Joints are drawn larger while picking them, so they are easy to hit.
    const picking = opts.selectMode === 'node';
    const geom = new THREE.SphereGeometry(scale * (picking ? 0.007 : 0.004), 12, 8);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(themeColor('--el-node')) });
    const mesh = new THREE.InstancedMesh(geom, mat, nodes.length);
    mesh.frustumCulled = false;
    const m = new THREE.Matrix4();
    nodes.forEach((n, i) => {
      m.makeTranslation(n.x, n.y, n.z);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    gNodes.add(mesh);
    nodePick = { object: mesh, nodes };
    if (animated) animated.nodeMesh = { mesh, nodes, matrix: new THREE.Matrix4() };
  }

  /**
   * Support symbols, drawn as the drawing convention draws them: a hatched
   * plate for a fixed base, a cone on the ground for a pin, a cone on rollers
   * for a roller. A free base has no symbol because there is nothing there.
   */
  function buildSupports(scale) {
    // The plan of an upper story has nothing to do with supports three stories
    // below it, so they only appear on the level that actually carries them.
    if (opts.view === 'plan' && opts.story !== 0) return;

    const base = model.nodes.filter((n) => n.level === 0 && n.fix);
    if (!base.length) return;

    const byKind = new Map();
    for (const n of base) {
      const kind = supportKind(n.fix);
      if (!kind) continue;
      if (!byKind.has(kind)) byKind.set(kind, []);
      byKind.get(kind).push(n);
    }

    const s = scale * 0.018;
    const colour = new THREE.Color(themeColor('--el-support'));
    const m = new THREE.Matrix4();

    for (const [kind, nodes] of byKind) {
      for (const geom of SUPPORT_PIECES[kind](s)) {
        const mesh = new THREE.InstancedMesh(
          geom, new THREE.MeshLambertMaterial({ color: colour }), nodes.length
        );
        mesh.frustumCulled = false;
        nodes.forEach((n, i) => {
          m.makeTranslation(n.x, n.y, n.z);
          mesh.setMatrixAt(i, m);
        });
        mesh.instanceMatrix.needsUpdate = true;
        gSupports.add(mesh);
      }
    }
  }

  function buildGrid() {
    const { xs, ys } = model.grid;
    const z = opts.view === 'plan' ? model.grid.zs[opts.story] : 0;
    const pts = [];
    const x0 = xs[0], x1 = xs[xs.length - 1];
    const y0 = ys[0], y1 = ys[ys.length - 1];
    for (const x of xs) pts.push(x, y0, z, x, y1, z);
    for (const y of ys) pts.push(x0, y, z, x1, y, z);

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(themeColor('--line')),
      transparent: true, opacity: 0.85,
    });
    gGrid.add(new THREE.LineSegments(geom, mat));
  }

  /* ---- coordinate axes ---- */

  /** Global triad at the model origin, matching the script's node (0, 0, 0). */
  function buildGlobalAxes(scale) {
    const len = scale * 0.17;
    const origin = new THREE.Vector3(0, 0, 0);
    const dirs = [
      [new THREE.Vector3(1, 0, 0), '--axis-x', 'X'],
      [new THREE.Vector3(0, 1, 0), '--axis-y', 'Y'],
      [new THREE.Vector3(0, 0, 1), '--axis-z', 'Z'],
    ];
    for (const [dir, token, label] of dirs) {
      gAxes.add(new THREE.ArrowHelper(
        dir, origin, len, new THREE.Color(themeColor(token)), len * 0.20, len * 0.10
      ));
      // Just clear of the arrowhead rather than floating well past it.
      labelSets.axis.push(addTag(gAxes, label,
        dir.x * len * 1.09, dir.y * len * 1.09, dir.z * len * 1.09,
        `tag-axis ax-${label.toLowerCase()}`));
    }
  }

  /**
   * Element local axes drawn at each midpoint: x along the member, y along the
   * section depth, z along the section width — the triad the section
   * properties and the eleLoad signs are expressed in.
   */
  function buildLocalAxes(elements, scale) {
    if (elements.length > MAX_LOCAL_AXES) return;

    const colors = ['--axis-x', '--axis-y', '--axis-z'].map((t) => new THREE.Color(themeColor(t)));
    const pts = [];
    const cols = [];

    for (const e of elements) {
      const mid = [
        (e.p1[0] + e.p2[0]) / 2,
        (e.p1[1] + e.p2[1]) / 2,
        (e.p1[2] + e.p2[2]) / 2,
      ];
      const len = Math.min(e.length * 0.25, scale * 0.035);
      basisOf(e).forEach((axis, i) => {
        pts.push(mid[0], mid[1], mid[2]);
        pts.push(mid[0] + axis.x * len, mid[1] + axis.y * len, mid[2] + axis.z * len);
        cols.push(colors[i].r, colors[i].g, colors[i].b, colors[i].r, colors[i].g, colors[i].b);
      });
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    gLocal.add(new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ vertexColors: true })));
  }

  /* ---- dimensions ---- */

  function buildDimensions() {
    const { xs, ys, zs } = model.grid;
    const span = Math.max(xs[xs.length - 1], ys[ys.length - 1]);
    const off = span * 0.06;
    const pts = [];

    // Bay widths along X, drawn below the footprint.
    const yDim = -off;
    for (let i = 0; i < xs.length - 1; i++) {
      pts.push(xs[i], yDim, 0, xs[i + 1], yDim, 0);
      pts.push(xs[i], 0, 0, xs[i], yDim * 1.25, 0);
      labelSets.dim.push(addTag(gDims, fmt(xs[i + 1] - xs[i], 2), (xs[i] + xs[i + 1]) / 2, yDim * 1.35, 0, 'tag-dim'));
    }
    pts.push(xs[xs.length - 1], 0, 0, xs[xs.length - 1], yDim * 1.25, 0);

    // Bay widths along Y, drawn to the left.
    const xDim = -off;
    for (let j = 0; j < ys.length - 1; j++) {
      pts.push(xDim, ys[j], 0, xDim, ys[j + 1], 0);
      pts.push(0, ys[j], 0, xDim * 1.25, ys[j], 0);
      labelSets.dim.push(addTag(gDims, fmt(ys[j + 1] - ys[j], 2), xDim * 1.35, (ys[j] + ys[j + 1]) / 2, 0, 'tag-dim'));
    }
    pts.push(0, ys[ys.length - 1], 0, xDim * 1.25, ys[ys.length - 1], 0);

    // Story heights, drawn on the near corner.
    if (opts.view !== 'plan') {
      for (let k = 0; k < zs.length - 1; k++) {
        pts.push(xDim, yDim, zs[k], xDim, yDim, zs[k + 1]);
        labelSets.dim.push(addTag(gDims, fmt(zs[k + 1] - zs[k], 2), xDim, yDim, (zs[k] + zs[k + 1]) / 2, 'tag-dim'));
      }
      labelSets.dim.push(addTag(gDims, `H = ${fmt(zs[zs.length - 1], 2)}`, xDim, yDim, zs[zs.length - 1] * 1.03, 'tag-dim'));
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    gDims.add(new THREE.LineSegments(geom, new THREE.LineBasicMaterial({
      color: new THREE.Color(themeColor('--el-dim')),
    })));
  }

  /* ---- labels ---- */

  function buildLabels(elements, nodes) {
    // Node tags sit up and to the right of the joint; element tags sit just
    // above the member midpoint. Neither covers what it names.
    if (opts.nodeLabels && nodes.length <= MAX_NODE_LABELS) {
      for (const n of nodes) {
        labelSets.node.push(addTag(gLabels, String(n.tag), n.x, n.y, n.z, 'tag-node', ANCHOR.node));
      }
    }
    if (opts.elemLabels && elements.length <= MAX_ELEM_LABELS) {
      for (const e of elements) {
        labelSets.elem.push(addTag(gLabels, String(e.tag),
          (e.p1[0] + e.p2[0]) / 2, (e.p1[1] + e.p2[1]) / 2, (e.p1[2] + e.p2[2]) / 2,
          'tag-elem', ANCHOR.elem));
      }
    }
  }

  /**
   * `anchor` is the point of the label box that lands on the 3D position, in
   * box-relative coordinates: (0.5, 0.5) centres it, (0, 1) puts its
   * bottom-left corner there so the box sits up and to the right. Anchoring
   * this way keeps the label clear of the geometry at every zoom level,
   * because the offset is a property of the box rather than a world offset.
   */
  /**
   * Hides labels that would overlap one already on screen, the way a CAD view
   * thins its annotation as you zoom out. Dimensions and axis letters win over
   * node tags, which win over element tags.
   *
   * Runs only when the camera has moved, and reads the screen position back
   * out of the transform CSS2DRenderer just wrote, so no layout is forced.
   * Culling uses `visibility` because the renderer owns `display`.
   */
  function declutter() {
    const key = `${camera.position.x.toFixed(2)},${camera.position.y.toFixed(2)},${camera.position.z.toFixed(2)}`
      + `|${camera.zoom.toFixed(3)}|${controls.target.x.toFixed(2)},${controls.target.y.toFixed(2)},${controls.target.z.toFixed(2)}`;
    if (key === declutterKey) return;
    declutterKey = key;

    const taken = [];
    for (const group of [labelSets.sel, labelSets.axis, labelSets.dim,
                         labelSets.node, labelSets.elem]) {
      for (const el of group) {
        if (el.style.display === 'none') continue;      // outside the frustum

        const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform);
        if (!m) continue;

        // Cached once — the text is fixed, so the box never changes size.
        if (el._w === undefined) { el._w = el.offsetWidth; el._h = el.offsetHeight; }
        if (!el._w) { el._w = undefined; continue; }

        const x = Number(m[1]) - el.dataset.cx * el._w;
        const y = Number(m[2]) - el.dataset.cy * el._h;
        const box = [x, y, x + el._w, y + el._h];

        const clash = taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1]);
        el.style.visibility = clash ? 'hidden' : '';
        if (!clash) taken.push(box);
      }
    }
  }

  function addTag(group, text, x, y, z, cls, anchor = [0.5, 0.5]) {
    const div = document.createElement('div');
    div.className = `tag ${cls}`;
    div.textContent = text;
    const obj = new CSS2DObject(div);
    obj.center.set(anchor[0], anchor[1]);
    obj.position.set(x, y, z);
    div.dataset.cx = anchor[0];
    div.dataset.cy = anchor[1];
    group.add(obj);
    return div;
  }

  /* ── cameras ──────────────────────────────────────────────────────── */

  function applyCamera() {
    const plan = opts.view === 'plan';
    const elev = opts.view === 'elevation';

    if (plan || elev) {
      camera = ortho;
      controls.object = ortho;
      controls.enableRotate = false;
      const [mx, my, mz] = model.bounds.max;
      const center = plan
        ? new THREE.Vector3(mx / 2, my / 2, model.grid.zs[opts.story])
        : new THREE.Vector3(mx / 2, my / 2, mz / 2);
      placeOrtho(center, Math.max(0.5 * Math.hypot(mx, my, mz), 1e-3));
      controls.target.copy(center);
    } else {
      camera = perspective;
      controls.object = perspective;
      controls.enableRotate = true;
    }
    controls.update();
  }

  function placeOrtho(center, radius) {
    const dist = radius * 4;
    const dir = opts.view === 'plan'
      ? new THREE.Vector3(0, 0, 1)
      : opts.frame.axis === 'x'
        ? new THREE.Vector3(0, -1, 0)
        : new THREE.Vector3(1, 0, 0);

    ortho.up.set(0, opts.view === 'plan' ? 1 : 0, opts.view === 'plan' ? 0 : 1);
    ortho.position.copy(center).add(dir.multiplyScalar(dist));
    ortho.lookAt(center);

    const box = host.getBoundingClientRect();
    const aspect = Math.max((box.width || 1) / Math.max(box.height || 1, 1), 1e-3);
    const half = radius * 1.15;
    ortho.left = -half * aspect;
    ortho.right = half * aspect;
    ortho.top = half;
    ortho.bottom = -half;
    ortho.updateProjectionMatrix();
  }

  /* ── selection ────────────────────────────────────────────────────── */

  let drag = null;

  renderer.domElement.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || !model) return;
    const rect = renderer.domElement.getBoundingClientRect();
    drag = {
      x0: ev.clientX - rect.left,
      y0: ev.clientY - rect.top,
      x1: ev.clientX - rect.left,
      y1: ev.clientY - rect.top,
      additive: ev.ctrlKey || ev.metaKey || ev.shiftKey,
      moved: false,
      rect,
    };
    renderer.domElement.setPointerCapture(ev.pointerId);
  });

  renderer.domElement.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    drag.x1 = ev.clientX - drag.rect.left;
    drag.y1 = ev.clientY - drag.rect.top;
    if (!drag.moved && Math.hypot(drag.x1 - drag.x0, drag.y1 - drag.y0) > DRAG_THRESHOLD) drag.moved = true;
    if (drag.moved) showBand();
  });

  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (!drag) return;
    renderer.domElement.releasePointerCapture?.(ev.pointerId);
    hideBand();

    const nodeMode = opts.selectMode === 'node';
    if (drag.moved) (nodeMode ? boxSelectNodes : boxSelect)();
    else (nodeMode ? clickSelectNode : clickSelect)();

    drag = null;
    drawSelection();
    emitSelection();
  });

  renderer.domElement.addEventListener('pointercancel', () => { hideBand(); drag = null; });

  /**
   * Keyboard control of the camera.
   *
   * The scene is the one part of this app that cannot be reached without a
   * mouse, and orbiting is the thing you do first. The keys move the camera on
   * the same orbit the mouse drags it along, so a keyboard user is looking at
   * the model the same way — not at a second, lesser version of the view.
   *
   * The handler sits on the host rather than the canvas because the host is
   * what takes focus, and it only claims the keys it uses.
   */
  host.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

    const ORBIT = 0.09;              // radians per press
    const spherical = new THREE.Spherical();
    const offset = camera.position.clone().sub(controls.target);

    const orbit = (dTheta, dPhi) => {
      spherical.setFromVector3(offset);
      spherical.theta += dTheta;
      // Stopped just short of the poles, where the up vector flips and the
      // view rolls over for no reason the user asked for.
      spherical.phi = Math.min(Math.PI - 1e-3, Math.max(1e-3, spherical.phi + dPhi));
      camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
      controls.update();
    };

    const zoom = (factor) => {
      if (camera === ortho) {
        camera.zoom = Math.max(0.02, camera.zoom * factor);
        camera.updateProjectionMatrix();
      } else {
        camera.position.copy(controls.target).add(offset.multiplyScalar(1 / factor));
      }
      controls.update();
    };

    switch (ev.key) {
      case 'ArrowLeft':  orbit(-ORBIT, 0); break;
      case 'ArrowRight': orbit(ORBIT, 0); break;
      case 'ArrowUp':    orbit(0, -ORBIT); break;
      case 'ArrowDown':  orbit(0, ORBIT); break;
      case '+': case '=': zoom(1.12); break;
      case '-': case '_': zoom(1 / 1.12); break;
      case 'Escape':     clearSelection(); break;
      default: return;
    }
    ev.preventDefault();
  });

  function showBand() {
    if (!band) return;
    const left = Math.min(drag.x0, drag.x1);
    const top = Math.min(drag.y0, drag.y1);
    band.hidden = false;
    band.dataset.mode = drag.x1 >= drag.x0 ? 'window' : 'crossing';
    band.style.left = `${left}px`;
    band.style.top = `${top}px`;
    band.style.width = `${Math.abs(drag.x1 - drag.x0)}px`;
    band.style.height = `${Math.abs(drag.y1 - drag.y0)}px`;
  }

  function hideBand() {
    if (band) band.hidden = true;
  }

  function clickSelect() {
    pointer.x = (drag.x1 / drag.rect.width) * 2 - 1;
    pointer.y = -(drag.y1 / drag.rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    raycaster.params.Line.threshold = Math.hypot(...model.bounds.max) * 0.006;

    for (const pick of picks) {
      const hits = raycaster.intersectObject(pick.object, false);
      if (!hits.length) continue;
      const hit = hits[0];
      const index = pick.mode === 'instance' ? hit.instanceId : Math.floor(hit.index / 2);
      const element = pick.elements[index];
      if (!element) continue;

      if (!drag.additive) selection.clear();
      if (selection.has(element.tag)) selection.delete(element.tag);
      else selection.add(element.tag);
      return;
    }
    if (!drag.additive) selection.clear();
  }

  function clickSelectNode() {
    if (!nodePick) return;
    pointer.x = (drag.x1 / drag.rect.width) * 2 - 1;
    pointer.y = -(drag.y1 / drag.rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const hit = raycaster.intersectObject(nodePick.object, false)[0];
    const node = hit && nodePick.nodes[hit.instanceId];
    if (!drag.additive) nodeSelection.clear();
    if (!node) return;
    if (nodeSelection.has(node.tag)) nodeSelection.delete(node.tag);
    else nodeSelection.add(node.tag);
  }

  /** A joint is a point, so window and crossing amount to the same test. */
  function boxSelectNodes() {
    const box = {
      x0: Math.min(drag.x0, drag.x1), x1: Math.max(drag.x0, drag.x1),
      y0: Math.min(drag.y0, drag.y1), y1: Math.max(drag.y0, drag.y1),
    };
    const w = drag.rect.width, h = drag.rect.height;
    if (!drag.additive) nodeSelection.clear();

    for (const n of visibleNodes) {
      const p = toScreen([n.x, n.y, n.z], w, h);
      if (p && inBox(p, box)) nodeSelection.add(n.tag);
    }
  }

  /**
   * ETABS window/crossing rule: dragging left-to-right selects only members
   * fully inside the box; dragging right-to-left also takes anything the box
   * merely touches.
   */
  function boxSelect() {
    const crossing = drag.x1 < drag.x0;
    const box = {
      x0: Math.min(drag.x0, drag.x1), x1: Math.max(drag.x0, drag.x1),
      y0: Math.min(drag.y0, drag.y1), y1: Math.max(drag.y0, drag.y1),
    };
    const w = drag.rect.width, h = drag.rect.height;
    if (!drag.additive) selection.clear();

    for (const e of visibleElements) {
      const a = toScreen(e.p1, w, h);
      const b = toScreen(e.p2, w, h);
      if (!a || !b) continue;
      const inA = inBox(a, box), inB = inBox(b, box);
      const hit = crossing
        ? (inA || inB || segmentCrossesBox(a, b, box))
        : (inA && inB);
      if (hit) selection.add(e.tag);
    }
  }

  const projected = new THREE.Vector3();

  function toScreen(p, w, h) {
    projected.set(p[0], p[1], p[2]).project(camera);
    if (projected.z < -1 || projected.z > 1) return null;   // behind or beyond
    return { x: (projected.x * 0.5 + 0.5) * w, y: (-projected.y * 0.5 + 0.5) * h };
  }

  const inBox = (p, b) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;

  /** Liang–Barsky: does the segment a→b intersect the axis-aligned box? */
  function segmentCrossesBox(a, b, box) {
    const dx = b.x - a.x, dy = b.y - a.y;
    let t0 = 0, t1 = 1;
    const clip = (p, q) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    return clip(-dx, a.x - box.x0) && clip(dx, box.x1 - a.x)
        && clip(-dy, a.y - box.y0) && clip(dy, box.y1 - a.y);
  }

  function drawSelection() {
    clear(gSelection);
    labelSets.sel.length = 0;
    if (!model) return;
    const accent = new THREE.Color(themeColor('--el-select'));

    if (selection.size) {
      const pts = [];
      for (const tag of selection) {
        const e = drawnByTag.get(tag) || model.elementByTag.get(tag);
        if (e) pts.push(...e.p1, ...e.p2);
      }
      if (pts.length) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const line = new THREE.LineSegments(geom, new THREE.LineBasicMaterial({
          color: accent, depthTest: false,
        }));
        line.renderOrder = 999;
        gSelection.add(line);
      }
    }

    if (nodeSelection.size) {
      const picked = getNodeSelection();
      const scale = Math.max(Math.hypot(...model.bounds.max), 1e-3);
      const geom = new THREE.SphereGeometry(scale * 0.011, 14, 10);
      const mesh = new THREE.InstancedMesh(
        geom,
        new THREE.MeshBasicMaterial({ color: accent, depthTest: false }),
        picked.length
      );
      mesh.frustumCulled = false;
      mesh.renderOrder = 1000;
      const m = new THREE.Matrix4();
      picked.forEach((n, i) => {
        m.makeTranslation(n.x, n.y, n.z);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      gSelection.add(mesh);
    }

    // Whatever the label switches say, what is selected carries its tag. The
    // point of picking something is usually to find out which one it is, and
    // turning on every label in the model to answer that is the wrong trade.
    // They go in `labelSets.sel`, which declutter reads first, so a selection
    // tag is never the one hidden by a crowd.
    if (!opts.elemLabels) {
      for (const tag of selection) {
        const e = drawnByTag.get(tag) || model.elementByTag.get(tag);
        if (!e) continue;
        labelSets.sel.push(addTag(gSelection, String(e.tag),
          (e.p1[0] + e.p2[0]) / 2, (e.p1[1] + e.p2[1]) / 2, (e.p1[2] + e.p2[2]) / 2,
          'tag-elem tag-sel', ANCHOR.elem));
      }
    }
    if (!opts.nodeLabels) {
      for (const n of getNodeSelection()) {
        labelSets.sel.push(addTag(gSelection, String(n.tag), n.x, n.y, n.z,
          'tag-node tag-sel', ANCHOR.node));
      }
    }
    // The labels are new, so the placement pass has to run again for them.
    declutterKey = '';
  }

  /* ── loop and resize ──────────────────────────────────────────────── */

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);

  function resize() {
    // Measured rather than read from clientWidth so fractional layout sizes on
    // a scaled display are carried through exactly.
    const rect = host.getBoundingClientRect();
    const w = rect.width || host.clientWidth || 1;
    const h = rect.height || host.clientHeight || 1;

    // setSize must be allowed to write the canvas CSS size. Suppressing it
    // leaves the canvas laid out at its backing-store size, so on any display
    // with a device pixel ratio other than 1 the WebGL view ends up a
    // different size from the label layer and every label looks displaced.
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    perspective.aspect = w / h;
    perspective.updateProjectionMatrix();
    if (camera === ortho && model) applyCamera();
  }

  function tick() {
    requestAnimationFrame(tick);
    if (opts.animate && animated) {
      // A mode shape means nothing without its sign, so the phase sweeps
      // through -1 … 1 rather than the shape simply being drawn at its peak.
      phase = Math.sin(performance.now() * 0.0022);
      applyPhase();
    }
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    declutter();
  }

  refreshTheme();
  resize();
  tick();

  return {
    setModel, setOptions, setResults, fit, revealNodes, refreshTheme,
    clearSelection, getSelection, setSelection, getNodeSelection, setNodeSelection,
    dispose,
  };

  /* ── result overlays ──────────────────────────────────────────────── */

  /**
   * Displacement of every node for the active overlay, already scaled so the
   * largest one is a readable fraction of the model. Returns null when there is
   * nothing to draw.
   */
  function deformationField() {
    if (!results || opts.deform === 'none') return null;

    const raw = opts.deform === 'mode' ? modeField() : displacementField();
    if (!raw || !raw.size) return null;

    let peak = 0;
    for (const v of raw.values()) {
      const m = Math.hypot(v[0], v[1], v[2]);
      if (m > peak) peak = m;
    }
    if (!(peak > 0)) return null;

    // A deformed shape is read for its shape, not its magnitude: the largest
    // displacement is drawn at a fixed fraction of the model so the picture
    // stays legible whether the answer is millimetres or metres.
    const span = Math.max(Math.hypot(...model.bounds.max), 1e-6);
    const factor = (span * 0.06 / peak) * (Number(opts.deformScale) || 1);

    const scaled = new Map();
    for (const [tag, v] of raw) scaled.set(tag, [v[0] * factor, v[1] * factor, v[2] * factor]);
    return scaled;
  }

  function displacementField() {
    const file = 'node_disp.out';
    if (!results.has(file)) return null;
    const rows = results.series[file].rows;
    if (!rows.length) return null;

    const step = opts.deformStep < 0 ? rows.length - 1 : Math.min(opts.deformStep, rows.length - 1);
    const row = rows[step];

    const field = new Map();
    for (const node of model.nodes) {
      const cx = results.nodeColumn(file, node.tag, 1);
      const cy = results.nodeColumn(file, node.tag, 2);
      const cz = results.nodeColumn(file, node.tag, 3);
      if (cx < 0) continue;
      field.set(node.tag, [row[cx], cy < 0 ? 0 : row[cy], cz < 0 ? 0 : row[cz]]);
    }
    return field;
  }

  function modeField() {
    if (!results.modeShapes) return null;
    const shape = results.modeShapes.get(Number(opts.modeNumber));
    if (!shape) return null;

    const field = new Map();
    for (const node of model.nodes) {
      const v = shape.get(node.tag);
      if (v) field.set(node.tag, v);
    }
    return field;
  }

  /**
   * The model as it is drawn: the parametric one when no overlay is active, and
   * a displaced copy of it otherwise. Every builder downstream works on this,
   * so nothing else has to know an overlay exists.
   */
  function displacedModel() {
    const field = deformationField();

    // An insertion point carries the member off its joint line; the joints stay
    // where they are, so only the member's own ends move.
    //
    // That displacement belongs to the solid, not to the line. The frame view
    // is the analytical model — the joint line has to run unbroken from the
    // base to the roof, because that is where the joints are and that is what
    // `-jntOffset` leaves standing. Drawing the line off the joints instead
    // breaks a column into disconnected segments and says something about the
    // model that is not true. So the offset is applied to the extruded view
    // alone, where it is the section that leans onto its face.
    const offset = opts.display === 'extruded'
      && model.elements.some((e) => e.offset && Math.hypot(...e.offset) > 1e-9);
    if (!field && !offset) return model;

    const nodes = field
      ? model.nodes.map((n) => {
        const d = field.get(n.tag);
        return d ? { ...n, x: n.x + d[0], y: n.y + d[1], z: n.z + d[2] } : n;
      })
      : model.nodes;

    const byTag = new Map(nodes.map((n) => [n.tag, n]));
    const elements = model.elements.map((e) => {
      const a = byTag.get(e.ni);
      const b = byTag.get(e.nj);
      if (!a || !b) return e;
      const [ox, oy, oz] = e.offset && offset ? e.offset : ZERO;
      return {
        ...e,
        p1: [a.x + ox, a.y + oy, a.z + oz],
        p2: [b.x + ox, b.y + oy, b.z + oz],
      };
    });
    return { ...model, nodes, elements, nodeByTag: byTag, field };
  }

  /**
   * Remembers a position buffer so the mode-shape animation can rewrite it in
   * place. The undeformed coordinates are recovered by subtracting the field
   * that was already added, which is cheaper and less error-prone than building
   * the geometry twice.
   */
  function registerAnimation(attribute, positions, tags) {
    if (!animated) return;
    const base = Float32Array.from(positions);
    tags.forEach((tag, v) => {
      const d = animated.field.get(tag);
      if (!d) return;
      base[v * 3] -= d[0];
      base[v * 3 + 1] -= d[1];
      base[v * 3 + 2] -= d[2];
    });
    animated.targets.push({ attribute, base, tags });
  }

  /** Redraws the registered geometry at the current animation phase. */
  function applyPhase() {
    if (!animated) return;

    for (const target of animated.targets) {
      const array = target.attribute.array;
      target.tags.forEach((tag, v) => {
        const d = animated.field.get(tag);
        if (!d) return;
        array[v * 3] = target.base[v * 3] + phase * d[0];
        array[v * 3 + 1] = target.base[v * 3 + 1] + phase * d[1];
        array[v * 3 + 2] = target.base[v * 3 + 2] + phase * d[2];
      });
      target.attribute.needsUpdate = true;
    }

    const nodeTarget = animated.nodeMesh;
    if (nodeTarget) {
      nodeTarget.nodes.forEach((n, i) => {
        const d = animated.field.get(n.tag) || ZERO;
        nodeTarget.matrix.makeTranslation(
          n.x - d[0] + phase * d[0],
          n.y - d[1] + phase * d[1],
          n.z - d[2] + phase * d[2]
        );
        nodeTarget.mesh.setMatrixAt(i, nodeTarget.matrix);
      });
      nodeTarget.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Local force diagrams, drawn as a ribbon standing off each member.
   *
   * Only the end values are recorded, so the diagram between them is linear —
   * which is exact for axial force and shear, and for moment on a member
   * carrying no span load. Members that do carry one are marked in the panel
   * rather than being drawn as if the straight line were the whole story.
   */
  function buildDiagrams(elements, scale) {
    const component = opts.diagram;
    if (!results || !component || !results.has('element_local_envelope.out')) return;

    const peak = memberPeak(results, component);
    if (!(peak > 0)) return;

    const size = scale * 0.08 / peak;
    const colour = new THREE.Color(themeColor(component === 'N' ? '--el-column' : '--el-beam'));
    const material = new THREE.LineBasicMaterial({ color: colour });
    const points = [];

    for (const e of elements) {
      if (!['column', 'beamX', 'beamY'].includes(e.kind)) continue;
      const forces = memberForces(results, e.tag);
      if (!forces) continue;

      // Sign convention: the value at end j is the one the member carries out
      // of that end, so it is negated to draw a continuous diagram.
      const vi = forces.i[component];
      const vj = -forces.j[component];
      const [, localY, localZ] = basisOf(e);
      // Bending about local z is drawn in the local y plane, and vice versa.
      const offset = component === 'Mz' || component === 'Vy' ? localY : localZ;

      const a = new THREE.Vector3(...e.p1);
      const b = new THREE.Vector3(...e.p2);
      const ai = a.clone().addScaledVector(offset, vi * size);
      const bj = b.clone().addScaledVector(offset, vj * size);

      points.push(a, ai, ai, bj, bj, b, a, b);
    }

    if (!points.length) return;
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    gDiagrams.add(new THREE.LineSegments(geom, material));
  }

  /* ── small helpers ────────────────────────────────────────────────── */

  function colorOf(kind) {
    return themeColor({
      column: '--el-column',
      isolator: '--el-isolator',
      damper: '--el-damper',
    }[kind] || '--el-beam');
  }

  function clear(group) {
    for (let i = group.children.length - 1; i >= 0; i--) {
      const child = group.children[i];
      child.geometry?.dispose?.();
      child.material?.dispose?.();
      if (child instanceof CSS2DObject) child.element.remove();
      if (child.dispose && child.isObject3D && child.line) child.dispose();   // ArrowHelper
      group.remove(child);
    }
  }
}
