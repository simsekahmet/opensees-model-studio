# OpenSees Model Studio

A browser-based model builder for [OpenSeesPy](https://openseespydoc.readthedocs.io/).
Define a space frame with forms instead of code, press **Build model**, and get a 3D
model, floor plans, elevations, dimensioned cross-sections, full node and element
tables, and a runnable `.py` script — all from a static page.

**Live app:** https://simsekahmet.github.io/opensees-model-studio/

**Version 1.4.0** — see [CHANGELOG.md](CHANGELOG.md).

---

## What it does

| Panel | Contents |
|---|---|
| **3D Model** | Orbitable model in stick or extruded mode, with node and element labels, supports, grid and dimension lines. Choosing a story shows its plan, choosing a frame line shows that elevation. Click any member to inspect it. |
| **Sections** | Scaled cross-section drawings with rebar layout, dimensions and section properties — including any section created by editing members, drawn the same way and listing the members that carry it. |
| **Model Data** | Story, element and node tables — tags, coordinates, restraints, lengths, section sizes, line loads and masses. |
| **Python Code** | The generated OpenSeesPy script, syntax highlighted, ready to copy or download as `.py` or as a `.ipynb` notebook with one code cell per section. |
| **Results** | A finished analysis, read back from its output folder: periods and participating mass, story drift, shear and displacement envelopes, the pushover capacity curve, the hysteresis loop, traces, the convergence history, and every recorder file with its columns named. |

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
- **Delete** removes the selected members. The grid still numbers around them,
  so every other tag is exactly where it was.
- **Ctrl + R** copies the selected members anywhere in three axes — a column to
  the story above, a beam half a bay across. Copies are members only: they carry
  no slab load and no tributary mass.
- **Insertion point** — the inspector names which part of the section the joint
  line runs through: the centroid, or any of the nine cardinal points. It is
  written out as a rigid end offset (`-jntOffset`), so a beam hung under the
  slab line is genuinely eccentric rather than merely drawn that way.

Press <kbd>?</kbd> for the full list of keys.

Every kind of edit sits on top of the parametric grid rather than replacing it:
it survives a rebuild, and `Use model values` / `Back to grid` removes it. All of
it is written into the generated script on the next **Build model**.

## Input, history and project files

Nothing you type is silently corrected. A bay width of `0`, a negative story
height or a typo is reported in red under the field and leaves the value exactly
as entered; the model cannot be built while an error stands. A list that had to
be padded or truncated to match the bay or story count says so in a note, so how
the input was read is never a guess.

Undo and redo sit in the top bar and answer to <kbd>Ctrl</kbd>+<kbd>Z</kbd> and
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>. They cover form edits, joint moves,
member edits and Reset, which asks for confirmation first.

Changing the bays or the stories asks before it clears work done by hand: moved
joints and resized, deleted or copied members were placed against a grid that is
about to move, and dragging them onto a different building is not a decision the
app should make quietly.

Every generated script and notebook carries its own model definition in a
comment block at the end, so **the file you keep to run is the file you can
reopen**. `Load model file…` takes a `.py`, an `.ipynb` or a `.json` project and
puts the sections, materials and analysis settings back in the panel on the
left. `Export project (.json)` writes the same thing on its own.

The app also keeps its state in the browser's local storage — and tells you when
it cannot, rather than losing the model when the tab closes.

## Reading the results back

The page builds models and writes scripts; it does not solve them. What it can
do is read the answer back. Run the generated script, then drop its output
folder onto the **Results** tab.

That works because the script writes `manifest.json` next to the recorder files.
Recorder output is bare columns of numbers with no header; the manifest names
every column — which node, which degree of freedom, which element, which
component — and carries the node coordinates, the element table, the story
levels and the support nodes with it. So a result set is self-describing, both
here and in whatever tools you read it with.

| From | You get |
|---|---|
| `manifest.json` | column names, model geometry, story levels, supports, case metadata |
| `node_disp.out` | displacement of every node, every step |
| `reactions.out` | reactions at the nodes that carry the supports |
| `element_local_envelope.out` | N, Vy, Vz, T, My, Mz envelopes at both ends of every member |
| `element_envelope.out` | the same in global directions, which story shear is summed from |
| `mode_shapes.out`, `periods.out` | mode shapes, periods and participating mass |
| `pushover.out`, `cyclic.out` | roof displacement, base shear and iterations per step |
| `convergence.out` | time, iterations and test norm per step of a time history |

Member forces are envelopes rather than a full history on purpose: twelve
components for every member at every step of a cyclic run is tens of megabytes
and is almost never read, while the minimum, the maximum and the largest
magnitude are what a member is checked against.

In the 3D view the same results drive a deformed shape at any scale, animated
mode shapes, and N–V–M diagrams along the members.

Everything you set in the sidebar maps onto a real OpenSeesPy command:

- **Materials** — `Elastic`, `Concrete01`, `Concrete02`, `Concrete04`, `ElasticPP`,
  `Steel01`, `Steel02`, `Hysteretic`, with Mander confinement applied to the core fibers.
- **Sections** — `Elastic` with cracked-section modifiers, `Fiber` built from `patch`
  and `layer` calls, `NDFiber` over an `ElasticIsotropic` or `J2Plasticity` nDMaterial,
  and the built-in `RCCircularSection`. Any of them can be wrapped in a
  `section('Aggregator', …)` that adds elastic shear and torsion. `Elastic` keeps the
  material response linear; the others give material nonlinearity, while geometric
  nonlinearity is set separately by the transformation.

  The remaining documented sections are deliberately not offered: `WFSection2d`,
  `RCSection2d`, `Uniaxial` and `Bidirectional` are two-dimensional and cannot carry
  an ndm 3 frame member, `ElasticMembranePlateSection`, `PlateFiber` and `LayeredShell`
  are shell sections, `Isolator2spring` belongs to an isolator element and `Pipe` to
  the pipe elements.
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
  main.js            entry point; wires the build pipeline
  schema.js          declarative catalogue of every parameter
  state.js           parameter store: validation, undo history, project files
  units.js           unit systems (kN·m, N·mm, kip·in) and formatting
  version.js         release number and the Python versions it targets
  model/
    sections.js      cross-section geometry, stiffness and fiber layout
    builder.js       grid → nodes, elements, loads, masses, diaphragms
  codegen/
    openseespy.js    emits the parametric OpenSeesPy script
    notebook.js      the same script as a .ipynb
  results/
    load.js          reads an output folder back through manifest.json
    derive.js        story drift, story shear, base shear, member envelopes
  viewer/
    viewer.js        WebGL scene, 3D/plan/elevation cameras, picking
  ui/
    shell.js         theme, tabs, toasts, confirmations, downloads
    form.js          renders the sidebar from schema.js
    reports.js       Sections, Model Data and inspector panels
    results.js       the Results panel
    charts.js        the SVG plotting the results are drawn with
tests/
  generate.mjs       writes one script per variant, headlessly
  roundtrip.mjs      a model must survive the trip out and back
  run_variants.py    runs them against real openseespy
  equilibrium.py     statics check on fixed and isolated bases
  results.py         end-to-end check of the result pipeline
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

The verification suite lives in [`tests/`](tests/) and you can run it yourself:

```bash
npm test
```

`generate.mjs` imports the app's own builder and code generator — the same
modules the browser loads — and writes one script per variant. Around a hundred
are produced, walking the catalogues rather than a hard-coded list, so every
material model, isolator, friction model, damper, element, transformation,
solver option and analysis case is covered, along with moved joints and edited
members. `run_variants.py` then runs each one against a real `openseespy`.

The last run on Python 3.12: **95 completed, 4 did not converge, 0 script
errors.** The four are `ConcreteD`, `ConfinedConcrete01`, `YamamotoBiaxialHDR`
and `multipleShearSpring` — highly nonlinear laws under a full gravity step,
valid scripts and difficult models.

`roundtrip.mjs` sends a model with hand edits out through the script, the
notebook and the project file and reads all three back, field by field: `Load
model file` is only a promise if every format survives the trip.

`equilibrium.py` closes statics end to end: the sum of the vertical base
reactions the solver reports is compared against the gravity load the builder
applied, for a fixed base, a fully isolated base and a partly isolated one. All
three balance to within the recorder's own output precision.

Three documented entries are deliberately not offered, because verification
showed they cannot run. `RambergOsgoodSteel` and `FRPConfinedConcrete` make
OpenSees print *"temporarily removed from the compiled versions"* and abort. The
`TFP` bearing is accepted at creation but then ends the gravity analysis in an
access violation inside the compiled `TFP_Bearing` element — the process dies
rather than reporting an error. Use `TripleFrictionPendulum` for the same
mechanism; it is verified.

## Running the generated script

```bash
pip install openseespy
python your_model.py
```

| | |
|---|---|
| Python | **3.9 – 3.13.** Development and verification are done on **3.12**. |
| Python 3.14 | Not supported — `openseespy` has no wheel for it yet, and the import fails with a DLL load error. |
| Extra packages | None, unless you choose the `PythonSparse` solver, which needs `numpy` and `scipy`. |

On Windows, `openseespy` ships prebuilt binaries that need the Microsoft Visual C++
redistributable; install it if the import fails with a DLL load error on a
supported Python version.

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

Copyright © 2026 Ahmet Şimşek.

Released under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/):
you may share and adapt the work for **non-commercial** purposes with credit.
Commercial use requires prior written permission. See [LICENSE](LICENSE)
and [NOTICE](NOTICE).
