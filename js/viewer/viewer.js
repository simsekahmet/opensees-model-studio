/**
 * viewer/viewer.js — the WebGL model viewer.
 *
 * Draws the model built by `model/builder.js` as either stick elements or
 * extruded solids, and drives the 3D, plan and elevation cameras.  The scene
 * is rebuilt whenever the visible subset changes, which keeps the instance
 * buffers dense and selection indices trivial to map back to elements.
 *
 * Global axes match the model: X and Y horizontal, Z vertical.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

import { themeColor } from '../ui/shell.js';
import { fmt } from '../units.js';

/** Above these counts the labels would be unreadable anyway, so they are cut. */
const MAX_NODE_LABELS = 400;
const MAX_ELEM_LABELS = 500;

/** Section-local axes expressed in world coordinates, per element family. */
const BASIS = {
  column: [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0)],
  beamX:  [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0)],
  beamY:  [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)],
};

export function createViewer(host, labelHost, { onSelect } = {}) {
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
  const gLabels = new THREE.Group();
  const gSelection = new THREE.Group();
  root.add(gElements, gNodes, gSupports, gGrid, gDims, gLabels, gSelection);

  /* ── state ────────────────────────────────────────────────────────── */
  let model = null;
  let picks = [];          // per drawable: { object, elements }
  const opts = {
    display: 'wireframe',
    view: 'view3d',
    story: 1,
    frame: { axis: 'x', index: 0 },
    nodeLabels: true,
    elemLabels: true,
    dims: false,
    grid: true,
    supports: true,
  };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let selectedTag = null;

  /* ── public API ───────────────────────────────────────────────────── */

  function setModel(next) {
    model = next;
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

  function dispose() {
    resizeObserver.disconnect();
    renderer.dispose();
    renderer.domElement.remove();
  }

  /* ── scene construction ───────────────────────────────────────────── */

  function rebuild() {
    clear(gElements); clear(gNodes); clear(gSupports);
    clear(gGrid); clear(gDims); clear(gLabels); clear(gSelection);
    picks = [];
    if (!model) return;

    const visible = model.elements.filter(elementVisible);
    const nodeTags = new Set();
    for (const e of visible) { nodeTags.add(e.ni); nodeTags.add(e.nj); }
    const nodes = model.nodes.filter((n) => nodeTags.has(n.tag) || (n.master && opts.view === 'view3d'));

    const scale = Math.max(Math.hypot(...model.bounds.max), 1e-3);

    if (opts.display === 'extruded') buildExtruded(visible);
    else buildWireframe(visible);

    buildNodes(nodes, scale);
    if (opts.supports) buildSupports(scale);
    if (opts.grid) buildGrid();
    if (opts.dims) buildDimensions();
    buildLabels(visible, nodes);
    if (selectedTag) highlight(selectedTag);
  }

  function elementVisible(e) {
    if (opts.view === 'plan') return e.story === opts.story;
    if (opts.view === 'elevation') {
      const { axis, index } = opts.frame;
      if (axis === 'x') return e.kind !== 'beamY' && e.j === index;
      return e.kind !== 'beamX' && e.i === index;
    }
    return true;
  }

  /* ---- stick display ---- */

  function buildWireframe(elements) {
    for (const kind of ['column', 'beamX', 'beamY']) {
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
      lines.userData.kind = kind;
      gElements.add(lines);
      picks.push({ object: lines, elements: list, mode: 'line' });
    }
  }

  /* ---- extruded display ---- */

  function buildExtruded(elements) {
    for (const kind of ['column', 'beamX', 'beamY']) {
      const list = elements.filter((e) => e.kind === kind);
      if (!list.length) continue;

      const geom = sectionGeometry(list[0].section);
      const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(colorOf(kind)) });
      const mesh = new THREE.InstancedMesh(geom, mat, list.length);
      mesh.frustumCulled = false;

      const m = new THREE.Matrix4();
      const basis = new THREE.Matrix4();
      const [ax, ay, az] = BASIS[kind];
      basis.makeBasis(ax, ay, az);

      list.forEach((e, n) => {
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
      const shape = iShape(sec);
      const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
      g.translate(0, 0, -0.5);
      g.rotateY(Math.PI / 2);
      return g;
    }
    return new THREE.BoxGeometry(1, sec.h, sec.b);
  }

  function iShape(sec) {
    const { h, bf, tf, tw } = { h: sec.h, bf: sec.bf, tf: sec.tf, tw: sec.tw };
    const hz = bf / 2, hy = h / 2, hw = tw / 2, yf = h / 2 - tf;
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
    const r = scale * 0.004;
    const geom = new THREE.SphereGeometry(r, 10, 8);
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

  /* ---- dimensions ---- */

  function buildDimensions() {
    const { xs, ys, zs } = model.grid;
    const span = Math.max(xs[xs.length - 1], ys[ys.length - 1]);
    const off = span * 0.06;
    const pts = [];
    const color = new THREE.Color(themeColor('--el-dim'));

    // Bay widths along X, drawn below the footprint.
    const yDim = -off;
    for (let i = 0; i < xs.length - 1; i++) {
      pts.push(xs[i], yDim, 0, xs[i + 1], yDim, 0);
      pts.push(xs[i], 0, 0, xs[i], yDim * 1.25, 0);
      addTag(`${fmt(xs[i + 1] - xs[i], 2)}`, (xs[i] + xs[i + 1]) / 2, yDim * 1.35, 0, 'tag-dim');
    }
    pts.push(xs[xs.length - 1], 0, 0, xs[xs.length - 1], yDim * 1.25, 0);

    // Bay widths along Y, drawn to the left.
    const xDim = -off;
    for (let j = 0; j < ys.length - 1; j++) {
      pts.push(xDim, ys[j], 0, xDim, ys[j + 1], 0);
      pts.push(0, ys[j], 0, xDim * 1.25, ys[j], 0);
      addTag(`${fmt(ys[j + 1] - ys[j], 2)}`, xDim * 1.35, (ys[j] + ys[j + 1]) / 2, 0, 'tag-dim');
    }
    pts.push(0, ys[ys.length - 1], 0, xDim * 1.25, ys[ys.length - 1], 0);

    // Story heights, drawn on the near corner.
    if (opts.view !== 'plan') {
      const xv = xDim, yv = yDim;
      for (let k = 0; k < zs.length - 1; k++) {
        pts.push(xv, yv, zs[k], xv, yv, zs[k + 1]);
        addTag(`${fmt(zs[k + 1] - zs[k], 2)}`, xv, yv, (zs[k] + zs[k + 1]) / 2, 'tag-dim');
      }
      addTag(`H = ${fmt(zs[zs.length - 1], 2)}`, xv, yv, zs[zs.length - 1] * 1.03, 'tag-dim');
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    gDims.add(new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color })));
  }

  /* ---- labels ---- */

  function buildLabels(elements, nodes) {
    if (opts.nodeLabels && nodes.length <= MAX_NODE_LABELS) {
      for (const n of nodes) addTag(String(n.tag), n.x, n.y, n.z, 'tag-node');
    }
    if (opts.elemLabels && elements.length <= MAX_ELEM_LABELS) {
      for (const e of elements) {
        addTag(String(e.tag),
          (e.p1[0] + e.p2[0]) / 2, (e.p1[1] + e.p2[1]) / 2, (e.p1[2] + e.p2[2]) / 2, 'tag-elem');
      }
    }
  }

  function addTag(text, x, y, z, cls) {
    const div = document.createElement('div');
    div.className = `tag ${cls}`;
    div.textContent = text;
    const obj = new CSS2DObject(div);
    obj.position.set(x, y, z);
    (cls === 'tag-dim' ? gDims : gLabels).add(obj);
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

  renderer.domElement.addEventListener('pointerdown', (ev) => {
    if (!model) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    raycaster.params.Line.threshold = Math.hypot(...model.bounds.max) * 0.006;

    for (const pick of picks) {
      const hits = raycaster.intersectObject(pick.object, false);
      if (!hits.length) continue;
      const hit = hits[0];
      const index = pick.mode === 'instance' ? hit.instanceId : Math.floor(hit.index / 2);
      const element = pick.elements[index];
      if (element) {
        selectedTag = element.tag;
        clear(gSelection);
        highlight(element.tag);
        onSelect?.(element);
        return;
      }
    }
    selectedTag = null;
    clear(gSelection);
    onSelect?.(null);
  });

  function highlight(tag) {
    const e = model.elementByTag.get(tag);
    if (!e) return;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute([...e.p1, ...e.p2], 3));
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(themeColor('--accent')),
      depthTest: false,
    });
    const line = new THREE.LineSegments(geom, mat);
    line.renderOrder = 999;
    gSelection.add(line);
  }

  function clearSelection() {
    selectedTag = null;
    clear(gSelection);
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
  }

  refreshTheme();
  resize();
  tick();

  return { setModel, setOptions, fit, refreshTheme, clearSelection, dispose };

  /* ── small helpers ────────────────────────────────────────────────── */

  function colorOf(kind) {
    return themeColor({ column: '--el-column', beamX: '--el-beam-x', beamY: '--el-beam-y' }[kind]);
  }

  function clear(group) {
    for (let i = group.children.length - 1; i >= 0; i--) {
      const child = group.children[i];
      child.geometry?.dispose?.();
      child.material?.dispose?.();
      if (child instanceof CSS2DObject) child.element.remove();
      group.remove(child);
    }
  }
}
