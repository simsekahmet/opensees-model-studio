"""tests/equilibrium.py - checks statics end to end on a generated model.

Runs a script that has recorders enabled, sums the vertical base reactions the
solver reports and compares them against the applied gravity load. Anything
worse than a rounding error means the loads, the tributary areas, the self
weight or the recorder's choice of nodes is wrong.

The isolated case is checked as well: with base isolation the restraint sits on
the foundation node under the bearing, so a recorder pointed at the
superstructure base would sum to zero and this check would catch it.

    node tests/generate.mjs
    python tests/equilibrium.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent

# The recorder writes about six significant figures per value, so summing a
# dozen of them leaves a rounding floor near 1e-5. The tolerance sits just above
# it: tight enough that a wrong set of nodes (which reads as ~100 % error) or a
# missing load can never pass, loose enough not to fail on output formatting.
TOLERANCE = 1e-4          # relative

CASES = [
    ("recorders", "fixed base"),
    ("isolator-elastomericBearingPlasticity", "base isolated"),
    ("isolation-partial", "partially isolated"),
]


def sum_vertical_reactions(reaction_file: Path) -> float:
    """Adds up the Z column of the last line of a reaction recorder file."""
    lines = [line for line in reaction_file.read_text().splitlines() if line.strip()]
    if not lines:
        raise SystemExit(f"{reaction_file} is empty - no reactions were recorded.")
    values = [float(v) for v in lines[-1].split()]
    # '-time' puts the pseudo-time first, then three DOF per node.
    per_node = values[1:]
    if len(per_node) % 3:
        raise SystemExit(f"{reaction_file}: unexpected column count {len(values)}.")
    return sum(per_node[2::3])


def applied_gravity(stem: str) -> float | None:
    """The total gravity load the builder put on the model, from the manifest."""
    manifest = json.loads((HERE / "out" / "manifest.json").read_text(encoding="utf8"))
    for entry in manifest:
        if entry["name"] == stem:
            return entry.get("gravityLoad")
    return None


def run_case(stem: str, label: str) -> bool:
    script = HERE / "out" / f"{stem}.py"
    if not script.exists():
        print(f"  skipped {label}: {script.name} was not generated")
        return True

    applied = applied_gravity(stem)
    if applied is None:
        print(f"  FAIL {label}: {stem} is not in manifest.json")
        return False

    with tempfile.TemporaryDirectory(prefix="osms-eq-") as work:
        proc = subprocess.run([sys.executable, str(script)], cwd=work,
                              capture_output=True, text=True, timeout=600)
        if proc.returncode != 0:
            print(f"  FAIL {label}: the script exited {proc.returncode}")
            print(proc.stderr[-800:])
            return False

        reactions = next(Path(work).rglob("reactions.out"), None)
        if reactions is None:
            print(f"  FAIL {label}: no reactions.out was written")
            return False

        vertical = sum_vertical_reactions(reactions)

    error = abs(abs(vertical) - abs(applied)) / max(abs(applied), 1e-12)
    ok = error <= TOLERANCE
    print(f"  {'ok  ' if ok else 'FAIL'} {label:<20} "
          f"reactions {vertical:14.6f}   applied {applied:14.6f}   error {error:.6%}")
    return ok


def main() -> int:
    print("Statics check - sum of vertical base reactions vs applied gravity\n")
    passed = all([run_case(stem, label) for stem, label in CASES])
    print("\nAll cases balance." if passed else "\nAt least one case does not balance.")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
