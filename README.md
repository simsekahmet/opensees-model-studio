# OpenSees Model Studio

A browser-based model builder for [OpenSeesPy](https://openseespydoc.readthedocs.io/).
Define a space frame with forms instead of code, press **Compile**, and get a 3D
model, floor plans, elevations, dimensioned cross-sections, full node and element
tables, and a runnable `.py` script — all from a static page.

**Live app:** https://simsekahmet.github.io/opensees-model-studio/

---

## What it does

| Panel | Contents |
|---|---|
| **3D Model** | Orbitable model in stick or extruded mode, with node and element labels, supports, grid and dimension lines. Click any member to inspect it. |
| **Plan** | Orthographic floor plan of any selected story. |
| **Elevation** | Any X–Z or Y–Z frame line, in isolation. |
| **Sections** | Scaled cross-section drawings with rebar layout, dimensions and section properties. |
| **Model Data** | Story, element and node tables — tags, coordinates, restraints, lengths, section sizes, line loads and masses. |
| **Python Code** | The generated OpenSeesPy script, syntax highlighted, ready to copy or download. |

## Editing in the view

The scene toolbar has an **Elements / Nodes** switch that decides what the
rubber band picks. Dragging left-to-right takes only what is fully inside the
box, right-to-left also takes what it touches, and Ctrl or Shift adds to the
selection.

- **Members** — the inspector lets you change that member's section dimensions
  and its slab load. Edits apply to the whole selection, so twenty columns can
  be resized at once, and identical edits share one section in the script.
- **Joints** — the inspector gives X, Y and Z displacement fields. Everything
  attached follows the joint, because element ends are read from the node
  coordinates.

Both kinds of edit sit on top of the parametric grid rather than replacing it:
they survive a recompile and later changes to bay widths or story heights, and
`Use model values` / `Back to grid` removes them. Every edit is written into the
generated script on the next **Compile**.

Everything you set in the sidebar maps onto a real OpenSeesPy command:

- **Materials** — `Elastic`, `Concrete01`, `Concrete02`, `Concrete04`, `ElasticPP`,
  `Steel01`, `Steel02`, `Hysteretic`, with Mander confinement applied to the core fibers.
- **Sections** — `section('Elastic', …)` with cracked-section modifiers, or `Fiber`
  sections built from `patch` and `layer` calls for rectangular, circular and I shapes.
- **Elements** — `elasticBeamColumn`, `forceBeamColumn`, `dispBeamColumn`,
  `ElasticTimoshenkoBeam`, with `Lobatto` / `Legendre` / `NewtonCotes` / `Radau` /
  `Trapezoidal` integration and `Linear` / `PDelta` / `Corotational` transformations.
- **Constraints** — base fixity and optional `rigidDiaphragm` master nodes.
- **Loads** — slab loads distributed to beams by exact 45° tributary areas or one-way
  spans, plus member self weight and lumped seismic mass.
- **Analysis** — the full `constraints` / `numberer` / `system` / `test` / `algorithm`
  stack, gravity `LoadControl`, `eigen` with period output, and recorders.

## Architecture

The page is a plain ES-module app with no build step, so it deploys to GitHub Pages
as-is. Three.js is the only dependency, loaded from a CDN through an import map.

```
index.html
css/
  theme.css          design tokens, light and dark palettes, reset
  app.css            shell, forms, viewport, tables, code panel
js/
  main.js            entry point; wires the compile pipeline
  schema.js          declarative catalogue of every parameter
  state.js           flat parameter store, persisted to localStorage
  units.js           unit systems (kN·m, N·mm, kip·in) and formatting
  model/
    sections.js      cross-section geometry, stiffness and fiber layout
    builder.js       grid → nodes, elements, loads, masses, diaphragms
  codegen/
    openseespy.js    emits the parametric OpenSeesPy script
  viewer/
    viewer.js        WebGL scene, 3D/plan/elevation cameras, picking
  ui/
    shell.js         theme, tabs, toasts, downloads
    form.js          renders the sidebar from schema.js
    reports.js       Sections, Model Data and inspector panels
```

Adding a new OpenSeesPy option means adding one entry to `js/schema.js` and one
branch to `js/codegen/openseespy.js`. The viewer and the reports pick it up for free.

## Sign conventions

Global axes are X and Y horizontal, Z vertical. Section depth `h` runs along the
member's local y-axis and width `b` along local z, which the emitted `geomTransf`
vectors enforce:

| Family | `vecxz` | local y | local z |
|---|---|---|---|
| Columns | `1, 0, 0` | −Y | +X |
| Beams along X | `0, -1, 0` | +Z | −Y |
| Beams along Y | `1, 0, 0` | +Z | +X |

Beam gravity load is therefore applied as `-beamUniform -w 0.0`, and column self
weight as `-beamUniform 0.0 0.0 -w`.

## Tag scheme

Tags are chosen so recorder output stays readable:

```
node    (level + 1) · 10000 + gridIndex + 1     20007 → level 1, grid point 7
master  (level + 1) · 10000 + 9999              diaphragm master node
column  100000 + story · 1000 + gridIndex + 1
beam X  200000 + level · 1000 + index + 1
beam Y  300000 + level · 1000 + index + 1
```

## Verification

Every generated script is executed against the real `openseespy` before release.
The current run is 89 model variants — one per material model, per isolator, per
friction model, per damper type and configuration, per static and transient
integrator, per constraint handler, plus moved joints and edited members: **0
script errors**.

Statics is checked end to end on the default model: the sum of the vertical base
reactions the solver reports matches the slab load plus the member self weight to
0.000000 %.

Two documented materials, `RambergOsgoodSteel` and `FRPConfinedConcrete`, are not
offered: OpenSees prints *"temporarily removed from the compiled versions"* and
aborts, so a script using them could never run.

## Running the generated script

```bash
pip install openseespy
python your_model.py
```

On Windows, `openseespy` ships prebuilt binaries that need the Microsoft Visual C++
redistributable; install it if the import fails with a DLL load error.

## Local development

No toolchain is required — any static server works:

```bash
python -m http.server 8123
```

Then open `http://localhost:8123`.

## Scope

The page builds models and writes scripts; it does not solve them. OpenSees is a
compiled C++ library with no WebAssembly build, so the analysis itself runs in your
local Python. A future local solver bridge can post results back into this same
interface without changing the model layer.

## Licence

MIT — see [LICENSE](LICENSE).
