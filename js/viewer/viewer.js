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
 * Section-local axes expressed in world coordinates, per element family.
 * These are the same triads the `geomTransf` vecxz values produce in the
 * generated script, so the local-axis display is not a separate convention.
 */
const BASIS = {
  column: [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0)],
  beamX:  [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0)],
  beamY:  [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)],
  isolator: [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0)],
};

/** Drawing order; devices come last so they sit on top of the frame. */
const KINDS = ['column', 'beamX', 'beamY', 'isolator', 'damper'];

/**
 * Local triad of one element. Frame members and isolators are axis aligned so
 * they use the fixed table; a damper runs diagonally, so its triad is derived
 * from the member axis with the global Z as the reference up direction.
 */
function basisOf(e) {
  if (BASIS[e.kind]) return BASIS[e.kind];
  const x = new THREE.Vector3(
    e.p2[0] - e.p1[0], e.p2[1] - e.p1[1], e.p2[2] - e.p1[2]
  ).normalize();
  const ref = Math.abs(x.z) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const z = new THREE.Vector3().crossVectors(x, ref).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
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
  const gSelection = new THREE.Group();
  root.add(gElements, gNodes, gSupports, gGrid, gDims, gLocal, gAxes, gLabels, gSelection);

  /* ── state ────────────────────────────────────────────────────────── */
  let model = null;
  let picks = [];          // per drawable: { object, elements, mode }
  let visibleElements = [];
  let visibleNodes = [];
  let nodePick = null;     // { object, nodes }
  const selection = new Set();
  const nodeSelection = new Set();

  const opts = {
    display: 'wireframe',
    selectMode: 'element',   // 'element' | 'node'
    view: 'view3d',
    story: 1,
    frame: { axis: 'x', index: 0 },
    nodeLabels: true,
    elemLabels: true,
    localAxes: false,
    dims: false,
    grid: true,
    supports: true,
    axes: true,
  };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  /** Labels by priority, most important first — see `declutter`. */
  const labelSets = { axis: [], dim: [], node: [], elem: [] };
  let declutterKey = '';

  /* ── public API ───────────────────────────────────────────────────── */

  function setModel(next) {
    model = next;
    selection.clear();
    nodeSelection.clear();
    opts.story = Math.min(opts.story, model.grid.nz) || 1;
    rebuild();
    applyCamera();
    fit();
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

  function fit() {
    if (!model) return;
    const [mx, my, mz] = model.bounds.max;
    const center = new THREE.Vector3(mx / 2, my / 2, mz / 2);
    const radius = Math.max(0.5 * Math.hypot(mx, my, mz), 1e-3);

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
    for (const g of [gElements, gNodes, gSupports, gGrid, gDims, gLocal, gAxes, gLabels, gSelection]) clear(g);
    picks = [];
    for (const set of Object.values(labelSets)) set.length = 0;
    declutterKey = '';
    if (!model) return;

    visibleElements = model.elements.filter(elementVisible);
    const nodeTags = new Set();
    for (const e of visibleElements) { nodeTags.add(e.ni); nodeTags.add(e.nj); }
    const nodes = model.nodes.filter((n) => nodeTags.has(n.tag) || (n.master && opts.view === 'view3d'));
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
    }
  }

  /* ---- extruded display ---- */

  function buildExtruded(elements) {
    for (const kind of KINDS) {
      const list = elements.filter((e) => e.kind === kind);
      if (!list.length) continue;

      const geom = sectionGeometry(list[0].section);
      const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(colorOf(kind)) });
      const mesh = new THREE.InstancedMesh(geom, mat, list.length);
      mesh.frustumCulled = false;

      const m = new THREE.Matrix4();
      const basis = new THREE.Matrix4();

      list.forEach((e, n) => {
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
      picks.push({ object: mesh, elements: list, mode: 'instance' });
    }
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
  }

  function buildSupports(scale) {
    const base = model.nodes.filter((n) => n.level === 0 && n.fix);
    if (!base.length) return;
    const s = scale * 0.018;
    const geom = new THREE.ConeGeometry(s, s * 1.6, 4);
    geom.rotateX(Math.PI / 2);          // point the cone up the Z axis
    geom.translate(0, 0, -s * 0.8);
    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(themeColor('--el-support')) });
    const mesh = new THREE.InstancedMesh(geom, mat, base.length);
    const m = new THREE.Matrix4();
    base.forEach((n, i) => {
      m.makeTranslation(n.x, n.y, n.z);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    gSupports.add(mesh);
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
    for (const group of [labelSets.axis, labelSets.dim, labelSets.node, labelSets.elem]) {
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

    const aspect = Math.max(host.clientWidth / Math.max(host.clientHeight, 1), 1e-3);
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
    if (!model) return;
    const accent = new THREE.Color(themeColor('--el-select'));

    if (selection.size) {
      const pts = [];
      for (const tag of selection) {
        const e = model.elementByTag.get(tag);
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
  }

  /* ── loop and resize ──────────────────────────────────────────────── */

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);

  function resize() {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    labelRenderer.setSize(w, h);
    perspective.aspect = w / h;
    perspective.updateProjectionMatrix();
    if (camera === ortho && model) applyCamera();
  }

  function tick() {
    requestAnimationFrame(tick);
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    declutter();
  }

  refreshTheme();
  resize();
  tick();

  return {
    setModel, setOptions, fit, refreshTheme,
    clearSelection, getSelection, getNodeSelection, setNodeSelection,
    dispose,
  };

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
