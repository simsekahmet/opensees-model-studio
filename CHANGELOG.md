# Changelog

All notable changes to OpenSees Model Studio are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [semantic versioning](https://semver.org/).

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
