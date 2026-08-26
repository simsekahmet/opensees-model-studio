# Verification

Every script the app can produce is generated headlessly and executed against a
real `openseespy`. Nothing here is mocked: `generate.mjs` imports the same
`js/model/builder.js` and `js/codegen/openseespy.js` the browser loads, so a
passing run says the shipped generator works, not that a copy of it does.

## Requirements

| | |
|---|---|
| Node | 18 or newer (ES modules, top-level `await`) |
| Python | 3.9 – 3.13 — **3.12 is what these runs are done on** |
| Packages | `pip install openseespy` (and `numpy scipy` for the PythonSparse variant) |

Python 3.14 has no `openseespy` wheel yet and fails on import with a DLL load
error, so the suite cannot run there.

## Running it

```bash
node tests/generate.mjs
node tests/roundtrip.mjs
python tests/run_variants.py
python tests/equilibrium.py
python tests/results.py
```

Or in one step, if you have npm available:

```bash
npm test
```

`generate.mjs` writes one script per variant into `tests/out/` along with a
`manifest.json`. Neither directory is committed.

## What each check proves

**`run_variants.py`** runs every generated script in its own interpreter and
sorts the outcome into four buckets:

| Result | Meaning |
|---|---|
| `ok` | the script ran to completion |
| `no-convergence` | the script is valid; the model did not converge |
| `error` | the script itself failed — a generator bug |
| `timeout` | the script did not finish in time |

Only `error` and `timeout` fail the run. Non-convergence is a property of the
model — a highly nonlinear concrete law under a full gravity step, say — and
is reported rather than treated as a defect.

Filter to one family while working on it:

```bash
python tests/run_variants.py --filter isolator-
```

**`equilibrium.py`** is the statics check. It sums the vertical base reactions
the solver actually reports and compares them with the gravity load the builder
applied, for a fixed base, a fully isolated base and a partly isolated one.

The isolated cases are the point of the check. With base isolation the restraint
moves down to the foundation node under each bearing, so a reaction recorder
left pointing at the superstructure base sums to zero — a wrong answer that
looks like a working model. That regression is exactly what this catches.

**`results.py`** closes the loop. It generates one model with every kind of
output turned on, runs it, and then reads the output directory back through the
app's own `results/load.js` and `results/derive.js` — the same code the browser
uses — asserting that the numbers mean what the panel says they mean:

- every file the manifest lists was found, and every displacement column carries
  its node tag
- drift ratios are in a plausible range
- story shear grows towards the base, which is the one thing a lateral analysis
  must do
- member end forces come back as a complete local set, with a non-zero peak to
  scale diagrams against
- mode shapes are not zero vectors and periods descend
- the pushover curve advances under positive base shear, and the hysteresis loop
  goes both ways

A result reader that is never run against a real analysis is not a reader, it is
a hope.

**`roundtrip.mjs`** guards `Load model file`. It builds a model unlike the
defaults — different materials, a circular column, isolators, dampers — moves a
joint, resizes a member, deletes one and copies another, then sends the whole
thing out through the generated script, the notebook and the project file and
reads each one back. Every field is compared, and the rebuilt model must have
the same nodes and elements. A script that was not written here has to be
refused rather than half-loaded.

## Coverage

The variant list in `generate.mjs` walks the catalogues rather than hard-coding
names, so adding a material, isolator, damper or friction model to
`js/model/*.js` adds a test case with no change here. Around a hundred scripts
are produced, covering:

- all three unit systems
- every section kind, with and without the aggregator wrap
- every concrete and steel material model that is offered
- every beam-column element, transformation and integration scheme
- every isolator, friction model, damper type and damper configuration
- the solver stack: `system`, `constraints`, `numberer`, `algorithm`
- modal, pushover and cyclic analyses, recorders and rigid diaphragms
- moved joints and per-member dimension edits

## Known results

The last full run on Python 3.12: **95 completed, 4 did not converge, 0 script
errors.** The four are `ConcreteD`, `ConfinedConcrete01`, `YamamotoBiaxialHDR`
and `multipleShearSpring` — highly nonlinear laws under a full gravity step.

Three documented entries are deliberately not offered, each withdrawn because a
run like this one showed it could not work:

| Entry | What OpenSees does |
|---|---|
| `RambergOsgoodSteel` | prints *"temporarily removed from the compiled versions"* and aborts |
| `FRPConfinedConcrete` | the same |
| `TFP` | is created without complaint, then ends the gravity analysis in an access violation inside `TFP_Bearing` — the process dies rather than reporting an error |

`TripleFrictionPendulum` covers the same mechanism as `TFP` and is verified.
