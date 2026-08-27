"""tests/isolation.py - one analysis must not inherit another's state.

Every case a generated script runs shares a single OpenSees domain. Without a
reset between them a cyclic run started after a pushover begins from the
displaced - and, with inelastic materials, damaged - model the pushover left
behind, and from its load pattern as well, which a displacement-controlled step
goes on scaling alongside its own. The curve that comes out is wrong from its
first record and looks perfectly plausible, which is what makes it dangerous.

The check is the strongest one available: run the cyclic analysis on its own and
run it again after a pushover, and require the two curves to agree. They come
out of the same model under the same protocol, so anything but round-off between
them is state that leaked across.

    node tests/generate.mjs
    python tests/isolation.py
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"

ALONE = "cyclic"
AFTER = "pushover-then-cyclic"

# Both runs solve the same equations in the same order, so they agree to the
# last bit of a double until the solver's own round-off separates them. The
# tolerance is scaled by the peak of each column, because a curve that crosses
# zero has steps where a relative comparison means nothing.
TOLERANCE = 1e-9          # of the column's own peak


def run_script(stem: str) -> Path:
    """Runs one generated script and hands back its output directory."""
    script = OUT / f"{stem}.py"
    if not script.exists():
        raise SystemExit(f"{script} is missing - run `node tests/generate.mjs` first.")

    work = Path(tempfile.mkdtemp(prefix=f"isolation-{stem}-"))
    proc = subprocess.run([sys.executable, str(script)], cwd=work,
                          capture_output=True, text=True, timeout=1800)
    if proc.returncode != 0:
        raise SystemExit(f"{stem} did not run:\n{proc.stderr[-2000:]}")

    found = list(work.rglob("cyclic.out"))
    if not found:
        raise SystemExit(f"{stem} produced no cyclic.out.")
    return found[0]


def read_curve(path: Path) -> list[list[float]]:
    return [[float(v) for v in line.split()]
            for line in path.read_text().splitlines() if line.strip()]


def main() -> int:
    print("Analysis isolation - a cyclic run after a pushover against the same "
          "run on its own\n")

    alone = read_curve(run_script(ALONE))
    after = read_curve(run_script(AFTER))

    if not alone or not after:
        print("  FAIL one of the runs produced an empty curve.")
        return 1

    labels = ["roof displacement", "base shear", "load factor"]
    width = min(len(alone[0]), len(after[0]), len(labels))
    failures = 0

    # The first record is the one that carries the whole point: it is where a
    # pushover's leftover displacement shows up, and it is what was seen in the
    # field - 0.19116 against 0.00008.
    first_alone, first_after = alone[0][0], after[0][0]
    same_start = abs(first_after - first_alone) <= abs(first_alone) * 1e-6
    print(f"  {'ok  ' if same_start else 'FAIL'} the cyclic run starts where it should"
          f"   alone {first_alone:.8e}   after a pushover {first_after:.8e}")
    failures += 0 if same_start else 1

    if len(alone) != len(after):
        print(f"  FAIL the two curves have different lengths: "
              f"{len(alone)} against {len(after)}")
        return 1

    for column in range(width):
        peak = max(abs(row[column]) for row in alone) or 1.0
        worst = max(abs(a[column] - b[column]) for a, b in zip(alone, after))
        share = worst / peak
        ok = share <= TOLERANCE
        print(f"  {'ok  ' if ok else 'FAIL'} {labels[column]:<18}"
              f" peak {peak:>14.6f}   largest difference {worst:.3e}"
              f"   {share:.2e} of peak")
        failures += 0 if ok else 1

    print("\nNothing leaks between analyses." if not failures
          else "\nOne analysis is inheriting another's state.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
