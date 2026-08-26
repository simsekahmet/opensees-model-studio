# Changelog

All notable changes to OpenSees Model Studio are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [semantic versioning](https://semver.org/).

## [1.3.0] — 2026-08-26

### Fixed

- **Deleting and copying members did nothing.** `viewer.getSelection()` hands
  back the members themselves, not their tags, and both were passing that
  straight into functions expecting tags — so the delete list was keyed by
  `"[object Object]"` and matched nothing, and the copy filter never found a
  member. The toast said it had worked. Both now take the tags off the members
  they were given.
- **An unrestrained base was drawn standing on fixed supports.** `Free` is
  deliberately `null` in the restraint table, and `??` read that as "no entry"
  and substituted a fixed base. The script was always right; only the drawing
  lied. A free base now shows its joints and nothing else.
- **Extruded members ignored moved joints.** The prism was oriented from the
  member's *family* — columns up, X beams along X — rather than from its own
  ends, so a member whose joint had been moved was drawn along the old grid line
  at its new, longer length. The triad is now built the way OpenSees builds it,
  from the member's own axis and the `vecxz` its family is given, which
  reproduces the old orientation exactly for members still on the grid.

### Added

- **Frame insertion points.** The inspector offers the nine cardinal points and
  the centroid: which part of the section the joint line runs through. It is
  written out as `geomTransf(..., '-jntOffset', …)`, so the joints stay where
  they are and the member is carried off the line by a rigid offset — a spandrel
  flush with the face, a beam hung under the slab line — and the eccentricity is
  real, not a drawing shift.
- **A 3D button** in the scene toolbar. Story and elevation no longer carry a
  "back to 3D" entry of their own; they keep their choice while 3D is on, so
  stepping out to the whole model and back does not lose the floor being read.

### Changed

- The credit and licence under the sidebar warning are left-aligned.

## [1.2.0] — 2026-08-26

### Fixed

- **`ElastomericX`, `LeadRubberX` and `HDR` were wrongly flagged as shear-only.**
  They were reported as a blocking issue that would stop the analysis
  converging. All three model their own axial response — cavitation and
  buckling included — and all three converge in the verification suite. Only
  `multipleShearSpring` and `YamamotoBiaxialHDR` genuinely carry shear alone,
  and the warning now belongs to them.
- **The default convergence tolerance was unusable in metres.** `NormDispIncr`
  measures a displacement increment, so a tolerance of `1e-8` in kN·m is ten
  nanometres — a bar a nonlinear section cannot clear, leaving the run to stall
  at a norm near `1e-6` until it gave up. The default now follows the unit
  system (`1e-6` in kN·m, `1e-3` in N·mm, `1e-5` in kip·in), and the field says
  what it measures.
- **A run that stopped part way left an unreadable output directory.** OpenSees
  writes its recorder files when the domain is wiped, so an analysis that raised
  first left them empty. The script now closes itself through `atexit`: the
  manifest is written and the recorders flushed however the run ended, and the
  manifest records whether it finished.
- **"None of the result files were found" said nothing useful.** It now lists
  what it looked for, and separates files that were never handed over from files
  that were handed over empty — which are two different problems.
- **The drawer handle and its close button appeared on the desktop.** They were
  declared before `.btn`, which sets `display` at equal specificity and won on
  source order.
- **Plan views showed the supports of the base**, three stories below whatever
  floor was being looked at.

### Added

- **Load model file.** Every generated script and notebook now carries its own
  model definition in a comment block, so the file kept to run is the file that
  can be reopened. `Load model file…` reads a `.py`, an `.ipynb` or a `.json`
  project and puts the sections, materials and analysis settings back in the
  panel on the left.
- **Deleting and copying members.** `Delete` removes the selected members —
  the grid numbers around them, so every other tag is unchanged — and
  `Ctrl + R` copies them anywhere in three axes. Both are undoable and both are
  written into the generated script.
- **A keyboard shortcut list**, in the overflow menu and on `?`.
- **Support symbols that mean something.** A hatched plate for a fixed base, a
  cone on the ground for a pin, a cone on rollers for a roller.
- **`Fit view to model`**, on `F` and in the view menu, now that rebuilding no
  longer re-frames the camera by itself.

### Changed

- **The view is no longer thrown away on every build.** The camera keeps its
  angle and zoom, the story and elevation pickers keep their selection, and the
  overlay toggles are remembered across builds and across sessions.
- **Plan and Elevation are no longer tabs.** They are the same scene seen
  through a different camera, so choosing a story shows its plan and choosing a
  frame line shows that elevation — and either picker set back to its 3D entry
  returns the whole model.
- **Work done by hand is no longer carried onto a grid it was not drawn for.**
  Changing the bays or stories asks first, then clears the moved joints, resized,
  deleted and copied members rather than dragging them somewhere nobody chose.
- **The result overlays moved to the Results panel**, where the analysis they
  draw actually is.
- The legend lists only what the model contains. The page opens in light mode.
  `Download .py` is `Download Python File`. The stale-build status reads
  `Build model`. The credit and licence sit under the sidebar warning.

## [1.1.0] — 2026-08-25

### Added

- **A Results panel.** OpenSees cannot run in a browser, so results come back
  the way they left: run the generated script, then drop its output folder into
  the new **Results** tab. It shows the periods with their participating mass
  ratios, story drift, shear and displacement envelopes, the pushover capacity
  curve, the hysteresis loop, roof and base-shear traces, the convergence
  history, and every raw recorder file with its columns finally named. Any of
  them exports as CSV.
- **`manifest.json`, written by the generated script.** Recorder files are bare
  columns of numbers; the manifest says what each column is, which node or
  element it belongs to, where the stories are and which nodes carry the
  supports. It is what turns a directory of numbers back into a model — for this
  app, and for anyone reading the output with their own tools.
- **Result overlays in the 3D view.** A deformed shape at any scale, animated
  mode shapes picked by period, and N, V, M, T diagrams drawn along the members.
  They sit in the existing scene toolbar rather than behind a second navigation
  layer.
- **More from every run.** Modal participation factors, mode shapes, a pushover
  capacity curve, a cyclic hysteresis record, and a convergence history —
  iterations and test norm at every step — because a run that misbehaves is
  diagnosed from its convergence, not from its final answer.
- **A results check in the suite**, run by `npm test` or `python tests/results.py`:
  it generates a model, runs it against real openseespy, reads the output back
  through the app's own modules and asserts the numbers — that drift ratios are
  plausible, that story shear grows towards the base, that mode shapes are not
  zero vectors, that the hysteresis loop goes both ways.

### Fixed

- **Story shear was attributed to the wrong story.** Column tags count stories
  from zero, so the columns under level *L* carry story index *L−1*; the
  manifest had them one level too high, which left the top story empty and
  shifted every other one down.
- **Member force output was tens of megabytes.** A cyclic run wrote twelve
  components for every member at every step — 42 MB for a three-story frame.
  Members are now recorded as envelopes (minimum, maximum, largest magnitude),
  which is what a member is checked against, and the same output is 20 kB.

## [1.0.0] — 2026-08-25

First tagged release. Everything below is relative to the untagged state that
preceded it.

### Fixed

- **Base reactions were recorded at the wrong nodes on isolated models.** The
  reaction recorder always pointed at the superstructure base, but base
  isolation moves the restraint down to the foundation node under each bearing,
  so `reactions.out` summed to zero on a model that had otherwise solved
  correctly. The recorder now picks the node that actually carries the restraint,
  bearing by bearing, so partial isolation layouts are handled too.
- **`system('PythonSparse')` produced a script that could not run.** OpenSees
  requires a dictionary naming a solver object, and the generator emitted the
  bare command, so the script stopped with *"PythonSparse requires a dictionary
  argument"*. The script now carries a SciPy-backed solver and the correct call.
  Verified against `BandGeneral`: identical periods to machine precision.
- **Invalid input was silently replaced.** A bay width of `0` became `1`, and
  out-of-range numbers were clamped when the field lost focus. Nothing is
  substituted any more — see below.

### Added

- **Input validation.** Every numeric field and every list field is checked as
  it is typed. An unusable value is reported in red under the field, the value
  is left exactly as it was entered, and the model cannot be built while any
  error stands. A list that had to be padded or truncated to match the bay or
  story count says so in a muted note, so nothing about how the input was
  interpreted is hidden.
- **Undo and redo.** Buttons in the top bar plus <kbd>Ctrl</kbd>+<kbd>Z</kbd> /
  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>. History covers form edits,
  joint moves, member edits and Reset alike; typing in one field folds into a
  single step.
- **A confirmation before Reset**, which is also undoable afterwards.
- **Project export and import.** `Export project (.json)` writes every input,
  joint move and member edit to a file that can be reopened, archived or shared;
  `Import project…` reads it back, filling in anything a newer release added.
- **A warning when local storage is unavailable.** Private browsing and a full
  quota both fail silently at the browser API level; the app now says so in a
  toast and keeps a marker in the sidebar footer rather than losing the model
  when the tab closes.
- **A mobile layout.** The parameter panel becomes a drawer, the top bar
  actions collapse into an overflow menu, and the tab strip scrolls
  horizontally. At 390 px the page no longer overflows to 512 px, and the
  build button stays on screen.
- **A reproducible verification suite** in `tests/`. `generate.mjs` writes one
  script per variant using the app's own modules, `run_variants.py` executes
  them against real `openseespy`, and `equilibrium.py` checks that the reported
  base reactions balance the applied gravity load — including the isolated
  cases. `npm test` runs all three.
- **Version, changelog and compatibility information.** The release is shown in
  the sidebar footer and written into the header of every generated script,
  which now also states which Python versions it will run on.

### Changed

- **"Compile" is now "Build model"** throughout the interface. The app builds a
  model and writes a script; it never compiled anything.
- **Gross and effective inertia are named apart.** Section cards previously
  showed `Iz` and `Iy` from the gross geometry while the table underneath showed
  the same labels after the cracked-section modifier — roughly `0.005` against
  `0.004 m⁴` on the default column. Cards now list `Ig,z` and `Ig,y`, the
  `Stiffness modifier`, and `Ie = modifier × Ig`; tables and the inspector list
  `Ie`, which is what the generated script uses.

### Removed

- **The `TFP` bearing.** Verification found that it is created without complaint
  and then ends the gravity analysis in an access violation inside the compiled
  `TFP_Bearing` element — the process dies rather than reporting an error, so a
  script using it could never be trusted. `TripleFrictionPendulum` covers the
  same mechanism and is verified. A saved model that had `TFP` selected falls
  back to the default bearing on load; select values that no longer exist are no
  longer carried forward.

### Known issues

- Four highly nonlinear variants do not converge under a full gravity step:
  `ConcreteD`, `ConfinedConcrete01`, `YamamotoBiaxialHDR` and
  `multipleShearSpring`. The scripts themselves are valid.
