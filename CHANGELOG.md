# Changelog

All notable changes to OpenSees Model Studio are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [semantic versioning](https://semver.org/).

## [1.7.0] — 2026-08-27

### Changed

- **An elastic section no longer drags a concrete model behind it.** With the
  default `Elastic` formulation the sidebar still asked for a concrete model, a
  steel model and every parameter of both, and the script still wrote
  `uniaxialMaterial('Concrete02', …)` and `Steel02` — three materials no section
  ever referred to. The same was true of `NDFiber`, which is built from a single
  `nDMaterial`. Both are gone from the form and from the script, which now says
  in two lines what it is built from instead. **77 of the 108 variants** shed
  those definitions; equilibrium, periods, base shear and the isolation check
  come back to the digit they were at, because the materials were never read.

- **Node and element labels start off.** A tag on every joint and every member
  is noise until there is a reason to read one, and the reason is almost always
  a selection — so a selected joint or member now carries its own tag whatever
  the switches say, drawn in the selection colour and placed first, so it is
  never the label a crowd hides. The switches themselves are unchanged.

### Added

- **A folder picker and .zip support for results.** The card took a dropped
  folder or a hand-picked set of files; it now also takes `Choose folder…`, and
  a `.zip` — dropped or picked — is unpacked in the page. The reader is written
  against the format on top of the browser's own `DecompressionStream`, so the
  app keeps its one dependency. Measured on a real output folder: deflated
  1.9 MB in 65 ms, stored in 11 ms, and an archive with a trailing comment in
  58 ms — all three yielding the same nine files and the same 8 424 256
  characters. Encrypted and ZIP64 archives are refused by name.

- **The keyboard reaches the whole app.** The tab strip follows the ARIA tabs
  pattern — `aria-selected`, `aria-controls`, `role="tabpanel"`, one tab stop
  for the strip with the arrow keys, Home and End moving inside it. Dialogs
  carry `aria-labelledby`, hold the focus inside while they are open, and give
  it back to whatever opened them. The 3D view takes focus and answers the arrow
  keys by orbiting, `+` and `-` by zooming and Escape by clearing the selection,
  and a live region beside it says what the canvas is showing and what has just
  been selected.

### Fixed

- **The Python toolbar no longer pushes the page sideways on a phone.** The
  three download buttons measured 464 px inside a 390 px header, and the strip
  they sit in does not wrap, so the document scrolled 88 px to the right. Below
  640 px they fold into one `Download ▾` menu; the strip measures 147 px and the
  document does not scroll. On a wide screen nothing changes.

- **`hidden` was not hiding.** The browser hides `[hidden]` with a rule that any
  author rule outranks, so `.btn { display: flex }` was quietly overriding it and
  the `Download record .txt` button stood on screen with no record loaded. The
  attribute is given the last word once, for the whole app.

## [1.6.0] — 2026-08-27

### Fixed

- **One analysis no longer inherits another's state.** Every case a generated
  script runs shares a single OpenSees domain, and nothing reset it between
  them: a cyclic run started after a pushover began from the displaced — and,
  with inelastic materials, damaged — model the pushover left behind, and from
  its load pattern too, which a displacement-controlled step goes on scaling
  alongside its own. The curve that came out was wrong from its first record
  and looked entirely plausible. Measured on a two-storey frame: the pushover
  ended at `0.128000 m` and the cyclic run's first record was `0.127440 m`,
  against `0.000080 m` for the same cyclic analysis on its own.

  A `reset_to_gravity()` helper now removes the previous lateral pattern, takes
  every node and material back to its initial state with `ops.reset()`, and
  finds the equilibrium the load-constant gravity belongs to again. The cyclic
  curve after a pushover is now identical to the cyclic curve on its own to
  **1.0e-16 of its peak** — double-precision round-off, over all 6000 records.
  A script that runs only one lateral case is emitted exactly as before.

### Added

- **Three story drift readings instead of one.** The drift was the average
  horizontal displacement of a floor, which is its rigid-body translation when
  the diaphragm is rigid and the thing that hides a twisting floor when it is
  not. Alongside it now sit the **largest drift any single joint of the story
  sees** — each joint paired with the joint directly beneath it, which is what a
  drift limit actually has to be met at — and the **torsional irregularity
  coefficient ηbi = Δmax / Δmean**, as TBDY 2018 §3.6.2.2 and ASCE 7-22
  §12.8.4.3 define it, flagged above 1.2. On a frame stiffened along one edge
  and pushed across it: mean drift `0.996 %`, largest joint `1.704 %`,
  **ηbi = 1.713** — a torsional irregularity that the average alone reported as
  a comfortable 1 %.

  ηbi is reported only where it means something: not at a zero crossing, where
  it is two numbers on their way to zero, and not for a direction the building
  barely answered in, where a drift of a few parts in a million carries a
  lively-looking ratio about nothing.

- **`tests/isolation.py`**, which runs the cyclic analysis on its own and again
  after a pushover and requires the two curves to agree. It fails on the code
  before this release with exactly the numbers above, and is now part of
  `npm test`.
- **A `pushover-then-cyclic` variant**, so two lateral cases on one domain are
  exercised against real openseespy.
- **Drift assertions in `results_check.mjs`**: no joint may drift less than the
  floor average, and ηbi has to match the two drifts it is derived from.

## [1.5.5] — 2026-08-27

### Fixed

- **An insertion point no longer breaks the joint line in the frame view.** The
  offset was applied to both views, so a column line set on its right-hand face
  was drawn as a stack of segments standing beside its own joints — which is not
  what the model says. `-jntOffset` leaves the joints exactly where they are and
  carries only the section off the line, so that is now what is drawn: the frame
  view runs unbroken from the base to the roof along the joint line, and the
  extruded view alone leans onto the face. Measured on a three-storey column
  line set to `middleRight`: frame `x = 0.000` through all three lifts, extruded
  `x = −0.250` through all three, against a joint line at `x = 0`.

### Added

- **An `insertion-points` variant** in the generation suite. Insertion points
  had no coverage at all, so the `-jntOffset` transformations and the element
  tags that point at them were never exercised against a real `openseespy`.

## [1.5.4] — 2026-08-27

### Fixed

- **A move too small to see now says so before it is made.** The move boxes are
  in the model's own length unit, and in a millimetre model a distance meant in
  metres is a thousand times too small: it lands, correctly, and nothing visible
  happens — which is indistinguishable from a dead button. Typing a distance
  under 0.4 % of the model's largest dimension now draws a caution naming both
  the fraction and the unit, so `5` in a 18 000 mm model reads *5 mm is 0.03 %
  of the model — the move will land, but it is too small to see. These boxes are
  in mm.* The move is still allowed: 5 mm is a legitimate thing to ask for.
- **The confirmation of a move now carries its unit**, for the same reason.

## [1.5.3] — 2026-08-27

### Changed

- **Slab loads and tributary masses are read from the joints as they actually
  sit.** Until now a moved joint carried the members with it but the floor it
  supported was still worked out from the nominal bay spacing, which is what the
  off-grid warning had been apologising for. Panel sizes now come from the four
  corners, and the load is scaled onto the panel's true plan area by the
  shoelace formula, so a corner dragged three metres out really does put the
  extra floor on the beams around it. Tributary mass follows the classical rule
  — a quarter of each adjoining panel — measured on those same panels, so a
  level's masses still sum to exactly the plan area it covers. On a grid with
  nothing moved the two agree by definition and the nominal spans are used
  unchanged: **103 of the 105 existing variants regenerate byte for byte**, and
  the only two that change are the two that already had moved joints. The
  generated script does the same arithmetic, and a new `moved-column-line`
  variant holds the two to each other in the statics check — **0.000001 %**.

### Added

- **`Clear all joint moves`, on the warning that reports them.** Joint moves are
  stored against joint tags, and a joint tag carries the bay count inside it, so
  changing the number of bays renumbers them; until now the only way to drop a
  move was to find and select the joint that carried it. The warning now offers
  to drop all of them at once, and Ctrl+Z brings them back.

### Fixed

- **`Apply move` no longer does nothing in silence.** With all three boxes at
  zero the button returned without a word, which reads exactly like a broken
  button — and since the boxes were reset to zero after every move, the second
  press of a repeated nudge always landed in that case. What is typed now
  survives the rebuild the move triggers, so the same step can be applied again
  and again, and a genuinely empty move says why it did nothing.
- **The move panel was rebuilt three times per move**, once by the rebuild and
  twice by the calls putting the selection back. It is rebuilt once.

- **A joint move is now watched instead of re-framed.** 1.5.2 answered "the move
  is invisible" by framing the whole model again on every move, which was the
  wrong cure: re-framing rescales everything at once, so the one thing that
  actually moved is the hardest thing to see, and it threw away the zoom and the
  angle the user had set. The camera now holds still, and the joint — drawn on
  top in the selection colour — is seen travelling to where it was sent. A move
  that carries the joint out of the frame is the only exception: `revealNodes`
  pans across to it at exactly the same distance and viewing angle, so the zoom
  survives the move.

## [1.5.2] — 2026-08-26

### Fixed

- **A joint move no longer leaves the camera where it was.** Since 1.2.0 a
  rebuild deliberately keeps the view, which is right for a change of bay width
  and wrong for a joint move: re-framing was what made the move visible in the
  first place. That one operation frames the model again; every other rebuild
  still leaves the camera alone.

## [1.5.1] — 2026-08-26

### Fixed

- **The selection was thrown away on every rebuild**, which made moving a joint
  look like it had failed. The move landed, but `setModel` cleared the selection
  and the move panel closed with it, so a second nudge had no target. Selections
  now survive a rebuild — tags are stable by design, and only a tag that no
  longer exists is dropped.
- **Restoring a selection ran before the model existed.** `compile` became
  asynchronous in 1.2.0, so the calls that put the selection back after a move or
  a member edit were working against the model that was about to be replaced.
  They wait for the rebuild now, and the inspector comes back with them.

## [1.5.0] — 2026-08-26

### Added

- **Floor slabs, as real shell elements.** One `ShellMITC4`, `ShellDKGQ` or
  `ShellNLDKGQ` per bay panel, on the four columns that bound it, over an
  `ElasticMembranePlateSection`. They are part of the structure, not a drawing:
  on the default frame the fundamental period drops from **0.335 s to 0.178 s**
  because the floor is now tied together in plane.

  Three decisions worth knowing about, each made deliberately:

  - **The shells are not loaded.** OpenSees shells refuse a surface load —
    `ShellMITC4::addLoad` rejects it outright — and with one element per panel
    the load would travel straight into the corner columns instead of along the
    beams. The slab load therefore keeps the tributary distribution that the
    statics check verifies, and the base reaction is unchanged.
  - **The slab's mass is counted once.** By default the shell is massless and
    the floor mass stays where it was, in the lumped nodal mass from the dead
    load. Choosing `From the shell density` gives the shell its own density and
    takes the slab's self weight out of the nodal mass, so the total is
    identical either way — measured at 211.603 t on all three variants.
  - **The panel spans column to column.** Using the joints that already exist
    means the slab and the frame share their whole boundary, with nothing to tie
    together afterwards. A finer mesh would need the beams split to match, which
    is a change to the tag scheme and is not in this release.

- Slabs draw as translucent panels behind the frame, follow a deformed shape or
  a mode shape like everything else, and appear in a plan only for the storey
  being looked at. They have their own view toggle and legend entry.

## [1.4.0] — 2026-08-26

### Fixed

- **The camera framed the model as if it started at the origin.** It centred on
  half the maximum extent, so a joint moved into negative X left the view
  pointing at empty space beside the building — the odd, half-off-screen picture
  after switching back to 3D. It now uses the real extents, and in a plan or an
  elevation it frames the drawn subset rather than the whole building.
- **Switching view no longer keeps the last camera.** Asking for 3D, a plan or
  an elevation means asking to see it, so the camera is framed on what was
  asked for. A rebuild still keeps the view exactly as it was.

### Removed

- **`Different section for Y-direction beams`**, with its two dimension fields.
  Y beams take the X beam's section; a beam that needs a different one is a
  decision about particular members, made by selecting them in the view and
  resizing them there.
- **`Roof dead load` and `Roof live load`.** One slab load now covers every
  floor including the roof, and the two remaining fields are named `Slab dead
  load` and `Slab live load`. A roof that carries something different is set on
  its own beams through the inspector's slab-load field.

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
